import { test } from "node:test";
import assert from "node:assert/strict";
import { readFormulas, writeFormulas, recalc, readCell, showValue, shiftFormulas, isColumnFormula, parse } from "../src/formula.js";

const rows = (...r) => r;
const calc = (table, f) => recalc(table, new Map(Object.entries(f))).rows;

test("the formula comment reads and writes back", () => {
	const m = readFormulas('<!-- wr1t3r formulas: D = B*C; d5 = SUM(D:D); E2 = IF(A2="a;b", 1, 2); F3 = -->');
	assert.deepEqual([...m], [["D", "B*C"], ["D5", "SUM(D:D)"], ["E2", 'IF(A2="a;b", 1, 2)'], ["F3", ""]]);
	assert.equal(writeFormulas(m), '<!-- wr1t3r formulas: D = B*C; D5 = SUM(D:D); E2 = IF(A2="a;b", 1, 2); F3 = -->');
	assert.equal(readFormulas("<!-- TBLFM: @2$3=$1 -->"), null);
	assert.equal(writeFormulas(new Map()), null);
});

test("column formulas, cell formulas, totals and number looks", () => {
	const t = rows(["Item", "Cost", "Qty", "Total"], ["Pens", "$2", "3", ""], ["Ink", "$1,250.5", "2", ""], ["Sum", "", "", ""]);
	const out = calc(t, { D: "B*C", D4: "SUM(D:D)", C4: "SUM(C2:C3)" });
	assert.deepEqual(out.map((r) => r[3]), ["Total", "$6.00", "$2,501.00", "$2,507.00"]);
	assert.equal(out[3][2], "5");
	assert.equal(out[0][3], "Total"); // the header never takes a column formula
});

test("an empty cell formula keeps a typed value out of a column formula", () => {
	const out = calc([["a", "b"], ["1", ""], ["2", "typed"]], { B: "A*10", B3: "" });
	assert.deepEqual(out.map((r) => r[1]), ["b", "10", "typed"]);
});

test("arithmetic follows spreadsheet precedence", () => {
	const one = (f) => calc([["x"], [""]], { A2: f })[1][0];
	assert.equal(one("1+2*3"), "7");
	assert.equal(one("(1+2)*3"), "9");
	assert.equal(one("2^3^2"), "512");
	assert.equal(one("-2^2"), "4"); // unary minus binds tighter, like Excel
	assert.equal(one("10/4"), "2.5");
	assert.equal(one("10/3"), "3.33");
	assert.equal(one("50%*8"), "4");
	assert.equal(one('"a"&1+1'), "a2");
	assert.equal(one("1/0"), "\\#DIV/0!");
	assert.equal(one("NOPE(1)"), "\\#NAME?");
	assert.equal(one("1+"), "\\#ERROR!");
	assert.equal(one("A2+1"), "\\#CIRC!");
});

test("functions", () => {
	const t = [["n", "tag", "x"], ["4", "a", ""], ["10", "b", ""], ["1", "a", ""], ["", "", ""]];
	const f = (src) => calc(t, { C5: src })[4][2];
	assert.equal(f("AVERAGE(A2:A4)"), "5");
	assert.equal(f("MIN(A:A)"), "1");
	assert.equal(f("MAX(A:A)"), "10");
	assert.equal(f("COUNT(A:A)"), "3");
	assert.equal(f("COUNTA(B:B)"), "3");
	assert.equal(f("MEDIAN(A2:A4)"), "4");
	assert.equal(f("SUMIF(B2:B4, \"a\", A2:A4)"), "5");
	assert.equal(f("COUNTIF(A2:A4, \">3\")"), "2");
	assert.equal(f("ROUND(10/3, 1)"), "3.3");
	assert.equal(f('IF(A3>5, "big", "small")'), "big");
	assert.equal(f("IFERROR(1/0, 0)"), "0");
	assert.equal(f("UPPER(B2)&LEN(B3)"), "A1");
	assert.equal(f("AND(A2>1, A3>1)"), "TRUE");
	assert.equal(f("SUM(B:B)"), "0"); // text in a range doesn't count
	assert.equal(f("B2*2"), "\\#VALUE!");
});

test("cells read like a spreadsheet would", () => {
	assert.equal(readCell("$1,200.50").v, 1200.5);
	assert.equal(readCell("15%").v, 0.15);
	assert.equal(readCell("**42**").v, 42);
	assert.equal(readCell("-3").v, -3);
	assert.equal(readCell("3 apples").v, "3 apples");
	assert.equal(readCell("").v, null);
	assert.equal(showValue(0.125, { pct: true }), "12.5%");
	assert.equal(showValue(-5, { cur: "€" }), "-€5.00");
	assert.equal(showValue(3, { dec: 2 }), "3.00");
	assert.equal(showValue("a|b"), "a\\|b");
});

test("isColumnFormula tells B*C from B2*C2", () => {
	assert.equal(isColumnFormula("=B*C"), true);
	assert.equal(isColumnFormula("B2*C2"), false);
	assert.equal(isColumnFormula("SUM(B:B)"), true);
	assert.equal(isColumnFormula("B*C2"), false);
	assert.equal(isColumnFormula("ROUND(1,2)"), false);
	assert.doesNotThrow(() => parse("SUM(B2:B5)*2"));
});

test("adding and removing rows and columns moves references", () => {
	const f = new Map([["D", "B*C"], ["D5", "SUM(D2:D4)"], ["E2", "D5/B3"]]);
	// A row added at row 3 (index 2): rows from 3 down move one down.
	assert.deepEqual([...shiftFormulas(f, "row", 2, 1)], [["D", "B*C"], ["D6", "SUM(D2:D5)"], ["E2", "D6/B4"]]);
	// Row 3 removed: the range shrinks, B3 is gone.
	assert.deepEqual([...shiftFormulas(f, "row", 2, -1)], [["D", "B*C"], ["D4", "SUM(D2:D3)"], ["E2", "D4/#REF!"]]);
	// Column B removed.
	assert.deepEqual([...shiftFormulas(f, "col", 1, -1)], [["C", "#REF!*B"], ["C5", "SUM(C2:C4)"], ["D2", "C5/#REF!"]]);
	// A column added before A.
	assert.deepEqual([...shiftFormulas(f, "col", 0, 1)], [["E", "C*D"], ["E5", "SUM(E2:E4)"], ["F2", "E5/C3"]]);
	// Removing the formula's own row drops it.
	assert.equal(shiftFormulas(f, "row", 4, -1).has("D5"), false);
});

test("a column formula leaves rows with nothing in them empty", () => {
	const out = calc([["a", "b", "c"], ["2", "3", ""], ["", "", ""], ["", "4", ""]], { C: "A*B" });
	assert.deepEqual(out.map((r) => r[2]), ["c", "6", "", "0"]);
});
