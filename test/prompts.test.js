import { test } from "node:test";
import assert from "node:assert/strict";
import { PROMPTS, promptFor } from "../src/prompts.js";

test("one prompt a day, and a tap moves to the next", () => {
	const d = new Date(2026, 8, 28);
	assert.equal(promptFor(d), promptFor(new Date(2026, 8, 28, 23, 59)));
	assert.notEqual(promptFor(d), promptFor(d, 1));
	assert.equal(promptFor(d, PROMPTS.length), promptFor(d));
	assert.equal(new Set(PROMPTS).size, PROMPTS.length);
	assert.ok(PROMPTS.every((p) => /[?.]$/.test(p)));
});
