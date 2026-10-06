// Builds public/food/usda-sr-legacy.json: USDA's SR Legacy food table (about
// 7,800 common foods; public domain), trimmed to what the planner's food
// search needs, so a build with no Worker key can still search USDA foods
// (src/foodtable.js). Run it once and commit the result:
//
//   npm run food-data                  downloads the zip from USDA
//   npm run food-data -- path/to.zip   uses a zip you downloaded
//
// SR Legacy is final (USDA stopped updating it in 2018), so this never needs
// running again unless the format here changes.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { usdaFood } from "../worker/usda.js";

export const SOURCE = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip";
export const OUT = "public/food/usda-sr-legacy.json";
const NUTRIENT_IDS = new Set([1003, 1004, 1005, 1008, 1079]); // protein, fat, carbs, kcal, fiber

// RFC 4180 CSV -> rows of strings.
export function parseCsv(text) {
	const rows = [];
	let row = [], field = "", quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
			else field += c;
		} else if (c === '"') quoted = true;
		else if (c === ",") { row.push(field); field = ""; }
		else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(field); rows.push(row); row = []; field = "";
		} else field += c;
	}
	if (field || row.length) { row.push(field); rows.push(row); }
	return rows;
}

// [{column: value}] for a CSV with a header row.
function records(text) {
	const [head, ...rows] = parseCsv(text);
	return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

// The zip's CSVs -> the table's rows: [name, serving, calories, fat, carbs, protein, fiber, group].
export async function buildTable(zipBytes) {
	const zip = await JSZip.loadAsync(zipBytes);
	const csv = async (name) => {
		const f = Object.values(zip.files).find((x) => !x.dir && x.name.split("/").pop() === name);
		if (!f) throw new Error(`${name} isn't in the zip`);
		return records(await f.async("string"));
	};
	const [foods, nutrients, portions, categories] = await Promise.all([csv("food.csv"), csv("food_nutrient.csv"), csv("food_portion.csv"), csv("food_category.csv")]);
	const category = new Map(categories.map((c) => [c.id, c.description]));
	const byFood = new Map();
	const get = (id) => byFood.get(id) || (byFood.set(id, { foodNutrients: [], foodMeasures: [] }), byFood.get(id));
	for (const n of nutrients) {
		const id = Number(n.nutrient_id);
		if (NUTRIENT_IDS.has(id)) get(n.fdc_id).foodNutrients.push({ nutrientId: id, value: Number(n.amount), unitName: id === 1008 ? "KCAL" : "G" });
	}
	for (const p of portions) {
		const text = [p.amount && Number(p.amount) !== 0 ? +Number(p.amount).toFixed(2) : "", p.portion_description || p.modifier].filter(Boolean).join(" ").trim();
		if (text) get(p.fdc_id).foodMeasures.push({ disseminationText: text, gramWeight: Number(p.gram_weight), rank: Number(p.seq_num) || 99 });
	}
	const rows = [];
	for (const f of foods) {
		const extra = byFood.get(f.fdc_id) || { foodNutrients: [], foodMeasures: [] };
		const description = f.description.replace(/\s*\(Includes foods for USDA's Food Distribution Program\)/i, "");
		const r = usdaFood({ fdcId: Number(f.fdc_id), description, dataType: "SR Legacy", foodCategory: category.get(f.food_category_id) || "", ...extra });
		if (r) rows.push([r.name, r.serving, r.calories, r.fat, r.carbs, r.protein, r.fiber, r.group]);
	}
	return rows.sort((a, b) => a[0].localeCompare(b[0]));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const from = process.argv[2];
	let bytes;
	if (from) bytes = await readFile(from);
	else {
		console.log("Downloading SR Legacy from USDA…");
		const res = await fetch(SOURCE);
		if (!res.ok) throw new Error(`USDA answered ${res.status}. Download ${SOURCE} yourself and pass its path.`);
		bytes = new Uint8Array(await res.arrayBuffer());
	}
	const rows = await buildTable(bytes);
	await mkdir(dirname(OUT), { recursive: true });
	await writeFile(OUT, JSON.stringify({ source: "USDA FoodData Central, SR Legacy (April 2018). Public domain.", columns: ["name", "serving", "calories", "fat", "carbs", "protein", "fiber", "group"], rows }));
	console.log(`Wrote ${rows.length} foods to ${OUT}.`);
}
