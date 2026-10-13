// Builds the food tables the planner's food search uses with no Worker key
// (src/foodtable.js), from USDA FoodData Central's CSV downloads (public
// domain), trimmed to what the search needs. Run it and commit the result:
//
//   npm run food-data                     both tables, downloaded from USDA
//   npm run food-data -- fndds [path.zip]  FNDDS: about 5,000 foods as eaten,
//                                          dishes and drinks included
//   npm run food-data -- sr [path.zip]     SR Legacy: about 7,800 ingredients
//
// SR Legacy is final (USDA stopped updating it in 2018). FNDDS is updated
// every two years with the national food survey; point TABLES.fndds.source at the
// newest "Survey Foods" CSV zip on fdc.nal.usda.gov/download-datasets and run
// it again then.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { usdaFood } from "../worker/usda.js";

export const TABLES = {
	sr: {
		source: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip",
		out: "public/food/usda-sr-legacy.json", label: "USDA FoodData Central, SR Legacy (April 2018). Public domain.",
	},
	fndds: {
		source: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip",
		out: "public/food/usda-fndds.json", label: "USDA FoodData Central, Food and Nutrient Database for Dietary Studies (FNDDS 2021-2023). Public domain.",
	},
};
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

// The zip's CSVs -> the table's rows: [name, serving, calories, fat, carbs,
// protein, fiber, group]. An SR Legacy zip has food_category.csv; an FNDDS
// (Survey) zip has wweia_food_category.csv, its categories from the national
// food survey ("Pizza", "Burritos and tacos"), tied to foods through
// food.csv's food_category_id or survey_fndds_food.csv.
export async function buildTable(zipBytes) {
	const zip = await JSZip.loadAsync(zipBytes);
	const file = (name) => Object.values(zip.files).find((x) => !x.dir && x.name.split("/").pop() === name);
	const csv = async (name, needed = true) => {
		const f = file(name);
		if (!f) { if (needed) throw new Error(`${name} isn't in the zip`); return []; }
		return records(await f.async("string"));
	};
	const survey = !!file("survey_fndds_food.csv") || !!file("wweia_food_category.csv");
	const [foods, nutrients, portions] = await Promise.all([csv("food.csv"), csv("food_nutrient.csv"), csv("food_portion.csv")]);
	const category = new Map();
	if (survey) {
		const codeOf = (row) => row[Object.keys(row).find((k) => /wweia/i.test(k) && !/description/i.test(k))] ?? Object.values(row)[0];
		for (const c of await csv("wweia_food_category.csv", false)) category.set(String(codeOf(c)), c[Object.keys(c).find((k) => /description/i.test(k))] || "");
		const link = new Map((await csv("survey_fndds_food.csv", false)).map((r) => [r.fdc_id, String(codeOf(r))]));
		for (const f of foods) f.food_category_id = link.get(f.fdc_id) || f.food_category_id;
	} else for (const c of await csv("food_category.csv")) category.set(c.id, c.description);
	const dataType = survey ? "Survey (FNDDS)" : "SR Legacy";
	const byFood = new Map();
	const get = (id) => byFood.get(id) || (byFood.set(id, { foodNutrients: [], foodMeasures: [] }), byFood.get(id));
	for (const n of nutrients) {
		const id = Number(n.nutrient_id);
		if (NUTRIENT_IDS.has(id)) get(n.fdc_id).foodNutrients.push({ nutrientId: id, value: Number(n.amount), unitName: id === 1008 ? "KCAL" : "G" });
	}
	for (const p of portions) {
		const desc = p.portion_description || (/^\d+$/.test(p.modifier || "") ? "" : p.modifier);
		const text = [p.amount && Number(p.amount) !== 0 && !/^\d/.test(desc || "") ? +Number(p.amount).toFixed(2) : "", desc].filter(Boolean).join(" ").trim();
		if (text) get(p.fdc_id).foodMeasures.push({ disseminationText: text, gramWeight: Number(p.gram_weight), rank: Number(p.seq_num) || 99 });
	}
	const rows = [];
	for (const f of foods) {
		const extra = byFood.get(f.fdc_id) || { foodNutrients: [], foodMeasures: [] };
		const description = f.description.replace(/\s*\(Includes foods for USDA's Food Distribution Program\)/i, "");
		const r = usdaFood({ fdcId: Number(f.fdc_id), description, dataType, foodCategory: category.get(String(f.food_category_id)) || "", ...extra });
		if (r) rows.push([r.name, r.serving, r.calories, r.fat, r.carbs, r.protein, r.fiber, r.group]);
	}
	return rows.sort((a, b) => a[0].localeCompare(b[0]));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const [which, from] = TABLES[process.argv[2]] ? [process.argv[2], process.argv[3]] : [null, process.argv[2]];
	for (const id of which ? [which] : Object.keys(TABLES)) {
		const t = TABLES[id];
		let bytes;
		if (from) bytes = await readFile(from);
		else {
			console.log(`Downloading ${t.source}…`);
			const res = await fetch(t.source);
			if (!res.ok) throw new Error(`USDA answered ${res.status}. Download the zip yourself and pass its path: npm run food-data -- ${id} path/to.zip`);
			bytes = new Uint8Array(await res.arrayBuffer());
		}
		const rows = await buildTable(bytes);
		await mkdir(dirname(t.out), { recursive: true });
		await writeFile(t.out, JSON.stringify({ source: t.label, columns: ["name", "serving", "calories", "fat", "carbs", "protein", "fiber", "group"], rows }));
		console.log(`Wrote ${rows.length} foods to ${t.out}.`);
	}
}
