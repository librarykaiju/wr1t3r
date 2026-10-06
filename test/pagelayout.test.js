import { test } from "node:test";
import assert from "node:assert/strict";
import { readSetup, pageInches, pagePixels, pageRule, pageTwips, paginate } from "../src/pagelayout.js";

test("page setup: sizes, orientation, margins", () => {
	assert.deepEqual(readSetup({ size: "bogus", orient: "sideways" }), { size: "letter", orient: "portrait", margin: "normal" });
	assert.deepEqual(pageInches({ size: "letter", orient: "landscape", margin: "narrow" }), { w: 11, h: 8.5, margin: 0.5 });
	assert.deepEqual(pagePixels({}), { w: 816, h: 1056, margin: 96 });
	assert.equal(pageRule({ size: "a4" }), "@page { size: 8.27in 11.69in; margin: 1in; }");
	assert.deepEqual(pageTwips({}), { width: 12240, height: 15840, margin: 1440 });
});

// Lines of 10px rows; split(n) gives a made-up position from + n.
const line = (from, rows, extra = {}) => ({ from, height: rows * 10, rows, split: (n) => from + n, next: from + 100, ...extra });

test("lines that fit stay on one page", () => {
	assert.deepEqual(paginate([line(0, 3), line(100, 4)], 100), { breaks: [], pages: 1, lastFill: 30 });
});

test("a paragraph that doesn't fit splits at a row; one that can't moves whole", () => {
	const r = paginate([line(0, 8), line(100, 5)], 100);
	assert.deepEqual(r.breaks, [{ pos: 102, inline: true, fill: 0, row: 2 }]);
	assert.equal(r.pages, 2);
	assert.equal(r.lastFill, 70);
	const img = { from: 100, height: 60, rows: 1, split: () => null, next: 200 };
	assert.deepEqual(paginate([line(0, 7), img], 100).breaks, [{ pos: 100, inline: false, fill: 30 }]);
});

test("a paragraph longer than a page breaks more than once", () => {
	const r = paginate([line(0, 2), line(100, 25)], 100);
	assert.deepEqual(r.breaks.map((b) => b.pos), [108, 118]);
	assert.equal(r.pages, 3);
	assert.equal(r.lastFill, 30);
});

test("a page break starts a new page", () => {
	const r = paginate([line(0, 1, { breakAfter: true, next: 50 }), line(50, 1)], 100);
	assert.deepEqual(r.breaks, [{ pos: 50, inline: false, fill: 90 }]);
});
