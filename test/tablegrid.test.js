import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTable, inline, arrowTarget } from "../src/tablegrid.js";

test("parseTable drops the dashes row, pads short rows and reads alignment", () => {
	const t = parseTable(["| A | B | C |", "|:--|:-:|--:|", "| 1 | 2 |", "x | y | z | w"]);
	assert.deepEqual(t.aligns, ["left", "center", "right", ""]);
	assert.deepEqual(t.rows, [["A", "B", "C", ""], ["1", "2", "", ""], ["x", "y", "z", "w"]]);
});

test("inline formatting in cells", () => {
	const kinds = (tokens) => tokens.map((t) => t.type === "text" ? t.text : `${t.type}(${t.text ?? kinds(t.children)})`).join("");
	assert.equal(kinds(inline("**bold** and *em* `a|b` ~~no~~")), "strong(bold) and em(em) code(a|b) del(no)");
	const link = inline("[aftermath.site](https://aftermath.site)")[0];
	assert.deepEqual(link.link, { url: "https://aftermath.site" });
	assert.equal(inline("see https://x.com/a.")[1].link.url, "https://x.com/a");
	assert.equal(inline("[[Plot Notes|the plot]]")[0].link.note, "Plot Notes");
	assert.equal(kinds(inline("[x](javascript:alert(1))")), "[x](javascript:alert(1))");
	assert.equal(kinds(inline("a \\| b")), "a | b");
	assert.equal(kinds(inline("snake_case_name")), "snake_case_name");
});

test("left and right leave a cell only from its edge", () => {
	const box = (value, s, e = s) => ({ value, selectionStart: s, selectionEnd: e });
	const at = { row: 2, col: 1 };
	assert.deepEqual(arrowTarget(box("abc", 0, 3), 1, at, 3), { row: 2, col: 2 }); // whole cell selected
	assert.deepEqual(arrowTarget(box("abc", 0, 3), -1, at, 3), { row: 2, col: 0 });
	assert.equal(arrowTarget(box("abc", 1), 1, at, 3), null); // caret mid-text moves in the text
	assert.deepEqual(arrowTarget(box("abc", 3), 1, at, 3), { row: 2, col: 2 });
	assert.deepEqual(arrowTarget(box("abc", 0), -1, at, 3), { row: 2, col: 0 });
	assert.equal(arrowTarget(box("abc", 0), 1, at, 3), null);
	assert.equal(arrowTarget(box("", 0), -1, { row: 0, col: 0 }, 3), null); // no cell to the left
	assert.equal(arrowTarget(box("", 0), 1, { row: 0, col: 2 }, 3), null);
});
