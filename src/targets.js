// Daily targets worked out from a goal, each from a published guideline (the
// list is on wr1t3r.app/health-data.html; keep the two in step):
//   calories  Mifflin-St Jeor resting rate (Am J Clin Nutr 1990), the most
//             accurate of the common equations (Frankenfield, J Am Diet Assoc
//             2005), times an activity level, less or more for the plan, never
//             under NHLBI's 1200/1500 floor (1998 obesity guidelines)
//   water     the National Academies' adequate intake from drinks (2004):
//             about 3.0 L for men, 2.2 L for women
//   protein   g per kg: the 0.8 RDA, 1.0 at 65+ (PROT-AGE 2013), 1.1 when
//             pregnant or nursing (IOM 2005), 1.2 while losing weight (Leidy,
//             Am J Clin Nutr 2015), 1.4 for hard training (ISSN 2017); the
//             highest that applies, and no more than 35% of calories
//   fat       30% of calories, inside the IOM's 20-35% range
//   carbs     the rest; `lowCarbs` when that's under the 130 g RDA
//   fiber     14 g per 1000 calories (IOM 2005)
//   steps     8000 under 60, 7000 from 60 (Paluch, Lancet Public Health 2022)
// Only for adults (18+): the equations aren't meant for children. The goal is
// kept in the Daily template's planner block, so every day uses it:
//   goal: {units: lb, sex: male, age: 41, height: 70, weight: 210, activity: light, plan: lose-1}
// height is inches (lb) or centimeters (kg). pregnant: true (pregnant or
// breastfeeding) drops any calorie cut.

export const ACTIVITY = [
	["sedentary", "Mostly sitting", 1.2],
	["light", "About 30 minutes of walking or other activity a day", 1.375],
	["moderate", "About an hour of activity a day", 1.55],
	["very", "Two hours a day, or hard training", 1.725],
];

// [id, label in lb, label in kg, calories a day]
export const PLANS = [
	["lose-1", "Lose 1 lb a week", "Lose about 0.5 kg a week", -500],
	["lose-0.5", "Lose ½ lb a week", "Lose about 0.25 kg a week", -250],
	["maintain", "Stay where I am", "Stay where I am", 0],
	["gain-0.5", "Gain ½ lb a week", "Gain about 0.25 kg a week", 250],
];

export const SEXES = [["female", "Female"], ["male", "Male"], ["other", "Other / rather not say"]];

// The youngest age it works targets out for.
export const ADULT = 18;
// The fewest calories a day it will suggest.
const FLOOR = { male: 1500, female: 1200, other: 1350 };
// Water from drinks, fl oz a day (3.0 L, 2.2 L, and halfway).
const WATER = { male: 101, female: 74, other: 88 };
const LB = 2.20462;

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const yes = (v) => v === true || /^(true|yes|on|1)$/i.test(String(v ?? "").trim());

// The goal from a planner block ({...} or nothing) with its numbers checked:
// { units, sex, age, height, weight, activity, plan, pregnant }, or null when
// it's missing something needed.
export function readGoal(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const g = {
		units: String(raw.units || "lb").toLowerCase() === "kg" ? "kg" : "lb",
		sex: SEXES.some(([k]) => k === raw.sex) ? raw.sex : "other",
		age: num(raw.age), height: num(raw.height), weight: num(raw.weight),
		activity: ACTIVITY.some(([k]) => k === raw.activity) ? raw.activity : "light",
		plan: PLANS.some(([k]) => k === String(raw.plan)) ? String(raw.plan) : "maintain",
	};
	if (yes(raw.pregnant)) g.pregnant = true;
	return g.age && g.height && g.weight ? g : null;
}

const round = (n, step) => Math.round(n / step) * step;

// The targets for a goal: { calories_target, water_target, protein_target,
// fat_target, carbs_target, fiber_target, steps_target, rest (resting
// calories), floored (true when the plan would have gone under the floor),
// lowCarbs }, or null (also for anyone under ADULT).
export function workOut(goal, { water_step = 8 } = {}) {
	const g = readGoal(goal);
	if (!g || g.age < ADULT) return null;
	const kg = g.units === "kg" ? g.weight : g.weight / LB;
	const cm = g.units === "kg" ? g.height : g.height * 2.54;
	const sexAdj = g.sex === "male" ? 5 : g.sex === "female" ? -161 : -78;
	const rest = 10 * kg + 6.25 * cm - 5 * g.age + sexAdj;
	const factor = ACTIVITY.find(([k]) => k === g.activity)[2];
	let change = PLANS.find(([k]) => k === g.plan)[3];
	if (g.pregnant) change = Math.max(0, change);
	const want = rest * factor + change;
	const floor = FLOOR[g.sex];
	const calories = round(Math.max(want, floor), 10);
	const step = num(water_step) || 8;
	const water = Math.max(step, round(WATER[g.sex], step));
	// Protein is counted on no more than the weight that's a BMI of 25 for
	// the height, so it doesn't climb with extra fat.
	const refKg = Math.min(kg, 25 * (cm / 100) ** 2);
	const perKg = Math.max(0.8, g.age >= 65 ? 1.0 : 0, g.pregnant ? 1.1 : 0, change < 0 ? 1.2 : 0, g.activity === "very" ? 1.4 : 0);
	const protein = Math.round(Math.min(perKg * refKg, (calories * 0.35) / 4));
	const fat = Math.round((calories * 0.3) / 9);
	const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
	return {
		calories_target: calories, water_target: water, protein_target: protein, fat_target: fat, carbs_target: carbs,
		fiber_target: Math.round((calories / 1000) * 14), steps_target: g.age < 60 ? 8000 : 7000,
		rest: Math.round(rest), floored: want < floor, lowCarbs: carbs < 130,
	};
}

// Whether the weight logged has moved far enough from the goal's (5 lb or
// 2.5 kg) that the targets are worth working out again.
export function needsRecalc(goal, weight) {
	const g = readGoal(goal);
	const w = num(weight);
	if (!g || !w) return false;
	return Math.abs(w - g.weight) >= (g.units === "kg" ? 2.5 : 5);
}
