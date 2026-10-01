import { test } from "node:test";
import assert from "node:assert/strict";
import {
	readPlanner, writePlanner, parseEntry, timelineRows, setEntry, addEvents, hourLabel, healthPathFor,
	addUnder, itemsUnder, removeLine, parseNutrition, findFood, searchFoods, waterOz, moodEntry, moodLine,
	healthDay, syncHealth, toggleMeds, mealAt, MEALS, addFoodRow, foodEntry, setEntryColor, EXERCISE, exerciseEntry, exerciseLine, moodChoice,
} from "../src/planner.js";

const DB = `# Nutrition Database

| Food | Serving Size | Calories | Fat (g) | Carbs (g) | Protein (g) | Fiber (g) | Food Group | Aliases | Servings/Container |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Apple | 1 medium (182g) | 95 | 0.3 | 25 | 0.5 | 4.4 | Produce | apples | |
| Banana | 1 medium (118g) | 105 | 0.4 | 27 | 1.3 | 3.1 | Produce | bananas | |
| Green Onion | 1 medium (15g) | 5 | 0 | 1.1 | 0.3 | 0.4 | Produce | scallion, scallions | |
| Peanut Butter | 2 tbsp (32g) | 190 | 16 | 7 | 7 | 2 | Fat/Protein | pb | 15 (16 oz jar) |
`;
const foods = parseNutrition(DB);

const HEALTH = `---
title: Daily Health
publish: false
date: "2026-09-30"
---
📅 [[2026-09-30|← Daily Timeline]]

## Nutrition Log

\`\`\`dataviewjs
const headingIdx = noteLines.findIndex(l => l.trim() === \`### \${meal}\`);
### 🍳Breakfast
\`\`\`

### 🍳Breakfast
-
### 🥗Lunch
-
### 🍝Dinner
-
### 🍇Snacks
-

## Activity Log
### 👟 Steps
-
`;

test("the block: defaults, a round trip, and unknown keys kept", () => {
	const cfg = readPlanner("");
	assert.deepEqual(cfg.tasks, ["crit", "todo"]);
	assert.equal(cfg.start, 9);
	assert.equal(cfg.end, 21);
	assert.deepEqual(cfg.timeline, []);
	assert.equal(writePlanner(cfg), "");
	const c2 = readPlanner('banner: "[[top.jpg]]"\ntasks: [crit]\ntimeline:\n  - 09:00 - 10:00 | Standup\n  - "13:30 - 14:00 | Dentist: cleaning"\nextra: 1');
	assert.equal(c2.banner, "[[top.jpg]]");
	assert.deepEqual(c2.tasks, ["crit"]);
	assert.deepEqual(c2.timeline, ["09:00 - 10:00 | Standup", "13:30 - 14:00 | Dentist: cleaning"]);
	const text = writePlanner(c2);
	assert.equal(text, 'banner: "[[top.jpg]]"\ntasks: [crit]\ntimeline:\n  - 09:00 - 10:00 | Standup\n  - "13:30 - 14:00 | Dentist: cleaning"\nextra: 1');
	assert.deepEqual(readPlanner(text), c2);
	assert.deepEqual(readPlanner("tasks: []").tasks, []);
});

test("timeline entries: parsing, rows by hour, edits and imports", () => {
	assert.deepEqual(parseEntry("09:30 - 10:15 | Dentist"), { allDay: false, start: 570, end: 615, text: "Dentist", color: null });
	assert.deepEqual(parseEntry("All day | Trip"), { allDay: true, start: null, end: null, text: "Trip", color: null });
	assert.equal(parseEntry("call Sam").start, null);
	assert.equal(hourLabel(9), "9 AM");
	assert.equal(hourLabel(12), "12 PM");
	assert.equal(hourLabel(20), "8 PM");

	const timeline = ["All day | Trip", "07:00 - 08:00 | Gym", "09:30 - 10:15 | Dentist", "22:00 | Late call", "call Sam"];
	const { allDay, rows } = timelineRows(timeline, { start: 9, end: 21 });
	assert.equal(rows.length, 12);
	assert.deepEqual(allDay.map((e) => e.text), ["Trip"]);
	assert.deepEqual(rows[0].items.map((e) => e.text), ["Gym", "Dentist"]);
	assert.deepEqual(rows[11].items.map((e) => e.text), ["Late call", "call Sam"]);

	let a = setEntry([], null, "Write", 14);
	assert.deepEqual(a, ["14:00 - 15:00 | Write"]);
	a = setEntry(a, null, "Standup", 9);
	assert.deepEqual(a, ["09:00 - 10:00 | Standup", "14:00 - 15:00 | Write"]);
	a = setEntry(a, 1, "Write chapter 3", 14);
	assert.deepEqual(a, ["09:00 - 10:00 | Standup", "14:00 - 15:00 | Write chapter 3"]);
	a = setEntry(a, 0, "08:30 - 09:00 | Standup", 9); // a typed time wins
	assert.equal(a[0], "08:30 - 09:00 | Standup");
	a = setEntry(a, 0, "", 9);
	assert.deepEqual(a, ["14:00 - 15:00 | Write chapter 3"]);

	const events = [
		{ title: "Dentist", start: "2026-09-30T09:30:00", end: "2026-09-30T10:15:00" },
		{ title: "Birthday", allDay: true, start: "2026-09-30", end: "2026-10-01" },
	];
	const r = addEvents(a, events);
	assert.equal(r.added, 2);
	assert.deepEqual(r.timeline, ["All day | Birthday", "09:30 - 10:15 | Dentist", "14:00 - 15:00 | Write chapter 3"]);
	assert.equal(addEvents(r.timeline, events).added, 0);
});

test("health note sections: adding in place of placeholders, headings made when missing, removing", () => {
	let t = addUnder(HEALTH, "🍳Breakfast", "Apple, 1");
	assert.match(t, /### 🍳Breakfast\n- Apple, 1\n### 🥗Lunch/);
	assert.match(t, /```\n\n### 🍳Breakfast/); // the heading inside the code block is left alone
	t = addUnder(t, "🍳Breakfast", "pb, 2");
	assert.match(t, /- Apple, 1\n- pb, 2\n### 🥗Lunch/);
	assert.deepEqual(itemsUnder(t, "🍳Breakfast").map((i) => i.text), ["Apple, 1", "pb, 2"]);
	assert.deepEqual(itemsUnder(t, "🥗Lunch"), []);

	t = addUnder(t, "💧 Water", "8", { parent: "Hydration Log" });
	assert.match(t, /- ?\n\n## Hydration Log\n### 💧 Water\n- 8\n$/);
	t = addUnder(t, "💧 Water", "8", { parent: "Hydration Log" });
	assert.deepEqual(itemsUnder(t, "💧 Water").map((i) => i.text), ["8", "8"]);
	t = addUnder(t, "Mood Log", "14:32 | 🙂 Good");
	assert.match(t, /- 8\n\n## Mood Log\n- 14:32 \| 🙂 Good\n$/);

	const [a, b] = itemsUnder(t, "🍳Breakfast");
	t = removeLine(t, b.line, b.text);
	t = removeLine(t, a.line, a.text);
	assert.match(t, /### 🍳Breakfast\n- \n### 🥗Lunch/);
	assert.equal(removeLine(t, 0, "nope"), t);

	// A parent heading that's there already gets the new heading at its end.
	const p = addUnder("# Day\n## Hydration Log\nSome words\n\n## Notes\n", "💧 Water", "16", { parent: "Hydration Log" });
	assert.equal(p, "# Day\n## Hydration Log\nSome words\n### 💧 Water\n- 16\n\n## Notes\n");
	// CRLF notes stay CRLF.
	assert.equal(addUnder("## Mood Log\r\n- \r\n", "Mood Log", "x"), "## Mood Log\r\n- x\r\n");
});

test("foods: the table, names and aliases, and search", () => {
	assert.equal(foods.length, 4);
	assert.deepEqual(foods[3], { name: "Peanut Butter", serving: "2 tbsp (32g)", calories: 190, fat: 16, carbs: 7, protein: 7, fiber: 2, group: "Fat/Protein", aliases: ["pb"] });
	assert.equal(findFood(foods, "scallions").name, "Green Onion");
	assert.equal(findFood(foods, "ban").name, "Banana");
	assert.equal(findFood(foods, "zzz"), null);
	assert.deepEqual(searchFoods(foods, "").map((f) => f.name), ["Apple", "Banana", "Green Onion", "Peanut Butter"]);
	assert.deepEqual(searchFoods(foods, "onion").map((f) => f.name), ["Green Onion"]);
	assert.deepEqual(searchFoods(foods, "pb").map((f) => f.name), ["Peanut Butter"]);
	assert.deepEqual(searchFoods(foods, "a").map((f) => f.name)[0], "Apple");
});

test("water, mood and meal readings", () => {
	assert.equal(waterOz("8"), 8);
	assert.equal(waterOz("2 glasses"), 16);
	assert.equal(waterOz("bottle"), 16);
	assert.equal(Math.round(waterOz("500ml")), 17);
	assert.equal(waterOz("lots"), null);
	assert.deepEqual(moodEntry("14:32 | 🙂 Good | slept well"), { time: "14:32", mood: "🙂 Good", note: "slept well" });
	assert.equal(moodLine(["🙂", "Good"], " fine\nreally ", new Date(2026, 8, 30, 9, 5)), "09:05 | 🙂 Good | fine really");
	assert.equal(mealAt(new Date(2026, 8, 30, 8)), MEALS[0]);
	assert.equal(mealAt(new Date(2026, 8, 30, 12)), MEALS[1]);
	assert.equal(mealAt(new Date(2026, 8, 30, 18)), MEALS[2]);
	assert.equal(mealAt(new Date(2026, 8, 30, 15, 30)), MEALS[3]);
	assert.equal(healthPathFor("content/_daily/2026-09-30.md"), "content/_daily/2026-09-30 Health.md");
});

test("the day's totals go into the health note's properties", () => {
	let t = addUnder(HEALTH, "🍳Breakfast", "Apple, 1");
	t = addUnder(t, "🍇Snacks", "pb, 0.5");
	t = addUnder(t, "🍇Snacks", "mystery bar, 1");
	t = addUnder(t, "💧 Water", "8", { parent: "Hydration Log" });
	t = addUnder(t, "💧 Water", "16oz", { parent: "Hydration Log" });
	const d = healthDay(t, foods);
	assert.equal(d.totals.calories, 190);
	assert.deepEqual(d.unmatched, ["mystery bar"]);
	assert.equal(d.waterOz, 24);
	assert.equal(d.meds, false);

	let s = syncHealth(t, foods, { calories_target: 2417, water_target: 128 });
	assert.match(s, /^---\ntitle: Daily Health\npublish: false\ndate: "2026-09-30"\ncalories: 190\ncalories_target: 2417\nfat_g: 8.3\ncarbs_g: 28.5\nprotein_g: 4\nfiber_g: 5.4\nhydration_oz: 24\nhydration_target_oz: 128\n---\n/);
	assert.equal(syncHealth(s, foods, { calories_target: 2417, water_target: 128 }), s); // settled
	s = toggleMeds(s);
	assert.match(s, /\nmeds: true\n---/);
	assert.equal(healthDay(s, foods).meds, true);
	assert.match(toggleMeds(s), /\nmeds: false\n---/);

	s = syncHealth(addUnder(s, "Mood Log", "14:32 | 🙂 Good"), foods);
	assert.match(s, /\nmood: 🙂 Good\n---/);
	assert.equal(healthDay(s, foods).moods[0].mood, "🙂 Good");

	// Removing the last food zeroes the totals rather than leaving stale ones.
	const items = itemsUnder(s, "🍳Breakfast").concat(itemsUnder(s, "🍇Snacks")).sort((a, b) => b.line - a.line);
	for (const it of items) s = removeLine(s, it.line, it.text);
	s = syncHealth(s, foods);
	assert.match(s, /\ncalories: 0\n/);
	assert.match(s, /\nfat_g: 0\n/);
});

test("exercise: lines, totals and the choices", () => {
	assert.deepEqual(exerciseEntry("07:30 | 🚶 Walk | 3,200 steps | 150 cal | by the river"), { time: "07:30", kind: "🚶 Walk", steps: 3200, kcal: 150, note: "by the river" });
	assert.deepEqual(exerciseEntry("🏃 Run | 300 kcal"), { time: null, kind: "🏃 Run", steps: null, kcal: 300, note: "" });
	assert.equal(exerciseLine("🥾 Hike", { steps: "8000", kcal: "", note: "Red trail\nsteep" }, new Date(2026, 8, 30, 7, 5)), "07:05 | 🥾 Hike | 8000 steps | Red trail steep");

	let t = addUnder(HEALTH, EXERCISE.heading, "07:30 | 🚶 Walk | 3200 steps | 150 cal", { parent: EXERCISE.parent });
	assert.match(t, /## Activity Log\n### 👟 Steps\n- ?\n### 🏃 Exercise\n- 07:30/);
	t = addUnder(t, "👟 Steps", "1000");
	let d = healthDay(t, foods);
	assert.equal(d.steps, 4200);
	assert.equal(d.kcal, 150);
	t = syncHealth(t, foods);
	assert.match(t, /\nsteps: 4200\nsteps_target: 7000\nactivity_kcal: 150\nactivity_kcal_target: 400\n---/);

	const cfg = readPlanner("exercises: [🚴 Bike, Yoga]\nmoods: [😊 Calm, Meh]");
	assert.deepEqual(cfg.exercises, ["🚴 Bike", "Yoga"]);
	assert.deepEqual(cfg.moods.map(moodChoice), [["😊", "Calm"], ["", "Meh"]]);
	assert.equal(writePlanner(cfg), "moods: [😊 Calm, Meh]\nexercises: [🚴 Bike, Yoga]");
	assert.equal(readPlanner("").exercises.length, 3);
	assert.equal(readPlanner("").moods.length, 8);
});

test("a USDA food becomes a Nutrition Database row", () => {
	const food = { name: "Peanut Butter, Creamy (Jif)", serving: "2 tbsp (32g)", calories: 190, fat: 16, carbs: 8, protein: 7, fiber: 2, group: "Fat/Protein", aliases: ["peanut butter, creamy"] };
	const t = addFoodRow(DB + "\nMore notes after the table.\n", food);
	assert.match(t, /\| Peanut Butter \| 2 tbsp \(32g\) \| 190 \| 16 \| 7 \| 7 \| 2 \| Fat\/Protein \| pb \| 15 \(16 oz jar\) \|\n\| Peanut Butter, Creamy \(Jif\) \| 2 tbsp \(32g\) \| 190 \| 16 \| 8 \| 7 \| 2 \| Fat\/Protein \| peanut butter, creamy \|  \|\n\nMore notes/);
	assert.equal(findFood(parseNutrition(t), "Peanut Butter, Creamy (Jif)").calories, 190);
	assert.deepEqual(foodEntry("Peanut Butter, Creamy (Jif), 1.5"), { name: "Peanut Butter, Creamy (Jif)", servings: 1.5 });
	assert.deepEqual(foodEntry("Broccoli, raw"), { name: "Broccoli, raw", servings: 1 });
	assert.deepEqual(foodEntry("Apple, 2"), { name: "Apple", servings: 2 });
	assert.deepEqual(foodEntry("Apple"), { name: "Apple", servings: 1 });
	assert.equal(addFoodRow(t, food), t); // already there
	assert.match(addFoodRow(DB, { ...food, name: "A | B" }), /\| A \/ B \|/);
	assert.match(addFoodRow("# Nutrition Database\n", food), /# Nutrition Database\n\n\| Food \|.*\n\| --- \|.*\n\| Peanut Butter, Creamy \(Jif\) \|/);
});

test("timeline entries keep their calendar color", () => {
	assert.deepEqual(parseEntry("10:30 - 11:15 | Dentist {#039BE5}"), { allDay: false, start: 630, end: 675, text: "Dentist", color: "#039be5" });
	assert.equal(parseEntry("All day | Trip {#7986cb}").color, "#7986cb");
	assert.equal(parseEntry("Standup").color, null);
	const events = [
		{ title: "Dentist", start: "2026-09-30T10:30:00", end: "2026-09-30T11:15:00", color: "#039BE5" },
		{ title: "Staff Meeting", start: "2026-09-30T14:00:00", end: "2026-09-30T15:00:00", color: "#d50000" },
		{ title: "Trip", allDay: true, start: "2026-09-30", end: "2026-10-01", color: "" },
	];
	const r = addEvents(["14:00 - 15:00 | Staff Meeting"], events);
	assert.equal(r.added, 2);
	assert.equal(r.colored, 1);
	assert.deepEqual(r.timeline, ["All day | Trip", "10:30 - 11:15 | Dentist {#039be5}", "14:00 - 15:00 | Staff Meeting {#d50000}"]);
	const again = addEvents(r.timeline, events);
	assert.equal(again.added + again.colored, 0);
	// Editing an entry's text keeps its color; the round trip through the block keeps it too.
	assert.equal(setEntry(r.timeline, 1, "Dentist (cleaning)", 10)[1], "10:30 - 11:15 | Dentist (cleaning) {#039be5}");
	assert.deepEqual(readPlanner(writePlanner({ ...readPlanner(""), timeline: r.timeline })).timeline, r.timeline);
});

test("an entry's color can be picked or taken off", () => {
	const t = ["09:00 - 10:00 | Standup", "13:00 - 14:00 | Write {#039be5}"];
	assert.deepEqual(setEntryColor(t, 0, "#D50000"), ["09:00 - 10:00 | Standup {#d50000}", "13:00 - 14:00 | Write {#039be5}"]);
	assert.deepEqual(setEntryColor(t, 1, null), ["09:00 - 10:00 | Standup", "13:00 - 14:00 | Write"]);
	assert.deepEqual(setEntryColor(t, 0, "red"), t);
	assert.deepEqual(setEntryColor(t, 5, "#d50000"), t);
});

test("food lines read like the Recipe template's: known names first, notes after the amount", () => {
	const db = parseNutrition(DB + "| Broccoli, raw | 1 cup | 31 | 0.3 | 6 | 2.6 | 2.4 | Produce | | |\n| Broccoli | 1 cup | 55 | 0.6 | 11 | 3.7 | 5 | Produce | | |\n");
	assert.deepEqual(foodEntry("Broccoli, raw, 2", db), { name: "Broccoli, raw", servings: 2 });
	assert.deepEqual(foodEntry("Broccoli, 2", db), { name: "Broccoli", servings: 2 });
	assert.deepEqual(foodEntry("Peanut Butter, 2 (smooth, for toast)", db), { name: "Peanut Butter", servings: 2 });
	assert.deepEqual(foodEntry("pb, 1", db), { name: "pb", servings: 1 });
	assert.deepEqual(foodEntry("Mystery bar, 3", db), { name: "Mystery bar", servings: 3 });
	assert.deepEqual(foodEntry("Mystery bar", db), { name: "Mystery bar", servings: 1 });
	const t = addUnder(addUnder(HEALTH, "🍳Breakfast", "Broccoli, raw, 2"), "🍳Breakfast", "Peanut Butter, 1 (smooth, on toast)");
	assert.equal(healthDay(t, db).totals.calories, 2 * 31 + 190);
});

test("card colors: read, shared from the template, written back into the block", async () => {
	const { readPlanner, cardColor, editPlannerBlock } = await import("../src/planner.js");
	assert.deepEqual(readPlanner("colors: {timeline: 3, crit: 9, \"#Todo\": 2}").colors, { timeline: 3, todo: 2 });
	assert.deepEqual(readPlanner("").colors, {});
	const own = readPlanner("colors: {crit: 1}");
	assert.equal(cardColor(own, { crit: 5, timeline: 3 }, "crit"), 1); // the note's own wins
	assert.equal(cardColor(own, { crit: 5, timeline: 3 }, "timeline"), 3); // else the template's
	assert.equal(cardColor(own, {}, "todo"), null);
	const tmpl = "---\ntitle: Daily Planner\n---\n<%* stuff -%>\n```wr1t3r-planner\n```\n\n# Notes\n";
	const a = editPlannerBlock(tmpl, (c) => ({ ...c, colors: { ...c.colors, timeline: 3 } }));
	assert.equal(a, "---\ntitle: Daily Planner\n---\n<%* stuff -%>\n```wr1t3r-planner\ncolors: {timeline: 3}\n```\n\n# Notes\n");
	const b = editPlannerBlock(a, (c) => ({ ...c, colors: {} }));
	assert.equal(b, tmpl);
	assert.equal(editPlannerBlock("no block here", (c) => c), null);
	// Other settings and the timeline stay.
	const day = "```wr1t3r-planner\ntasks: [crit]\ntimeline:\n  - 09:00 - 10:00 | A\n```";
	assert.equal(editPlannerBlock(day, (c) => ({ ...c, colors: { crit: 2 } })), "```wr1t3r-planner\ntasks: [crit]\ncolors: {crit: 2}\ntimeline:\n  - 09:00 - 10:00 | A\n```");
});

test("a deleted calendar event comes off the timeline it was imported into", async () => {
	const { addEvents, removeEvent } = await import("../src/planner.js");
	const at = (h, m) => new Date(2026, 9, 1, h, m).toISOString();
	const ev = { title: "Staff Meeting", start: at(14, 0), end: at(15, 0), color: "#3f51b5" };
	const day = { title: "Trip", allDay: true, start: "2026-10-01", end: "2026-10-01" };
	const { timeline } = addEvents(["10:00 - 11:00 | Write", "14:00 - 15:00 | Something else"], [ev, day]);
	assert.equal(timeline.length, 4);
	const r = removeEvent(timeline, ev);
	assert.equal(r.removed, 1);
	assert.ok(!r.timeline.some((l) => l.includes("Staff Meeting")));
	assert.ok(r.timeline.includes("14:00 - 15:00 | Something else"));
	assert.equal(removeEvent(r.timeline, day).timeline.length, 2);
	assert.equal(removeEvent(r.timeline, { ...ev, title: "Not there" }).removed, 0);
});
