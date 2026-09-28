import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { frontmatterLines, propertyEdit, propertyCount } from "../src/frontmatter.js";

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
