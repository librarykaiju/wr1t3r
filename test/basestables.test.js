import { test } from "node:test";
import assert from "node:assert/strict";
import { tablesIn, pickTable, tableRecords, cellValue } from "../src/basestables.js";
import { readBase, runView } from "../src/bases.js";
import { summarize } from "../src/basessummary.js";

const NOTE = `---
type: budget
month: 2026-03-01
---
Intro | not a table

## Income

| Source | Amount |
| --- | ---: |
| Pay | $3,000 |

## Spending

| Category | Budget | Spent |
| :-- | --: | --: |
| Rent | $1,500 | $1,500.00 |
| Groceries | 400 | **420.50** |
|  |  |  |
| **Total** | $1,900 | $1,920.50 |
<!-- wr1t3r formulas v2: C4 = SUM(C:C) -->

\`\`\`
| Fake | Table |
| ---- | ----- |
| in | code |
\`\`\`
`;

test("tables in a note, skipping code and frontmatter", () => {
	const t = tablesIn(NOTE);
	assert.equal(t.length, 2);
	assert.deepEqual(t[1].headers, ["Category", "Budget", "Spent"]);
	assert.equal(t[1].heading, "Spending");
	assert.equal(t[1].rows.length, 4);
});

test("which table", () => {
	const t = tablesIn(NOTE);
	assert.equal(pickTable(t, true).heading, "Income");
	assert.equal(pickTable(t, 2).heading, "Spending");
	assert.equal(pickTable(t, "spending").heading, "Spending");
	assert.equal(pickTable(t, 3), null);
	assert.equal(pickTable(t, "Nope"), null);
});

test("cells become numbers, and empty and total rows drop out", () => {
	assert.equal(cellValue("$1,200.50"), 1200.5);
	assert.equal(cellValue("**42**"), 42);
	assert.equal(cellValue(""), null);
	assert.equal(cellValue("Rent"), "Rent");
	const r = tableRecords(NOTE, "Spending");
	assert.deepEqual(r.headers, ["Category", "Budget", "Spent"]);
	assert.deepEqual(r.rows, [
		{ Category: "Rent", Budget: 1500, Spent: 1500 },
		{ Category: "Groceries", Budget: 400, Spent: 420.5 },
	]);
	assert.equal(tableRecords("no table here", true), null);
});

const FILES = [
	{ path: "b/Mar.md", text: NOTE },
	{ path: "b/Apr.md", text: NOTE.replace("month: 2026-03-01", "month: 2026-04-01").replace("420.50", "380") },
	{ path: "b/Plain.md", text: "---\ntype: budget\n---\nnothing" },
];
const board = (view) => readBase(`filters:\n  and:\n    - note.type == "budget"\nviews:\n  - type: table\n    name: T\n    wr1t3r:\n      tableRows: Spending\n${view}`);

test("a board with table rows: one row per table row, the note's properties beside them", () => {
	const r = runView(board("    order: [month, Category, Spent]\n"), 0, FILES);
	assert.equal(r.total, 4);
	assert.deepEqual(r.tableHeaders, ["Category", "Budget", "Spent"]);
	assert.deepEqual(r.rows.map((x) => x.values.map(String)), [
		["2026-03-01", "Rent", "1500"], ["2026-03-01", "Groceries", "420.5"],
		["2026-04-01", "Rent", "1500"], ["2026-04-01", "Groceries", "380"],
	]);
	assert.ok(r.rows[0].tableKeys.has("category") && !r.rows[0].tableKeys.has("month"));
});

test("without an order the columns are the file name and the table's", () => {
	const r = runView(board(""), 0, FILES);
	assert.deepEqual(r.columns, ["file.name", "Category", "Budget", "Spent"]);
});

test("filter, group and add up by a table column", () => {
	const r = runView(board("    filters:\n      and:\n        - Category == \"Groceries\"\n    groupBy:\n      property: month\n"), 0, FILES);
	assert.equal(r.total, 2);
	assert.equal(r.groups.length, 2);
	assert.equal(summarize("Sum", r.rows.map((x) => x.value("Spent"))), "800.5");
	const g = runView(board("    groupBy:\n      property: Category\n"), 0, FILES);
	assert.deepEqual(g.groups.map((x) => [x.key, summarize("Sum", x.rows.map((y) => y.value("Spent")))]), [["Groceries", "800.5"], ["Rent", "3000"]]);
});

test("a table column wins over a property of the same name", () => {
	const files = [{ path: "x.md", text: "---\nCategory: Note level\n---\n| Category | N |\n| --- | --- |\n| Real | 1 |\n" }];
	const r = runView(readBase("views:\n  - type: table\n    name: T\n    wr1t3r:\n      tableRows: true\n"), 0, files);
	assert.equal(r.rows[0].value("Category"), "Real");
	assert.equal(r.rows[0].value("note.Category"), "Real");
});

test("boards without table rows are unchanged", () => {
	const r = runView(readBase(`views:\n  - type: table\n    name: T\n    order: [month]\n`), 0, FILES);
	assert.equal(r.total, 3);
	assert.equal(r.tableHeaders, undefined);
	assert.equal(r.rows[0].tableKeys, undefined);
});

test("totals read amounts written with a currency sign", () => {
	assert.equal(summarize("Sum", ["$12.50", "$7.50", "1,000", "-$5", "n/a", null]), "1015");
	assert.equal(summarize("Average", ["$10", "$20"]), "15");
});
