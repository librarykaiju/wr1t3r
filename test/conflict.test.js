import test from "node:test";
import assert from "node:assert/strict";
import { mergeLines, diffCounts } from "../src/conflict.js";
import { conflictOf, conflictDay } from "../src/paths.js";
import { tasksTagged, itemTags } from "../src/tasklists.js";
import { datedTasks } from "../src/weekly.js";

test("conflictOf finds the note a conflict copy came from", () => {
	assert.equal(conflictOf("docs/Critical Tasks (conflict 2026-11-03).md"), "docs/Critical Tasks.md");
	assert.equal(conflictOf("Note (conflict 2026-11-03 2).md"), "Note.md");
	assert.equal(conflictOf("Boards/Plan (conflict 2026-11-03).board"), "Boards/Plan.board");
	assert.equal(conflictOf("Note.md"), null);
	assert.equal(conflictOf("Note (conflict).md"), null);
	assert.equal(conflictOf("My (conflict 2026-11-03) thoughts.md"), null);
	assert.equal(conflictDay("Note (conflict 2026-11-03 2).md"), "2026-11-03");
});

test("task lists leave out conflict copies", () => {
	const text = "- [ ] Adjust desk templates #crit 📅 2026-10-15\n";
	const notes = { "docs/Critical Tasks.md": text, "docs/Critical Tasks (conflict 2026-11-03).md": text };
	assert.deepEqual(tasksTagged(notes, "crit").map((t) => t.path), ["docs/Critical Tasks.md"]);
	assert.deepEqual(itemTags(notes), [{ tag: "crit", count: 1 }]);
	assert.deepEqual(datedTasks(notes, "2026-10-12", "2026-10-18").map((t) => t.path), ["docs/Critical Tasks.md"]);
});

test("mergeLines keeps every line of both versions once", () => {
	const a = "# Tasks\n- [x] one\n- [ ] two\n- [ ] three";
	const b = "# Tasks\n- [ ] two\n- [ ] three\n- [ ] four";
	assert.equal(mergeLines(a, b), "# Tasks\n- [x] one\n- [ ] two\n- [ ] three\n- [ ] four");
	// Ticked on one side, open on the other: once, ticked.
	assert.equal(mergeLines("- [x] paper #crit ✅ 2026-11-03\n- [ ] call", "- [ ] paper #crit\n- [ ] call\n- [ ] room"), "- [x] paper #crit ✅ 2026-11-03\n- [ ] call\n- [ ] room");
	assert.equal(mergeLines("- [ ] paper", "- [x] paper"), "- [x] paper");
	// Other edits to a line keep both.
	assert.equal(mergeLines("- [ ] paper", "- [ ] paper and pens"), "- [ ] paper\n- [ ] paper and pens");
	assert.equal(mergeLines(a, a), a);
	assert.deepEqual(diffCounts(a, b), { added: 1, removed: 1 });
});
