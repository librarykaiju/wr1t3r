import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseCsv, buildTable } from "../scripts/food-data.js";
import { foodsFrom, searchTable, searchBundled, resetBundled } from "../src/foodtable.js";

test("CSV: quotes, commas and doubled quotes", () => {
	assert.deepEqual(parseCsv('"a","b, c","say ""hi"""\r\n1,2,3\n'), [["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
});

// A zip laid out like USDA's SR Legacy CSV download, two foods.
async function srZip() {
	const zip = new JSZip();
	const dir = "FoodData_Central_sr_legacy_food_csv_2018-04/";
	zip.file(dir + "food.csv", '"fdc_id","data_type","description","food_category_id","publication_date"\n"167512","sr_legacy_food","Apples, raw, with skin (Includes foods for USDA\'s Food Distribution Program)","9","2019-04-01"\n"173944","sr_legacy_food","Peanut butter, smooth style, with salt","16","2019-04-01"\n');
	zip.file(dir + "food_nutrient.csv", '"id","fdc_id","nutrient_id","amount"\n"1","167512","1008","52"\n"2","167512","1004","0.17"\n"3","167512","1005","13.81"\n"4","167512","1003","0.26"\n"5","167512","1079","2.4"\n"6","167512","1162","4.6"\n"7","173944","1008","588"\n"8","173944","1004","50"\n');
	zip.file(dir + "food_portion.csv", '"id","fdc_id","seq_num","amount","measure_unit_id","portion_description","modifier","gram_weight"\n"1","167512","1","1","9999","","cup, quartered or chopped","125"\n"2","167512","2","1","9999","","medium (3"" dia)","182"\n"3","173944","1","2","9999","","tbsp","32"\n');
	zip.file(dir + "food_category.csv", '"id","code","description"\n"9","0900","Fruits and Fruit Juices"\n"16","1600","Legumes and Legume Products"\n');
	return zip.generateAsync({ type: "uint8array" });
}

test("the SR Legacy zip becomes table rows: first measure, per-serving numbers, groups", async () => {
	const rows = await buildTable(await srZip());
	assert.deepEqual(rows, [
		["Apples, raw, with skin", "1 cup, quartered or chopped (125g)", 65, 0.2, 17.3, 0.3, 3, "Produce"],
		["Peanut butter, smooth style, with salt", "2 tbsp (32g)", 188, 16, 0, 0, 0, "Legume"],
	]);
});

test("searching the shipped table", async () => {
	const data = { rows: await buildTable(await srZip()) };
	const foods = foodsFrom(data);
	assert.deepEqual(searchTable(foods, "apple").map((f) => f.name), ["Apples, raw, with skin"]);
	assert.deepEqual(searchTable(foods, ""), []);
	// A build with only the SR Legacy file searches that.
	resetBundled();
	const r = await searchBundled("peanut", async (u) => (u.includes("sr-legacy") ? new Response(JSON.stringify(data)) : new Response("", { status: 404 })));
	assert.equal(r[0].serving, "2 tbsp (32g)");
	assert.equal(r[0].dataType, "SR Legacy");
	// Both: FNDDS's matches come first.
	resetBundled();
	const fndds = { rows: [["Peanut butter sandwich", "1 sandwich (93g)", 345, 17, 35, 13, 3, "Other"]] };
	const both = await searchBundled("peanut", async (u) => new Response(JSON.stringify(u.includes("fndds") ? fndds : data)));
	assert.deepEqual(both.map((f) => f.dataType), ["Survey (FNDDS)", "SR Legacy"]);
	resetBundled();
});

// A zip laid out like USDA's Survey (FNDDS) CSV download.
async function fnddsZip(edit = (files) => files) {
	const zip = new JSZip();
	const files = {};
	const dir = "FoodData_Central_survey_food_csv_2024-10-31/";
	files["food.csv"] = '"fdc_id","data_type","description","food_category_id","publication_date"\n"2705385","survey_fndds_food","Pizza, cheese, from restaurant or fast food, medium crust","","2024-10-31"\n"2705386","survey_fndds_food","Latte, whole milk","","2024-10-31"\n';
	files["food_nutrient.csv"] = '"id","fdc_id","nutrient_id","amount"\n"1","2705385","1008","270"\n"2","2705385","1004","10"\n"3","2705385","1005","33"\n"4","2705385","1003","12"\n"5","2705385","1079","2"\n"6","2705386","1008","54"\n"7","2705386","1003","3"\n';
	files["food_portion.csv"] = '"id","fdc_id","seq_num","amount","measure_unit_id","portion_description","modifier","gram_weight"\n"1","2705385","1","","9999","1 slice","10205","107"\n"2","2705385","2","","9999","Quantity not specified","90000","107"\n"3","2705386","1","","9999","1 cup","10205","244"\n';
	files["survey_fndds_food.csv"] = '"fdc_id","food_code","wweia_category_number","start_date","end_date"\n"2705385","58106210","3602","2021-01-01","2023-12-31"\n"2705386","92101950","7204","2021-01-01","2023-12-31"\n';
	files["wweia_food_category.csv"] = '"wweia_food_category","wweia_food_category_description"\n"3602","Pizza"\n"7204","Coffee"\n';
	for (const [name, text] of Object.entries(edit(files))) zip.file(dir + name, text);
	return zip.generateAsync({ type: "uint8array" });
}

test("the FNDDS zip becomes table rows, with survey categories", async () => {
	const rows = await buildTable(await fnddsZip());
	assert.deepEqual(rows, [
		["Latte, whole milk", "1 cup (244g)", 132, 0, 0, 7.3, 0, "Beverage"],
		["Pizza, cheese, from restaurant or fast food, medium crust", "1 slice (107g)", 289, 10.7, 35.3, 12.8, 2.1, "Other"],
	]);
});

// The nutrients by their older numbers ("208" for kcal), through nutrient.csv,
// with a byte-order mark on the header.
test("FNDDS nutrients given by nutrient number, or by an id nutrient.csv explains", async () => {
	const want = await buildTable(await fnddsZip());
	const byNumber = await buildTable(await fnddsZip((f) => ({
		...f,
		"food_nutrient.csv": "\uFEFF" + f["food_nutrient.csv"].replace(/"10(08|04|05|03)"/g, '"2$1"').replace(/"1079"/g, '"291"'),
	})));
	assert.deepEqual(byNumber, want);
	const byOwnId = await buildTable(await fnddsZip((f) => ({
		...f,
		"food_nutrient.csv": f["food_nutrient.csv"].replace(/"(1008|1004|1005|1003|1079)"/g, (_, id) => `"${Number(id) + 50000}"`),
		"nutrient.csv": '"id","name","unit_name","nutrient_nbr"\n"51008","Energy","KCAL","208"\n"51062","Energy","kJ","268"\n"51004","Total lipid (fat)","G","204"\n"51005","Carbohydrate, by difference","G","205"\n"51003","Protein","G","203"\n"51079","Fiber, total dietary","G","291"\n',
	})));
	assert.deepEqual(byOwnId, want);
});

test("a zip whose nutrients can't be read writes nothing", async () => {
	const zip = await fnddsZip((f) => ({ ...f, "food_nutrient.csv": f["food_nutrient.csv"].replace(/"10\d\d"/g, '"9999"') }));
	await assert.rejects(buildTable(zip), /Only 0 of 2 foods have calories/);
});
