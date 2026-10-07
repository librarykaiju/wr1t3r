// Daily targets worked out from a goal: calories from the Mifflin-St Jeor
// resting rate times an activity level, less or more for the plan; water from
// body weight; and protein, fat and carbs (shown only when the planner's
// macros switch is on). The goal is kept in the Daily template's planner
// block, so every day uses it:
//   goal: {units: lb, sex: male, age: 41, height: 70, weight: 210, activity: light, plan: lose-1}
// height is inches (lb) or centimeters (kg).

export const ACTIVITY = [
	["sedentary", "Mostly sitting", 1.2],
	["light", "On my feet some of the day", 1.375],
	["moderate", "Exercise 3 to 5 days a week", 1.55],
	["very", "Hard exercise most days", 1.725],
];

// [id, label in lb, label in kg, calories a day]
export const PLANS = [
	["lose-1", "Lose 1 lb a week", "Lose about 0.5 kg a week", -500],
	["lose-0.5", "Lose ½ lb a week", "Lose about 0.25 kg a week", -250],
	["maintain", "Stay where I am", "Stay where I am", 0],
	["gain-0.5", "Gain ½ lb a week", "Gain about 0.25 kg a week", 250],
];

export const SEXES = [["female", "Female"], ["male", "Male"], ["other", "Other / rather not say"]];

// The fewest calories a day it will suggest.
const FLOOR = { male: 1500, female: 1200, other: 1350 };
const LB = 2.20462;

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

// The goal from a planner block ({...} or nothing) with its numbers checked:
// { units, sex, age, height, weight, activity, plan }, or null when it's
// missing something needed.
export function readGoal(raw) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const g = {
		units: String(raw.units || "lb").toLowerCase() === "kg" ? "kg" : "lb",
		sex: SEXES.some(([k]) => k === raw.sex) ? raw.sex : "other",
		age: num(raw.age), height: num(raw.height), weight: num(raw.weight),
		activity: ACTIVITY.some(([k]) => k === raw.activity) ? raw.activity : "light",
		plan: PLANS.some(([k]) => k === String(raw.plan)) ? String(raw.plan) : "maintain",
	};
	return g.age && g.height && g.weight ? g : null;
}

const round = (n, step) => Math.round(n / step) * step;

// The targets for a goal: { calories_target, water_target, protein_target,
// fat_target, carbs_target, rest (resting calories), floored (true when the
// plan would have gone under the floor) }, or null.
export function workOut(goal, { water_step = 8 } = {}) {
	const g = readGoal(goal);
	if (!g) return null;
	const kg = g.units === "kg" ? g.weight : g.weight / LB;
	const cm = g.units === "kg" ? g.height : g.height * 2.54;
	const sexAdj = g.sex === "male" ? 5 : g.sex === "female" ? -161 : -78;
	const rest = 10 * kg + 6.25 * cm - 5 * g.age + sexAdj;
	const factor = ACTIVITY.find(([k]) => k === g.activity)[2];
	const change = PLANS.find(([k]) => k === g.plan)[3];
	const want = rest * factor + change;
	const floor = FLOOR[g.sex];
	const calories = round(Math.max(want, floor), 10);
	// Water: about 2/3 oz per lb, rounded up to whole steps.
	const step = num(water_step) || 8;
	const water = Math.max(step, Math.ceil((kg * LB * 2 / 3) / step) * step);
	// Protein: 0.8 g per lb of body weight, counted no higher than the weight
	// that's a BMI of 25 for the height (so it doesn't climb with extra fat).
	const refKg = Math.min(kg, 25 * (cm / 100) ** 2);
	const protein = Math.round(0.8 * refKg * LB);
	const fat = Math.round((calories * 0.3) / 9);
	const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
	return { calories_target: calories, water_target: water, protein_target: protein, fat_target: fat, carbs_target: carbs, rest: Math.round(rest), floored: want < floor };
}

// Whether the weight logged has moved far enough from the goal's (5 lb or
// 2.5 kg) that the targets are worth working out again.
export function needsRecalc(goal, weight) {
	const g = readGoal(goal);
	const w = num(weight);
	if (!g || !w) return false;
	return Math.abs(w - g.weight) >= (g.units === "kg" ? 2.5 : 5);
}
