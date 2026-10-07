import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTime, parseDays, parseMed, medLine, parseMeds, putMed, removeMed, dosesOn, medEntry, medTakenLine, doseStatus, overdue, medReminders, newMedsNote } from "../src/meds.js";
import { workOut, readGoal, needsRecalc } from "../src/targets.js";

test("times and days", () => {
	assert.equal(parseTime("8am"), "08:00");
	assert.equal(parseTime("8:30 pm"), "20:30");
	assert.equal(parseTime("12am"), "00:00");
	assert.equal(parseTime("20:00"), "20:00");
	assert.equal(parseTime("2"), null);
	assert.equal(parseTime("25:00"), null);
	assert.deepEqual(parseDays("Mon, Thu"), [1, 4]);
	assert.deepEqual(parseDays("weekdays"), [1, 2, 3, 4, 5]);
	assert.equal(parseDays("daily"), null);
	assert.equal(parseDays("blue"), null);
});

test("a medicine line reads and writes back", () => {
	assert.deepEqual(parseMed("Lisinopril | 10 mg | 08:00"), { name: "Lisinopril", dose: "10 mg", times: ["08:00"], asNeeded: false, days: null });
	assert.deepEqual(parseMed("Vitamin D | 1 tab | 8pm, 8am"), { name: "Vitamin D", dose: "1 tab", times: ["08:00", "20:00"], asNeeded: false, days: null });
	assert.deepEqual(parseMed("Methotrexate | 2.5 mg | 09:00 | Mon"), { name: "Methotrexate", dose: "2.5 mg", times: ["09:00"], asNeeded: false, days: [1] });
	assert.deepEqual(parseMed("Ibuprofen | 200 mg | as needed"), { name: "Ibuprofen", dose: "200 mg", times: [], asNeeded: true, days: null });
	assert.deepEqual(parseMed("Vitamin C | 8am"), { name: "Vitamin C", dose: "", times: ["08:00"], asNeeded: false, days: null });
	assert.deepEqual(parseMed("Tylenol | 2 | 08:00").dose, "2");
	assert.equal(medLine(parseMed("Methotrexate | 2.5 mg | 09:00 | Mon")), "Methotrexate | 2.5 mg | 09:00 | Mon");
	assert.equal(medLine({ name: "Ibuprofen", dose: "200 mg", times: [] }), "Ibuprofen | 200 mg | as needed");
	assert.equal(medLine({ name: "A|B", dose: "", times: ["08:00"], days: [1, 2, 3, 4, 5] }), "A B | 08:00 | weekdays");
});

test("the list note: read, add, change, remove", () => {
	let t = newMedsNote();
	assert.deepEqual(parseMeds(t), []);
	t = putMed(t, { name: "Lisinopril", dose: "10 mg", times: ["08:00"] });
	t = putMed(t, { name: "Ibuprofen", dose: "200 mg", times: [] });
	const list = parseMeds(t);
	assert.deepEqual(list.map((m) => m.name), ["Lisinopril", "Ibuprofen"]);
	assert.match(t, /^title: Medications$/m);
	t = putMed(t, { name: "Lisinopril", dose: "20 mg", times: ["08:00"] }, list[0].line);
	assert.equal(parseMeds(t)[0].dose, "20 mg");
	t = removeMed(t, parseMeds(t)[1].line);
	assert.deepEqual(parseMeds(t).map((m) => m.name), ["Lisinopril"]);
	assert.deepEqual(parseMeds("---\na: - b | 08:00\n---\n- [ ] task | 08:00\n```\n- X | 08:00\n```\n- Y | 9am\n").map((m) => m.name), ["Y"]);
});

test("a day's doses and what's taken", () => {
	const meds = parseMeds("- Lisinopril | 10 mg | 08:00\n- Vitamin D | 1 tab | 08:00, 20:00\n- Methotrexate | 2.5 mg | 09:00 | Mon\n- Ibuprofen | 200 mg | as needed\n");
	assert.equal(dosesOn(meds, "2026-10-05").length, 4); // a Monday
	const doses = dosesOn(meds, "2026-10-07"); // a Wednesday
	assert.deepEqual(doses.map((d) => `${d.time} ${d.name}`), ["08:00 Lisinopril", "08:00 Vitamin D", "20:00 Vitamin D"]);
	const at = new Date(2026, 9, 7, 20, 5);
	assert.equal(medTakenLine(doses[2], "20:00", at), "20:05 | Vitamin D | 1 tab | for 20:00");
	const taken = [medEntry(medTakenLine(doses[2], "20:00", at)), medEntry("08:30 | lisinopril"), medEntry("14:00 | Ibuprofen | 200 mg")];
	const st = doseStatus(doses, taken);
	assert.deepEqual(st.doses.map((d) => !!d.taken), [true, false, true]);
	assert.equal(st.done, 2);
	assert.equal(st.due, 3);
	assert.deepEqual(st.extra.map((e) => e.name), ["Ibuprofen"]);
	// A Vitamin D logged by hand without "for" fills the first open dose.
	assert.deepEqual(doseStatus(doses, [medEntry("09:00 | Vitamin D")]).doses.map((d) => !!d.taken), [false, true, false]);
	assert.deepEqual(overdue(st, "2026-10-07", new Date(2026, 9, 7, 9, 30)).map((d) => d.name), ["Vitamin D"]);
	assert.deepEqual(overdue(st, "2026-10-07", new Date(2026, 9, 7, 8, 30)), []);
	assert.deepEqual(overdue(st, "2026-10-06", new Date(2026, 9, 7, 23, 0)), []);
});

test("reminders skip doses taken and past", () => {
	const meds = parseMeds("- Lisinopril | 10 mg | 08:00\n- Vitamin D | 20:00\n- Ibuprofen | as needed\n");
	const from = new Date(2026, 9, 7, 7, 0).getTime();
	const r = medReminders(meds, { from, days: 2, takenOn: (day) => (day === "2026-10-07" ? [medEntry("07:10 | Lisinopril | 10 mg | for 08:00")] : []), pathOn: (day) => `${day} Health.md` });
	assert.deepEqual(r.map((x) => [new Date(x.at).getDate(), new Date(x.at).getHours(), x.title]), [[7, 20, "💊 Vitamin D"], [8, 8, "💊 Lisinopril 10 mg"], [8, 20, "💊 Vitamin D"]]);
	assert.equal(r[0].path, "2026-10-07 Health.md");
	assert.equal(new Set(r.map((x) => x.id)).size, 3);
});

test("targets from a goal", () => {
	assert.equal(readGoal({ age: 41 }), null);
	const g = { units: "lb", sex: "male", age: 41, height: 70, weight: 210, activity: "light", plan: "lose-1" };
	const t = workOut(g, { water_step: 8 });
	// 10*95.25 + 6.25*177.8 - 205 + 5 = 1864; *1.375 = 2563; -500 = 2063
	assert.equal(t.rest, 1864);
	assert.equal(t.calories_target, 2060);
	assert.equal(t.water_target, 144);
	assert.equal(t.floored, false);
	assert.ok(t.protein_target > 100 && t.protein_target < 160, t.protein_target);
	assert.equal(t.fat_target, Math.round(2060 * 0.3 / 9));
	const small = workOut({ units: "kg", sex: "female", age: 70, height: 150, weight: 45, activity: "sedentary", plan: "lose-1" });
	assert.equal(small.calories_target, 1200);
	assert.equal(small.floored, true);
	assert.equal(needsRecalc(g, 204), true);
	assert.equal(needsRecalc(g, 207), false);
	assert.equal(needsRecalc({ ...g, units: "kg", weight: 90 }, 87), true);
});
