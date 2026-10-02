import test from "node:test";
import assert from "node:assert/strict";
import { monthGrid, movedValue, timelineBars, dateOf } from "../src/basescalendar.js";

test("a month grid starts on Sunday and covers 6 weeks", () => {
	const g = monthGrid(2026, 9); // October 2026 starts on a Thursday
	assert.equal(g.length, 42);
	assert.equal(g[0].getDay(), 0);
	assert.equal(g[0].getDate(), 27); // Sunday, 27 September
	assert.equal(g[4].getDate(), 1);
});

test("moving a note keeps its time of day", () => {
	assert.equal(movedValue("2026-10-02", "2026-10-09"), "2026-10-09");
	assert.equal(movedValue("2026-10-02T14:30", "2026-10-09"), "2026-10-09T14:30");
	assert.equal(movedValue(null, "2026-10-09"), "2026-10-09");
});

test("timeline bars sort by start and span the range", () => {
	const rows = [{ v: { s: "2026-10-10", e: "2026-10-12" } }, { v: { s: "2026-10-01" } }, { v: { s: "" } }, { v: { s: "2026-10-05", e: "2026-10-01" } }];
	const { bars, from, to } = timelineBars(rows, (row, id) => row.v[id], "s", "e");
	assert.equal(bars.length, 3);
	assert.equal(new Date(bars[0].start).getDate(), 1);
	assert.equal(bars[2].end - bars[2].start, 2 * 86400000);
	assert.equal(bars[1].end, bars[1].start, "an end before the start is ignored");
	assert.equal(new Date(to).getDate(), 12);
	assert.equal(new Date(from).getDate(), 1);
	assert.equal(dateOf(["2026-10-03"]).dateOnly, true);
});
