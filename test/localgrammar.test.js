import { test } from "node:test";
import assert from "node:assert/strict";
import { unitIndex, toMatches } from "../src/localgrammar.js";

const lint = (kind, start, end, msg = "m", reps = []) => ({
	lint_kind: () => kind, span: () => ({ start, end }), message: () => msg,
	suggestions: () => reps.map((r) => ({ get_replacement_text: () => r })),
});

test("code point offsets become string offsets, past emoji", () => {
	const text = "🎉 and and";
	const u = unitIndex(text);
	assert.equal(u(0), 0);
	assert.equal(u(1), 2);
	assert.equal(text.slice(u(2), u(9)), "and and");
});

test("lints become LanguageTool-shaped matches; spelling is left to the browser", () => {
	const text = "Café 🙂 is is good. Teh end.";
	const { matches } = toMatches(text, [lint("Repetition", 7, 12, "Repeated word", ["is"]), lint("Spelling", 21, 24), lint("Style", 3, 3)]);
	assert.equal(matches.length, 1);
	assert.equal(text.slice(matches[0].offset, matches[0].offset + matches[0].length), "is is");
	assert.deepEqual(matches[0].replacements, ["is"]);
	assert.equal(matches[0].rule, "Repetition");
});
