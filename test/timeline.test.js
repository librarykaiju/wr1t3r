import { test } from "node:test";
import assert from "node:assert/strict";
import { timelineChanges, eventsOn, eventLine } from "../src/timeline.js";
import { applyChanges } from "../src/vaultlinks.js";

const note = [
	"---",
	"title: Daily Timeline",
	"---",
	"```dataviewjs",
	"# not a heading",
	"```",
	"",
	"# Timeline",
	"- [ ] 07:00 - 08:00 |",
	"- [ ] 08:00 - 09:00 | ",
	"- [ ] 09:00 - 10:00 |",
	"- [ ] 10:00 - 11:00 | gym",
	"- [ ] 11:00 - 12:00 |",
	"",
	"## Hydration Log",
	"- ",
].join("\n");

// Local wall-clock times, as the Worker's RFC 3339 times read on this device.
const ev = (title, start, end, allDay = false) => ({ title, start, end, allDay, calendar: "c" });
const fill = (text, events) => {
	const r = timelineChanges(text, events);
	return r && { text: applyChanges(text, r.changes), added: r.added };
};

test("an event filling an empty hour slot replaces it", () => {
	const r = fill(note, [ev("Standup", "2026-09-29T09:00:00", "2026-09-29T10:00:00")]);
	assert.equal(r.added, 1);
	assert.match(r.text, /08:00 - 09:00 \| \n- \[ \] 09:00 - 10:00 \| Standup\n- \[ \] 10:00 - 11:00 \| gym/);
});

test("a shorter event goes in time order and the slot stays", () => {
	const r = fill(note, [ev("Dentist", "2026-09-29T08:30:00", "2026-09-29T09:15:00")]);
	assert.match(r.text, /08:00 - 09:00 \| \n- \[ \] 08:30 - 09:15 \| Dentist\n- \[ \] 09:00 - 10:00 \|\n/);
});

test("a long event swallows the empty slots it covers but not written ones", () => {
	const r = fill(note, [ev("Workshop", "2026-09-29T08:00:00", "2026-09-29T12:00:00")]);
	assert.match(r.text, /07:00 - 08:00 \|\n- \[ \] 08:00 - 12:00 \| Workshop\n- \[ \] 10:00 - 11:00 \| gym\n\n## Hydration/);
});

test("all-day events go first, and pulling again adds nothing", () => {
	const events = [ev("Birthday", "2026-09-29", "2026-09-30", true), ev("Call", "2026-09-29T13:30:00", "2026-09-29T14:00:00")];
	const once = fill(note, events);
	assert.match(once.text, /# Timeline\n- \[ \] All day \| Birthday\n- \[ \] 07:00/);
	assert.match(once.text, /11:00 - 12:00 \|\n- \[ \] 13:30 - 14:00 \| Call\n\n## Hydration/);
	const twice = fill(once.text, events);
	assert.equal(twice.added, 0);
	assert.equal(twice.text, once.text);
});

test("a ticked event isn't added back", () => {
	const text = note.replace("- [ ] 11:00 - 12:00 |", "- [x] 11:00 - 11:30 | Lunch with Sam");
	assert.equal(fill(text, [ev("Lunch with Sam", "2026-09-29T11:00:00", "2026-09-29T11:30:00")]).added, 0);
});

test("Daily Timeline heading, empty section, CRLF", () => {
	const r = fill("# Daily Timeline\r\n\r\n## Notes\r\n", [ev("A", "2026-09-29T09:00:00", "2026-09-29T09:30:00")]);
	assert.equal(r.text, "# Daily Timeline\r\n- [ ] 09:00 - 09:30 | A\r\n\r\n## Notes\r\n");
	assert.equal(fill("# Timeline", [ev("A", "2026-09-29T09:00:00", "2026-09-29T09:30:00")]).text, "# Timeline\n- [ ] 09:00 - 09:30 | A");
});

test("no Timeline heading -> null", () => {
	assert.equal(timelineChanges("# Notes\n- a\n", [ev("A", "2026-09-29T09:00:00", "2026-09-29T09:30:00")]), null);
});

test("only the day's events, all-day first", () => {
	const events = [ev("B", "2026-09-29T09:00:00", "2026-09-29T10:00:00"), ev("Next", "2026-09-30T09:00:00", "2026-09-30T10:00:00"), ev("Trip", "2026-09-28", "2026-10-01", true)];
	assert.deepEqual(eventsOn(events, new Date(2026, 8, 29)).map((e) => e.title), ["Trip", "B"]);
	assert.equal(eventLine(events[0]), "- [ ] 09:00 - 10:00 | B");
});

test("items already out of order are sorted, with the lines under them", () => {
	const text = [
		"# Timeline",
		"- [ ] 14:00 - 15:00 | review",
		"    - notes for review",
		"- [ ] call Sam",
		"- [x] 09:00 - 10:00 | gym",
		"",
		"## Notes",
	].join("\n");
	const r = fill(text, [ev("Standup", "2026-09-29T09:30:00", "2026-09-29T09:45:00"), ev("Trip", "2026-09-29", "2026-09-30", true)]);
	assert.equal(r.added, 2);
	assert.equal(r.text, [
		"# Timeline",
		"- [ ] All day | Trip",
		"- [x] 09:00 - 10:00 | gym",
		"- [ ] 09:30 - 09:45 | Standup",
		"- [ ] 14:00 - 15:00 | review",
		"    - notes for review",
		"- [ ] call Sam",
		"",
		"## Notes",
	].join("\n"));
	// Nothing new, but out of order: pulling still sorts.
	const sorted = fill(text, []);
	assert.equal(sorted.added, 0);
	assert.match(sorted.text, /# Timeline\n- \[x\] 09:00 - 10:00 \| gym\n- \[ \] 14:00/);
	assert.deepEqual(timelineChanges(r.text, []).changes, []);
});
