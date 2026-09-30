import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { calloutOf, toggleTask } from "../src/blocks.js";

test("callout types and aliases map to Obsidian's colors", () => {
	assert.deepEqual(calloutOf("> [!warning]- Careful"), { type: "warning", color: "orange", icon: "alert", fold: "-", tag: [2, 14], title: "Careful" });
	assert.deepEqual(calloutOf("> [!note]").tag, [2, 9]);
	assert.equal(calloutOf("> [!note]").title, "");
	assert.equal(calloutOf("> [!mystery]").icon, "pencil");
	assert.equal(calloutOf(">[!TIP] x").color, "cyan");
	assert.equal(calloutOf("> [!faq]").color, "yellow");
	assert.equal(calloutOf("> [!mystery]").color, "blue");
	assert.equal(calloutOf("> just a quote"), null);
	assert.equal(calloutOf("[!note] not quoted"), null);
});

test("toggleTask flips the box and stamps or unstamps the done date", () => {
	const day = new Date(2026, 8, 30);
	const s = EditorState.create({ doc: "- [ ] a\n- [x] b ✅ 2026-09-29\n- [X] c\n- a" });
	assert.deepEqual(toggleTask(s, 2, day), [{ from: 3, to: 4, insert: "x" }, { from: 7, insert: " ✅ 2026-09-30" }]);
	assert.deepEqual(toggleTask(s, 10, day), [{ from: 11, to: 12, insert: " " }, { from: 15, to: 28, insert: "" }]);
	assert.deepEqual(toggleTask(s, 31, day), [{ from: 32, to: 33, insert: " " }]);
	assert.equal(toggleTask(s, 0, day), null);
});
