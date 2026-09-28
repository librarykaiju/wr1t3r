import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import { slashEdit, taskEdit, headingEdit, wikiEdit } from "../src/kbbar.js";

const run = (doc, anchor, edit, head = anchor) => {
	const s = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
	const tr = s.update(edit(s));
	return { doc: tr.state.doc.toString(), pos: tr.state.selection.main.head };
};

test("/ goes where the slash menu sees it", () => {
	assert.deepEqual(run("", 0, slashEdit), { doc: "/", pos: 1 });
	assert.deepEqual(run("word", 4, slashEdit), { doc: "word /", pos: 6 });
	assert.deepEqual(run("word ", 5, slashEdit), { doc: "word /", pos: 6 });
});

test("task box toggles", () => {
	assert.equal(run("buy milk", 3, taskEdit).doc, "- [ ] buy milk");
	assert.equal(run("- buy milk", 3, taskEdit).doc, "- [ ] buy milk");
	assert.equal(run("  - [x] done", 3, taskEdit).doc, "  done");
	assert.equal(run("a\nb", 0, taskEdit, 3).doc, "- [ ] a\n- [ ] b");
});

test("heading cycles none to ### and back", () => {
	let doc = "Title";
	const seen = [];
	for (let i = 0; i < 4; i++) { doc = run(doc, 0, headingEdit).doc; seen.push(doc); }
	assert.deepEqual(seen, ["# Title", "## Title", "### Title", "Title"]);
});

test("[[ ]] wraps the cursor or selection", () => {
	assert.deepEqual(run("see ", 4, wikiEdit), { doc: "see [[]]", pos: 6 });
	assert.deepEqual(run("see Note", 4, wikiEdit, 8), { doc: "see [[Note]]", pos: 10 });
});

test("bar commands wrap the selection and put blocks on their own line", async () => {
	const { commandSnippet } = await import("../src/kbbar.js");
	const at = (doc, a, b = a) => EditorState.create({ doc, selection: EditorSelection.single(a, b) });
	assert.equal(commandSnippet(at("say hi", 4, 6), "**${}**").template, "**hi${}**");
	assert.equal(commandSnippet(at("a {b}", 2, 5), "**${}**").template, "**\\{b\\}${}**");
	assert.equal(commandSnippet(at("text", 4), "> ${}").template, "\n> ${}");
	assert.equal(commandSnippet(at("", 0), "> ${}").template, "> ${}");
	assert.equal(commandSnippet(at("x", 1), "`${}`").template, "`${}`");
});
