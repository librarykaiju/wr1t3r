import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { frontmatterLines, propertyEdit, propertyCount, propertyEnter, tagsIn, tagHue } from "../src/frontmatter.js";

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
	assert.deepEqual(propertyEnter(d, end(3)), { from: end(3), to: end(3), template: "\n  - ${}" });
	assert.deepEqual(propertyEnter(d, end(4)), { from: end(4), to: end(4), template: "\n- ${}" }); // snippet adds the indent
	assert.deepEqual(propertyEnter(d, end(5)), { from: d.line(5).from, to: end(5), template: "${key}: ${}" });
	assert.equal(propertyEnter(d, end(2) - 1), null); // mid-line: normal Enter
	assert.equal(propertyEnter(d, end(7)), null); // body
	assert.equal(propertyEnter(d, end(6)), null); // closing fence
});

test("reads tags in list, flow and bare forms", () => {
	const t = (s) => { const d = doc(s); return tagsIn(d, frontmatterLines(d)); };
	assert.deepEqual(t("---\ntitle: A\ntags:\n  - novel\n  - \"draft\"\nx: 1\n---").tags, ["novel", "draft"]);
	assert.deepEqual(t("---\ntags:\n  - novel\n  - draft\n---"), { first: 2, last: 4, from: 9, to: 29, tags: ["novel", "draft"] });
	assert.deepEqual(t("---\ntags: [novel, '#draft']\n---").tags, ["novel", "draft"]);
	assert.deepEqual(t("---\ntags: novel draft\n---").tags, ["novel", "draft"]);
	assert.equal(t("---\ntags:\n---"), null);
	assert.equal(t("---\ntitle: A\n---"), null);
	assert.equal(tagHue("Novel"), tagHue("novel"));
});
