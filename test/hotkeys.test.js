import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import { toggleMark, insertLink, cycleCheckbox } from "../src/hotkeys.js";

// doc with | for the cursor, or [ ] around a selection (anchor at [, head at ]).
function at(doc) {
	const a = doc.indexOf("["), h = doc.indexOf("]");
	if (doc.includes("|")) return EditorState.create({ doc: doc.replace("|", ""), selection: { anchor: doc.indexOf("|") } });
	return EditorState.create({ doc: doc.replace("[", "").replace("]", ""), selection: EditorSelection.single(a, h - 1) });
}
function show(state) {
	const { from, to } = state.selection.main, d = state.sliceDoc();
	return from === to ? d.slice(0, from) + "|" + d.slice(from) : d.slice(0, from) + "[" + d.slice(from, to) + "]" + d.slice(to);
}
const apply = (state, spec) => state.update(spec).state;

test("Ctrl+B and Ctrl+I wrap, unwrap and tell bold from italic", () => {
	assert.equal(show(apply(at("a [word] b"), toggleMark(at("a [word] b"), "**"))), "a **[word]** b");
	assert.equal(show(apply(at("a **[word]** b"), toggleMark(at("a **[word]** b"), "**"))), "a [word] b");
	assert.equal(show(apply(at("a [**word**] b"), toggleMark(at("a [**word**] b"), "**"))), "a [word] b");
	assert.equal(show(apply(at("a |b"), toggleMark(at("a |b"), "**"))), "a **|**b");
	assert.equal(show(apply(at("a **[word]** b"), toggleMark(at("a **[word]** b"), "*"))), "a ***[word]*** b");
	assert.equal(show(apply(at("a *[word]* b"), toggleMark(at("a *[word]* b"), "*"))), "a [word] b");
	assert.equal(show(apply(at("a ***[word]*** b"), toggleMark(at("a ***[word]*** b"), "*"))), "a **[word]** b");
});

test("Ctrl+K makes a markdown link", () => {
	assert.equal(show(apply(at("see [this] now"), insertLink(at("see [this] now")))), "see [this](|) now");
	assert.equal(show(apply(at("x |"), insertLink(at("x |")))), "x [|]()");
});

test("Ctrl+Enter cycles a checkbox like Obsidian", () => {
	const cyc = (doc) => apply(at(doc), cycleCheckbox(at(doc))).sliceDoc();
	assert.equal(cyc("buy milk|"), "- [ ] buy milk");
	assert.equal(cyc("- buy milk|"), "- [ ] buy milk");
	assert.equal(cyc("- [ ] buy milk|"), "- [x] buy milk");
	assert.equal(cyc("- [x] buy milk|"), "- [ ] buy milk");
	assert.equal(cyc("\t1. step|"), "\t1. [ ] step");
	assert.equal(cyc("> - [ ] quoted|"), "> - [x] quoted");
	assert.equal(cyc("|"), "- [ ] ");
});
