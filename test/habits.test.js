import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHabit, habitLine, readHabits, habitEntry, wordsEntry, dayOf, dueOn, progress, slug, habitProps, streak, addDays, habitsGlance } from "../src/habits.js";
import { readPlanner, writePlanner, healthDay, syncHealth, setWords, untick, addUnder, HABITS } from "../src/planner.js";

test("a habit line reads and writes back", () => {
	assert.deepEqual(parseHabit("🧘 Stretch"), { name: "🧘 Stretch", goal: 1, words: false, days: null });
	assert.deepEqual(parseHabit("Pushups | 3"), { name: "Pushups", goal: 3, words: false, days: null });
	assert.deepEqual(parseHabit("Write | 1,500 words | weekdays"), { name: "Write", goal: 1500, words: true, days: [1, 2, 3, 4, 5] });
	assert.deepEqual(parseHabit("Run | Mon, Wed, Fri").days, [1, 3, 5]);
	assert.equal(parseHabit("Run | blue").days, null);
	assert.equal(parseHabit(""), null);
	assert.equal(habitLine(parseHabit("Write | 500 words | weekdays")), "Write | 500 words | weekdays");
	assert.equal(habitLine({ name: "A|B", goal: 2, words: false, days: [0, 6] }), "A B | 2 | weekends");
	assert.equal(readHabits(["Read", "read | 2", "", "Run"]).map((h) => h.name).join(), "Read,Run");
});

test("ticks and words make a day", () => {
	assert.deepEqual(habitEntry("07:30 | 🧘 Stretch"), { time: "07:30", name: "🧘 Stretch" });
	assert.deepEqual(habitEntry("Stretch"), { time: null, name: "Stretch" });
	assert.deepEqual(wordsEntry("k3x9f2 | 1,523"), { device: "k3x9f2", words: 1523 });
	assert.equal(wordsEntry("nonsense"), null);
	const d = dayOf([{ name: "Stretch" }, { name: "🧘 stretch" }, { name: "Pushups" }], [{ words: 300 }, { words: 250 }]);
	assert.equal(d.counts.get("stretch"), 2);
	assert.equal(d.words, 550);
	assert.deepEqual(progress(parseHabit("🧘 Stretch"), d), { n: 2, goal: 1, done: true });
	assert.deepEqual(progress(parseHabit("Pushups | 3"), d), { n: 1, goal: 3, done: false });
	assert.deepEqual(progress(parseHabit("Write | 500 words"), d), { n: 550, goal: 500, done: true });
	assert.equal(slug("🧘 Stretch"), "stretch");
	assert.equal(slug("Write 500 words!"), "write_500_words");
	assert.equal(dueOn(parseHabit("Run | Mon"), "2026-10-05"), true); // a Monday
	assert.equal(dueOn(parseHabit("Run | Mon"), "2026-10-06"), false);
});

test("habit properties count only the habits due that day", () => {
	const habits = readHabits(["Stretch", "Run | Mon", "Write | 500 words"]);
	const d = dayOf([{ name: "Stretch" }], [{ words: 120 }]);
	assert.deepEqual(habitProps(habits, d, "2026-10-06"), { habit_stretch: 1, habit_write: 120, habits_done: 1, habits_due: 2, words_written: 120 });
	assert.deepEqual(habitProps(habits, d, "2026-10-05"), { habit_stretch: 1, habit_run: 0, habit_write: 120, habits_done: 1, habits_due: 3, words_written: 120 });
});

test("streaks: today not done yet doesn't break it, days off don't either", () => {
	const h = parseHabit("Stretch | weekdays");
	const days = new Map();
	const done = (day) => days.set(day, dayOf([{ name: "Stretch" }]));
	// Mon 2026-09-28 .. Fri 10-02 done, weekend off, Mon 10-05 done, Tue 10-06 missed, Wed 10-07 done, Thu 10-08 (today) not yet.
	for (const d of ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-07"]) done(d);
	const s = streak(h, days, "2026-10-08");
	assert.equal(s.current, 1);
	assert.equal(s.best, 6);
	assert.deepEqual([s.done, s.due], [7, 8]);
	assert.equal(s.grid.length, 84);
	assert.equal(s.grid.find((g) => g.day === "2026-10-08").state, "today");
	assert.equal(s.grid.find((g) => g.day === "2026-10-06").state, "missed");
	assert.equal(s.grid.find((g) => g.day === "2026-10-04").state, "off");
	assert.equal(s.grid.find((g) => g.day === "2026-10-09").state, "future");
	assert.equal(s.grid[0].day, addDays("2026-10-04", -77)); // a Sunday
	assert.equal(s.grid[0].state, "before");
	done("2026-10-08");
	assert.equal(streak(h, days, "2026-10-08").current, 2);
	assert.equal(streak(parseHabit("Never"), days, "2026-10-08").current, 0);
});

test("the glance for a Home tile", () => {
	const habits = readHabits(["Stretch", "Read"]);
	const days = new Map([["2026-10-07", dayOf([{ name: "Stretch" }])], ["2026-10-08", dayOf([{ name: "Stretch" }, { name: "Read" }])]]);
	const g = habitsGlance(habits, days, "2026-10-08");
	assert.equal(g.done, 2);
	assert.equal(g.label, "of 2 habits done today");
	assert.equal(g.extras[0].n, "🔥2");
	assert.equal(g.bars.length, 14);
	assert.equal(g.bars.at(-1).count, 2);
	assert.equal(habitsGlance([], days, "2026-10-08"), null);
});

test("the planner keeps habits as a list, and the health note logs them", () => {
	const cfg = readPlanner("habits:\n  - Stretch\n  - \"Write | 500 words\"");
	assert.deepEqual(cfg.habits, ["Stretch", "Write | 500 words"]);
	assert.equal(writePlanner(cfg), "habits:\n  - Stretch\n  - Write | 500 words");
	assert.deepEqual(readPlanner("habits:\n  - Read", "habits:\n  - Stretch").habits, ["Read"]);
	assert.deepEqual(readPlanner("", "habits:\n  - Stretch").habits, ["Stretch"]);
	let t = "---\ndate: 2026-10-08\n---\n\n## Mood Log\n- \n";
	t = addUnder(t, HABITS.heading, "07:30 | Stretch");
	t = addUnder(t, HABITS.heading, "08:00 | Stretch");
	t = setWords(t, "dev1", 200);
	t = setWords(t, "dev2", 50);
	t = setWords(t, "dev1", 320);
	const d = healthDay(t, []);
	assert.equal(d.habits.counts.get("stretch"), 2);
	assert.equal(d.habits.words, 370);
	assert.equal(d.wordLines.length, 2);
	const synced = syncHealth(t, [], { ...cfg }, null);
	assert.match(synced, /habit_stretch: 2/);
	assert.match(synced, /habit_write: 370/);
	assert.match(synced, /habits_done: 1/);
	assert.match(synced, /words_written: 370/);
	const one = untick(t, "Stretch");
	assert.equal(healthDay(one, []).habits.counts.get("stretch"), 1);
	assert.doesNotMatch(one, /08:00 \| Stretch/);
});

test("words written: prose only, per day, never below none", async () => {
	const { proseWords, countsTowardWords, addWords } = await import("../src/wordlog.js");
	assert.equal(proseWords("---\ntitle: A B C\n---\nOne two three.\n\n```wr1t3r-planner\nhabits:\n  - Read\n```\n<span>four</span>"), 4);
	assert.equal(countsTowardWords("Novel/Chapter 1.md"), true);
	assert.equal(countsTowardWords("_daily/2026-10-08.md"), true);
	assert.equal(countsTowardWords("_daily/2026-10-08 Health.md"), false);
	assert.equal(countsTowardWords("_templates/Daily.md"), false);
	assert.equal(countsTowardWords("templates/Daily.md"), false);
	assert.equal(countsTowardWords("_wr1t3r/Home.md"), false);
	assert.equal(countsTowardWords("pics/cat.png"), false);
	assert.deepEqual(addWords({ day: "2026-10-07", n: 900 }, "2026-10-08", 40), { day: "2026-10-08", n: 40 });
	assert.deepEqual(addWords({ day: "2026-10-08", n: 40 }, "2026-10-08", -100), { day: "2026-10-08", n: 0 });
});
