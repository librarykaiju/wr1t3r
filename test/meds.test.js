import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTime, parseDays, parseMed, medLine, parseMeds, putMed, removeMed, dosesOn, medEntry, medTakenLine, doseStatus, overdue, medReminders, newMedsNote, medsCalendar, medEvents } from "../src/meds.js";
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
	assert.equal(t.water_target, 104); // 3.0 L of drinks, to the nearest 8 oz
	assert.equal(t.floored, false);
	// 1.2 g/kg while losing, on the BMI-25 weight for 5'10" (79 kg)
	assert.equal(t.protein_target, 95);
	assert.equal(t.fat_target, Math.round(2060 * 0.3 / 9));
	assert.equal(t.fiber_target, 29);
	assert.equal(t.steps_target, 8000);
	assert.equal(workOut({ ...g, plan: "maintain" }).protein_target, Math.round(0.8 * 25 * 1.778 ** 2));
	assert.equal(workOut({ ...g, sex: "female" }).water_target, 72);
	assert.equal(workOut({ ...g, age: 17 }), null);
	const expecting = workOut({ ...g, sex: "female", pregnant: true });
	assert.equal(expecting.calories_target, workOut({ ...g, sex: "female", plan: "maintain" }).calories_target);
	assert.equal(readGoal({ ...g, pregnant: "true" }).pregnant, true);
	assert.equal(readGoal(g).pregnant, undefined);
	const small = workOut({ units: "kg", sex: "female", age: 70, height: 150, weight: 45, activity: "sedentary", plan: "lose-1" });
	assert.equal(small.calories_target, 1200);
	assert.equal(small.floored, true);
	assert.equal(needsRecalc(g, 204), true);
	assert.equal(needsRecalc(g, 207), false);
	assert.equal(needsRecalc({ ...g, units: "kg", weight: 90 }, 87), true);
});

test("a medicine line keeps its pill photo", async () => {
	const { photoTarget } = await import("../src/meds.js");
	assert.equal(photoTarget("![[Lisinopril pill.jpg]]"), "Lisinopril pill.jpg");
	assert.equal(photoTarget("![](Lisinopril%20pill.jpg)"), "Lisinopril pill.jpg");
	assert.equal(photoTarget("10 mg"), null);
	const m = parseMed("Lisinopril | 10 mg | 08:00 | Mon | ![[Lisinopril pill.jpg]]");
	assert.deepEqual(m, { name: "Lisinopril", dose: "10 mg", times: ["08:00"], asNeeded: false, days: [1], photo: "![[Lisinopril pill.jpg]]" });
	assert.equal(medLine(m), "Lisinopril | 10 mg | 08:00 | Mon | ![[Lisinopril pill.jpg]]");
	assert.equal(parseMed("Ibuprofen | 200 mg | ![[Ibuprofen pill.jpg]] | as needed").photo, "![[Ibuprofen pill.jpg]]");
	assert.equal(parseMed("Ibuprofen | 200 mg | ![[Ibuprofen pill.jpg]] | as needed").asNeeded, true);
	assert.equal(medLine({ name: "Ibuprofen", dose: "200 mg", photo: "![[Ibuprofen pill.jpg]]" }), "Ibuprofen | 200 mg | as needed | ![[Ibuprofen pill.jpg]]");
	assert.equal(medLine({ name: "Ibuprofen", dose: "200 mg", photo: "" }), "Ibuprofen | 200 mg | as needed");
	assert.equal(dosesOn([m], "2026-10-12")[0].photo, "![[Lisinopril pill.jpg]]");
});

test("doses say who gave them, and a second dose is caught", async () => {
	const { alreadyGiven } = await import("../src/meds.js");
	const at = new Date(2026, 9, 13, 8, 12);
	const line = medTakenLine({ name: "Lisinopril", dose: "10 mg" }, "08:00", at, "Sam");
	assert.equal(line, "08:12 | Lisinopril | 10 mg | for 08:00 | by Sam");
	assert.deepEqual(medEntry(line), { time: "08:12", name: "Lisinopril", dose: "10 mg", for: "08:00", by: "Sam" });
	assert.equal(medTakenLine({ name: "Lisinopril", dose: "10 mg" }, "08:00", at), "08:12 | Lisinopril | 10 mg | for 08:00");
	const log = [medEntry(line), medEntry("14:40 | Ibuprofen | 200 mg | by Brandon")];
	assert.equal(alreadyGiven(log, { name: "lisinopril", forTime: "08:00" }).by, "Sam");
	assert.equal(alreadyGiven(log, { name: "Lisinopril", forTime: "20:00" }), null);
	assert.equal(alreadyGiven(log, { name: "Ibuprofen", now: new Date(2026, 9, 13, 14, 55) }).time, "14:40");
	assert.equal(alreadyGiven(log, { name: "Ibuprofen", now: new Date(2026, 9, 13, 15, 30) }), null);
});

test("people's medicines live in their own folder", async () => {
	const { personMedsPath, personLogPath, cleanPerson, newMedsNote, newMedsLog, parseMeds: pm } = await import("../src/meds.js");
	const { readPlanner, syncMedsLog } = await import("../src/planner.js");
	assert.equal(cleanPerson(" Aunt / Jo|"), "Aunt Jo");
	assert.equal(personMedsPath("Mom"), "People/Mom/Medications.md");
	assert.equal(personLogPath("Mom", "2026-10-13"), "People/Mom/Meds/2026-10-13 meds.md");
	assert.match(newMedsNote("Mom"), /^title: "Mom's medications"$/m);
	assert.deepEqual(readPlanner("people: [Mom, Dad, mom]").people, ["Mom", "Dad"]);
	assert.deepEqual(readPlanner("").people, []);
	assert.deepEqual(readPlanner("buttons: [meds]", "people: [Mom]").people, ["Mom"]);
	const meds = pm("- Lisinopril | 10 mg | 08:00, 20:00");
	const doses = dosesOn(meds, "2026-10-13");
	const log = newMedsLog("Mom", "2026-10-13").replace("## 💊 Medications\n", "## 💊 Medications\n- 08:12 | Lisinopril | 10 mg | for 08:00 | by Sam\n");
	const out = syncMedsLog(log, doses);
	assert.match(out, /^meds: false$/m);
	assert.match(out, /^meds_taken: 1$/m);
	assert.match(out, /^meds_due: 2$/m);
	assert.match(out, /^person: "Mom"$/m);
	const r = medReminders(meds, { from: new Date(2026, 9, 13, 9).getTime(), days: 1, who: "Mom" });
	assert.deepEqual(r.map((x) => x.title), ["💊 Mom: Lisinopril 10 mg"]);
	assert.notEqual(r[0].id, medReminders(meds, { from: new Date(2026, 9, 13, 9).getTime(), days: 1 })[0].id);
});

test("a course with dates, a purpose and a note, and its chart", async () => {
	const { parseDate, activeOn, scheduleText, medChart } = await import("../src/meds.js");
	assert.equal(parseDate("10/20/26"), "2026-10-20");
	assert.equal(parseDate("2026-10-24"), "2026-10-24");
	assert.equal(parseDate("2/30/26"), null);
	const m = parseMed("Ondansetron | 8 mg | 6am, 3pm, 10pm | from 10/20/26 | until 2026-10-24 | purpose: Prevents nausea | note: Then as needed every 8 h");
	assert.deepEqual([m.from, m.until, m.purpose, m.note, m.dose, m.times], ["2026-10-20", "2026-10-24", "Prevents nausea", "Then as needed every 8 h", "8 mg", ["06:00", "15:00", "22:00"]]);
	assert.equal(medLine(m), "Ondansetron | 8 mg | 06:00, 15:00, 22:00 | from 2026-10-20 | until 2026-10-24 | purpose: Prevents nausea | note: Then as needed every 8 h");
	assert.deepEqual(parseMed(medLine(m)), m);
	assert.equal(activeOn(m, "2026-10-19"), false);
	assert.equal(activeOn(m, "2026-10-24"), true);
	assert.equal(dosesOn([m], "2026-10-25").length, 0);
	assert.equal(dosesOn([m], "2026-10-21").length, 3);
	assert.match(scheduleText(m), /^8 mg, 3 times a day · Start Oct 20(, 2026)? · Last dose Oct 24(, 2026)? · Then as needed every 8 h$/);
	const bactrim = parseMed("Bactrim DS | 1 tab | 11am | Mon, Wed, Fri | from 2026-11-19");
	assert.match(scheduleText(bactrim), /^1 tab, once a day, Mon, Wed, Fri · Start Nov 19/);
	const prn = parseMed("Ibuprofen | 200 mg | as needed");
	const chart = medChart([m, bactrim, prn], "2026-10-21", [medEntry("06:05 | Ondansetron | 8 mg | for 06:00 | by Sam"), medEntry("13:00 | Ibuprofen | 200 mg")]);
	assert.deepEqual(chart.times, ["06:00", "11:00", "15:00", "22:00"]);
	assert.equal(chart.rows[0].cells["06:00"].given.by, "Sam");
	assert.equal(chart.rows[0].cells["15:00"].due, true);
	assert.equal(chart.rows[0].cells["15:00"].given, null);
	assert.equal(chart.rows[1].active, false);
	assert.equal(chart.rows[1].cells["11:00"].due, false);
	assert.equal(chart.rows[2].given.length, 1);
});

test("medsCalendar: yours and each person's", () => {
	assert.deepEqual(medsCalendar(), { id: "wr1t3r-meds", name: "Medications", color: "#33b679", shown: true, writable: false, meds: true });
	assert.equal(medEvents(parseMeds("- A | 1 | 09:00"), medsCalendar(), { from: new Date(2026, 9, 7), to: new Date(2026, 9, 8) })[0].title, "💊 A 1");
	const mom = medsCalendar("Mom", 1);
	assert.equal(mom.id, "wr1t3r-meds:mom");
	assert.equal(mom.name, "Mom's medicines");
	assert.equal(mom.who, "Mom");
	assert.notEqual(mom.color, medsCalendar().color);
});

test("medEvents: each dose as a quarter-hour event, given ones ticked", () => {
	const meds = parseMeds("- Lisinopril | 10 mg | 08:00, 20:00\n- Ibuprofen | 200 mg | as needed\n- Amoxicillin | 500 mg | 12:00 | until 2026-10-07");
	const c = medsCalendar("Mom", 1);
	const from = new Date(2026, 9, 7, 9, 0), to = new Date(2026, 9, 9);
	const ev = medEvents(meds, c, { from, to, takenOn: (day) => (day === "2026-10-07" ? [medEntry("12:05 | Amoxicillin | 500 mg | for 12:00 | by Brandon")] : []) });
	// 08:00 on the 7th is before `from`; Amoxicillin stops after the 7th.
	assert.deepEqual(ev.map((e) => [new Date(e.start).getDate(), new Date(e.start).getHours(), e.title]), [
		[7, 12, "✓ Mom: Amoxicillin 500 mg"], [7, 20, "💊 Mom: Lisinopril 10 mg"], [8, 8, "💊 Mom: Lisinopril 10 mg"], [8, 20, "💊 Mom: Lisinopril 10 mg"],
	]);
	assert.equal(ev[0].location, "given 12:05 by Brandon");
	assert.equal(ev[0].calendar, c.id);
	assert.equal(ev[0].color, c.color);
	assert.deepEqual(ev[0].alerts, []);
	assert.equal(new Date(ev[1].end) - new Date(ev[1].start), 15 * 60000);
	assert.equal(new Set(ev.map((e) => e.id)).size, ev.length);
});
