import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { headings, outline, activeIndex, hidden, key, plain } from "../src/toc.js";
import { cells, format, cellIndex, cellStart, tableAt } from "../src/table.js";

const state = (doc) => EditorState.create({ doc, extensions: [yamlFrontmatter({ content: markdown({ base: markdownLanguage }) })] });

test("headings come from the syntax tree, not from # anywhere", () => {
	const doc = "---\ntitle: x\n# not: a heading\n---\n## Intro\ntext\n```\n# code\n```\n### The **bold** [[Note|alias]] ##\nSetext\n===\n#hashtag\n## [Link](http://x) `code`\n";
	const h = headings(state(doc));
	assert.deepEqual(h.map((x) => [x.level, x.text]), [[2, "Intro"], [3, "The bold alias"], [1, "Setext"], [2, "Link code"]]);
	const o = outline(h);
	assert.deepEqual(o.map((x) => [x.depth, x.parent, x.hasKids]), [[1, -1, true], [2, 0, false], [0, -1, true], [1, 2, false]]);
	assert.equal(activeIndex(h, 0), -1);
	assert.equal(activeIndex(h, h[1].from), 1);
	assert.equal(activeIndex(h, doc.length), 3);
	assert.equal(hidden(o, 1, new Set([key(o[0])])), true);
	assert.equal(hidden(o, 2, new Set([key(o[0])])), false);
	assert.equal(plain("*a* __b__ ==c== ~~d~~"), "a b c d");
});

test("table cells, formatting and alignment", () => {
	assert.deepEqual(cells("| a | b \\| c | `x|y` |"), ["a", "b \\| c", "`x|y`"]);
	assert.deepEqual(cells("a | b"), ["a", "b"]);
	assert.deepEqual(format(["| Name | Qty |", "|:-|--:|", "| apple | 3 |", "| kiwi |"]), [
		"| Name  | Qty |",
		"| :---- | --: |",
		"| apple |   3 |",
		"| kiwi  |     |",
	]);
	assert.deepEqual(format(["a|b", ":-:|-", "x|y"]), ["|  a  | b   |", "| :-: | --- |", "|  x  | y   |"]);
	assert.equal(cellIndex("| a | b |", 2), 0);
	assert.equal(cellIndex("| a | b |", 6), 1);
	assert.equal(cellStart("| a   | b   |", 1), 8);
	assert.equal(cellStart("|     | b   |", 0), 2, "empty cell: just inside");
	const s = state("Intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter\n");
	const t = tableAt(s, s.doc.toString().indexOf("1"));
	assert.equal(t.row, 2);
	assert.equal(t.lines.length, 3);
	assert.equal(tableAt(s, 2), null);
});
