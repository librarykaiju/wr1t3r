import { test } from "node:test";
import assert from "node:assert/strict";
import { readIcs, readTime, asRepeats, planIcs, googleEvent, icsNote } from "../src/ics.js";
import { parseEvent, occurrences } from "../src/notecal.js";

process.env.TZ = "UTC"; // the expected local times below are UTC
const D = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const cal = (...events) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");

test("times: dates, UTC, a named zone, floating", () => {
	assert.deepEqual(readTime("20261007", { VALUE: "DATE" }), { allDay: true, local: "2026-10-07" });
	const utc = readTime("20261007T150000Z");
	const want = new Date(Date.UTC(2026, 9, 7, 15));
	assert.equal(utc.local, `2026-10-${String(want.getDate()).padStart(2, "0")}T${String(want.getHours()).padStart(2, "0")}:00`);
	// 3pm in Chicago (CDT, UTC-5) is 20:00 UTC.
	const chi = readTime("20261007T150000", { TZID: "America/Chicago" });
	const at = new Date(Date.UTC(2026, 9, 7, 20));
	assert.equal(chi.local, `2026-10-${String(at.getDate()).padStart(2, "0")}T${String(at.getHours()).padStart(2, "0")}:00`);
	assert.deepEqual(readTime("20261007T150000", { TZID: "Central Standard Time" }), { allDay: false, local: "2026-10-07T15:00" }, "unknown zone: as written");
	assert.equal(readTime("junk"), null);
});

test("reads events: folded lines, escapes, all-day ends, alarms, cancelled ones", () => {
	const evs = readIcs(cal(
		["UID:a@x", "SUMMARY:Dentist\\, Dr. Lee", "DTSTART:20261007T150000", "DTEND:20261007T160000", "LOCATION:Main St", "DESCRIPTION:Bring the\\nform and a very long", " line that was folded", "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "END:VALARM"],
		["UID:b@x", "SUMMARY:Trip", "DTSTART;VALUE=DATE:20261010", "DTEND;VALUE=DATE:20261013"],
		["UID:c@x", "SUMMARY:Gone", "STATUS:CANCELLED", "DTSTART:20261007T090000"],
		["UID:d@x", "SUMMARY:Quick", "DTSTART:20261008T090000", "DURATION:PT15M"],
	));
	assert.equal(evs.length, 3);
	const [a, b, d] = evs;
	assert.equal(a.title, "Dentist, Dr. Lee");
	assert.equal(a.description, "Bring the\nform and a very longline that was folded");
	assert.equal(a.reminder, 30);
	assert.equal(a.end, "2026-10-07T16:00");
	assert.deepEqual([b.allDay, b.start, b.end], [true, "2026-10-10", "2026-10-12"]);
	assert.equal(d.end, "2026-10-08T09:15");
});

test("repeat rules the built-in calendar can and can't hold", () => {
	const [mwf, biweekly, count, monthly2nd] = readIcs(cal(
		["UID:m", "SUMMARY:Gym", "DTSTART:20261005T070000", "DTEND:20261005T080000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261231T000000Z"],
		["UID:b", "SUMMARY:Bins", "DTSTART:20261005T070000", "RRULE:FREQ=WEEKLY;INTERVAL=2"],
		["UID:c", "SUMMARY:Course", "DTSTART;VALUE=DATE:20261006", "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4"],
		["UID:t", "SUMMARY:Board", "DTSTART:20261013T180000", "RRULE:FREQ=MONTHLY;BYDAY=2TU"],
	));
	const m = asRepeats(mwf);
	assert.equal(m.simplified, false);
	assert.deepEqual(m.parts.map((p) => [p.start, p.repeat, p.until]), [["2026-10-05T07:00", "weekly", "2026-12-31"], ["2026-10-07T07:00", "weekly", "2026-12-31"], ["2026-10-09T07:00", "weekly", "2026-12-31"]]);
	assert.equal(asRepeats(biweekly).simplified, true);
	const c = asRepeats(count);
	assert.deepEqual(c.parts.map((p) => [p.start, p.until]), [["2026-10-06", "2026-10-15"], ["2026-10-08", "2026-10-15"]]);
	assert.equal(asRepeats(monthly2nd).simplified, true);
});

test("plan: notes that read back as events, past ones left out, re-imports skipped, moved occurrences", () => {
	const evs = readIcs(cal(
		["UID:class", "SUMMARY:Class", "DTSTART:20260901T180000", "DTEND:20260901T190000", "RRULE:FREQ=WEEKLY", "EXDATE:20261013T180000"],
		["UID:class", "RECURRENCE-ID:20261020T180000", "SUMMARY:Class (room 4)", "DTSTART:20261021T180000", "DTEND:20261021T190000"],
		["UID:old", "SUMMARY:Old", "DTSTART:20250101T100000"],
		["UID:soon", "SUMMARY:Soon: lunch", "DTSTART;VALUE=DATE:20261009"],
	));
	const plan = planIcs(evs, new Set(["soon"]), "2026-10-07");
	assert.equal(plan.past, 1);
	assert.equal(plan.already, 1);
	assert.equal(plan.add.length, 2);
	const [cls, moved] = plan.add.map((a) => parseEvent("_wr1t3r/Calendar/x.md", a.text));
	assert.match(plan.add[0].text, /^uid: class$/m);
	assert.deepEqual(occurrences(cls, D("2026-10-01"), D("2026-10-31")).map((o) => o.start.slice(0, 10)), ["2026-10-06", "2026-10-27"]);
	assert.equal(moved.title, "Class (room 4)");
	assert.match(plan.add[1].text, /^uid: "class\|2026-10-20"$/m);
	assert.equal(planIcs(evs, new Set(["class", "class|2026-10-20", "soon"]), "2026-10-07").add.length, 0);
});

test("a note for a title that YAML would misread", () => {
	const [e] = readIcs(cal(["UID:x", "SUMMARY:Re: plans", "DTSTART;VALUE=DATE:20261009"]));
	const text = icsNote(e, { start: e.start, end: e.end, repeat: "", until: "" });
	assert.equal(parseEvent("a.md", text).title, "Re: plans");
});

test("Google gets the rule as written and skipped days in this device's zone", () => {
	const [e] = readIcs(cal(["UID:g", "SUMMARY:Class", "DTSTART:20260901T180000", "DTEND:20260901T190000", "RRULE:FREQ=WEEKLY;INTERVAL=2", "EXDATE:20261013T180000"]));
	const g = googleEvent(e, "America/Chicago");
	assert.deepEqual(g.recurrence, ["RRULE:FREQ=WEEKLY;INTERVAL=2", "EXDATE;TZID=America/Chicago:20261013T180000"]);
	assert.equal(g.start, "2026-09-01T18:00");
	assert.equal(g.uid, "g");
});
