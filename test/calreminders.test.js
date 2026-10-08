import { test } from "node:test";
import assert from "node:assert/strict";
import { eventIdFor, reminderEvent, plan, prune, PER_PASS } from "../src/calreminders.js";
import { eventBody } from "../worker/calendar.js";

const at = (s) => new Date(s).getTime();
const r = (title, when, path = "Tasks.md") => ({ title, at: at(when), path });

test("event ids are base32hex and the same for the same reminder", () => {
	const a = eventIdFor(r("Call Sam", "2026-10-09T14:30"));
	assert.match(a, /^[0-9a-v]{5,1024}$/);
	assert.equal(a, eventIdFor(r("Call Sam", "2026-10-09T14:30")));
	assert.notEqual(a, eventIdFor(r("Call Sam", "2026-10-09T15:30")));
	assert.notEqual(a, eventIdFor(r("Call Sam", "2026-10-09T14:30", "Other.md")));
});

test("a reminder's event", () => {
	const e = reminderEvent(r("Call Sam", "2026-10-09T14:30", "Lists/To Do's List.md"), "America/Chicago");
	assert.equal(e.title, "⏰ Call Sam");
	assert.equal(e.start, "2026-10-09T14:30");
	assert.equal(e.end, "2026-10-09T14:45");
	assert.equal(e.reminder, 0);
	assert.match(e.description, /To Do's List/);
	const body = eventBody(e);
	assert.equal(body.id, e.id);
	assert.equal(body.transparency, "transparent");
	assert.deepEqual(body.reminders, { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] });
	assert.equal(eventBody({ ...e, id: "Not-Valid!" }).id, undefined);
});

test("a pass adds what's new and removes what's gone", () => {
	const now = at("2026-10-08T10:00");
	const keep = r("Keep", "2026-10-09T09:00"), gone = r("Gone", "2026-10-09T10:00"), fresh = r("Fresh", "2026-10-08T12:00");
	const past = r("Past", "2026-10-08T08:00"), far = r("Far", "2026-11-30T08:00");
	const sent = { [eventIdFor(keep)]: { at: keep.at }, [eventIdFor(gone)]: { at: gone.at }, [eventIdFor(past)]: { at: past.at }, oldone: { at: at("2026-10-08T09:00") } };
	const p = plan([keep, fresh, past, far], sent, now);
	assert.deepEqual(p.add.map((x) => x.title), ["Fresh"]);
	assert.deepEqual(p.remove, [eventIdFor(gone)]);
	const many = Array.from({ length: 40 }, (_, i) => r("T" + i, new Date(now + (i + 1) * 3600000).toISOString()));
	assert.equal(plan(many, {}, now).add.length, PER_PASS);
	assert.deepEqual(Object.keys(prune({ a: { at: now - 2 * 864e5 }, b: { at: now - 3600000 } }, now)), ["b"]);
});
