import test from "node:test";
import assert from "node:assert/strict";
import { summarize, summaryFor } from "../src/basessummary.js";
import { BDate } from "../src/bases.js";

test("column totals", () => {
	const v = [3, "4.5", null, "x", [2]];
	assert.equal(summarize("Sum", v), "9.5");
	assert.equal(summarize("Average", v), "3.17");
	assert.equal(summarize("Median", v), "3");
	assert.equal(summarize("Min", v), "2");
	assert.equal(summarize("Max", v), "4.5");
	assert.equal(summarize("Range", v), "2.5");
	assert.equal(summarize("Filled", v), "4");
	assert.equal(summarize("Empty", v), "1");
	assert.equal(summarize("Unique", ["a", "A", "b", ""]), "2");
	assert.equal(summarize("Checked", [true, false, null, true]), "2");
	assert.equal(summarize("Unchecked", [true, false, null, true]), "2");
	assert.equal(summarize("Sum", ["x"]), "");
});

test("date totals", () => {
	const v = ["2026-10-01", new BDate(new Date(2026, 9, 5).getTime(), true), null];
	assert.equal(summarize("Earliest", v), "2026-10-01");
	assert.equal(summarize("Latest", v), "2026-10-05");
	assert.equal(summarize("Range", v), "4 days");
});

test("summary for a column", () => {
	const same = (a, b) => a.replace(/^note\./, "") === b.replace(/^note\./, "");
	assert.equal(summaryFor({ summaries: { price: "Sum" } }, "note.price", same), "Sum");
	assert.equal(summaryFor({}, "note.price", same), null);
});

import { unread, readFiles } from "../src/ocr.js";
test("pictures and PDFs to read", () => {
	const files = [{ path: "a.png", version: "1" }, { path: "b.pdf", version: "2" }, { path: "c.mp3", version: "1" }, { path: "d.jpg", version: "1" }];
	const index = { "a.png": { version: "1", text: "hello" }, "b.pdf": { version: "1", text: "old" }, "gone.png": { version: "1", text: "x" } };
	assert.deepEqual(unread(files, index).map((f) => f.path), ["b.pdf", "d.jpg"]);
	assert.deepEqual(readFiles(files, index).map((f) => f.path), ["a.png", "b.pdf"]);
});
