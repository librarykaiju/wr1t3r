import { test } from "node:test";
import assert from "node:assert/strict";
import { readPlanner, writePlanner, editPlannerBlock, sleepEntry, sleepLine, sleepHours, hoursText, weightEntry, weightLine, healthDay, syncHealth, addUnder, SLEEP, WEIGHT, MEDS } from "../src/planner.js";
import { dosesOn, parseMeds, medTakenLine } from "../src/meds.js";
import { parseFrontmatter } from "../src/dvpage.js";

test("buttons: the first five by default, a chosen list in its order", () => {
	assert.deepEqual(readPlanner("").buttons, ["food", "water", "meds", "exercise", "mood"]);
	assert.deepEqual(readPlanner("buttons: [Sleep, meds, nope, meds]").buttons, ["sleep", "meds"]);
	assert.deepEqual(readPlanner("buttons: []").buttons, []);
	assert.equal(writePlanner(readPlanner("buttons: [weight, sleep]")), "buttons: [weight, sleep]");
	assert.equal(writePlanner(readPlanner("")), "");
});

test("a day takes the template's shared settings unless it sets its own", () => {
	const tmpl = "buttons: [meds, water]\ncalories_target: 2000\nmacros: true\ntimeline:\n  - 09:00 | Template thing\ncolors: {timeline: 3}";
	const cfg = readPlanner("tasks: [todo]\ncalories_target: 1800", tmpl);
	assert.deepEqual(cfg.buttons, ["meds", "water"]);
	assert.equal(cfg.calories_target, 1800);
	assert.equal(cfg.macros, true);
	assert.deepEqual(cfg.timeline, []); // not shared
	assert.deepEqual(cfg.tasks, ["todo"]);
	assert.deepEqual(cfg.colors, {});
});

test("goal, macros and setup write back as YAML that reads the same", () => {
	const cfg = { ...readPlanner(""), setup: "done", macros: true, goal: { units: "lb", sex: "male", age: 41, height: 70, weight: 210, activity: "light", plan: "lose-1" }, calories_target: 2060, protein_target: 130 };
	const text = writePlanner(cfg);
	assert.match(text, /^setup: done$/m);
	assert.match(text, /^macros: true$/m);
	assert.match(text, /^goal: \{units: lb, sex: male, age: 41, height: 70, weight: 210, activity: light, plan: lose-1\}$/m);
	const back = readPlanner(text);
	assert.equal(back.setup, "done");
	assert.equal(back.macros, true);
	assert.equal(Number(back.goal.weight), 210);
	assert.equal(back.goal.plan, "lose-1");
	assert.equal(back.protein_target, 130);
	const note = "# Daily\n\n```wr1t3r-planner\ntasks: [todo]\n```\n";
	assert.match(editPlannerBlock(note, (c) => ({ ...c, buttons: ["sleep"], med_reminders: false })), /```wr1t3r-planner\ntasks: \[todo\]\nbuttons: \[sleep\]|```wr1t3r-planner\nbuttons: \[sleep\]\ntasks: \[todo\]/);
	assert.equal(readPlanner("med_reminders: false").med_reminders, false);
	assert.equal(readPlanner("").med_reminders, true);
});

test("sleep lines", () => {
	assert.equal(sleepHours("23:10", "06:40"), 7.5);
	assert.equal(sleepHours("01:00", "08:15"), 7.3);
	assert.equal(sleepLine("23:10", "6:40", "woke once"), "23:10 - 06:40 | 7.5 h | woke once");
	assert.deepEqual(sleepEntry("23:10 - 06:40 | 7.5 h | woke once"), { bed: "23:10", wake: "06:40", hours: 7.5, note: "woke once" });
	assert.deepEqual(sleepEntry("7h 30m"), { bed: null, wake: null, hours: 7.5, note: "" });
	assert.equal(sleepEntry("22:00 - 06:00").hours, 8);
	assert.equal(hoursText(7.5), "7h 30m");
	assert.equal(hoursText(8), "8h");
});

test("weight lines", () => {
	assert.deepEqual(weightEntry("07:05 | 208.4 lb"), { time: "07:05", value: 208.4, unit: "lb" });
	assert.deepEqual(weightEntry("94,5 kg"), { time: null, value: 94.5, unit: "kg" });
	assert.equal(weightLine(208.44, "lb", new Date(2026, 9, 7, 7, 5)), "07:05 | 208.4 lb");
});

test("the health note's sleep, weight and doses go into its properties", () => {
	let t = "---\ntitle: Daily Health\n---\n\n## Mood Log\n- \n";
	t = addUnder(t, SLEEP.heading, "23:00 - 06:30 | 7.5 h");
	t = addUnder(t, WEIGHT.heading, "07:00 | 208 lb");
	t = addUnder(t, WEIGHT.heading, "21:00 | 209.2 lb");
	const meds = parseMeds("- Lisinopril | 10 mg | 08:00\n- Vitamin D | 08:00, 20:00\n");
	const doses = dosesOn(meds, "2026-10-07");
	t = addUnder(t, MEDS.heading, medTakenLine(doses[0], "08:00", new Date(2026, 9, 7, 8, 5)));
	const d = healthDay(t, []);
	assert.equal(d.sleepHours, 7.5);
	assert.equal(d.weight, 209.2);
	assert.equal(d.medsTaken.length, 1);
	let fm = parseFrontmatter(syncHealth(t, [], readPlanner(""), doses));
	assert.equal(fm.sleep_h, 7.5);
	assert.equal(fm.sleep_target_h, 8);
	assert.equal(fm.weight, 209.2);
	assert.equal(fm.weight_unit, "lb");
	assert.equal(fm.meds, false);
	assert.equal(fm.meds_taken, 1);
	assert.equal(fm.meds_due, 3);
	for (const dose of doses.slice(1)) t = addUnder(t, MEDS.heading, medTakenLine(dose, dose.time));
	fm = parseFrontmatter(syncHealth(t, [], readPlanner(""), doses));
	assert.equal(fm.meds, true);
	// No schedule: the Meds yes/no is left as it was.
	fm = parseFrontmatter(syncHealth("---\nmeds: true\n---\n", [], readPlanner("")));
	assert.equal(fm.meds, true);
});
