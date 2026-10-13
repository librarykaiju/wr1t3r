import { test } from "node:test";
import assert from "node:assert/strict";
import { recipeSync, upsertRecipeRow, isRecipeSync, syncBlockDbPath, ingredientEntry } from "../src/recipe.js";

const DB = `# Nutrition Database

| Food | Serving Size | Calories | Fat (g) | Carbs (g) | Protein (g) | Fiber (g) | Food Group | Aliases | Servings/Container |
| ---- | ------------ | -------- | ------- | --------- | ----------- | --------- | ---------- | ------- | ------------------ |
| Butter | 1 tbsp (14g) | 102 | 11.5 | 0 | 0.1 | 0 | Fat/Oil | | |
| Egg (raw) | 1 large (50g) | 72 | 5 | 0.4 | 6.3 | 0 | Protein | egg, eggs | |
| Chicken Pieces (bone-in, skin-on, raw) | 1 lb | 730 | 50 | 0 | 66 | 0 | Protein | | |
| Scrambled Eggs | 1 serving | 1 | 1 | 1 | 1 | 1 | Recipe | scrambled eggs | |

Notes after the table.
`;
const RECIPE = `---
title: "Scrambled Eggs"
yield: 2
---
## Ingredients
- Egg, 4 (beaten, room temp)
- Butter, 1 tbsp (salted)
- Chicken Pieces (bone-in, skin-on, raw), 0.5
- Unicorn dust, 1

## Instructions
- Not an ingredient, 9
`;

test("a recipe's per-serving row, as the template makes it", () => {
	const r = recipeSync(RECIPE, "content/_recipes/Scrambled Eggs.md", DB);
	assert.equal(r.ingredients, 4);
	assert.equal(r.unmatched, 1);
	// (4×72 + 102 + 0.5×730) / 2 = 377.5 → 378; fat (20 + 11.5 + 25) / 2 = 28.25 → 28.3
	assert.deepEqual(r.per, { calories: 378, fat: 28.3, carbs: 0.8, protein: 29.2, fiber: 0 });
	assert.equal(r.row, "| Scrambled Eggs | 1 serving | 378 | 28.3 | 0.8 | 29.2 | 0 | Recipe | scrambled eggs |");
	assert.equal(r.upToDate, false);
	assert.ok(r.existing.startsWith("| Scrambled Eggs | 1 serving | 1 |"));
	// Updated in place (keeping the hand-added alias), then up to date.
	const up = upsertRecipeRow(DB, r.name, r.row);
	assert.equal(up.action, "Updated");
	assert.ok(up.text.includes(r.row + "\n\nNotes after the table."));
	assert.equal(recipeSync(RECIPE, "x.md", up.text).upToDate, true);
	assert.equal(upsertRecipeRow(up.text, r.name, r.row).action, null);
	// A new recipe goes after the table's last row; a name with a comma gets a comma-free alias.
	const pie = recipeSync('---\ntitle: "Pie, Apple"\n---\n## Ingredients\n- Butter, 2\n', "p.md", DB);
	assert.equal(pie.row, "| Pie, Apple | 1 serving | 204 | 23 | 0 | 0.2 | 0 | Recipe | Pie Apple |");
	const add = upsertRecipeRow(DB, pie.name, pie.row);
	assert.equal(add.action, "Added");
	assert.ok(add.text.includes("| Scrambled Eggs | 1 serving | 1 | 1 | 1 | 1 | 1 | Recipe | scrambled eggs | |\n" + pie.row + "\n"));
	// No title: the file name.
	assert.equal(recipeSync("## Ingredients\n- Butter, 1\n", "content/_recipes/Toast.md", DB).name, "Toast");
});

test("the template's sync block is recognized, with its database path", () => {
	const code = 'const dbPath = "content/_docs/Nutrition Database.md";\nconst groupName = "Recipe";\nconst button = container.createEl("button", { text: "➕ Sync to Nutrition Database" });';
	assert.equal(isRecipeSync(code), true);
	assert.equal(isRecipeSync("dv.paragraph('hi')"), false);
	assert.equal(syncBlockDbPath(code), "content/_docs/Nutrition Database.md");
	const known = { has: (n) => ["butter", "chicken pieces (bone-in, skin-on, raw)"].includes(n.toLowerCase()) };
	assert.deepEqual(ingredientEntry("Butter, 8 tbsp (1 stick unsalted, room temp)", known), { name: "Butter", servings: 8 });
	assert.deepEqual(ingredientEntry("Chicken Pieces (bone-in, skin-on, raw), 2", known), { name: "Chicken Pieces (bone-in, skin-on, raw)", servings: 2 });
});

test("missing ingredients and their closest foods", async () => {
	const { missingIngredients, closestFood, closestFoods, matchIngredients, asIngredient } = await import("../src/recipe.js");
	assert.deepEqual(missingIngredients(RECIPE, DB), ["Unicorn dust"]);
	const foods = [
		["Onion rings, breaded, par fried, frozen", "1 cup"], ["Onions, raw", "1 cup, chopped"], ["Beef, ground, 80% lean meat / 20% fat, raw", "4 oz"],
		["Fast foods, nachos, with cheese, beans, ground beef, and tomatoes", "1 serving"], ["Sugar-apples, (sweetsop), raw", "1 cup"], ["Sugars, granulated", "1 tsp"],
		["Spices, paprika", "1 tsp"],
	].map(([name, serving]) => ({ name, serving, calories: 1, aliases: [] }));
	assert.equal(closestFood(foods, "onions").name, "Onions, raw");
	assert.equal(closestFood(foods, "Ground beef").name, "Beef, ground, 80% lean meat / 20% fat, raw");
	assert.equal(closestFood(foods, "sugar").name, "Sugars, granulated");
	assert.equal(closestFood(foods, "smoked paprika powder").name, "Spices, paprika");
	assert.equal(closestFood(foods, "Unicorn dust"), null);
	assert.equal(closestFoods(foods, "onion").length, 2);
	const m = matchIngredients(["Onion", "Unicorn dust"], foods);
	assert.deepEqual(m.map((x) => x.options.length), [2, 0]);
	// Added with the ingredient as an alias, the recipe finds it.
	const withOnion = DB.replace("| Scrambled Eggs |", `| ${asIngredient(m[0].options[0], "Onion").name} | 1 cup | 64 | 0.2 | 15 | 1.8 | 2.7 | Produce | Onion | |\n| Scrambled Eggs |`);
	assert.deepEqual(missingIngredients(RECIPE.replace("- Unicorn dust, 1", "- Onion, 1"), withOnion), []);
});
