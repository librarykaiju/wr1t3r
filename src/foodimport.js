// Foods into the Nutrition Database from a spreadsheet: a CSV with a header
// row, its columns matched by name so their order (and any extra columns)
// don't matter. A food needs a name and calories; the rest default to 0.
//   name      Food, Name, Food Name, Description, Item
//   serving   Serving, Serving Size, Amount, Portion
//   calories  Calories, Energy (kcal), kcal, Energy
//   fat       Fat, Total Fat          carbs   Carbs, Carbohydrates, Total Carbs
//   protein   Protein                 fiber   Fiber, Fibre, Dietary Fiber
//   group     Food Group, Group, Category
//   aliases   Aliases (comma-separated)
// Units in brackets ("Fat (g)") are ignored. A food already in the database
// (same name) is left as it is, and so is a repeat further down the file.

import { parseCsv } from "./storygraph.js";
import { parseNutrition } from "./planner.js";

export const NUTRITION_NOTE = "Nutrition Database.md";
export const NUTRITION_HEADER = "| Food | Serving Size | Calories | Fat (g) | Carbs (g) | Protein (g) | Fiber (g) | Food Group | Aliases | Servings/Container |";

export function newNutritionNote() {
	return `---\ntitle: Nutrition Database\n---\n\n# Nutrition Database\n\nOne food per row, for one serving. The planner's Food button logs from this table.\n\n${NUTRITION_HEADER}\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
}

const COLUMNS = {
	name: /^(food|name|food name|description|item)$/,
	serving: /^(serving|serving size|amount|portion)$/,
	calories: /^(calories|energy|kcal|energy kcal|calories kcal)$/,
	fat: /^(fat|total fat)$/,
	carbs: /^(carbs|carbohydrates?|total carbs|total carbohydrates?|net carbs)$/,
	protein: /^protein$/,
	fiber: /^(fiber|fibre|dietary fiber|dietary fibre)$/,
	group: /^(food group|group|category)$/,
	aliases: /^aliases?$/,
};

// A header cell as it's matched: lower case, units in brackets and stray
// punctuation dropped ("Energy (kcal)" -> "energy kcal", "Fat (g)" -> "fat").
const norm = (h) => String(h).toLowerCase().replace(/\((g|mg|kcal)\)/g, (m, u) => (u === "kcal" ? " kcal" : "")).replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

const number = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : 0; };

// CSV text -> { foods: [{ name, serving, calories, fat, carbs, protein, fiber,
// group, aliases }], skipped (rows with no name or calories) }. Throws when
// the header has no name or calories column.
export function readFoodCsv(text) {
	const [head = [], ...rows] = parseCsv(text);
	const at = {};
	head.forEach((h, i) => {
		const n = norm(h);
		for (const [k, re] of Object.entries(COLUMNS)) if (at[k] == null && re.test(n)) at[k] = i;
	});
	if (at.name == null || at.calories == null) throw new Error("That file needs a header row with a Food (or Name) column and a Calories column.");
	const foods = [];
	let skipped = 0;
	for (const r of rows) {
		const get = (k) => (at[k] == null ? "" : String(r[at[k]] ?? "").trim());
		const name = get("name").replace(/\|/g, "/");
		if (!name || get("calories") === "" || !Number.isFinite(parseFloat(get("calories")))) { skipped++; continue; }
		foods.push({
			name, serving: get("serving") || "1 serving", calories: number(get("calories")), fat: number(get("fat")), carbs: number(get("carbs")),
			protein: number(get("protein")), fiber: number(get("fiber")), group: get("group") || "Other",
			aliases: get("aliases").split(",").map((a) => a.trim()).filter(Boolean),
		});
	}
	return { foods, skipped };
}

// The database with rows for the foods it doesn't have yet, after the table's
// last row (a new table when it has none): { text, added, already }.
export function addFoods(dbText, foods) {
	const have = new Set(parseNutrition(dbText).map((f) => f.name.toLowerCase()));
	const nl = dbText.includes("\r\n") ? "\r\n" : "\n";
	const cell = (v) => String(v ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
	const rows = [];
	let already = 0;
	for (const f of foods) {
		const key = cell(f.name).toLowerCase();
		if (!key) continue;
		if (have.has(key)) { already++; continue; }
		have.add(key);
		rows.push(`| ${[f.name, f.serving, f.calories, f.fat, f.carbs, f.protein, f.fiber, f.group || "Other", (f.aliases || []).join(", "), ""].map(cell).join(" | ")} |`);
	}
	if (!rows.length) return { text: dbText, added: 0, already };
	const lines = dbText.split(/\r?\n/);
	let last = -1;
	lines.forEach((l, i) => { if (l.trim().startsWith("|")) last = i; });
	if (last < 0) {
		const text = dbText.replace(/(\r?\n)*$/, "") + nl + nl + NUTRITION_HEADER + nl + "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |" + nl + rows.join(nl) + nl;
		return { text, added: rows.length, already };
	}
	lines.splice(last + 1, 0, ...rows);
	return { text: lines.join(nl), added: rows.length, already };
}
