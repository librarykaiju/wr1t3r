import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig, writeConfig, noteDay, tasksTagged, onDay, taskList, shownText, newTaskLine, appendTask, listName, listTags, tagFor, itemTags } from "../src/tasklists.js";

const notes = {
	"content/_daily/2026-09-30.md": "# Day\n- [ ] write intro #crit\n- [ ] groceries #todo\n",
	"content/_daily/2026-09-29.md": "- [x] ship it #crit ✅ 2026-09-29\n- [ ] late thing #crit 📅 2026-09-28\n",
	"content/Projects.md": "- [ ] call Sam #crit 📅 2026-10-02\n- [ ] no date #crit\n- [ ] not tagged\n- [x] done today #crit ✅ 2026-09-30\n- [ ] sub #crit/work 📅 2026-09-30\n- [ ] #critical isn't it\n",
	"content/_templates/Daily.md": "- [ ] template task #crit\n",
};

test("settings: defaults, choices, and a round trip that keeps unknown keys", () => {
	assert.deepEqual(readConfig(""), { list: "crit", lists: ["crit"], day: "note", show: "open", group: "none", sort: "due", layout: "grouped", color: null });
	const cfg = readConfig("list: '#todo'\nshow: ALL\ngroup: bogus\nextra: 1");
	assert.equal(cfg.list, "todo");
	assert.equal(cfg.show, "all");
	assert.equal(cfg.group, "none");
	assert.equal(writeConfig(cfg), "list: todo\nshow: all\nextra: 1");
	assert.equal(listName("crit"), "Critical Tasks");
	assert.equal(listName("todo"), "To Do's");
	assert.equal(listName("work"), "Work");
	assert.equal(listName("wish-list"), "Wish list");
	assert.equal(listName("home/errands"), "Errands");
	assert.equal(tagFor("Wish list"), "wish-list");
	assert.equal(tagFor(" #Packing "), "packing");
});

test("a card can show several lists: grouped by list, each item once, its own defaults", () => {
	assert.deepEqual(listTags("crit+todo"), ["crit", "todo"]);
	assert.deepEqual(listTags(["#crit", "todo", "crit"]), ["crit", "todo"]);
	const both = readConfig("list: [crit, todo]");
	assert.deepEqual([both.lists, both.list, both.group, both.day], [["crit", "todo"], "crit", "list", "note"]);
	assert.equal(writeConfig(both), "list: [crit, todo]");
	assert.equal(writeConfig({ ...both, layout: "columns", color: 4 }), "list: [crit, todo]\nlayout: columns\ncolor: 4");
	// Lists that aren't task lists show every item, not a day's.
	assert.equal(readConfig("list: shopping").day, "all");
	const mixed = { "a.md": "- [ ] one #crit\n- [ ] two #todo\n- [ ] both #crit #todo\n- [ ] milk #shopping\n" };
	const r = taskList(mixed, readConfig("list: [crit, todo]\nday: all"), { path: "x.md", today: "2026-10-01" });
	assert.equal(r.title, "Tasks");
	assert.deepEqual(r.groups.map((g) => [g.label, g.tasks.map((t) => t.text)]), [["Critical Tasks", ["one #crit", "both #crit #todo"]], ["To Do's", ["two #todo"]]]);
	const shop = taskList(mixed, readConfig("list: [shopping, wishlist]"), { path: "2026-10-01.md", today: "2026-10-01" });
	assert.equal(shop.title, "Shopping & Wishlist");
	assert.deepEqual(shop.groups.map((g) => [g.label, g.tasks.length]), [["Shopping", 1], ["Wishlist", 0]]);
	assert.deepEqual(itemTags(mixed).map((x) => [x.tag, x.count]), [["crit", 2], ["todo", 2], ["shopping", 1]]);
});

test("tasks are found by tag (nested tags count), outside templates", () => {
	const texts = tasksTagged(notes, "crit").map((t) => t.text);
	assert.deepEqual(texts.sort(), ["call Sam #crit 📅 2026-10-02", "done today #crit ✅ 2026-09-30", "late thing #crit 📅 2026-09-28", "no date #crit", "ship it #crit ✅ 2026-09-29", "sub #crit/work 📅 2026-09-30", "write intro #crit"]);
	assert.equal(noteDay("content/_daily/2026.05.14.md"), "2026-05-14");
	assert.equal(noteDay("content/Projects.md"), null);
});

test("a day's list: due, done or written that day, plus overdue on today", () => {
	const today = "2026-09-30";
	const r = taskList(notes, readConfig("show: all"), { path: "content/_daily/2026-09-30.md", today });
	assert.equal(r.title, "Critical Tasks");
	assert.equal(r.day, "2026-09-30");
	assert.deepEqual(r.groups[0].tasks.map((t) => t.text), ["late thing #crit 📅 2026-09-28", "sub #crit/work 📅 2026-09-30", "write intro #crit", "done today #crit ✅ 2026-09-30"]);
	// Another day doesn't carry overdue tasks.
	assert.equal(onDay({ due: "2026-09-28", done: false, path: "x.md" }, "2026-09-29", today), false);
	// Outside a daily note, day: note means every task.
	assert.equal(taskList(notes, readConfig(""), { path: "content/Projects.md", today }).count, 5);
});

test("grouping by due date puts overdue and today first", () => {
	const r = taskList(notes, readConfig("day: all\ngroup: due"), { path: "content/Projects.md", today: "2026-09-30" });
	assert.deepEqual(r.groups.map((g) => g.label), ["Overdue", "Today", "2026-10-02", "No due date"]);
});

test("shown text, and a task added from a view", () => {
	assert.equal(shownText("call Sam #crit 📅 2026-10-02", "crit"), "call Sam");
	assert.equal(shownText("sub #crit/work", "crit"), "sub #crit/work");
	assert.equal(newTaskLine("buy stamps", "todo", "2026-09-30"), "- [ ] buy stamps #todo 📅 2026-09-30");
	assert.equal(newTaskLine("- [ ] buy #todo", "todo", null), "- [ ] buy #todo");
	assert.equal(appendTask("# To Do's List\n\n", "- [ ] a #todo"), "# To Do's List\n- [ ] a #todo\n");
	assert.equal(appendTask("", "- [ ] a"), "- [ ] a\n");
});
