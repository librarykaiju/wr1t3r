import { test } from "node:test";
import assert from "node:assert/strict";
import { noteIcon, cleanIcon, moveFolderIcons, ICON_CHOICES } from "../src/icons.js";

test("a note's icon is its icon: property", () => {
	assert.equal(noteIcon("---\ntitle: A\nicon: 🌸\n---\n# A\n"), "🌸");
	assert.equal(noteIcon('---\nicon: "📖"\n---\n'), "📖");
	assert.equal(noteIcon("---\nIcon: ✏️ # pencil\n---\n"), "✏️");
	assert.equal(noteIcon("---\r\nicon: 👩🏽‍💻\r\n---\r\nBody"), "👩🏽‍💻");
	assert.equal(noteIcon("# No properties\nicon: 🌸\n"), "");
	assert.equal(noteIcon("---\nicon:\n---\n"), "");
	assert.equal(noteIcon("---\nicons: 🌸\n---\n"), "");
});

test("cleanIcon keeps short symbols only", () => {
	assert.equal(cleanIcon("  ⭐ "), "⭐");
	assert.equal(cleanIcon("'★'"), "★");
	assert.equal(cleanIcon("a whole sentence here"), "");
	assert.equal(cleanIcon("[x]"), "");
	assert.equal(cleanIcon(null), "");
});

test("folder icons follow a renamed folder and its subfolders", () => {
	const icons = { Drafts: "✏️", "Drafts/Old": "📦", Draftsman: "🧑", Ideas: "💡" };
	assert.deepEqual(moveFolderIcons(icons, "Drafts", "Story/Drafts"), { "Story/Drafts": "✏️", "Story/Drafts/Old": "📦", Draftsman: "🧑", Ideas: "💡" });
	assert.equal(moveFolderIcons(icons, "Recipes", "Food"), null);
});

test("the picker's choices are icons", () => {
	for (const [, row] of ICON_CHOICES) {
		assert.ok(row.length <= 16);
		for (const e of row) assert.equal(cleanIcon(e), e);
	}
});
