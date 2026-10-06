import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseCsv, buildTable } from "../scripts/food-data.js";
import { foodsFrom, searchTable, searchBundled } from "../src/foodtable.js";

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
	const r = await searchBundled("peanut", async () => new Response(JSON.stringify(data)));
	assert.equal(r[0].serving, "2 tbsp (32g)");
	assert.equal(r[0].dataType, "SR Legacy");
});
