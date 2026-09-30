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
	const day = new Date(2026, 8, 30, 14, 5);
	const cyc = (doc) => apply(at(doc), cycleCheckbox(at(doc), day)).sliceDoc();
	assert.equal(cyc("buy milk|"), "- [ ] buy milk");
	assert.equal(cyc("- buy milk|"), "- [ ] buy milk");
	assert.equal(cyc("- [ ] buy milk|"), "- [x] buy milk ✅ 2026-09-30");
	assert.equal(cyc("- [x] buy milk ✅ 2026-09-30|"), "- [ ] buy milk");
	assert.equal(cyc("\t1. step|"), "\t1. [ ] step");
	assert.equal(cyc("> - [ ] quoted|"), "> - [x] quoted ✅ 2026-09-30");
	assert.equal(cyc("|"), "- [ ] ");
	// The cursor lands after the new box, so typing goes into the task, and
	// stays before a new done date.
	const after = (doc) => show(apply(at(doc), cycleCheckbox(at(doc), day)));
	assert.equal(after("|"), "- [ ] |");
	assert.equal(after("|buy milk"), "- [ ] |buy milk");
	assert.equal(after("- |buy"), "- [ ] |buy");
	assert.equal(after("- [ ] buy|"), "- [x] buy| ✅ 2026-09-30");
});

test("Ctrl/Cmd+D deletes the line; Ctrl+Enter works on a Mac too", () => {
	assert.equal(DEFAULT_KEYS["Delete line"], "Mod-d");
	assert.equal(bindings().byKey.get("Mod-d"), "Delete line");
	assert.equal(macAlias("Ctrl-Enter"), "Mod-Enter");
	assert.equal(macAlias("Ctrl-b"), null); // the Mac's own Ctrl keys stay free
});

import { keyName, showKey, usableKey, bindings, rebind, DEFAULT_KEYS, macAlias } from "../src/hotkeys.js";

const ev = (code, key, mods = {}) => ({ code, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test("key names come from the physical key, with Cmd as Mod on a Mac", () => {
	assert.equal(keyName(ev("KeyB", "b", { ctrlKey: true }), false), "Mod-b");
	assert.equal(keyName(ev("KeyB", "b", { metaKey: true }), true), "Mod-b");
	assert.equal(keyName(ev("KeyB", "b", { ctrlKey: true }), true), "Ctrl-b");
	assert.equal(keyName(ev("KeyF", "F", { ctrlKey: true, shiftKey: true }), false), "Mod-Shift-f");
	assert.equal(keyName(ev("BracketRight", "}", { ctrlKey: true, shiftKey: true }), false), "Mod-Shift-]");
	assert.equal(keyName(ev("KeyN", "˜", { altKey: true }), true), "Alt-n"); // Option changes the character, not the key
	assert.equal(keyName(ev("Enter", "Enter", { ctrlKey: true }), false), "Mod-Enter");
	assert.equal(keyName(ev("Minus", "-", { ctrlKey: true }), false), "Mod--");
	assert.equal(keyName(ev("ControlLeft", "Control", { ctrlKey: true }), false), null);
});

test("keys read as Ctrl+Shift+F, or ⌘⇧F on a Mac", () => {
	assert.equal(showKey("Mod-Shift-f", false), "Ctrl+Shift+F");
	assert.equal(showKey("Mod-Shift-f", true), "⌘⇧F");
	assert.equal(showKey("Mod-Enter", false), "Ctrl+Enter");
	assert.equal(showKey("Mod--", false), "Ctrl+-");
	assert.equal(showKey("Alt-ArrowUp", true), "⌥↑");
	assert.equal(showKey(undefined, false), "");
	assert.ok(usableKey("Mod-b") && usableKey("Alt-x") && usableKey("F5"));
	assert.ok(!usableKey("b") && !usableKey("Shift-b") && !usableKey(null));
});

test("changing a hotkey takes it off whatever had it, and resets tidy up", () => {
	let c = rebind({}, "Heading 1", "Mod-b");
	assert.deepEqual(c, { "Heading 1": "Mod-b", "Bold": "" });
	let k = bindings(c);
	assert.equal(k.byKey.get("Mod-b"), "Heading 1");
	assert.equal(k.byLabel.Bold, undefined);
	c = rebind(c, "Bold", null); // Bold back to Ctrl+B: Heading 1 loses it, which is its default (none)
	assert.deepEqual(c, {});
	assert.equal(bindings(c).byKey.get("Mod-b"), "Bold");
	assert.deepEqual(rebind({}, "Italic", ""), { "Italic": "" });
	assert.equal(bindings({ Italic: "" }).byKey.has(DEFAULT_KEYS.Italic), false);
});
