import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfPageText, noteName, withFrontmatter } from "../src/convert-text.js";

// pdf.js text items: [str, font size, y, hasEOL]
const items = (rows) => rows.map(([str, h, y, eol]) => ({ str, transform: [h, 0, 0, h, 6, y], hasEOL: !!eol, height: h }));

test("PDF text: headings, wrapped lines joined, paragraphs split, hyphens mended", () => {
	const text = pdfPageText(items([
		["Quarterly Report", 24, 422],
		["", 12, 390, true],
		["This first paragraph wraps across", 12, 390, true],
		["several lines and a hyphen-", 12, 377, true],
		["ated word.", 12, 363, true],
		["Second paragraph.", 12, 338],
	]));
	assert.equal(text, "# Quarterly Report\n\nThis first paragraph wraps across several lines and a hyphenated word.\n\nSecond paragraph.");
});

test("note names drop the extension and characters Obsidian refuses", () => {
	assert.equal(noteName("Q3: plan [draft].docx"), "Q3- plan -draft-");
	assert.equal(noteName(".hidden.txt"), "hidden");
});

test("frontmatter is added unless the file has its own", () => {
	const d = new Date(2026, 8, 26);
	assert.equal(withFrontmatter("# Hi\n", "a.docx", d), '---\nsource: "a.docx"\nuploaded: 2026-09-26\n---\n\n# Hi\n');
	assert.equal(withFrontmatter("---\ntags: [x]\n---\nbody", "a.md", d), "---\ntags: [x]\n---\nbody");
});
