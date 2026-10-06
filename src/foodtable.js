// USDA food search with no key: the SR Legacy table (about 7,800 common
// foods) shipped with the app as public/food/usda-sr-legacy.json (made by
// scripts/food-data.js), searched on the device. Results have the same shape
// as the Worker's live USDA search (worker/usda.js).

import { searchFoods } from "./planner.js";

export const TABLE_URL = "/food/usda-sr-legacy.json";
let table = null;

// rows -> foods searchFoods can read.
export function foodsFrom(data) {
	return (data?.rows || []).map(([name, serving, calories, fat, carbs, protein, fiber, group]) => ({
		name, serving, calories, fat, carbs, protein, fiber, group, aliases: [], dataType: "SR Legacy",
	}));
}

export function searchTable(foods, q, limit = 25) {
	return String(q || "").trim() ? searchFoods(foods, q, limit) : [];
}

export async function searchBundled(q, get = (u) => fetch(u)) {
	table ||= (async () => {
		const res = await get(TABLE_URL);
		if (!res.ok) throw new Error("This build has no USDA food table. Run npm run food-data, then build again.");
		return foodsFrom(await res.json());
	})().catch((e) => { table = null; throw e; });
	return searchTable(await table, q);
}
