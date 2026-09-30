import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { nextFootnote, footnoteEdit } from "../src/footnotes.js";

const insert = (doc, text, at = doc.indexOf("|")) => {
	const s = EditorState.create({ doc: doc.replace("|", ""), selection: { anchor: at } });
	const after = s.update(footnoteEdit(s, text)).state;
	const d = after.doc.toString(), c = after.selection.main.head;
	return d.slice(0, c) + "|" + d.slice(c);
};

test("numbers after the highest footnote, named ones aside", () => {
	assert.equal(nextFootnote("plain"), 1);
	assert.equal(nextFootnote("a[^1] b[^3] c[^note]\n\n[^1]: x\n[^3]: y\n[^note]: z"), 4);
});

test("puts the marker at the cursor and the text at the bottom", () => {
	assert.equal(insert("One| two.\n", "A source."), "One[^1]| two.\n\n[^1]: A source.\n");
	assert.equal(insert("One| two.", "A source."), "One[^1]| two.\n\n[^1]: A source.");
	assert.equal(insert("One|\n\n\n", "x"), "One[^1]|\n\n[^1]: x\n\n\n");
});

test("joins the footnotes already at the bottom", () => {
	assert.equal(insert("A[^1] b|.\n\n[^1]: first\n", "second"), "A[^1] b[^2]|.\n\n[^1]: first\n[^2]: second\n");
	assert.equal(insert("A[^1] b|.\n\n[^1]: first\n    more of it\n", "second"), "A[^1] b[^2]|.\n\n[^1]: first\n    more of it\n[^2]: second\n");
	assert.equal(insert("A[^1] b|.\n\n[^1]: first\n\nLater text.\n", "second"), "A[^1] b[^2]|.\n\n[^1]: first\n\nLater text.\n\n[^2]: second\n");
});

test("empty text moves the cursor to the definition", () => {
	assert.equal(insert("One| two.\n", ""), "One[^1] two.\n\n[^1]: |\n");
});

test("keeps the text on one line", () => {
	assert.equal(insert("a|", "  line one\nline two "), "a[^1]|\n\n[^1]: line one line two");
});
