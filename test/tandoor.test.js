import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { normUnit, parseServing, toServings, readExport, ingredientsNote, ingredientLines, instructionLines, recipeNote, setProperties, setSection, recipesFolder, planImport } from "../src/tandoor.js";
import { parseNutrition } from "../src/planner.js";
import { recipeSync } from "../src/recipe.js";
import { parseFrontmatter } from "../src/dvpage.js";

const DB = `| Food | Serving Size | Calories | Fat (g) | Carbs (g) | Protein (g) | Fiber (g) | Food Group | Aliases | Servings/Container |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wheat flour, white, all-purpose | 1 cup (125g) | 455 | 1.2 | 95.4 | 12.9 | 3.4 | Grain | flour | |
| Milk, whole | 1 cup (244g) | 149 | 7.9 | 11.7 | 7.7 | 0 | Dairy | milk | |
| Egg, whole, raw | 1 large (50g) | 72 | 4.8 | 0.4 | 6.3 | 0 | Protein | egg | |
| Garlic, raw | 1 clove (3g) | 4 | 0 | 1 | 0.2 | 0.1 | Produce | garlic | |
| Butter, salted | 1 tbsp (14.2g) | 102 | 11.5 | 0 | 0.1 | 0 | Dairy | butter | |
| Salt, table | 1 tsp (6g) | 0 | 0 | 0 | 0 | 0 | Other | salt | |
| Oats | 100g | 389 | 6.9 | 66 | 17 | 10.6 | Grain | | |
`;
const foods = parseNutrition(DB);

const ing = (food, amount, unit, extra = {}) => ({ food: food && { name: food, plural_name: null }, unit: unit && { name: unit, plural_name: unit === "g" ? null : unit + "s" }, amount, note: "", order: 0, is_header: false, no_amount: false, ...extra });
const RECIPE = {
	name: "Crêpes: Sunday \"best\"",
	description: "Thin pancakes.",
	keywords: [{ name: "Breakfast" }, { name: "French Food" }],
	working_time: 15, waiting_time: 30, servings: 4, servings_text: "crêpes", source_url: "https://example.com/crepes",
	steps: [
		{ name: "", instruction: "Rest the batter.", order: 1, ingredients: [] },
		{ name: "Batter", instruction: "Whisk everything.\n\nNo lumps.", order: 0, ingredients: [
			{ ...ing(null, 0, null), is_header: true, note: "Dry" },
			ing("flour", "2.5E+2", "g"),
			{ ...ing("milk", 2, "cup"), order: 1 },
			{ ...ing("egg", 3, null), order: 2 },
			{ ...ing("garlic", 2, "clove"), order: 3, note: "minced" },
			{ ...ing("butter", 30, "g"), order: 4 },
			{ ...ing("salt", 0, null), order: 5, no_amount: true },
			{ ...ing("oats", 1, "cup"), order: 6 },
			{ ...ing("Saffron, Spanish", 1, "pinch"), order: 7 },
			{ ...ing(null, 0, null), order: 8, note: "a little oil for the pan" },
		] },
	],
};

test("units are normalised", () => {
	assert.equal(normUnit("Tablespoons."), "tablespoon");
	assert.equal(normUnit("lbs"), "lb");
	assert.equal(normUnit("Fl. oz"), "fl oz");
	assert.equal(normUnit("cloves"), "clove");
	assert.equal(normUnit("pinches"), "pinch");
	assert.equal(normUnit(null), "");
});

test("servings are read for weight, volume and count", () => {
	assert.deepEqual(parseServing("1 medium (118g)"), { grams: 118, ml: null, count: { qty: 1, unit: "medium" } });
	assert.deepEqual(parseServing("100g"), { grams: 100, ml: null, count: null });
	const cup = parseServing("0.5 cup (114g)");
	assert.equal(cup.grams, 114);
	assert.ok(Math.abs(cup.ml - 118.294) < 0.01);
	assert.equal(parseServing("8 fl oz (240 ml)").ml, 236.588);
	assert.deepEqual(parseServing("1 serving").count, { qty: 1, unit: "serving" });
	assert.equal(parseServing("1 1/2 cups").ml, 1.5 * 236.588);
	assert.deepEqual(parseServing(""), { grams: null, ml: null, count: null });
});

test("Tandoor amounts in servings of the food", () => {
	const f = (name) => foods.find((x) => x.name.startsWith(name));
	assert.equal(toServings(250, "g", f("Wheat")), 2);
	assert.equal(toServings(1, "kg", f("Wheat")), 8);
	assert.equal(toServings(2, "cups", f("Milk")), 2);
	assert.equal(toServings(3, null, f("Egg")), 3);
	assert.equal(toServings(2, "piece", f("Egg")), 2);
	assert.equal(toServings(2, "cloves", f("Garlic")), 2);
	assert.equal(toServings(2, "tablespoons", f("Butter")), 2);
	assert.equal(toServings(0.5, "tsp", f("Salt")), 0.5);
	assert.equal(toServings(0, "g", f("Oats")), 0);
	assert.equal(toServings(1, "cup", f("Oats")), null, "no volume to go on");
	assert.equal(toServings(2, "slice", f("Egg")), null, "a different thing counted");
	assert.equal(toServings(3, null, f("Oats")), null);
	assert.equal(toServings("x", "g", f("Oats")), null);
});

async function exportZip(recipes) {
	const outer = new JSZip();
	for (const [id, r] of recipes) {
		const inner = new JSZip();
		inner.file("recipe.json", JSON.stringify(r));
		inner.file("image.jpeg", new Uint8Array([1, 2, 3]));
		outer.file(`${id}.zip`, await inner.generateAsync({ type: "uint8array" }));
	}
	return outer.generateAsync({ type: "uint8array" });
}

test("an export's recipes, by id", async () => {
	const got = await readExport(await exportZip([[12, RECIPE], [3, { name: "Toast", steps: [] }]]), JSZip);
	assert.deepEqual(got.map((r) => [r.id, r.recipe.name]), [[3, "Toast"], [12, RECIPE.name]]);
	const single = new JSZip();
	single.file("recipe.json", JSON.stringify({ name: "One" }));
	assert.deepEqual(await readExport(await single.generateAsync({ type: "uint8array" }), JSZip), [{ id: null, recipe: { name: "One" } }]);
	await assert.rejects(readExport(new Uint8Array([1, 2, 3]), JSZip), /isn't a zip/);
	const empty = new JSZip();
	empty.file("notes.txt", "hi");
	await assert.rejects(readExport(await empty.generateAsync({ type: "uint8array" }), JSZip), /no Tandoor recipes/);
});

test("ingredient lines: servings, Tandoor's amount kept, and what didn't convert", () => {
	const { lines, unconverted, loose } = ingredientLines(RECIPE, foods);
	assert.deepEqual(lines, [
		"- flour, 2 (250 g)",
		"- milk, 2 (2 cups)",
		"- egg, 3 (3)",
		"- garlic, 2 (2 cloves; minced)",
		"- butter, 2.11 (30 g)",
		"- salt, 0",
		"- oats, 1 (1 cup; check the servings: 1 is 100g)",
		"- Saffron Spanish, 1 (1 pinch)",
	]);
	assert.deepEqual(unconverted, ["oats"]);
	assert.deepEqual(loose, ["a little oil for the pan"]);
	assert.equal(ingredientsNote([{ recipe: RECIPE }, { recipe: RECIPE }]).match(/^- /gm).length, 8);
});

test("steps in order, paragraphs kept in their item", () => {
	assert.deepEqual(instructionLines(RECIPE), ["1. **Batter.** Whisk everything.", "", "   No lumps.", "2. Rest the batter."]);
});

const TEMPLATE = `---
title: "Crêpes"
publish: false
tags:
  - recipe
yield: 4
source:
banner: https://img.brandonj.ink/banners/food.jpg
---

## Ingredients
-

## Instructions
1.

## Notes

## Nutrition (auto-calculated)
\`\`\`dataviewjs
const groupName = "Recipe";
// ## Not a heading
dv.paragraph("Sync to Nutrition Database");
\`\`\`
`;

test("a recipe note from the vault's template, which the sync reads", () => {
	const { title, text, unconverted } = recipeNote({ id: 12, recipe: RECIPE }, foods, TEMPLATE);
	assert.equal(title, RECIPE.name);
	const fm = parseFrontmatter(text);
	assert.equal(fm.title, RECIPE.name);
	assert.deepEqual(fm.tags, ["recipe", "breakfast", "french-food"]);
	assert.equal(fm.yield, 4);
	assert.equal(fm.source, "https://example.com/crepes");
	assert.equal(fm.tandoor, 12);
	assert.equal(fm.banner, "https://img.brandonj.ink/banners/food.jpg");
	assert.equal(fm.publish, false);
	assert.deepEqual(unconverted, ["oats"]);
	assert.match(text, /## Notes\nThin pancakes\.\n\nPrep 15 min · Waiting 30 min\n\nMakes 4 crêpes\.\n\nAlso:\n- a little oil for the pan\n\n## Nutrition/);
	assert.match(text, /dv\.paragraph\("Sync to Nutrition Database"\);\n```\n$/);
	assert.ok(!text.includes("- \n"), "the template's empty item is gone");
	const sync = recipeSync(text, "Recipes/Crêpes.md", DB);
	assert.equal(sync.ingredients, 8);
	assert.equal(sync.unmatched, 1); // the saffron
	// 2 flour + 2 milk + 3 eggs + 2 garlic + 2.11 butter + 1 oats, over 4
	assert.equal(sync.per.calories, Math.round((910 + 298 + 216 + 8 + 102 * 2.11 + 389) / 4));
});

test("a plain recipe note when there's no template", () => {
	const { text } = recipeNote({ id: null, recipe: { name: "Toast", servings: 0, steps: [{ instruction: "Toast it.", ingredients: [ing("bread", 2, "slice")] }] } }, foods);
	assert.equal(text, "---\ntitle: \"Toast\"\ntags:\n  - recipe\nyield: 1\nsource:\n---\n\n## Ingredients\n- bread, 1 (2 slices)\n\n## Instructions\n1. Toast it.\n\n## Notes\n");
});

test("properties and sections are set in place", () => {
	assert.equal(setProperties("---\na: 1\ntags:\n  - x\n- y\nb: 2\n---\nBody", [["tags", ["tags: [z]"]], ["c", ["c: 3"]]]), "---\na: 1\ntags: [z]\nb: 2\nc: 3\n---\nBody");
	assert.equal(setProperties("Body", [["a", ["a: 1"]]]), "---\na: 1\n---\n\nBody");
	assert.equal(setSection("## A\nold\n### sub\nold\n## B\nkeep\n", "a", ["new"]), "## A\nnew\n\n## B\nkeep\n");
	assert.equal(setSection("## B\nkeep\n## Nutrition\nx\n", "Notes", ["n"]), "## B\nkeep\n## Notes\nn\n\n## Nutrition\nx\n");
	assert.equal(setSection("# T\n", "Notes", []), "# T\n\n## Notes\n\n");
});

test("the recipes folder, and where each recipe goes", () => {
	const notes = [
		{ path: "content/_templates/Recipe Template.md", text: TEMPLATE },
		{ path: "content/food/Pie.md", text: "---\ntags: [recipe]\n---\n## Ingredients\n- a, 1\n" },
		{ path: "content/food/Soup.md", text: "---\ntitle: Soup\ntandoor: 3\n---\n## Ingredients\n- a, 1\n" },
		{ path: "content/food/Crêpes Sunday best.md", text: "Someone else's note" },
		{ path: "content/Notes.md", text: "## Ingredients\n- not a recipe\n" },
	];
	assert.equal(recipesFolder(notes, "content/Recipes/"), "content/food/");
	assert.equal(recipesFolder([], "content/Recipes/"), "content/Recipes/");
	const plan = planImport([{ id: 3, recipe: { name: "Soup v2" } }, { id: 12, recipe: RECIPE }, { id: null, recipe: { name: "soup" } }, { id: 13, recipe: { name: "" } }], notes, "content/food/");
	assert.deepEqual(plan.map((p) => [p.path, p.existing]), [
		["content/food/Soup.md", true],
		["content/food/Crêpes Sunday best (2).md", false],
		["content/food/Soup.md", true],
		["content/food/Tandoor recipe 13.md", false],
	]);
});
