import test from "node:test";
import assert from "node:assert/strict";
import { nextDay, nextTask, ruleOf } from "../src/recur.js";
import { remindersIn, setReminderChanges, taskTitle, reminderMark } from "../src/reminders.js";
import { doneStampChanges, setTaskLine } from "../src/tasks.js";

test("repeat rules", () => {
	assert.equal(nextDay("every day", "2026-10-02"), "2026-10-03");
	assert.equal(nextDay("every 2 weeks", "2026-10-02"), "2026-10-16");
	assert.equal(nextDay("every month", "2026-01-31"), "2026-02-28");
	assert.equal(nextDay("every year", "2026-10-02"), "2027-10-02");
	assert.equal(nextDay("every weekday", "2026-10-02"), "2026-10-05"); // Friday -> Monday
	assert.equal(nextDay("every monday, thursday", "2026-10-02"), "2026-10-05");
	assert.equal(nextDay("every tuesday and friday", "2026-10-02"), "2026-10-06");
	assert.equal(nextDay("every blue moon", "2026-10-02"), null);
});

test("next copy of a repeating task", () => {
	const line = "- [x] Water plants 🔁 every week 📅 2026-10-02 (@2026-10-02 08:00) ✅ 2026-10-02 ^abc";
	assert.equal(ruleOf(line), "every week");
	assert.equal(nextTask(line, "2026-10-04"), "- [ ] Water plants 🔁 every week 📅 2026-10-09 (@2026-10-09 08:00)");
	assert.equal(nextTask("- [ ] Pay rent 🔁 every month when done 📅 2026-09-01", "2026-10-02"), "- [ ] Pay rent 🔁 every month when done 📅 2026-11-02");
	assert.equal(nextTask("- [ ] No repeat", "2026-10-02"), null);
});

test("ticking a repeating task adds the next one above", () => {
	const date = new Date(2026, 9, 2);
	assert.equal(setTaskLine("- [ ] Stretch 🔁 every day 📅 2026-10-02", "x", date), "- [ ] Stretch 🔁 every day 📅 2026-10-03\n- [x] Stretch 🔁 every day 📅 2026-10-02 ✅ 2026-10-02");
	assert.equal(doneStampChanges("- [x] Stretch 🔁 every day ✅ 2026-10-02", 0, true, date).length, 0, "already done: no second copy");
});

test("reminders in a note", () => {
	const text = "- [ ] Call [[Sam|Sam Lee]] (@2026-10-03 14:30) 📅 2026-10-03\n- [x] Done (@2026-10-03 09:00)\n- [ ] Morning (@2026-10-04)\nNot a task (@2026-10-03 10:00)";
	const r = remindersIn("content/a.md", text);
	assert.equal(r.length, 2);
	assert.equal(r[0].title, "Call Sam Lee");
	assert.equal(r[0].at, new Date(2026, 9, 3, 14, 30).getTime());
	assert.equal(r[1].at, new Date(2026, 9, 4, 9, 0).getTime());
	assert.notEqual(r[0].id, r[1].id);
	assert.equal(remindersIn("content/a.md", text)[0].id, r[0].id, "ids are stable");
	assert.equal(taskTitle("Plan 🔁 every week 📅 2026-10-03 ^x"), "Plan");
	assert.equal(reminderMark("- [ ] x (@2026-10-03 9:05)").time, "09:05");
});

test("setting and clearing a reminder", () => {
	const apply = (line, ch) => { let s = line; for (const c of [...ch].sort((a, b) => b.from - a.from)) s = s.slice(0, c.from) + c.insert + s.slice(c.to ?? c.from); return s; };
	assert.equal(apply("- [ ] Call ✅ 2026-10-01 ^id", setReminderChanges("- [ ] Call ✅ 2026-10-01 ^id", 0, "2026-10-03 14:00")), "- [ ] Call (@2026-10-03 14:00) ✅ 2026-10-01 ^id");
	assert.equal(apply("- [ ] Call (@2026-10-03 14:00) x", setReminderChanges("- [ ] Call (@2026-10-03 14:00) x", 0, "2026-10-04 08:00")), "- [ ] Call (@2026-10-04 08:00) x");
	assert.equal(apply("- [ ] Call (@2026-10-03 14:00)", setReminderChanges("- [ ] Call (@2026-10-03 14:00)", 0, null)), "- [ ] Call");
	assert.deepEqual(setReminderChanges("plain line", 0, "2026-10-03 14:00"), []);
});

test("due reminders: only those that came due since the last check, and not stale ones", async () => {
	const { dueReminders } = await import("../src/reminders.js");
	const at = (m) => ({ at: m * 60000, title: "t" + m });
	const list = [at(10), at(20), at(30), at(40)];
	assert.deepEqual(dueReminders(list, 15 * 60000, 31 * 60000).map((r) => r.title), ["t20", "t30"]);
	assert.deepEqual(dueReminders(list, 0, 50 * 60000).map((r) => r.title), ["t40"], "older than 15 minutes is skipped");
	assert.deepEqual(dueReminders(list, 30 * 60000, 30.3 * 60000), []);
});
