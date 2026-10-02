import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { tableGrid } from "../src/tablegrid.js";

const doc = "Above\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nBelow";
const make = (anchor) => {
	let s = EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ base: markdownLanguage }), tableGrid] });
	ensureSyntaxTree(s, s.doc.length, 5000);
	return s.update({}).state; // rebuild the grid with the parsed tree
};
const from = doc.indexOf("| a"), to = doc.indexOf("| 4 |") + 5;

test("arrowing into a grid table edits a cell and leaves the cursor", () => {
	const s = make(doc.indexOf("\n\n|") + 1); // the blank line above
	const tr = s.update({ selection: { anchor: from }, userEvent: "select" });
	assert.equal(tr.state.selection.main.head, s.selection.main.head);
	const below = make(doc.indexOf("Below"));
	const up = below.update({ selection: { anchor: to }, userEvent: "select" });
	assert.equal(up.state.selection.main.head, below.selection.main.head);
	// Up and down jump over a drawn table; that counts as entering it too.
	const over = s.update({ selection: { anchor: doc.indexOf("Below") }, userEvent: "select" });
	assert.equal(over.state.selection.main.head, s.selection.main.head);
});

test("search, clicks and moves outside tables are untouched", () => {
	const s = make(0);
	assert.equal(s.update({ selection: { anchor: from + 2 }, userEvent: "select.search" }).state.selection.main.head, from + 2);
	assert.equal(s.update({ selection: { anchor: from + 2 }, userEvent: "select.pointer" }).state.selection.main.head, from + 2);
	assert.equal(s.update({ selection: { anchor: 3 }, userEvent: "select" }).state.selection.main.head, 3);
	const end = make(doc.length);
	assert.equal(end.update({ selection: { anchor: doc.length - 2 }, userEvent: "select" }).state.selection.main.head, doc.length - 2);
	assert.equal(s.update({ selection: { anchor: from + 2 } }).state.selection.main.head, from + 2);
});

import { sortRows, sortedBy } from "../src/tablegrid.js";
import { readModel, writeModel, recalcModel } from "../src/tablecalc.js";

test("sorting keeps a totals row in place and moves overrides with their rows", () => {
	const lines = ["| Item | Qty | Price | Total |", "|---|---|---|---|", "| pear | 10 | $2 | 20 |", "| apple | 2 | $1,200 | 2400 |", "| fig | | 5 | 0 |", "| Sum | | | 2420 |"];
	const fline = "<!-- wr1t3r formulas: D = B*C; D5 = SUM(D2:D4); D4 = -->"; // the file counts the header as row 1
	const m = readModel(lines, fline);
	assert.equal(sortRows(m, 0), 1);
	assert.deepEqual(m.rows.map((r) => r[0]), ["Item", "apple", "fig", "pear", "Sum"]);
	assert.equal(m.formulas.get("D2"), ""); // fig's override moved with it
	assert.equal(m.formulas.get("D4"), "SUM(D1:D3)"); // the totals row kept its place
	assert.equal(sortedBy(m, 0), 1);
	assert.equal(sortRows(m, 0), -1); // again: Z to A
	assert.deepEqual(m.rows.map((r) => r[0]), ["Item", "pear", "fig", "apple", "Sum"]);
	sortRows(m, 2, 1); // numbers as numbers, with $ and commas; blanks last
	assert.deepEqual(m.rows.map((r) => r[2]), ["Price", "$2", "5", "$1,200", ""]);
	assert.match(writeModel(recalcModel(m)), /wr1t3r formulas/);
	const plain = readModel(["| n |", "|---|", "| 10 |", "| 9 |", "|  |", "| 100 |"], null);
	sortRows(plain, 0);
	assert.deepEqual(plain.rows.map((r) => r[0]), ["n", "9", "10", "100", ""]);
});
