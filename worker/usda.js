// Food search in USDA FoodData Central, for the planner's Food button: a food
// that isn't in the vault's Nutrition Database yet can be found here, added
// to it as a row, and logged. The lookup runs here so the key stays out of
// the page.
//
//   GET /api/usda/search?q=   -> {results: [{fdcId, name, brand, serving,
//                                calories, fat, carbs, protein, fiber, group,
//                                aliases, dataType}]}
//
// Nutrients are for one serving: a branded food's label serving, else the
// first household measure USDA gives ("1 cup (140 g)"), else 100 g.
//
// Setting: USDA_API_KEY (free at fdc.nal.usda.gov/api-key-signup).

import { HttpError } from "./util.js";

const SEARCH = "https://api.nal.usda.gov/fdc/v1/foods/search";
const DATA_TYPES = "Foundation,SR Legacy,Survey (FNDDS),Branded";

export async function usdaApi(request, env, url) {
	if (!url.pathname.startsWith("/api/usda/")) return null;
	if (url.pathname !== "/api/usda/search" || request.method !== "GET") throw new HttpError(404, "Not found");
	if (!env.USDA_API_KEY) throw new HttpError(404, "USDA food search needs USDA_API_KEY set on the Worker", { setup: true });
	const q = (url.searchParams.get("q") || "").trim();
	if (!q) throw new HttpError(400, "q: what to search for");
	const qs = new URLSearchParams({ api_key: env.USDA_API_KEY, query: q, pageSize: "25", dataType: DATA_TYPES });
	const res = await fetch(`${SEARCH}?${qs}`, { headers: { Accept: "application/json" } });
	if (res.status === 403) throw new HttpError(502, "USDA turned the key down. Check USDA_API_KEY.");
	if (res.status === 429) throw new HttpError(502, "USDA is rate-limiting searches. Wait a moment and try again.");
	if (!res.ok) throw new HttpError(502, `USDA answered ${res.status}`);
	const data = await res.json();
	return { results: (data.foods || []).map(usdaFood).filter(Boolean) };
}

const NUTRIENTS = { calories: [1008, 2048, 2047], fat: [1004], carbs: [1005], protein: [1003], fiber: [1079] };

// One search result -> a Nutrition Database row's worth, or null.
export function usdaFood(f) {
	if (!f || !f.description) return null;
	const per100 = {};
	for (const [key, ids] of Object.entries(NUTRIENTS)) {
		for (const id of ids) {
			const n = (f.foodNutrients || []).find((x) => x.nutrientId === id && (key !== "calories" || /kcal/i.test(x.unitName || "KCAL")));
			if (n && Number.isFinite(n.value)) { per100[key] = n.value; break; }
		}
		per100[key] ??= 0;
	}
	const { serving, factor } = servingOf(f);
	const round = (v, d) => Math.round(v * factor * 10 ** d) / 10 ** d;
	const brand = titleCase(f.brandName || f.brandOwner || "");
	const plain = titleCase(f.description);
	return {
		fdcId: f.fdcId, dataType: f.dataType || "", brand, serving,
		name: brand && !plain.toLowerCase().includes(brand.toLowerCase()) ? `${plain} (${brand})` : plain,
		calories: round(per100.calories, 0), fat: round(per100.fat, 1), carbs: round(per100.carbs, 1),
		protein: round(per100.protein, 1), fiber: round(per100.fiber, 1),
		group: groupOf(f.foodCategory, f.description),
		aliases: [...new Set([brand && plain.toLowerCase()].filter(Boolean))],
	};
}

// The serving the numbers are for, and what to multiply the per-100 g values by.
function servingOf(f) {
	const unit = String(f.servingSizeUnit || "").toLowerCase();
	const u = /^(g|grm)$/.test(unit) ? "g" : /^(ml|mlt)$/.test(unit) ? "ml" : null;
	if (u && f.servingSize > 0) {
		const amount = `${+Number(f.servingSize).toFixed(1)}${u}`;
		const hh = String(f.householdServingFullText || "").trim();
		return { serving: hh ? `${hh} (${amount})` : amount, factor: f.servingSize / 100 };
	}
	const m = [...(f.foodMeasures || [])]
		.filter((x) => x.gramWeight > 0 && x.disseminationText && !/quantity not specified/i.test(x.disseminationText))
		.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];
	if (m) return { serving: `${m.disseminationText} (${Math.round(m.gramWeight)}g)`, factor: m.gramWeight / 100 };
	return { serving: "100g", factor: 1 };
}

// USDA's food category -> the Nutrition Database's Food Group. The
// categories are SR Legacy's ("Vegetables and Vegetable Products"), Branded
// foods' ("Nut & Seed Butters") and FNDDS's survey ones ("Bananas", "Liquor
// and cocktails"). First match wins, so the narrow ones come first: "Potato
// chips" is a snack, "Salad dressings and vegetable oils" an oil, "Apple juice"
// a drink. Dishes (pizza, burgers, burritos) stay Other.
const GROUPS = [
	[/pizza|burger|sandwich|burrito|taco|nachos|enchilada|quesadilla|chimichanga|\bchili\b/i, "Other"],
	[/macaroni|pasta mixed/i, "Grain"],
	[/doughnut|pastr/i, "Sweetener"],
	[/chips|popcorn|pretzel|snack|\bbars?\b/i, "Snack"],
	[/formula|\bjuice$|alcohol|liquor|liqueur|cocktail|vodka|tequila|whiskey|brandy|martini|\b(gin|rum)\b|\bwine\b|\bbeer\b|smoothie|soft drink|fruit drink|sports? (and energy )?drink/i, "Beverage"],
	[/\bnuts?\b|seed|peanut/i, "Fat/Protein"],
	[/fats? and oils|\boils?\b|butter|margarine|animal fat|mayonnaise/i, "Fat/Oil"],
	[/sauce|condiment|dressing|\bdips?\b|grav(y|ies)|ketchup|mustard|mayo|salsa|pickle|olive/i, "Condiment"],
	[/vegetable|fruit|produce|salad|potato|tomato|carrot|onion|\bcorn\b|lettuce|\bpeppers?\b|broccoli|spinach|cabbage|string bean|green bean|apple|banana|grape|peach|nectarine|\bpears?\b|berr(y|ies)|citrus|orange|melon|pineapple|mango|papaya/i, "Produce"],
	[/legume|bean|lentil|tofu|soy product/i, "Legume"],
	[/milk substitute|plant.based milk|non.dairy/i, "Dairy Alternative"],
	[/dairy|cheese|milk|yogurt|cream/i, "Dairy"],
	[/poultry|chicken|turkey|beef|pork|lamb|veal|game|fish|seafood|shellfish|sausage|meat|egg|bacon|frankfurter|cold cuts|\bham\b/i, "Protein"],
	[/cereal|grain|pasta|noodle|bread|baked|rice|cracker|tortilla|flour|bagel|muffin|\brolls?\b|\bbuns?\b|biscuit|pancake|waffle|french toast|oatmeal|grits/i, "Grain"],
	[/sweet|candy|sugar|syrup|honey|dessert|cookie|brownie|cake|\bpies?\b|pastr|doughnut|pudding|gelatin|\bices?\b|sorbet|\bjams?\b|topping/i, "Sweetener"],
	[/spice|herb|seasoning/i, "Spice"],
	[/beverage|drink|juice|coffee|tea|soda|water/i, "Beverage"],
];
const match = (text) => GROUPS.find(([re]) => re.test(String(text || "")))?.[1];

// A food's group from its category, else from the first words of its name
// ("Broccoli, fresh, cooked" -> Produce) when the category says nothing.
export function groupOf(category, name = "") {
	const c = typeof category === "object" ? category?.description : category;
	return match(c) || match(String(name).split(",")[0]) || "Other";
}

// "PEANUT BUTTER, CREAMY" -> "Peanut Butter, Creamy". Mixed-case text is left as is.
function titleCase(s) {
	s = String(s || "").trim();
	if (s !== s.toUpperCase()) return s;
	return s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(And|Or|Of|With|In)\b/g, (w) => w.toLowerCase());
}
