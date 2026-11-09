import { test } from "node:test";
import assert from "node:assert/strict";
import { mergedCalendar } from "../src/calmerge.js";

// A calendar source that records what it was asked.
function source(name, cals, events, { fail } = {}) {
	const calls = [];
	return {
		calls,
		async events(from, to, ids) { calls.push(["events", ids]); if (fail) throw fail; return { calendars: cals, events }; },
		async addEvent(b) { calls.push(["add", b.calendarId]); return { id: "new", calendar: b.calendarId || cals.find((c) => c.primary).id, title: b.title }; },
		async deleteEvent(c, id) { calls.push(["delete", c, id]); return { deleted: true }; },
		async importEvents(c, evs) { calls.push(["import", c, evs.length]); return { imported: evs.length, failed: [] }; },
		async addCalendar(n) { calls.push(["addCalendar", n]); return "wr1t3r-reminders"; },
	};
}
const google = (opts) => source("google", [{ id: "me@gmail.com", name: "me@gmail.com", primary: true, shown: true }, { id: "work", name: "Work", primary: false, shown: false }], [{ id: "g1", calendar: "me@gmail.com", start: "2026-11-10T09:00" }], opts);
const nextcloud = (opts) => source("nc", [{ id: "personal", name: "Personal", primary: true, shown: true }, { id: "wr1t3r-reminders", name: "wr1t3r reminders", primary: false, shown: true }], [{ id: "a.ics", calendar: "personal", start: "2026-11-10T08:00" }], opts);
const merge = (base, extra, o = {}) => mergedCalendar({ runBase: (fn) => fn(base), extra, ...o });

test("both sides' calendars and events show together, Google's main calendar first", async () => {
	const g = google(), n = nextcloud();
	const r = await merge(g, n).events(0, 1, null);
	assert.deepEqual(r.calendars.map((c) => [c.id, c.primary]), [["me@gmail.com", true], ["work", false], ["nc:personal", false], ["nc:wr1t3r-reminders", false]]);
	assert.deepEqual(r.events.map((e) => [e.id, e.calendar]), [["a.ics", "nc:personal"], ["g1", "me@gmail.com"]]);
});

test("picked calendars are split between the sides", async () => {
	const g = google(), n = nextcloud();
	await merge(g, n).events(0, 1, ["work", "nc:personal"]);
	assert.deepEqual(g.calls[0], ["events", ["work"]]);
	assert.deepEqual(n.calls[0], ["events", ["personal"]]);
});

test("adding, deleting and importing go to the side the calendar belongs to", async () => {
	const g = google(), n = nextcloud();
	const m = merge(g, n);
	await m.events(0, 1, null);
	assert.equal((await m.addEvent({ title: "x", calendarId: "nc:personal" })).calendar, "nc:personal");
	await m.addEvent({ title: "y", calendarId: "work" });
	await m.addEvent({ title: "z" });
	await m.deleteEvent("nc:personal", "a.ics|20261110T140000Z");
	await m.deleteEvent("me@gmail.com", "g1");
	await m.importEvents("nc:wr1t3r-reminders", [{}, {}]);
	assert.equal(await m.addCalendar("wr1t3r reminders"), "nc:wr1t3r-reminders");
	assert.deepEqual(n.calls.slice(1), [["add", "personal"], ["delete", "personal", "a.ics|20261110T140000Z"], ["import", "wr1t3r-reminders", 2], ["addCalendar", "wr1t3r reminders"]]);
	assert.deepEqual(g.calls.slice(1), [["add", "work"], ["add", undefined], ["delete", "me@gmail.com", "g1"]]);
});

test("with only the notebook's calendar on the usual side, Nextcloud's main calendar is the main one", async () => {
	const nb = source("notebook", [{ id: "notebook", name: "Calendar", primary: true, shown: true }], []), n = nextcloud();
	const m = merge(nb, n, { extraFirst: () => true });
	const r = await m.events(0, 1, null);
	assert.deepEqual(r.calendars.map((c) => [c.id, c.primary]), [["nc:personal", true], ["nc:wr1t3r-reminders", false], ["notebook", false]]);
	await m.addEvent({ title: "no calendar named" });
	assert.deepEqual(n.calls.at(-1), ["add", undefined]);
});

test("one side failing still shows the other", async () => {
	const down = new Error("Couldn't reach your Nextcloud");
	const told = [];
	const r = await merge(google(), nextcloud({ fail: down }), { onExtraError: (e) => told.push(e) }).events(0, 1, null);
	assert.deepEqual(r.calendars.map((c) => c.id), ["me@gmail.com", "work"]);
	assert.deepEqual(told, [down]);
	const warned = [];
	const r2 = await merge(google({ fail: new Error("Google is down") }), nextcloud(), { warn: (e) => warned.push(e.message) }).events(0, 1, null);
	assert.deepEqual(r2.calendars.map((c) => [c.id, c.primary]), [["nc:personal", true], ["nc:wr1t3r-reminders", false]]);
	assert.deepEqual(warned, ["Google is down"]);
	await assert.rejects(merge(google({ fail: new Error("both") }), nextcloud({ fail: down })).events(0, 1, null), /both/);
});
