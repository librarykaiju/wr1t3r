import { test } from "node:test";
import assert from "node:assert/strict";
import { cssClasses, isManuscript, paragraphLines } from "../src/manuscript.js";
import { compileMarkdown } from "../src/compile.js";

test("the manuscript class, as a list, a string or the old cssclass", () => {
	assert.ok(isManuscript("---\ncssclasses:\n  - manuscript\n---\nText"));
	assert.ok(isManuscript("---\ncssclasses: wide, Manuscript\n---\n"));
	assert.ok(isManuscript("---\ncssclass: manuscript\n---\n"));
	assert.deepEqual(cssClasses("---\ncssclasses: [a, b]\n---\n"), ["a", "b"]);
	assert.ok(!isManuscript("---\ntitle: x\n---\nmanuscript"));
	assert.ok(!isManuscript("cssclasses: manuscript"));
});

test("each prose line becomes its own paragraph; the rest stays", () => {
	const t = ["She ran.  ", "He followed.\\", "Dawn came.", "", "# Two", "- a", "- b", "> q", "> r", "```", "x", "y", "```", "Last", "==="].join("\n");
	assert.equal(paragraphLines(t), ["She ran.", "", "He followed.", "", "Dawn came.", "", "# Two", "- a", "- b", "> q", "> r", "```", "x", "y", "```", "Last", "==="].join("\n"));
});

test("compile splits lines only for the manuscript layout, only when rendering", () => {
	const parts = [{ kind: "note", path: "S/One.md", depth: 0 }];
	const text = () => "---\ncssclasses: [manuscript]\n---\nA line.\nB line.\n";
	const ms = { headings: "none", layout: "manuscript" };
	assert.equal(compileMarkdown(parts, ms, text, { render: true }).markdown, "A line.\n\nB line.\n");
	assert.equal(compileMarkdown(parts, ms, text).markdown, "A line.\nB line.\n");
	assert.equal(compileMarkdown(parts, { headings: "none" }, text, { render: true }).markdown, "A line.\nB line.\n");
});
