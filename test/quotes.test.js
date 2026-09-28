import { test } from "node:test";
import assert from "node:assert/strict";
import { QUOTES, quoteFor, dayNumber } from "../src/quotes.js";

test("same local day, same quote; next day, the next one", () => {
	const a = quoteFor(new Date(2026, 8, 28, 0, 5));
	assert.deepEqual(quoteFor(new Date(2026, 8, 28, 23, 55)), a);
	const i = QUOTES.findIndex(([t]) => t === a.text);
	assert.equal(quoteFor(new Date(2026, 8, 29, 9)).text, QUOTES[(i + 1) % QUOTES.length][0]);
	assert.equal(dayNumber(new Date(1970, 0, 2)), 1);
});

test("every quote has text, author and work, with no duplicates", () => {
	for (const q of QUOTES) assert.ok(q.length === 3 && q.every((s) => typeof s === "string" && s.trim()));
	assert.equal(new Set(QUOTES.map((q) => q[0])).size, QUOTES.length);
});
