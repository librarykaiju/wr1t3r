import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { readModel, writeModel, recalcModel, blockAt, recalcChange } from "../src/tablecalc.js";
import { setCell, ops, editText, insertRef } from "../src/tablegrid.js";

const stateOf = (doc) => {
	const s = EditorState.create({ doc, extensions: markdown({ base: markdownLanguage }) });
	ensureSyntaxTree(s, 1e9);
	return s;
};
const TABLE = "| Item | Cost | Qty | Total |\n| :--- | ---: | --- | ----- |\n| Pens | $2 | 3 | |\n| Ink | $4 | 2 | |";

test("the formula line belongs to the table above it", () => {
	const doc = `Intro\n\n${TABLE}\n<!-- wr1t3r formulas: D = B*C -->\nAfter`;
	const s = stateOf(doc);
	const blk = blockAt(s, doc.indexOf("Ink"));
	assert.equal(s.sliceDoc(blk.from, blk.to), `${TABLE}\n<!-- wr1t3r formulas: D = B*C -->`);
	assert.equal(blockAt(s, doc.indexOf("wr1t3r formulas")).from, blk.from);
	assert.equal(blockAt(s, doc.indexOf("After")), null);
	const ch = recalcChange(s, blk);
	assert.equal(ch.insert, [
		"| Item | Cost | Qty | Total |",
		"| :--- | ---: | --- | ----- |",
		"| Pens |   $2 | 3   | $6.00 |",
		"| Ink  |   $4 | 2   | $8.00 |",
		"<!-- wr1t3r formulas: D = B*C -->",
	].join("\n"));
	// Up to date: nothing to change.
	const s2 = stateOf(`${ch.insert}\n`);
	assert.equal(recalcChange(s2, blockAt(s2, 0)), null);
	// A table without formulas is never rewritten.
	const s3 = stateOf(TABLE);
	assert.equal(recalcChange(s3, blockAt(s3, 0)), null);
});

test("typing into cells: text, cell formulas, column formulas", () => {
	const m = readModel(TABLE.split("\n"), null);
	assert.equal(setCell(m, 1, 0, "Pens"), false); // unchanged
	assert.equal(setCell(m, 1, 3, "=B2*C2"), true);
	assert.deepEqual([...m.formulas], [["D2", "B2*C2"]]);
	setCell(m, 2, 3, "=B*C");
	assert.deepEqual([...m.formulas], [["D2", "B2*C2"], ["D", "B*C"]]);
	assert.equal(editText(m, 2, 3), "=B*C");
	// A typed value in a column-formula cell keeps the formula off it.
	setCell(m, 2, 3, "n/a | none");
	assert.deepEqual([...m.formulas], [["D2", "B2*C2"], ["D", "B*C"], ["D3", ""]]);
	assert.equal(m.rows[2][3], "n/a \\| none");
	assert.equal(editText(m, 2, 3), "n/a | none");
	// The header takes text only.
	setCell(m, 0, 3, "=Total");
	assert.equal(m.rows[0][3], "=Total");
	const out = writeModel(recalcModel(m)).split("\n");
	assert.equal(out[2], "| Pens |   $2 | 3   | $6.00       |");
	assert.equal(out[3], "| Ink  |   $4 | 2   | n/a \\| none |");
	assert.equal(out[4], "<!-- wr1t3r formulas: D2 = B2*C2; D = B*C; D3 = -->");
});

test("bar actions move formulas with their cells", () => {
	const m = readModel(TABLE.split("\n"), "<!-- wr1t3r formulas: D = B*C; B4 = SUM(B2:B3) -->");
	m.rows.push(["Sum", "", "", ""]);
	assert.deepEqual(ops.addRow(m, { row: 1, col: 2 }), { row: 2, col: 2 });
	assert.deepEqual([...m.formulas], [["D", "B*C"], ["B5", "SUM(B2:B4)"]]);
	assert.equal(m.rows.length, 5);
	ops.deleteColumn(m, { row: 1, col: 0 });
	assert.deepEqual([...m.formulas], [["C", "A*B"], ["A5", "SUM(A2:A4)"]]);
	assert.deepEqual(m.aligns, ["right", "", ""]);
	ops.clearColumnFormula(m, { row: 1, col: 2 });
	assert.deepEqual([...m.formulas], [["A5", "SUM(A2:A4)"]]);
	assert.deepEqual(ops.deleteRow(m, { row: 0, col: 0 }), { row: 0, col: 0 }); // not the header
});

test("clicking cells while typing a formula", () => {
	const box = (value) => ({
		value, selectionStart: value.length, selectionEnd: value.length,
		setRangeText(t, s, e) { this.value = this.value.slice(0, s) + t + this.value.slice(e); this.selectionStart = this.selectionEnd = s + t.length; },
	});
	const a = box("=SUM(");
	insertRef(a, "B2");
	assert.equal(a.value, "=SUM(B2");
	insertRef(a, "B5", true);
	assert.equal(a.value, "=SUM(B2:B5");
	insertRef(a, "C3");
	assert.equal(a.value, "=SUM(C3");
	const b = box("=B2*");
	insertRef(b, "C2");
	assert.equal(b.value, "=B2*C2");
});
