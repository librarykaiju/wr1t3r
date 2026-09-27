import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { eventBody, slimEvent } from "../worker/calendar.js";
import * as A from "../src/agenda.js";

crypto.subtle.timingSafeEqual ??= (a, b) => Buffer.from(a).equals(Buffer.from(b));

const env = {
	WR1T3R_TOKEN: "t", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "sec", GOOGLE_REFRESH_TOKEN: "r1",
	GOOGLE_TOKEN_URL: "https://g/token", GOOGLE_API: "https://g/api",
};
const call = (e, path, init = {}) =>
	worker.fetch(new Request("https://w" + path, { ...init, headers: { Authorization: "Bearer t", ...init.headers } }), e);

function fakeGoogle() {
	const seen = [];
	const real = globalThis.fetch;
	globalThis.fetch = async (url, init = {}) => {
		seen.push({ url: String(url), init });
		const u = new URL(url);
		const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
		if (u.pathname === "/token") return j({ access_token: "a1", expires_in: 3600 });
		if (u.pathname === "/api/users/me/calendarList") return j({ items: [
			{ id: "me@x", primary: true, selected: true, summary: "Me", backgroundColor: "#f00", accessRole: "owner", defaultReminders: [{ method: "popup", minutes: 10 }] },
			{ id: "hidden", summary: "Hidden", selected: false, accessRole: "reader" },
			{ id: "fam", summary: "Family", selected: true, accessRole: "writer" },
		] });
		if (u.pathname === "/api/calendars/me%40x/events") return j({ items: [
			{ id: "b", summary: "Later", start: { dateTime: "2026-09-28T15:00:00Z" }, end: { dateTime: "2026-09-28T16:00:00Z" }, reminders: { useDefault: true } },
			{ id: "x", status: "cancelled", start: {}, end: {} },
		] });
		if (u.pathname === "/api/calendars/fam/events") return j({ items: [
			{ id: "a", summary: "Earlier", start: { date: "2026-09-28" }, end: { date: "2026-09-29" }, reminders: { useDefault: false, overrides: [{ method: "email", minutes: 60 }] } },
		] });
		if (init.method === "POST" && /^\/api\/calendars\/[^/]+\/events$/.test(u.pathname)) return j({ id: "new", ...JSON.parse(init.body) });
		return j({ error: { message: "nope" } }, 404);
	};
	return { seen, restore: () => (globalThis.fetch = real) };
}

test("events come from shown calendars only, merged in order, with alert minutes", async () => {
	const g = fakeGoogle();
	try {
		const r = await call(env, "/api/calendar/events?from=2026-09-28T00:00:00Z&to=2026-09-30T00:00:00Z");
		const body = await r.json();
		assert.equal(r.status, 200);
		assert.deepEqual(body.calendars.map((c) => [c.name, c.shown, c.writable]), [["Me", true, true], ["Hidden", false, false], ["Family", true, true]]);
		assert.deepEqual(body.events.map((e) => [e.id, e.alerts]), [["a", []], ["b", [10]]]);
		assert.equal(g.seen.filter((s) => s.url.endsWith("/token")).length, 1);
		await call(env, "/api/calendar/events?from=2026-09-28T00:00:00Z&to=2026-09-30T00:00:00Z");
		assert.equal(g.seen.filter((s) => s.url.endsWith("/token")).length, 1, "access token is reused");
		const only = await (await call(env, "/api/calendar/events?from=2026-09-28T00:00:00Z&to=2026-09-30T00:00:00Z&calendars=fam,nope")).json();
		assert.deepEqual(only.events.map((e) => e.id), ["a"], "only the asked-for calendars, and only real ones");
		assert.equal(only.calendars.length, 3);
		const add = await call(env, "/api/calendar/events", { method: "POST", body: JSON.stringify({ title: "Lunch", start: "2026-09-28T12:00", end: "2026-09-28T13:00", timeZone: "America/Chicago", reminder: 15 }) });
		assert.equal(add.status, 200);
		const sent = JSON.parse(g.seen.at(-1).init.body);
		assert.deepEqual(sent.start, { dateTime: "2026-09-28T12:00:00", timeZone: "America/Chicago" });
		assert.deepEqual(sent.reminders, { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] });
		assert.ok(g.seen.at(-1).url.endsWith("/api/calendars/primary/events"));
		const fam = await call(env, "/api/calendar/events", { method: "POST", body: JSON.stringify({ title: "Picnic", allDay: true, start: "2026-10-03", calendarId: "fam" }) });
		assert.equal(fam.status, 200);
		assert.equal((await fam.json()).event.calendar, "fam");
		assert.ok(g.seen.at(-1).url.endsWith("/api/calendars/fam/events"));
	} finally { g.restore(); }
});

test("calendar routes need the token, the setup, and a sane range", async () => {
	assert.equal((await call(env, "/api/calendar/events?from=a&to=b", { headers: { Authorization: "Bearer no" } })).status, 401);
	const bare = await call({ WR1T3R_TOKEN: "t" }, "/api/calendar/events?from=2026-09-28T00:00:00Z&to=2026-09-29T00:00:00Z");
	assert.equal(bare.status, 404);
	assert.equal((await bare.json()).setup, true);
	assert.equal((await call(env, "/api/calendar/events?from=2026-01-01T00:00:00Z&to=2026-12-01T00:00:00Z")).status, 400);
});

test("event bodies: all-day end is the day after, bad input is refused", () => {
	assert.deepEqual(eventBody({ title: "Trip", allDay: true, start: "2026-10-01", end: "2026-10-03" }).end, { date: "2026-10-04" });
	assert.deepEqual(eventBody({ title: "Day", allDay: true, start: "2026-12-31" }).end, { date: "2027-01-01" });
	assert.deepEqual(eventBody({ title: "x", allDay: true, start: "2026-10-01", reminder: "none" }).reminders, { useDefault: false, overrides: [] });
	for (const bad of [null, { title: "" }, { title: "x", start: "2026-10-01T10:00", end: "2026-10-01T09:00", timeZone: "UTC" }, { title: "x", start: "10am", end: "11am", timeZone: "UTC" }]) {
		assert.throws(() => eventBody(bad));
	}
	assert.deepEqual(slimEvent({ id: "1", start: { date: "2026-10-01" }, end: { date: "2026-10-02" } }, { id: "c" }).alerts, []);
});

test("agenda: days, all-day spans, alerts and form fields", () => {
	const events = [
		{ id: "t", title: "Standup", start: "2026-09-28T09:00:00", end: "2026-09-28T09:15:00", alerts: [10, 0] },
		{ id: "a", title: "Trip", allDay: true, start: "2026-09-28", end: "2026-09-30", alerts: [] },
	];
	const days = A.byDay(events, new Date(2026, 8, 28, 13), 3);
	assert.deepEqual(days.map((d) => [d.key, d.events.map((e) => e.id)]), [["2026-09-28", ["a", "t"]], ["2026-09-29", ["a"]], ["2026-09-30", []]]);
	assert.equal(A.dayLabel(new Date(2026, 8, 29), new Date(2026, 8, 28, 23)), "Tomorrow");
	const at = new Date("2026-09-28T08:50:00").getTime();
	assert.deepEqual(A.dueAlerts(events, at - 1000, at).map((d) => d.minutes), [10]);
	assert.deepEqual(A.dueAlerts(events, at, at + 30 * 60000), [], "too late to be useful");
	assert.equal(A.alertText({ event: events[0], minutes: 60 }), "Standup starts in 1 hour");
	assert.equal(A.nextEvent(events, new Date("2026-09-28T09:10:00")).id, "t");
	assert.deepEqual(A.formEvent({ title: " Late ", date: "2026-09-28", startTime: "23:00", endTime: "00:30", reminder: "10" }, "UTC"),
		{ title: "Late", allDay: false, location: "", start: "2026-09-28T23:00", end: "2026-09-29T00:30", timeZone: "UTC", reminder: 10 });
	assert.equal(A.formEvent({ title: "x", allDay: true, date: "2026-09-28", reminder: "" }).reminder, undefined);
});
