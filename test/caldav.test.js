import { test } from "node:test";
import assert from "node:assert/strict";
import { nextcloudCalendar, connectCalendar, eventIcs, vtimezone, withoutOccurrence, parseCalendars, REMINDERS_CALENDAR } from "../src/caldav.js";
import { NextcloudError } from "../src/nextcloud.js";
import { AuthError } from "../src/api.js";
import { readIcs } from "../src/ics.js";
import { formEvent } from "../src/agenda.js";
import { reminderEvent } from "../src/calreminders.js";
import { fakeCaldav } from "./fakecaldav.js";

process.env.TZ = "America/Chicago"; // the times below are Chicago's, across a DST change
const TZ = "America/Chicago";

function setup(opts) {
	const dav = fakeCaldav(opts);
	const creds = { server: dav.base, user: dav.login, uid: dav.uid, password: dav.state.password };
	const c = nextcloudCalendar({ creds: () => creds, get: dav.fetch, wait: async () => {} });
	return { c, dav, creds };
}
const D = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

test("an event added from the form comes back in the agenda with its time, alert and color", async () => {
	const { c } = setup();
	const body = formEvent({ title: "Dentist; checkup", allDay: false, date: "2026-11-10", startTime: "15:00", endTime: "16:00", reminder: "30", location: "Main St, Suite 2", colorId: "11" }, TZ);
	const added = await c.addEvent(body);
	assert.equal(added.start, "2026-11-10T15:00");
	const { calendars, events } = await c.events(D("2026-11-10"), D("2026-11-11"));
	assert.deepEqual(calendars.map((x) => [x.id, x.name, x.primary, x.shown, x.writable]), [["personal", "Personal", true, true, true]]);
	assert.equal(events.length, 1);
	const e = events[0];
	assert.deepEqual({ ...e, id: undefined }, { id: undefined, calendar: "personal", title: "Dentist; checkup", allDay: false, start: "2026-11-10T15:00", end: "2026-11-10T16:00", location: "Main St, Suite 2", link: "", color: "#d50000", alerts: [30], repeats: false });
	assert.match(e.id, /\.ics$/);
	assert.equal(e.id, added.id);
});

test("an all-day event spans its days, and has no alert unless asked", async () => {
	const { c, dav } = setup();
	await c.addEvent(formEvent({ title: "Trip", allDay: true, date: "2026-11-20", endDate: "2026-11-22", reminder: "" }, TZ));
	const ics = dav.state.puts[0];
	assert.match(ics, /DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261123/);
	assert.doesNotMatch(ics, /VALARM|VTIMEZONE/);
	const [e] = (await c.events(D("2026-11-01"), D("2026-12-01"))).events;
	assert.deepEqual([e.allDay, e.start, e.end, e.alerts], [true, "2026-11-20", "2026-11-23", []]);
});

test("a weekly event keeps its wall-clock time across the end of daylight saving", async () => {
	const { c, dav } = setup();
	await c.addEvent({ ...formEvent({ title: "Choir", allDay: false, date: "2026-10-22", startTime: "19:00", endTime: "20:30", reminder: "" }, TZ), repeat: "weekly" });
	assert.match(dav.state.puts[0], /DTSTART;TZID=America\/Chicago:20261022T190000/);
	assert.match(dav.state.puts[0], /RRULE:FREQ=WEEKLY/);
	assert.match(dav.state.puts[0], /TRIGGER:-PT10M/, "a timed event gets the default 10-minute alert");
	const { events } = await c.events(D("2026-10-20"), D("2026-11-13"));
	assert.deepEqual(events.map((e) => e.start), ["2026-10-22T19:00", "2026-10-29T19:00", "2026-11-05T19:00", "2026-11-12T19:00"]);
	assert.ok(events.every((e) => e.repeats && e.id.includes("|")));
});

test("deleting one occurrence of a repeating event leaves the rest", async () => {
	const { c } = setup();
	await c.addEvent({ ...formEvent({ title: "Standup", allDay: false, date: "2026-11-02", startTime: "09:00", endTime: "09:15", reminder: "none" }, TZ), repeat: "daily" });
	const week = () => c.events(D("2026-11-02"), D("2026-11-07")).then((r) => r.events);
	const before = await week();
	assert.equal(before.length, 5);
	assert.deepEqual(await c.deleteEvent("personal", before[2].id), { deleted: true });
	assert.deepEqual((await week()).map((e) => e.start.slice(0, 10)), ["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06"]);
	assert.deepEqual(before[0].alerts, []);
	// The whole event, by its file.
	await c.deleteEvent("personal", before[0].id.split("|")[0]);
	assert.deepEqual(await week(), []);
	assert.deepEqual(await c.deleteEvent("personal", before[0].id.split("|")[0]), { deleted: true }, "already gone is fine");
});

test("deleting an all-day occurrence uses a date EXDATE, and drops a changed copy of it", () => {
	const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x", "DTSTART;VALUE=DATE:20261101", "RRULE:FREQ=DAILY", "END:VEVENT", "BEGIN:VEVENT", "UID:x", "RECURRENCE-ID;VALUE=DATE:20261103", "DTSTART;VALUE=DATE:20261104", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
	const out = withoutOccurrence(ics, "20261103");
	assert.match(out, /DTSTART;VALUE=DATE:20261101\r\nEXDATE;VALUE=DATE:20261103/);
	assert.doesNotMatch(out, /RECURRENCE-ID/);
	assert.equal(out.match(/BEGIN:VEVENT/g).length, 1);
});

test("reminders go to their calendar once; a second device's copy counts as already there", async () => {
	const { c, dav } = setup();
	const id = await c.addCalendar(REMINDERS_CALENDAR);
	assert.equal(id, "wr1t3r-reminders");
	assert.equal(await c.addCalendar(REMINDERS_CALENDAR), id, "made once");
	const r = { title: "Call mom", at: new Date(2026, 10, 10, 17, 0).getTime(), path: "Inbox/Today.md" };
	const ev = { ...reminderEvent(r, TZ), calendarId: id };
	await c.addEvent(ev);
	const ics = dav.state.puts.at(-1);
	assert.match(ics, /TRIGGER:PT0S/);
	assert.match(ics, /TRANSP:TRANSPARENT/);
	assert.ok(dav.state.calendars.get(id).events.has(ev.id + ".ics"));
	await assert.rejects(c.addEvent(ev), /already exists/);
	await c.deleteEvent(id, ev.id);
	assert.equal(dav.state.calendars.get(id).events.size, 0);
	// The reminders calendar is never the main one.
	const { calendars } = await c.events(D("2026-11-10"), D("2026-11-11"));
	assert.deepEqual(calendars.filter((x) => x.primary).map((x) => x.id), ["personal"]);
});

test("hidden, read-only and task-only calendars are handled", async () => {
	const { c, dav } = setup();
	dav.state.addCalendar("work", { name: "Work", color: "#ff0000", enabled: false });
	dav.state.addCalendar("shared", { name: "Team", writable: false });
	dav.state.addCalendar("tasks", { name: "Tasks", tasks: true });
	dav.state.drop("work", "w.ics", eventIcs({ title: "Review", start: "2026-11-10T10:00", end: "2026-11-10T11:00", timeZone: TZ }, { uid: "w" }));
	const r = await c.events(D("2026-11-10"), D("2026-11-11"));
	assert.deepEqual(r.calendars.map((x) => [x.id, x.shown, x.writable, x.color]), [["personal", true, true, "#0082c9"], ["work", false, true, "#ff0000"], ["shared", true, false, "#0082c9"]]);
	assert.deepEqual(r.events, [], "a calendar turned off in Nextcloud isn't read");
	const picked = await c.events(D("2026-11-10"), D("2026-11-11"), ["work"]);
	assert.deepEqual(picked.events.map((e) => [e.title, e.color]), [["Review", "#ff0000"]]);
	await assert.rejects(c.addEvent({ ...formEvent({ title: "x", allDay: true, date: "2026-11-10" }, TZ), calendarId: "shared" }), /403/);
});

test("importing an .ics adds each event once", async () => {
	const { c, dav } = setup();
	const events = [
		{ uid: "abc@school", title: "Exam", allDay: false, start: "2026-12-01T08:00", end: "2026-12-01T10:00", timeZone: TZ, location: "", description: "Bring pencils", recurrence: [] },
		{ uid: "def@school", title: "Break", allDay: true, start: "2026-12-20", end: "2027-01-03", timeZone: TZ, recurrence: [] },
		{ uid: "ghi@school", title: "", allDay: true, start: "2026-12-05", end: "2026-12-05", timeZone: TZ, recurrence: [] },
	];
	const r = await c.importEvents("", events);
	assert.equal(r.imported, 2);
	assert.deepEqual(r.failed, [{ title: "", error: "Give the event a title" }]);
	assert.deepEqual(await c.importEvents("", events.slice(0, 2)), { imported: 2, failed: [] }, "again: kept, not doubled");
	assert.equal(dav.state.calendars.get("personal").events.size, 2);
	assert.match(dav.state.calendars.get("personal").events.get("abc@school.ics").ics, /DESCRIPTION:Bring pencils/);
});

test("a revoked app password is a sign-in error", async () => {
	const { c, dav } = setup();
	dav.state.password = "revoked";
	await assert.rejects(c.events(D("2026-11-10"), D("2026-11-11")), AuthError);
});

test("connecting checks the account and its calendars", async () => {
	const dav = fakeCaldav();
	const go = (o) => connectCalendar({ server: "cloud.example.com", user: dav.login, password: "app-pass", get: dav.fetch, pageProtocol: "https:", ...o });
	assert.deepEqual(await go({}), { server: "https://cloud.example.com", user: "me@example.com", uid: "me", password: "app-pass" });
	await assert.rejects(go({ password: "nope" }), (e) => e instanceof NextcloudError && e.reason === "password");
	await assert.rejects(go({ server: "elsewhere.example.com" }), (e) => e instanceof NextcloudError && e.reason === "blocked");
});

test("what wr1t3r writes reads back the same with the .ics reader", () => {
	const ics = eventIcs({ title: "Line\nbreak, comma; semi \\ slash " + "é".repeat(60), start: "2026-03-08T01:30", end: "2026-03-08T03:30", timeZone: TZ, reminder: 5 }, { uid: "u1", now: new Date(0) });
	for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, "folded: " + line);
	const [e] = readIcs(ics);
	assert.equal(e.title, "Line\nbreak, comma; semi \\ slash " + "é".repeat(60));
	assert.equal(e.start, "2026-03-08T01:30");
	assert.equal(e.reminder, 5);
});

test("a time zone's daylight-saving rules come out as yearly rules", () => {
	const z = vtimezone("America/Chicago", 2026).join("\n");
	assert.match(z, /BEGIN:DAYLIGHT\nDTSTART:20260308T020000\nTZOFFSETFROM:-0600\nTZOFFSETTO:-0500\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU/);
	assert.match(z, /BEGIN:STANDARD\nDTSTART:20261101T020000\nTZOFFSETFROM:-0500\nTZOFFSETTO:-0600\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU/);
	assert.match(vtimezone("Europe/London", 2026).join("\n"), /BYMONTH=10;BYDAY=-1SU/);
	assert.match(vtimezone("Asia/Kolkata", 2026).join("\n"), /BEGIN:STANDARD\nDTSTART:19700101T000000\nTZOFFSETFROM:\+0530\nTZOFFSETTO:\+0530/);
});

test("calendar listings from other servers read the same", () => {
	const xml = `<multistatus xmlns="DAV:"><response><href>/cal/me/home/</href><propstat><prop><resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype><displayname>Home</displayname></prop><status>HTTP/1.1 200 OK</status></propstat><propstat><prop><calendar-color xmlns="http://apple.com/ns/ical/"/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response></multistatus>`;
	assert.deepEqual(parseCalendars(xml), [{ id: "home", name: "Home", color: "#0082c9", primary: true, shown: true, writable: true }]);
});
