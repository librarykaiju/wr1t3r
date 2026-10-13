// USDA food search with no key: the tables shipped with the app (made by
// scripts/food-data.js), searched on the device. FNDDS first, the foods as
// people eat them (dishes, drinks, "Pizza, cheese, from restaurant"), then SR
// Legacy's ingredients. A build without one of the files searches the other.
// Results have the same shape as the Worker's live USDA search
// (worker/usda.js).

import { searchFoods } from "./planner.js";

export const TABLES = [
	{ url: "/food/usda-fndds.json", dataType: "Survey (FNDDS)" },
	{ url: "/food/usda-sr-legacy.json", dataType: "SR Legacy" },
];
let loaded = null;

// rows -> foods searchFoods can read.
export function foodsFrom(data, dataType = "SR Legacy") {
	return (data?.rows || []).map(([name, serving, calories, fat, carbs, protein, fiber, group]) => ({
		name, serving, calories, fat, carbs, protein, fiber, group, aliases: [], dataType,
	}));
}

export function searchTable(foods, q, limit = 25) {
	return String(q || "").trim() ? searchFoods(foods, q, limit) : [];
}

// Every shipped table's foods, FNDDS first, loaded once.
export function loadBundled(get = (u) => fetch(u)) {
	loaded ||= (async () => {
		const tables = await Promise.all(TABLES.map(async (t) => {
			try {
				const res = await get(t.url);
				return res.ok ? foodsFrom(await res.json(), t.dataType) : [];
			} catch { return []; }
		}));
		const foods = tables.flat();
		if (!foods.length) throw new Error("This build has no USDA food table. Run npm run food-data, then build again.");
		return foods;
	})().catch((e) => { loaded = null; throw e; });
	return loaded;
}

// The best matches from each table, FNDDS's first.
export async function searchBundled(q, get) {
	const foods = await loadBundled(get);
	const out = [];
	for (const t of TABLES) out.push(...searchTable(foods.filter((f) => f.dataType === t.dataType), q, 15));
	return out.slice(0, 25);
}

// Forget the loaded tables (tests).
export const resetBundled = () => { loaded = null; };
