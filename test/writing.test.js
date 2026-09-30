import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { smartEdit } from "../src/writing.js";

// Types text at the | in doc, as the smart punctuation handler would.
const type = (doc, text) => {
	const at = doc.lastIndexOf("|");
	const s = EditorState.create({ doc: doc.slice(0, at) + doc.slice(at + 1), extensions: yamlFrontmatter({ content: markdown({ base: markdownLanguage }) }) });
	ensureSyntaxTree(s, s.doc.length, 5000);
	const e = smartEdit(s, at, at, text);
	const d = s.sliceDoc();
	return e ? d.slice(0, e.from) + e.insert + d.slice(e.to) : d.slice(0, at) + text + d.slice(at);
};

test("quotes curl open or closed by what's before them", () => {
	assert.equal(type('He said |', '"'), "He said “");
	assert.equal(type("He said “hi|", '"'), "He said “hi”");
	assert.equal(type("don|", "'"), "don’");
	assert.equal(type("(|", "'"), "(‘");
	assert.equal(type("|", '"'), "“");
});

test("dashes and dots between words", () => {
	assert.equal(type("wait--|", "t"), "wait—t");
	assert.equal(type("wait --|", " "), "wait — ");
	assert.equal(type("“late” --|", " "), "“late” — ");
	assert.equal(type("wait...|".replace("...|", "..|"), "."), "wait…");
});

test("markdown that must stay plain is left alone", () => {
	assert.equal(type("--|", "-"), "---", "a rule or frontmatter fence");
	assert.equal(type("- |", '"'), "- “", "a list item's text still curls");
	assert.equal(type("---\ntitle: |\n---\n", '"'), '---\ntitle: "\n---\n', "properties");
	assert.equal(type("a `code |", '"'), 'a `code "', "inline code");
	assert.equal(type("```\nx = |\n```", '"'), '```\nx = "\n```', "code block");
	assert.equal(type("see [[Brandon|", "'"), "see [[Brandon'", "a link to a note");
	assert.equal(type("[a](https://x|", "'"), "[a](https://x'", "a link address");
	assert.equal(type('<span style=|', '"'), '<span style="', "an HTML tag");
	assert.equal(type("<!--|", " "), "<!-- ", "an HTML comment");
	assert.equal(type("| a --|", " "), "| a -- ", "a table row");
	assert.equal(type("x --|", ">"), "x -->");
	assert.equal(type("../|".replace("/|", "|"), "."), "...", "dots with no word before");
});
