import { test } from "node:test";
import assert from "node:assert/strict";
import { setTaskLine, taskMark, doneStampChanges, setDoneDates, sortChecklists, setDueChanges, dueOf, dueMark, tickInText } from "../src/tasks.js";

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

test("done tasks sink, children move with them and sort too", () => {
	const text = [
		"# List",
		"- [x] done one ✅ 2026-09-29",
		"  - [ ] child of done",
		"- [ ] open one",
		"- plain bullet",
		"- [X] done two",
		"- [ ] open two",
		"  - [x] sub done",
		"  - [ ] sub open",
		"    more text",
		"",
		"after",
	].join("\n");
	assert.equal(sortChecklists(text), [
		"# List",
		"- [ ] open one",
		"- plain bullet",
		"- [ ] open two",
		"  - [ ] sub open",
		"    more text",
		"  - [x] sub done",
		"- [x] done one ✅ 2026-09-29",
		"  - [ ] child of done",
		"- [X] done two",
		"",
		"after",
	].join("\n"));
});

test("nothing to sort gives null; the Timeline, code, numbered lists and blank-line breaks hold", () => {
	assert.equal(sortChecklists("- [ ] a\n- [x] b\n"), null);
	assert.equal(sortChecklists("# Timeline\n- [x] 09:00 | a\n- [ ] 10:00 | b\n# Notes\n- [x] c\n- [ ] d"), "# Timeline\n- [x] 09:00 | a\n- [ ] 10:00 | b\n# Notes\n- [ ] d\n- [x] c");
	assert.equal(sortChecklists("```\n- [x] a\n- [ ] b\n```"), null);
	assert.equal(sortChecklists("1. [x] a\n2. [ ] b"), null);
	assert.equal(sortChecklists("- [x] a\n\n- [ ] b"), null);
	assert.equal(sortChecklists("---\ntags:\n- [x]\n- [ ]\n---\n"), null);
	assert.equal(sortChecklists("- [x] a\r\n- [ ] b"), "- [ ] b\r\n- [x] a");
});

test("due dates go in as the Tasks plugin writes them, before a done date and a block id", () => {
	const apply = (line, day) => { let s = line; for (const c of setDueChanges(line, 0, day).sort((a, b) => b.from - a.from)) s = s.slice(0, c.from) + c.insert + s.slice(c.to ?? c.from); return s; };
	assert.equal(apply("- [ ] Call Sam", "2026-10-03"), "- [ ] Call Sam 📅 2026-10-03");
	assert.equal(apply("- [ ] Call Sam 📅 2026-10-03", "2026-10-05"), "- [ ] Call Sam 📅 2026-10-05");
	assert.equal(apply("- [ ] Call Sam 📅 2026-10-03 ^id", null), "- [ ] Call Sam ^id");
	assert.equal(apply("- [x] a ✅ 2026-09-30 ^id", "2026-10-01"), "- [x] a 📅 2026-10-01 ✅ 2026-09-30 ^id");
	assert.equal(apply("- [ ] a ^id", "2026-10-01"), "- [ ] a 📅 2026-10-01 ^id");
	assert.deepEqual(setDueChanges("plain line", 0, "2026-10-01"), []);
	assert.equal(dueOf("- [ ] a 📅 2026-10-03"), "2026-10-03");
	assert.equal(dueOf("- a 📅 2026-10-03"), null);
});

test("a due date is overdue only while the task is open", () => {
	assert.deepEqual(dueMark("- [ ] a 📅 2026-09-29", "2026-09-30"), { from: 8, to: 21, day: "2026-09-29", state: "overdue" });
	assert.equal(dueMark("- [ ] a 📅 2026-09-30", "2026-09-30").state, "today");
	assert.equal(dueMark("- [ ] a 📅 2026-10-01", "2026-09-30").state, "later");
	assert.equal(dueMark("- [x] a 📅 2026-09-01", "2026-09-30").state, "done");
	assert.equal(dueMark("- [ ] no date", "2026-09-30"), null);
});

test("a Dataview tick finds its line, or the one task with its text", () => {
	const text = "# T\n- [ ] call Sam\n- [ ] buy milk\n";
	assert.equal(tickInText(text, 1, "call Sam", true, day), "# T\n- [x] call Sam ✅ 2026-09-30\n- [ ] buy milk\n");
	// The note moved on: found by text.
	assert.equal(tickInText("new line\n" + text, 1, "call Sam", true, day), "new line\n# T\n- [x] call Sam ✅ 2026-09-30\n- [ ] buy milk\n");
	assert.equal(tickInText("- [x] a ✅ 2026-09-30\r\n- [ ] b", 0, "a ✅ 2026-09-30", false, day), "- [ ] a\r\n- [ ] b");
	assert.equal(tickInText("- [ ] a\n- [ ] a\nx", 2, "a", true, day), null);
	assert.equal(tickInText("- [ ] a", 0, "gone", true, day), null);
});
