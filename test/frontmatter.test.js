import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { frontmatterLines, propertyEdit, propertyCount, propertyEnter, tagsIn, tagHue, tagAddEdit, tagRemoveEdit, tagName } from "../src/frontmatter.js";

const doc = (s) => Text.of(s.split("\n"));

test("finds the frontmatter fences", () => {
	assert.deepEqual(frontmatterLines(doc("---\ntitle: A\ntags:\n  - x\n---\nBody")), { open: 1, close: 5 });
	assert.deepEqual(frontmatterLines(doc("---\na: 1\n...\n")), { open: 1, close: 3 });
	assert.equal(frontmatterLines(doc("Body\n---\n")), null);
	assert.equal(frontmatterLines(doc("---\nnever closed")), null);
});

test("adding a property inserts one line above the closing fence", () => {
	const d = doc("---\ntitle: A\n---\nBody");
	assert.deepEqual(propertyEdit(d), { at: d.line(3).from, text: "${key}: ${}\n" });
});

test("a note without frontmatter gets a new block at the top", () => {
	assert.deepEqual(propertyEdit(doc("Body")), { at: 0, text: "---\n${key}: ${}\n---\n" });
});

test("counts top-level keys only", () => {
	const d = doc("---\ntitle: A\ntags:\n  - x\n# note\n- y\ndate: 2026\n---");
	assert.equal(propertyCount(d, frontmatterLines(d)), 3);
});

test("Enter at the end of a property line starts the next one", () => {
	const d = doc("---\ntitle: A\ntags:\n  - novel\n  - \n---\nBody");
	const end = (n) => d.line(n).to;
	assert.deepEqual(propertyEnter(d, end(2)), { from: end(2), to: end(2), template: "\n${key}: ${}" });
	// tags: the items are pills, so Enter goes past them
	assert.deepEqual(propertyEnter(d, end(3)), { from: end(5), to: end(5), template: "\n${key}: ${}" });
	const a = doc("---\naliases:\n  - One\n  - \n---");
	assert.deepEqual(propertyEnter(a, a.line(2).to), { from: a.line(2).to, to: a.line(2).to, template: "\n  - ${}" });
	assert.deepEqual(propertyEnter(a, a.line(3).to), { from: a.line(3).to, to: a.line(3).to, template: "\n- ${}" }); // snippet adds the indent
	assert.deepEqual(propertyEnter(a, a.line(4).to), { from: a.line(4).from, to: a.line(4).to, template: "${key}: ${}" });
	assert.equal(propertyEnter(d, end(2) - 1), null); // mid-line: normal Enter
	assert.equal(propertyEnter(d, end(7)), null); // body
	assert.equal(propertyEnter(d, end(6)), null); // closing fence
});

test("reads tags in list, flow and bare forms", () => {
	const t = (s) => { const d = doc(s); return tagsIn(d, frontmatterLines(d)); };
	assert.deepEqual(t("---\ntitle: A\ntags:\n  - novel\n  - \"draft\"\nx: 1\n---").tags, ["novel", "draft"]);
	assert.deepEqual(t("---\ntags:\n  - novel\n  - draft\n---"), { form: "list", first: 2, last: 4, from: 9, to: 29, tags: ["novel", "draft"], items: [3, 4], indent: "  " });
	assert.deepEqual(t("---\ntags: [novel, '#draft']\n---").tags, ["novel", "draft"]);
	assert.deepEqual(t("---\ntags: novel draft\n---").tags, ["novel", "draft"]);
	assert.deepEqual(t("---\ntags:\n---").tags, []);
	assert.equal(t("---\ntitle: A\n---"), null);
	assert.equal(tagHue("Novel"), tagHue("novel"));
});

test("adding and removing tags edits only that property", () => {
	const apply = (s, edit) => s.slice(0, edit.from) + edit.insert + s.slice(edit.to);
	const run = (s, f) => { const d = doc(s); return apply(s, f(d, tagsIn(d, frontmatterLines(d)))); };
	const list = "---\ntags:\n  - novel\n  - draft\nx: 1\n---\nBody";
	assert.equal(run(list, (d, t) => tagAddEdit(d, t, "plot")), "---\ntags:\n  - novel\n  - draft\n  - plot\nx: 1\n---\nBody");
	assert.equal(run(list, (d, t) => tagRemoveEdit(d, t, 0)), "---\ntags:\n  - draft\nx: 1\n---\nBody");
	assert.equal(run("---\ntags:\n---", (d, t) => tagAddEdit(d, t, "a")), "---\ntags:\n  - a\n---");
	assert.equal(run("---\ntags: [a, b]\n---", (d, t) => tagAddEdit(d, t, "c")), "---\ntags: [a, b, c]\n---");
	assert.equal(run("---\ntags: a, b\n---", (d, t) => tagRemoveEdit(d, t, 0)), "---\ntags: b\n---");
	assert.equal(run("---\ntags: a b\n---", (d, t) => tagAddEdit(d, t, "c")), "---\ntags: a b c\n---");
	assert.equal(tagName(" #big idea "), "big-idea");
});
