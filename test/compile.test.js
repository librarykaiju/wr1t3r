import { test } from "node:test";
import assert from "node:assert/strict";
import { compileMarkdown, renumberFootnotes, shiftHeadings, flatten, cleanNote, leftOut, writeCompileSettings, compileSettings, PAGE_BREAK } from "../src/compile.js";
import { readBinder } from "../src/binder.js";

const texts = {
	"N/One.md": "---\ntitle: x\n---\n# One\n\nFirst[^a] line. ^blk\n\n%% not this %%\n\n[^a]: Note A.\n",
	"N/Two.md": "Second[^a] with [[One|a link]] and [[Some/Place#Heading]].\n\n## Scene\n\n[^a]: Note B.\n",
	"N/Cut.md": "---\nstatus: cut\n---\nGone.\n",
	"N/P/Three.md": "Third.\n",
};
const parts = [
	{ kind: "note", path: "N/One.md", depth: 0 },
	{ kind: "note", path: "N/Two.md", depth: 0 },
	{ kind: "note", path: "N/Cut.md", depth: 0 },
	{ kind: "folder", path: "N/P/", depth: 0 },
	{ kind: "note", path: "N/P/Three.md", depth: 1 },
];
const text = (p) => texts[p];

test("notes join in order with titles, scene breaks and renumbered footnotes", () => {
	const r = compileMarkdown(parts, {}, text);
	assert.equal(r.notes, 3);
	assert.equal(r.markdown, [
		"# One", "First[^1] line.", "[^1]: Note A.",
		"* * *",
		"# Two", "Second[^2] with a link and Place.", "### Scene", "[^2]: Note B.",
		"# P",
		"## Three", "Third.", "",
	].join("\n\n").replace(/\n\n$/, "\n"));
});

test("text only, a title page, and page breaks", () => {
	const r = compileMarkdown(parts, { headings: "none", separator: "page", title: "Book", author: "B. J." }, text);
	assert.ok(r.markdown.startsWith('<div class="title-page">\n\n# Book\n\nby B. J.\n\n</div>\n\n' + PAGE_BREAK));
	assert.ok(r.markdown.includes("First[^1] line."));
	assert.ok(!r.markdown.includes("# Two"));
	assert.ok(r.markdown.includes("## Scene"));
	assert.equal(r.markdown.split(PAGE_BREAK).length, 4); // after the title page, and between the three notes
});

test("footnotes: numbered by first use, across notes", () => {
	assert.deepEqual(renumberFootnotes("a[^x] b[^y] c[^x]\n\n[^y]: Y\n[^x]: X\n[^z]: unused", 4), { text: "a[^5] b[^6] c[^5]\n\n[^6]: Y\n[^5]: X\n[^7]: unused", next: 7 });
});

test("headings shift down, but not inside code", () => {
	assert.equal(shiftHeadings("# A\n```\n# code\n```\n###### F", 2), "### A\n```\n# code\n```\n###### F");
});

test("rendering: images, highlights, callouts and tasks", () => {
	const t = flatten("> [!warning] Careful\n> text\n- [x] done\n- [ ] todo\n==hi== ![[My Pic.png|cap]] ![[Other]]", { render: true, embed: (n) => (n === "Other" ? "EMBEDDED" : null) });
	assert.equal(t, "> **Careful**\n> text\n- ☑ done\n- ☐ todo\n<mark>hi</mark> ![cap](wr1t3r-image:My%20Pic.png) EMBEDDED");
	assert.equal(flatten("![[pic.png]]"), "![[pic.png]]"); // markdown keeps Obsidian's form
});

test("cleaning and leaving out", () => {
	assert.equal(cleanNote("---\na: 1\n---\n\nText <!-- c --> here ^id\n"), "Text  here");
	assert.ok(leftOut("---\ncompile: false\n---\nx"));
	assert.ok(!leftOut("---\nstatus: draft\n---\nx"));
});

test("settings are saved in the binder and read back", () => {
	const t = writeCompileSettings("---\ntags: [a]\ncompile:\n  title: Old\n---\n1. [[One]]\n", { title: "New: Book", author: "Me", headings: "none", separator: "blank" });
	assert.equal(t, '---\ntags: [a]\ncompile:\n  title: "New: Book"\n  author: Me\n  headings: none\n  separator: blank\n---\n1. [[One]]\n');
	assert.deepEqual(compileSettings(readBinder(t).compile), { title: "New: Book", author: "Me", headings: "none", separator: "blank" });
	assert.equal(writeCompileSettings("1. [[One]]\n", {}), "---\ncompile:\n  headings: title\n  separator: scene\n---\n1. [[One]]\n");
});
