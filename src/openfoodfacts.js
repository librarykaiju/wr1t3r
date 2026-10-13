// A packaged food by its barcode, from Open Food Facts (openfoodfacts.org, open
// data under the ODbL; no key). It's called from the page, so it works in
// both builds, with or without the Worker; https://world.openfoodfacts.org is
// in the page's connect-src (public/_headers).

import { groupOf } from "../worker/usda.js";

const API = "https://world.openfoodfacts.org/api/v2/product/";
const FIELDS = "product_name,product_name_en,generic_name,brands,serving_size,serving_quantity,nutriments,categories";

const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const kcalOk = (v) => v != null && Number.isFinite(v);

// Open Food Facts' product -> a Nutrition Database food, or null when it has
// no calories to go on. Numbers are for the label serving when it gives one,
// else per 100 g.
export function productFood(p, code = "") {
	if (!p) return null;
	const n = p.nutriments || {};
	// Open Food Facts' plain "energy" is in kJ.
	const kcal = (sfx) => {
		const k = num(n[`energy-kcal${sfx}`]);
		if (k != null) return k;
		const kj = num(n[`energy-kj${sfx}`]) ?? num(n[`energy${sfx}`]);
		return kj == null ? null : kj / 4.184;
	};
	const grams = Number(p.serving_quantity) > 0 ? Number(p.serving_quantity) : null;
	// Per serving as printed; else worked out from per 100 g and the serving's
	// weight; else per 100 g.
	let sfx = "_serving", factor = 1, serving = String(p.serving_size || "").trim();
	if (kcalOk(kcal("_serving"))) { serving ||= "1 serving"; }
	else if (grams && kcalOk(kcal("_100g"))) { sfx = "_100g"; factor = grams / 100; serving ||= `${grams}g`; }
	else if (kcalOk(kcal("_100g"))) { sfx = "_100g"; serving = "100g"; }
	else return null;
	const g = (key) => round((num(n[key + sfx]) ?? 0) * factor, 1);
	const name = String(p.product_name_en || p.product_name || p.generic_name || "").trim() || `Barcode ${code}`;
	const brand = String(p.brands || "").split(",")[0].trim();
	return {
		name: (brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} (${brand})` : name).replace(/\|/g, "/"),
		serving, calories: Math.round(kcal(sfx) * factor),
		fat: g("fat"), carbs: g("carbohydrates"), protein: g("proteins"), fiber: g("fiber"),
		group: groupOf(String(p.categories || "").split(",").slice(-2).join(","), name),
		// The barcode as an alias, so the next scan finds it in the database.
		aliases: code ? [code] : [],
	};
}

// A barcode (EAN-13, UPC-A, EAN-8, UPC-E) -> { code, found, food }, food null
// when Open Food Facts doesn't have it or has no nutrition for it. A 12-digit
// UPC is also tried as the 13-digit EAN Open Food Facts files most under.
export async function lookupBarcode(code, get = (u) => fetch(u, { headers: { Accept: "application/json" } })) {
	const tries = [code, ...(/^\d{12}$/.test(code) ? ["0" + code] : [])];
	for (const c of tries) {
		const res = await get(`${API}${encodeURIComponent(c)}.json?fields=${FIELDS}`);
		if (res.status === 404) continue;
		if (!res.ok) throw new Error(`Open Food Facts answered ${res.status}`);
		const data = await res.json();
		if (data.status === 1 || data.product) return { code: c, food: productFood(data.product, c), found: true };
	}
	return { code, food: null, found: false };
}
