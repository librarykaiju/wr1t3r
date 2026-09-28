import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { linksIn, linkAt, target, resolveNote } from "../src/links.js";

const state = (doc) => {
	const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
	ensureSyntaxTree(s, doc.length, 5000);
	return s;
};

test("finds web links, autolinks, bare URLs, references and wikilinks", () => {
	const doc = "See [site](https://a.com/x \"t\") and https://b.com/y. <https://c.com> www.d.com [ref][r] [[Note#Part|alias]] ![[pic.png]] ![img](https://i.com/p.png) `https://code.com`\n\n[r]: https://e.com";
	const s = state(doc);
	const got = linksIn(s).map((l) => [doc.slice(l.from, l.to), l.url || l.note]);
	assert.deepEqual(got, [
		["[site](https://a.com/x \"t\")", "https://a.com/x"],
		["https://b.com/y", "https://b.com/y"],
		["<https://c.com>", "https://c.com"],
		["www.d.com", "https://www.d.com"],
		["[ref][r]", "https://e.com"],
		["[[Note#Part|alias]]", "Note"],
		["https://e.com", "https://e.com"],
	]);
	assert.equal(linkAt(s, doc.indexOf("alias")).heading, "Part");
	assert.equal(linkAt(s, 1), null);
});

test("only web and mail links open outside; other schemes never do", () => {
	assert.deepEqual(target("mailto:a@b.c"), { url: "mailto:a@b.c" });
	assert.equal(target("javascript:alert(1)"), null);
	assert.equal(target("//evil.com"), null);
	assert.deepEqual(target("Other%20Note.md#Top"), { note: "Other Note.md", heading: "Top" });
	assert.equal(target("#Top"), null);
});

test("notes resolve like Obsidian: relative, from the root, then by name", () => {
	const paths = ["Inbox.md", "writing/Draft.md", "writing/ideas/Draft.md", "notes/Plot.md"];
	assert.equal(resolveNote({ note: "Draft", wiki: true }, "Inbox.md", paths), "writing/Draft.md");
	assert.equal(resolveNote({ note: "ideas/Draft", wiki: true }, "Inbox.md", paths), "writing/ideas/Draft.md");
	assert.equal(resolveNote({ note: "plot", wiki: true }, null, paths), "notes/Plot.md");
	assert.equal(resolveNote({ note: "../notes/Plot.md" }, "writing/Draft.md", paths), "notes/Plot.md");
	assert.equal(resolveNote({ note: "Draft.md" }, "writing/ideas/x.md", paths), "writing/ideas/Draft.md");
	assert.equal(resolveNote({ note: "Missing", wiki: true }, null, paths), null);
});

test("footnotes jump between the reference and its definition", async () => {
	const { footnoteJump } = await import("../src/links.js");
	const doc = "Text with a note.[^1] More[^long].\n\n[^1]: The note.\n[^long]:Other";
	const s = state(doc);
	const fns = linksIn(s).filter((l) => l.footnote);
	assert.deepEqual(fns.map((l) => [l.footnote, l.def]), [["1", false], ["long", false], ["1", true], ["long", true]]);
	assert.equal(linksIn(s).filter((l) => !l.footnote).length, 0); // not taken for a note link
	assert.equal(footnoteJump(s, fns[0]), doc.indexOf("The note."));
	assert.equal(footnoteJump(s, fns[1]), doc.indexOf("Other"));
	assert.equal(footnoteJump(s, fns[2]), doc.indexOf("[^1]"));
	assert.equal(footnoteJump(s, { footnote: "none", def: false }), null);
});
