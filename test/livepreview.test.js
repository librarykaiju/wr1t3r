import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { hiddenRanges } from "../src/livepreview.js";

const state = (doc) => {
	const s = EditorState.create({ doc, extensions: yamlFrontmatter({ content: markdown({ base: markdownLanguage }) }) });
	ensureSyntaxTree(s, s.doc.length, 5000);
	return s;
};
const shown = (doc, cursor) => {
	const s = state(doc);
	let out = "", at = 0;
	for (const [a, b] of hiddenRanges(s, 0, s.doc.length, new Set(cursor))) { out += doc.slice(at, a); at = b; }
	return out + doc.slice(at);
};

test("hides heading, emphasis, code and link markup", () => {
	assert.equal(shown("## Title\n**bold** and *it* ~~no~~ `x`"), "Title\nbold and it no x");
	assert.equal(shown("see [the site](https://a.b \"t\") now"), "see the site now");
	assert.equal(shown("a [[Note]] b [[Other|alias]] ==hi=="), "a Note b alias hi");
});

test("leaves cursor lines, code, embeds, images and frontmatter alone", () => {
	assert.equal(shown("**a**\n**b**", [1]), "**a**\nb");
	assert.equal(shown("```\n**a** [[b]]\n```"), "```\n**a** [[b]]\n```");
	assert.equal(shown("`[[x]]` ![[Embed]] ![alt](https://x.y/p.png)"), "[[x]] ![[Embed]] ![alt](https://x.y/p.png)");
	assert.equal(shown("---\ntitle: ==a==\n---\n# H"), "---\ntitle: ==a==\n---\nH");
	assert.equal(shown("| a | **b** |\n|---|---|\n| 1 | 2 |"), "| a | **b** |\n|---|---|\n| 1 | 2 |");
	assert.equal(shown("text[^1]\n\n[^1]: note [^2]"), "text1\n\n[^1]: note 2");
	assert.equal(shown("text[^1]", [1]), "text[^1]");
});
