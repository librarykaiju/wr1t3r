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
