import { test } from "node:test";
import assert from "node:assert/strict";
import { properties, propertyIndex, deleteKey, clearEmpty, renameKey, planChange, frontmatterDiff, validKey } from "../src/propclean.js";

const JOURNAL = `---
title: "A walk"
publish: false
tags:
  - ""
callout:
sticky: false
source: ""
cover: []
vibes:
  - calm
  - ""
  - quiet
---
Body with a line like
tags:
  - ""
that isn't frontmatter.
`;

test("properties: each key's lines, empty or not, and blank list items", () => {
	const p = properties(JOURNAL);
	assert.deepEqual(p.items.map((i) => [i.key, i.empty]), [["title", false], ["publish", false], ["tags", true], ["callout", true], ["sticky", false], ["source", true], ["cover", true], ["vibes", false]]);
	assert.deepEqual(p.items.find((i) => i.key === "vibes").blank, [11]);
	assert.equal(properties("No frontmatter\n"), null);
	assert.equal(properties("---\nunclosed: 1\n"), null);
});

test("clearing empty values leaves everything else as it was", () => {
	assert.equal(clearEmpty(JOURNAL), `---
title: "A walk"
publish: false
sticky: false
vibes:
  - calm
  - quiet
---
Body with a line like
tags:
  - ""
that isn't frontmatter.
`);
	assert.equal(clearEmpty(JOURNAL, "callout"), JOURNAL.replace("callout:\n", ""));
	assert.equal(clearEmpty("---\ntitle: T\n---\nx"), "---\ntitle: T\n---\nx"); // nothing to do
	// CRLF notes stay CRLF, and false or 0 aren't empty.
	assert.equal(clearEmpty("---\r\na: \r\nb: false\r\nc: 0\r\n---\r\nx\r\n"), "---\r\nb: false\r\nc: 0\r\n---\r\nx\r\n");
});

test("deleting and renaming a key", () => {
	assert.equal(deleteKey(JOURNAL, "vibes").includes("calm"), false);
	assert.equal(deleteKey(JOURNAL, "vibes").includes("sticky: false"), true);
	assert.equal(deleteKey(JOURNAL, "nope"), JOURNAL);
	// Rename: the key's name changes, its value and spacing stay.
	assert.equal(renameKey("---\nvibes:  calm # note\nb: 1\n---\n", "vibes", "vibesAndThemes").text, "---\nvibesAndThemes:  calm # note\nb: 1\n---\n");
	// Merge into an empty key, or drop an empty source.
	assert.equal(renameKey("---\nvibes: calm\nvibesAndThemes:\n---\n", "vibes", "vibesAndThemes").text, "---\nvibesAndThemes: calm\n---\n");
	assert.equal(renameKey("---\nvibes:\nvibesAndThemes: calm\n---\n", "vibes", "vibesAndThemes").text, "---\nvibesAndThemes: calm\n---\n");
	// Both with values: left alone, flagged.
	assert.deepEqual(renameKey("---\nvibes: a\nvibesAndThemes: b\n---\n", "vibes", "vibesAndThemes"), { text: "---\nvibes: a\nvibesAndThemes: b\n---\n", conflict: true });
	assert.equal(renameKey('---\n"my key": 1\n---\n', "my key", "myKey").text, "---\nmyKey: 1\n---\n");
	assert.equal(validKey("vibesAndThemes"), true);
	assert.equal(validKey("bad: key"), false);
	assert.equal(validKey(""), false);
});

test("the index counts keys and empties; a plan lists what would change", () => {
	const notes = { "a.md": JOURNAL, "b.md": "---\ntags: [x]\ncallout: note\n---\n", "c.md": "no frontmatter" };
	const idx = propertyIndex(notes);
	const row = (k) => idx.find((r) => r.key === k);
	assert.deepEqual([row("tags").notes, row("tags").empty], [2, 1]);
	assert.deepEqual([row("callout").notes, row("callout").empty, row("callout").emptyPaths], [2, 1, ["a.md"]]);
	assert.equal(row("vibes").blanks, 1);
	const plan = planChange(notes, (t) => clearEmpty(t));
	assert.deepEqual(plan.changed.map((c) => c.path), ["a.md"]);
	const d = frontmatterDiff(plan.changed[0].before, plan.changed[0].after);
	assert.deepEqual(d.added, []);
	assert.ok(d.removed.includes("callout:") && d.removed.includes('source: ""'));
	const merge = planChange({ "x.md": "---\nvibes: a\nvibesAndThemes: b\n---\n", "y.md": "---\nvibes: a\n---\n" }, (t) => renameKey(t, "vibes", "vibesAndThemes"));
	assert.deepEqual([merge.changed.map((c) => c.path), merge.conflicts], [["y.md"], ["x.md"]]);
});

test("the website's properties are known, and planner-only ones aren't among them", async () => {
	const { SITE_KEYS } = await import("../src/sitekeys.js");
	for (const k of ["publish", "title", "tags", "permalink", "coverImage", "callout", "date", "layout"]) assert.ok(SITE_KEYS.has(k), k);
	for (const k of ["meds", "hydration_oz", "steps", "calories_target"]) assert.ok(!SITE_KEYS.has(k), k);
});

test("genre and genres: same values merge quietly, different ones only when asked", async () => {
	const { renameKey } = await import("../src/propclean.js");
	const dead = "---\ntitle: Dead Silence\ngenre:\n  - Science Fiction\n  - Horror\ngenres:\n  - Science Fiction\n  - Horror\nshelf: Finished\n---\nBody\n";
	assert.deepEqual(renameKey(dead, "genres", "genre"), { text: "---\ntitle: Dead Silence\ngenre:\n  - Science Fiction\n  - Horror\nshelf: Finished\n---\nBody\n", conflict: false });
	// Same values in another order or form still count as the same.
	assert.equal(renameKey("---\ngenre: [horror, Science Fiction]\ngenres:\n  - Science Fiction\n  - Horror\n---\n", "genres", "genre").conflict, false);
	const diff = "---\ngenre:\n  - Horror\ngenres:\n  - Science Fiction\n  - horror\n  - \"Space: Opera\"\n---\n";
	assert.equal(renameKey(diff, "genres", "genre").conflict, true);
	assert.deepEqual(renameKey(diff, "genres", "genre", { combine: true }), { text: '---\ngenre:\n  - Horror\n  - Science Fiction\n  - "Space: Opera"\n---\n', conflict: false, combined: true });
	// A scalar and a flow list combine into a list too.
	assert.equal(renameKey("---\ngenre: Horror\ngenres: [Drama]\n---\n", "genres", "genre", { combine: true }).text, "---\ngenre:\n  - Horror\n  - Drama\n---\n");
});
