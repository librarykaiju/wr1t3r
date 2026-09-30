import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { dataviewBlocks, blockBodyChange } from "../src/dataview.js";

// Rewrites the first ```lang block's body, as the planner, task list and cards blocks do.
function rewrite(doc, lang, text) {
	const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
	ensureSyntaxTree(state, state.doc.length, 5000);
	const b = dataviewBlocks(state, lang)[0];
	return state.update({ changes: blockBodyChange(state, b, text) }).state.doc.toString();
}

test("a block's body is rewritten between its fences, whatever was there", () => {
	const L = "wr1t3r-planner";
	assert.equal(rewrite("```wr1t3r-planner\ntimeline:\n  - A\n```\n\n# Notes\n", L, "timeline:\n  - B"), "```wr1t3r-planner\ntimeline:\n  - B\n```\n\n# Notes\n");
	assert.equal(rewrite("```wr1t3r-planner\ntimeline:\n  - A\n```\n# Notes\n", L, ""), "```wr1t3r-planner\n```\n# Notes\n");
	assert.equal(rewrite("```wr1t3r-planner\n```\n", L, "x: 1"), "```wr1t3r-planner\nx: 1\n```\n");
	// A blank line left in the block (by the old code) is replaced, not glued onto the fence.
	assert.equal(rewrite("```wr1t3r-planner\n\n```\n", L, "x: 1"), "```wr1t3r-planner\nx: 1\n```\n");
	assert.equal(rewrite("```wr1t3r-cards\n- link: \"[[A]]\"\n```", "wr1t3r-cards", ""), "```wr1t3r-cards\n```");
});
