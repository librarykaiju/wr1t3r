import { test } from "node:test";
import assert from "node:assert/strict";
import { weekOf, weekStart, noteWeek, weeklyPath, weekNote, datedTasks, tasksByDay, taskLabel, addPlan, hasReflect, reflectSection, addReflect } from "../src/weekly.js";

test("a day's week runs Monday to Sunday and is named by its ISO week", () => {
	const w = weekOf("2026-10-14");
	assert.equal(w.name, "2026-W42");
	assert.equal(w.from, "2026-10-12");
	assert.equal(w.to, "2026-10-18");
	assert.equal(w.days.length, 7);
	assert.equal(w.title, "Oct 12 – 18, 2026");
	assert.equal(weekOf("2026-10-31").title, "Oct 26 – Nov 1, 2026");
	// Sunday belongs to the week before it.
	assert.equal(weekOf("2026-10-18").name, "2026-W42");
	// Days at the turn of the year take the ISO year.
	assert.equal(weekOf("2027-01-01").name, "2026-W53");
	assert.equal(weekOf("2025-12-29").name, "2026-W01");
});

test("a week name gives back its Monday, and only real weeks count", () => {
	assert.equal(weekStart("2026-W42"), "2026-10-12");
	assert.equal(weekStart("2026-W01"), "2025-12-29");
	assert.equal(weekStart("2026-W53"), "2026-12-28");
	assert.equal(weekStart("2027-W53"), null);
	assert.equal(weekStart("2026-W00"), null);
	assert.equal(weekStart("Week 42"), null);
	assert.equal(noteWeek("Notes/_weekly/2026-W42.md"), "2026-10-12");
	assert.equal(noteWeek("Notes/2026-10-12.md"), null);
	assert.equal(weeklyPath("Notes/", "2026-10-14"), "Notes/weekly/2026-W42.md");
	assert.equal(weeklyPath("Notes/", "2026-10-14", "_weekly/"), "Notes/_weekly/2026-W42.md");
});

test("a new weekly note has the week block, focus, plans and notes", () => {
	const t = weekNote("2026-10-14");
	assert.match(t, /^---\ntitle: "Week of Oct 12 – 18, 2026"\nweek: 2026-W42\n/);
	assert.match(t, /```wr1t3r-week\n```/);
	assert.match(t, /## Plans\n/);
	assert.ok(t.indexOf("## Plans") < t.indexOf("## Notes"));
});

test("tasks due in the week are found wherever they're written, overdue open ones too", () => {
	const notes = {
		"a.md": "- [ ] Dentist 📅 2026-10-15\n- [x] Old 📅 2026-10-01 ✅ 2026-10-01\n- [ ] Late 📅 2026-10-08\n- [ ] Later 📅 2026-10-20\n- [ ] No date",
		"_templates/Daily.md": "- [ ] Template 📅 2026-10-15",
		"b.md": "- [x] Paid rent 📅 2026-10-12 ✅ 2026-10-11 ^r1",
	};
	const tasks = datedTasks(notes, "2026-10-12", "2026-10-18");
	assert.deepEqual(tasks.map((t) => t.text), ["Late 📅 2026-10-08", "Paid rent 📅 2026-10-12 ✅ 2026-10-11 ^r1", "Dentist 📅 2026-10-15"]);
	const w = weekOf("2026-10-14");
	const by = tasksByDay(tasks, w.days, "2026-10-14");
	assert.deepEqual(by.get("2026-10-14").map((t) => [t.text, !!t.overdue]), [["Late 📅 2026-10-08", true]]);
	assert.equal(by.get("2026-10-15").length, 1);
	// A week without today in it leaves overdue tasks off.
	const next = weekOf("2026-10-21");
	assert.equal([...tasksByDay(tasks, next.days, "2026-10-14").values()].flat().length, 0);
	assert.equal(taskLabel("Paid rent #bills 📅 2026-10-12 ✅ 2026-10-11 ^r1"), "Paid rent #bills");
});

test("plans go at the end of the Plans section, which is made when missing", () => {
	let t = weekNote("2026-10-14");
	t = addPlan(t, "2026-10-15", "  Dentist ");
	t = addPlan(t, "2026-10-16", "Call Sam");
	assert.match(t, /## Plans\n- \[ \] Dentist 📅 2026-10-15\n- \[ \] Call Sam 📅 2026-10-16\n\n## Notes/);
	assert.equal(addPlan("# Week\n\n## Notes\nhi\n", "2026-10-15", "X"), "# Week\n\n## Plans\n- [ ] X 📅 2026-10-15\n\n## Notes\nhi\n");
	assert.equal(addPlan("# Week\n\nhi\n", "2026-10-15", "X"), "# Week\n\nhi\n\n## Plans\n- [ ] X 📅 2026-10-15\n");
	assert.equal(addPlan("## Plans\r\n- [ ] A 📅 2026-10-12\r\n", "2026-10-13", "B"), "## Plans\r\n- [ ] A 📅 2026-10-12\r\n- [ ] B 📅 2026-10-13\r\n");
});

test("Reflect & recover adds the week in numbers and both sets of questions", () => {
	const s = reflectSection("2026-10-12", { notes: [{ path: "d/2026-10-13.md", text: "Wrote a lot today" }], days: new Map(), habits: [], today: "2026-10-14" });
	assert.match(s, /^## Reflect & recover\n\n### This week in numbers\n\n- \*\*Entries:\*\* 1/);
	assert.match(s, /### Reflect\n\n#### What went well\?/);
	assert.match(s, /### Recover\n\n#### How rested do I feel\? \(1–5\)/);
	assert.doesNotMatch(s, /^---/m);
	const t = addReflect("note\n\n", s);
	assert.ok(t.startsWith("note\n\n## Reflect & recover\n"));
	assert.ok(hasReflect(t));
	assert.ok(!hasReflect("note"));
});
