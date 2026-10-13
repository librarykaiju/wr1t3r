import { test } from "node:test";
import assert from "node:assert/strict";
import { builtinTemplate } from "../src/builtintemplates.js";

test("the daily template has the planner", () => {
	const t = builtinTemplate("_templates/daily.md");
	assert.match(t, /^---\ndate: <% tp\.date\.now\("YYYY-MM-DD"\) %>\n---\n/);
	assert.match(t, /```wr1t3r-planner\ntasks: \[crit, todo\]/);
});

test("names match however they're written", () => {
	assert.equal(builtinTemplate("Daily"), builtinTemplate("_templates/daily.md"));
	assert.equal(builtinTemplate("content/_templates/Book.md"), builtinTemplate("book"));
	assert.match(builtinTemplate("book"), /type: book/);
});

test("an unknown template is null", () => {
	assert.equal(builtinTemplate("_templates/nothing.md"), null);
	assert.equal(builtinTemplate(""), null);
	assert.equal(builtinTemplate(undefined), null);
});

test("the budget templates are listed and the overview board runs over the month notes", async () => {
	const { writingTemplates } = await import("../src/builtintemplates.js");
	const { renderTemplate } = await import("../src/daily.js");
	const { readBase, runView } = await import("../src/bases.js");
	const { recalcModel, readModel } = await import("../src/tablecalc.js");
	assert.ok(["Budget month", "Budget overview"].every((n) => writingTemplates().some((t) => t.name === n)));
	const month = (title, date) => renderTemplate(builtinTemplate("Budget month"), { title, date }).text;
	const jan = month("2026-01 Budget", new Date(2026, 0, 15));
	assert.match(jan, /^---\ntitle: "2026-01 Budget"\ntype: budget\nmonth: 2026-01-01\n/);
	// The sample table is already what its formulas work out.
	const lines = jan.split("\n");
	const at = lines.findIndex((l) => l.startsWith("| Category"));
	const model = readModel(lines.slice(at, at + 10), lines[at + 10]);
	assert.deepEqual(recalcModel(model).rows, model.rows);
	const overview = renderTemplate(builtinTemplate("Budget overview"), { title: "Budget overview", date: new Date() }).text;
	const code = /```board\n([\s\S]*?)```/.exec(overview)[1];
	const fill = (text, rent, groceries) => text.replace("| Rent | $0.00 | $0.00 |", `| Rent | ${rent} | ${rent} |`).replace("| Groceries | $0.00 | $0.00 |", `| Groceries | ${groceries} | ${groceries} |`);
	const files = [
		{ path: "b/2026-01.md", text: fill(jan, "$1,500", "$400") },
		{ path: "b/2026-02.md", text: fill(month("2026-02 Budget", new Date(2026, 1, 3)), "$1,500", "$350") },
		{ path: "b/Budget overview.md", text: overview },
	];
	const base = readBase(code);
	const r = runView(base, 0, files);
	assert.equal(r.total, 14); // 7 categories x 2 months; the Total rows and the overview note are left out
	assert.equal(r.groups.length, 7);
	assert.deepEqual(r.groups.find((g) => g.key === "Groceries").rows.map((x) => x.value("Budget")), [400, 350]);
	assert.equal(runView(base, 1, files).groups.length, 2);
});
