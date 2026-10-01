// A recipe's per-serving nutrition, worked out the way the vault's Recipe
// template does it (w3bz1n3 _templates/Recipe Template.md), so wr1t3r can
// sync it into the Nutrition Database itself: same ingredients (the list
// items under "## Ingredients", as Dataview's file.lists has them), same food
// matching, same rounding, and the same row, replaced in place when the
// recipe is already there. src/recipeview.js draws the button.

import { listItems, parseFrontmatter } from "./dvpage.js";
import { parseNutrition } from "./planner.js";

export const RECIPE_GROUP = "Recipe";

// Whether a dataviewjs block is the template's "Sync to Nutrition Database" one.
export const isRecipeSync = (code) => /groupName\s*=\s*["']Recipe["']/.test(code) && /Sync to Nutrition Database/.test(code);

// The database path a sync block names (const dbPath = "..."), or null.
export const syncBlockDbPath = (code) => code.match(/const\s+dbPath\s*=\s*["']([^"']+)["']/)?.[1] ?? null;

// The template's lookup: a name or alias, else the first name starting with
// the text, else the first containing it.
function lookup(foods) {
	const byName = new Map();
	for (const f of foods) {
		byName.set(f.name.toLowerCase(), f);
		for (const a of f.aliases) if (a) byName.set(a.toLowerCase(), f);
	}
	return {
		has: (n) => byName.has(n.toLowerCase()),
		find: (n) => {
			const q = n.toLowerCase();
			return byName.get(q) || foods.find((f) => f.name.toLowerCase().startsWith(q)) || foods.find((f) => f.name.toLowerCase().includes(q)) || null;
		},
	};
}

// "Food, amount (notes)": the food is the longest part before a comma that's
// a database name or alias, else the part before the first comma.
export function ingredientEntry(line, known) {
	const cuts = [...line.matchAll(/,/g)].map((m) => m.index).reverse();
	const cut = cuts.find((i) => known.has(line.slice(0, i).trim())) ?? cuts.at(-1);
	if (cut == null) return { name: line.trim(), servings: 1 };
	const amount = parseFloat(line.slice(cut + 1));
	return { name: line.slice(0, cut).trim(), servings: Number.isFinite(amount) ? amount : 1 };
}

const r1 = (n) => Math.round(n * 10) / 10;

// The recipe note's row for the database: { name, row, per, yield,
// ingredients, unmatched, existing (the row there now, or null), upToDate }.
export function recipeSync(noteText, notePath, dbText) {
	const foods = parseNutrition(dbText || "");
	const known = lookup(foods);
	const fm = parseFrontmatter(noteText) || {};
	const lines = listItems(noteText).filter((l) => l.section?.subpath === "Ingredients").map((l) => l.text.trim()).filter(Boolean);
	const totals = { calories: 0, fat: 0, carbs: 0, protein: 0, fiber: 0 };
	let unmatched = 0;
	for (const line of lines) {
		const e = ingredientEntry(line, known);
		const food = known.find(e.name);
		if (!food) { unmatched++; continue; }
		for (const k of Object.keys(totals)) totals[k] += food[k] * e.servings;
	}
	const y = parseFloat(fm.yield) > 0 ? parseFloat(fm.yield) : 1;
	const per = { calories: Math.round(totals.calories / y), fat: r1(totals.fat / y), carbs: r1(totals.carbs / y), protein: r1(totals.protein / y), fiber: r1(totals.fiber / y) };
	const raw = (fm.title != null && String(fm.title).trim()) || String(notePath).split("/").pop().replace(/\.md$/i, "");
	const name = raw.replace(/\|/g, "/").trim();
	const aliases = new Set();
	if (name.includes(",")) aliases.add(name.replace(/,/g, ""));
	const noteAliases = fm.aliases;
	if (Array.isArray(noteAliases)) noteAliases.forEach((a) => aliases.add(String(a).trim()));
	else if (noteAliases) aliases.add(String(noteAliases).trim());
	// Aliases already on the recipe's row (added by hand) stay.
	const existing = existingRow(dbText || "", name);
	if (existing) for (const a of (cells(existing.line)[8] || "").split(",")) if (a.trim()) aliases.add(a.trim());
	const row = `| ${name} | 1 serving | ${per.calories} | ${per.fat} | ${per.carbs} | ${per.protein} | ${per.fiber} | ${RECIPE_GROUP} | ${[...aliases].filter(Boolean).join(", ")} |`;
	return { name, row, per, yield: y, ingredients: lines.length, unmatched, existing: existing?.line ?? null, upToDate: !!existing && sameRow(existing.line, row) };
}

// The database line whose Food is `name` (case aside): { index, line } or null.
function existingRow(dbText, name) {
	const lines = dbText.split(/\r?\n/);
	const index = lines.findIndex((l) => { const c = l.split("|").map((x) => x.trim()); return c.length > 1 && c[1].toLowerCase() === name.toLowerCase(); });
	return index < 0 ? null : { index, line: lines[index] };
}

// Same cells, whatever the padding (the database is often column-aligned).
const cells = (l) => l.split("|").map((c) => c.trim()).filter((c, i, a) => !(i === 0 && c === "") && !(i === a.length - 1 && c === ""));
const sameRow = (a, b) => { const x = cells(a), y = cells(b); return y.every((c, i) => (x[i] ?? "") === c); };

// The database with the recipe's row put in: in place of its old one, else
// after the table's last row. -> { text, action: "Added" | "Updated" | null }.
export function upsertRecipeRow(dbText, name, row) {
	const nl = dbText.includes("\r\n") ? "\r\n" : "\n";
	const lines = dbText.split(/\r?\n/);
	const at = existingRow(dbText, name);
	if (at) {
		if (sameRow(at.line, row)) return { text: dbText, action: null };
		lines[at.index] = row;
		return { text: lines.join(nl), action: "Updated" };
	}
	let last = -1;
	lines.forEach((l, i) => { if (l.trim().startsWith("|")) last = i; });
	if (last < 0) return { text: dbText, action: null, error: "Could not find the table in the database note." };
	lines.splice(last + 1, 0, row);
	return { text: lines.join(nl), action: "Added" };
}
