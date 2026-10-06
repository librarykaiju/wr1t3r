import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEvent, occurrences, eventText, eventName, skipDay, notebookCalendar } from "../src/notecal.js";
import { byDay, dueAlerts, formEvent } from "../src/agenda.js";

const D = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const ev = (yaml, path = "_wr1t3r/Calendar/x.md") => parseEvent(path, `---\n${yaml}\n---\n`);

test("a timed event reads back as the agenda wants it", () => {
	const e = ev("title: Dentist\nstart: 2026-10-07T15:00\nend: 2026-10-07T16:00\nlocation: Main St\ncolor: 7\nreminder: 30");
	const [o] = occurrences(e, D("2026-10-07"), D("2026-10-08"));
	assert.equal(o.title, "Dentist");
	assert.equal(o.start, "2026-10-07T15:00");
	assert.equal(o.end, "2026-10-07T16:00");
	assert.equal(o.color, "#039be5");
	assert.deepEqual(o.alerts, [30]);
	assert.equal(o.id, "_wr1t3r/Calendar/x.md");
	assert.equal(byDay([o], D("2026-10-07"), 1)[0].events.length, 1);
	assert.equal(dueAlerts([o], D("2026-10-07").getTime() + 14.4 * 3600e3, D("2026-10-07").getTime() + 14.6 * 3600e3).length, 1);
});

test("all-day events: end is the last day in the note, the day after for the agenda", () => {
	const e = ev("title: Trip\nstart: 2026-10-07\nend: 2026-10-09");
	const [o] = occurrences(e, D("2026-10-01"), D("2026-10-31"));
	assert.equal(o.allDay, true);
	assert.equal(o.end, "2026-10-10");
	assert.deepEqual(byDay([o], D("2026-10-06"), 5).map((d) => d.events.length), [0, 1, 1, 1, 0]);
	assert.deepEqual(o.alerts, [], "no default alert for all-day");
	assert.equal(occurrences(e, D("2026-10-09"), D("2026-10-10")).length, 1, "still shows on its last day");
	assert.equal(occurrences(e, D("2026-10-10"), D("2026-10-11")).length, 0);
});

test("not an event: no frontmatter, no start, junk times", () => {
	assert.equal(parseEvent("a.md", "just text"), null);
	assert.equal(ev("title: x"), null);
	assert.equal(ev("title: x\nstart: tomorrow"), null);
	const e = ev("start: 2026-10-07T09:30\nend: 2026-10-07T08:00", "_wr1t3r/Calendar/2026-10-07 Standup.md");
	assert.equal(e.title, "Standup", "title from the note name");
	assert.equal(e.end, "2026-10-07T10:30", "a bad end becomes an hour");
});

test("weekly repeats, with a skipped week and an end", () => {
	const e = ev("title: Class\nstart: 2026-09-01T18:00\nend: 2026-09-01T19:00\nrepeat: weekly\nskip: [2026-10-13]\nuntil: 2026-10-27");
	const list = occurrences(e, D("2026-10-01"), D("2026-11-30"));
	assert.deepEqual(list.map((o) => o.start.slice(0, 10)), ["2026-10-06", "2026-10-20", "2026-10-27"]);
	assert.equal(list[0].id, "2026-10-06|_wr1t3r/Calendar/x.md");
	assert.equal(list[0].repeats, true);
});

test("monthly on the 31st lands on each month's last day; yearly; daily years later", () => {
	const m = ev("title: Rent\nstart: 2026-01-31\nrepeat: monthly");
	assert.deepEqual(occurrences(m, D("2026-02-01"), D("2026-05-01")).map((o) => o.start), ["2026-02-28", "2026-03-31", "2026-04-30"]);
	const y = ev("title: Birthday\nstart: 2020-10-08\nrepeat: yearly");
	assert.deepEqual(occurrences(y, D("2026-10-01"), D("2026-10-31")).map((o) => o.start), ["2026-10-08"]);
	const d = ev("title: Pills\nstart: 2010-01-01T08:00\nend: 2010-01-01T08:15\nrepeat: daily");
	assert.deepEqual(occurrences(d, D("2026-10-07"), D("2026-10-09")).map((o) => o.start), ["2026-10-07T08:00", "2026-10-08T08:00"]);
});

test("a timed event past midnight shows from its start", () => {
	const e = ev("title: Late\nstart: 2026-10-07T23:00\nend: 2026-10-08T01:00");
	assert.equal(occurrences(e, D("2026-10-07"), D("2026-10-08")).length, 1);
	assert.equal(occurrences(e, D("2026-10-08"), D("2026-10-09")).length, 1, "still on while it runs into the next day");
});

test("the form's body becomes a note that reads back the same", () => {
	const body = { ...formEvent({ title: "Lunch: Sam", allDay: false, date: "2026-10-07", startTime: "12:00", endTime: "13:00", reminder: "5", location: "Café", colorId: "2" }, "America/Chicago"), repeat: "weekly" };
	const text = eventText(body);
	const e = parseEvent("_wr1t3r/Calendar/a.md", text);
	assert.equal(e.title, "Lunch: Sam");
	assert.equal(e.location, "Café");
	assert.equal(e.start, "2026-10-07T12:00");
	assert.deepEqual(e.alerts, [5]);
	assert.equal(e.repeat, "weekly");
	assert.equal(eventName(body), "2026-10-07 Lunch Sam");
	assert.throws(() => eventText({ title: " ", allDay: true, start: "2026-10-07" }), /title/);
	assert.equal(parseEvent("a.md", eventText({ title: "No alert", allDay: false, start: "2026-10-07T09:00", end: "2026-10-07T10:00", reminder: "none" })).alerts.length, 0);
});

test("skipping a day adds to the list in whichever form it's in", () => {
	assert.equal(skipDay("---\ntitle: a\n---\nbody", "2026-10-07"), "---\ntitle: a\nskip: [2026-10-07]\n---\nbody");
	assert.equal(skipDay("---\nskip: [2026-10-01]\n---\n", "2026-10-07"), "---\nskip: [2026-10-01, 2026-10-07]\n---\n");
	assert.equal(skipDay("---\nskip:\n  - 2026-10-01\ntitle: a\n---\n", "2026-10-07"), "---\nskip:\n  - 2026-10-01\n  - 2026-10-07\ntitle: a\n---\n");
	assert.equal(skipDay("---\nskip: 2026-10-01\n---\n", "2026-10-07"), "---\nskip: [2026-10-01, 2026-10-07]\n---\n");
});

test("the calendar over notes: add, list, delete one occurrence, delete an event", async () => {
	const files = new Map([["Home/_wr1t3r/Calendar/old.md", "---\ntitle: Gym\nstart: 2026-10-05T07:00\nend: 2026-10-05T08:00\nrepeat: daily\n---\n"], ["Home/notes/a.md", "---\nstart: 2026-10-07\n---\n"]]);
	const cal = notebookCalendar({
		folder: () => "Home/_wr1t3r/Calendar/",
		notes: () => [...files].map(([path, text]) => ({ path, text })),
		async create(folder, name, text) { const p = folder + name + ".md"; files.set(p, text); return p; },
		async write(p, fn) { files.set(p, fn(files.get(p))); },
		async remove(p) { files.delete(p); },
	});
	const added = await cal.addEvent({ title: "Dentist", allDay: false, start: "2026-10-07T15:00", end: "2026-10-07T16:00" });
	assert.equal(added.id, "Home/_wr1t3r/Calendar/2026-10-07 Dentist.md");
	let r = await cal.events(D("2026-10-07"), D("2026-10-08"));
	assert.deepEqual(r.events.map((e) => e.title), ["Gym", "Dentist"], "notes outside the folder aren't events");
	assert.equal(r.calendars[0].writable, true);
	await cal.deleteEvent("notebook", r.events[0].id);
	await cal.deleteEvent("notebook", added.id);
	r = await cal.events(D("2026-10-07"), D("2026-10-09"));
	assert.deepEqual(r.events.map((e) => e.start), ["2026-10-08T07:00"]);
});
