import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { calloutOf, toggleTask } from "../src/blocks.js";

test("callout types and aliases map to Obsidian's colors", () => {
	assert.deepEqual(calloutOf("> [!warning]- Careful"), { type: "warning", color: "orange", fold: "-" });
	assert.equal(calloutOf(">[!TIP] x").color, "cyan");
	assert.equal(calloutOf("> [!faq]").color, "yellow");
	assert.equal(calloutOf("> [!mystery]").color, "blue");
	assert.equal(calloutOf("> just a quote"), null);
	assert.equal(calloutOf("[!note] not quoted"), null);
});

test("toggleTask flips only the box character", () => {
	const s = EditorState.create({ doc: "- [ ] a\n- [x] b\n- [X] c\n- a" });
	assert.deepEqual(toggleTask(s, 2), { from: 3, to: 4, insert: "x" });
	assert.deepEqual(toggleTask(s, 10), { from: 11, to: 12, insert: " " });
	assert.deepEqual(toggleTask(s, 18), { from: 19, to: 20, insert: " " });
	assert.equal(toggleTask(s, 0), null);
});
