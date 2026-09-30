import { test } from "node:test";
import assert from "node:assert/strict";
import { setTaskLine, taskMark, doneStampChanges, setDoneDates } from "../src/tasks.js";

const day = new Date(2026, 8, 30, 14, 5);

test("ticking adds the Tasks plugin's done date, unticking takes it off", () => {
	assert.equal(setTaskLine("- [ ] Call Sam", "x", day), "- [x] Call Sam ✅ 2026-09-30");
	assert.equal(setTaskLine("- [x] Call Sam ✅ 2026-09-30", " ", day), "- [ ] Call Sam");
	assert.equal(setTaskLine("  * [ ] nested  ", "x", day), "  * [x] nested ✅ 2026-09-30  ");
	assert.equal(setTaskLine("1. [ ] Due 📅 2026-10-03", "x", day), "1. [x] Due 📅 2026-10-03 ✅ 2026-09-30");
});

test("the done date goes before a block id, as Tasks keeps the id last", () => {
	assert.equal(setTaskLine("- [ ] quote ^q-1", "x", day), "- [x] quote ✅ 2026-09-30 ^q-1");
	assert.equal(setTaskLine("- [x] quote ✅ 2026-09-30 ^q-1", " ", day), "- [ ] quote ^q-1");
});

test("no second stamp, none on an empty task, nothing on other lines", () => {
	assert.equal(setTaskLine("- [x] done ✅ 2026-09-01", "x", day), "- [x] done ✅ 2026-09-01");
	assert.equal(setTaskLine("- [ ] ", "x", day), "- [x] ");
	assert.equal(setTaskLine("- plain", "x", day), "- plain");
	assert.deepEqual(doneStampChanges("text", 0, true, day), []);
	assert.deepEqual(taskMark("> - [/] half"), { at: 5, char: "/" });
});

test("the setting turns stamping off, but unticking still cleans up", () => {
	setDoneDates(false);
	try {
		assert.equal(setTaskLine("- [ ] a", "x", day), "- [x] a");
		assert.equal(setTaskLine("- [x] a ✅ 2026-09-30", " ", day), "- [ ] a");
	} finally { setDoneDates(true); }
});
