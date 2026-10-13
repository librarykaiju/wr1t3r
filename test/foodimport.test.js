import { test } from "node:test";
import assert from "node:assert/strict";
import { readFoodCsv, addFoods, newNutritionNote } from "../src/foodimport.js";
import { parseNutrition } from "../src/planner.js";
import { upsertRecipeRow } from "../src/recipe.js";

test("foods from a CSV, columns matched by name", () => {
	const csv = "﻿Food Name,Amount,Energy (kcal),Protein (g),Carbs (g),Fat (g),Fiber (g),Saturated Fat (g),Notes\n"
		+ "\"Oats, rolled\",1/2 cup,150,5,27,2.5,4,0.5,x\n"
		+ "Greek yogurt,170 g,\"1,000\",17,6,0,,0,\n"
		+ ",1 cup,100,1,1,1,1,0,\n"
		+ "Mystery,1,,1,1,1,1,0,\n";
	const { foods, skipped } = readFoodCsv(csv);
	assert.equal(skipped, 2);
	assert.deepEqual(foods[0], { name: "Oats, rolled", serving: "1/2 cup", calories: 150, fat: 2.5, carbs: 27, protein: 5, fiber: 4, group: "Other", aliases: [] });
	assert.equal(foods[1].calories, 1000);
	assert.equal(foods[1].fiber, 0);
	assert.throws(() => readFoodCsv("Title,Author\nx,y\n"), /Calories column/);
});

test("added after the table, skipping foods it has", () => {
	const db = newNutritionNote().replace(/\n$/, "\n| Banana | 1 medium | 105 | 0.4 | 27 | 1.3 | 3.1 | Fruit | | |\n") + "\nNotes.\n";
	const foods = [
		{ name: "banana", serving: "1", calories: 1 },
		{ name: "Rice | white", serving: "1 cup", calories: 205, fat: 0.4, carbs: 45, protein: 4.3, fiber: 0.6, group: "Grain", aliases: ["rice"] },
		{ name: "rice / WHITE", serving: "x", calories: 9 },
	];
	const r = addFoods(db, foods);
	assert.equal(r.added, 1);
	assert.equal(r.already, 2);
	const parsed = parseNutrition(r.text);
	assert.deepEqual(parsed.map((f) => f.name), ["Banana", "Rice / white"]);
	assert.deepEqual(parsed[1].aliases, ["rice"]);
	assert.match(r.text, /\| Rice \/ white \|.*\|\n\nNotes\.\n$/);
	assert.equal(addFoods(r.text, foods).added, 0);
	// A note with no table gets one.
	assert.equal(parseNutrition(addFoods("# Foods\n", foods).text).length, 2);
});

test("a new database takes a recipe's row", () => {
	const r = upsertRecipeRow(newNutritionNote(), "Soup", "| Soup | 1 serving | 200 | 1 | 2 | 3 | 4 | Recipe | |");
	assert.equal(r.action, "Added");
	assert.equal(parseNutrition(r.text)[0].name, "Soup");
});
