import { test } from "node:test";
import assert from "node:assert/strict";
import {
	tandoorServer, unitKind, parseServing, servingsOf, tandoorIngredients, ingredientLine, tandoorRecipeNote,
	templateSyncBlock, recipeFolder, noteForTandoorId, connectTandoor, listTandoorRecipes, TandoorError,
} from "../src/tandoor.js";
import { recipeSync, isRecipeSync } from "../src/recipe.js";
import { parseNutrition, findFood } from "../src/planner.js";

const DB = `# Nutrition Database

| Food | Serving Size | Calories | Fat (g) | Carbs (g) | Protein (g) | Fiber (g) | Food Group | Aliases | Servings/Container |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wheat flour, white, all-purpose | 1 cup (125g) | 455 | 1.2 | 95.4 | 12.9 | 3.4 | Grain | flour | |
| Butter | 1 tbsp (14g) | 102 | 11.5 | 0 | 0.1 | 0 | Fat/Oil | | |
| Egg (raw) | 1 large (50g) | 72 | 5 | 0.4 | 6.3 | 0 | Protein | egg, eggs | |
| Milk, whole | 1 cup (244g) | 149 | 7.9 | 11.7 | 7.7 | 0 | Dairy | milk | |
| Garlic | 1 clove (3g) | 4 | 0 | 1 | 0.2 | 0.1 | Produce | | |
| Salt | 1 tsp (6g) | 0 | 0 | 0 | 0 | 0 | Other | | |
`;

// The shape of GET /api/recipe/<id>/ on Tandoor 2.
const ing = (food, amount, unit, extra = {}) => ({ food: food && { name: food }, unit: unit && { name: unit, plural_name: unit === "cup" ? "cups" : unit }, amount, note: "", is_header: false, no_amount: false, original_text: "", ...extra });
const RECIPE = {
	id: 12, name: "Pancakes", description: "Sunday ones.", servings: 4, servings_text: "pancakes", source_url: "https://example.com/pancakes",
	working_time: 10, waiting_time: 0, keywords: [{ name: "breakfast", label: "Breakfast" }],
	steps: [
		{ name: "", instruction: "Whisk the dry things.", ingredients: [ing("", 0, null, { is_header: true, note: "Batter" }), ing("Flour", 250, "g"), ing("Salt", 0, null, { no_amount: true })] },
		{ name: "Cook", instruction: "Add {{ ingredients[0] }} milk.\nFry in butter.", ingredients: [ing("Milk", 1.5, "cup"), ing("Eggs", 2, null), ing("Butter", 2, "tbsp", { note: "melted" }), ing("Garlic", 2, "clove"), ing("Maple syrup", 60, "ml")] },
	],
};

const foods = parseNutrition(DB);
const find = (n) => findFood(foods, n);

test("Tandoor's address from whatever's pasted", () => {
	assert.equal(tandoorServer("recipes.example.com"), "https://recipes.example.com");
	assert.equal(tandoorServer("https://recipes.example.com/recipe/12/"), "https://recipes.example.com");
	assert.equal(tandoorServer("https://example.com/tandoor/api/recipe/"), "https://example.com/tandoor");
	assert.equal(tandoorServer(""), "");
});

test("units: weight, volume, or a count of something", () => {
	assert.deepEqual(unitKind("g"), { kind: "mass", per: 1 });
	assert.deepEqual(unitKind("Cups"), { kind: "volume", per: 236.588 });
	assert.equal(unitKind("tablespoons").kind, "volume");
	assert.deepEqual(unitKind(""), { kind: "count", per: 1, word: "" });
	assert.deepEqual(unitKind("cloves"), { kind: "count", per: 1, word: "clove" });
	assert.equal(unitKind("12%"), null);
});

test("a serving size, read every way it's written", () => {
	assert.deepEqual(parseServing("1 cup (125g)"), { mass: 125, volume: 236.588, count: null });
	assert.deepEqual(parseServing("100g"), { mass: 100, volume: null, count: null });
	assert.deepEqual(parseServing("1 large (50g)"), { mass: 50, volume: null, count: { n: 1, word: "" } });
	assert.deepEqual(parseServing("1/2 cup"), { mass: null, volume: 236.588 / 2, count: null });
	assert.deepEqual(parseServing("1 serving"), { mass: null, volume: null, count: { n: 1, word: "" } });
	assert.deepEqual(parseServing("1 lb"), { mass: 453.592, volume: null, count: null });
});

test("amounts become servings of the database's food", () => {
	assert.equal(servingsOf(250, "g", "1 cup (125g)"), 2);
	assert.equal(servingsOf(1.5, "cup", "1 cup (244g)"), 1.5);
	assert.equal(servingsOf(2, "", "1 large (50g)"), 2);
	assert.equal(servingsOf(2, "clove", "1 clove (3g)"), 2);
	assert.equal(servingsOf(1, "lb", "1 cup (125g)"), 3.63);
	assert.equal(servingsOf(3, "tbsp", "1 cup (125g)"), 0.19); // by volume
	assert.equal(servingsOf(2, "slice", "1 clove (3g)"), null); // different things
	assert.equal(servingsOf(100, "g", "1 cup"), null); // no density
});

test("ingredients skip headers and keep their notes", () => {
	const list = tandoorIngredients(RECIPE);
	assert.equal(list.length, 7);
	assert.deepEqual(list[0], { name: "Flour", amount: 250, unit: "g", unitShown: "g", note: "", noAmount: false, original: "" });
	assert.equal(list[1].noAmount, true);
	assert.equal(list[2].unitShown, "cups");
});

test("lines that convert, lines to check, and lines with no food yet", () => {
	assert.deepEqual(ingredientLine({ name: "Flour", amount: 250, unit: "g", unitShown: "g", note: "sifted" }, find("Flour")), { line: "Wheat flour, white, all-purpose, 2 (250 g, sifted)", converted: true, missing: false });
	assert.deepEqual(ingredientLine({ name: "Flour", amount: 100, unit: "pinch", unitShown: "pinches", note: "" }, find("Flour")), { line: "Wheat flour, white, all-purpose, 1 (100 pinches, check: 1 serving is 1 cup (125g))", converted: false, missing: false });
	assert.deepEqual(ingredientLine({ name: "Syrup, maple", amount: 60, unit: "ml", unitShown: "ml", note: "" }, null), { line: "Syrup maple, 1 (60 ml, check the servings)", converted: false, missing: true });
	assert.deepEqual(ingredientLine({ name: "Salt", amount: 0, unit: "", unitShown: "", note: "", noAmount: true }, find("Salt")), { line: "Salt, 0 (to taste)", converted: true, missing: false });
});

test("a Tandoor recipe as a recipe note the Sync button reads", () => {
	const block = "```dataviewjs\nconst groupName = \"Recipe\";\n// Sync to Nutrition Database\n```";
	const r = tandoorRecipeNote(RECIPE, find, { syncBlock: block });
	assert.equal(r.ingredients, 7);
	assert.equal(r.unconverted, 1);
	assert.deepEqual(r.missing, ["Maple syrup"]);
	assert.match(r.text, /^---\ntitle: "Pancakes"\nyield: 4\nyield_text: "pancakes"\nsource: "https:\/\/example.com\/pancakes"\ntandoor_id: 12\nprep_minutes: 10\ntags: \["recipe", "Breakfast"\]\n---\n\n# Pancakes\n\nSunday ones\.\n\n## Ingredients\n/);
	assert.match(r.text, /- Wheat flour, white, all-purpose, 2 \(250 g\)\n- Salt, 0 \(to taste\)\n- Milk, whole, 1\.5 \(1\.5 cups\)\n- Egg \(raw\), 2\n/);
	assert.match(r.text, /## Instructions\n\n1\. Whisk the dry things\.\n\n2\. \*\*Cook\*\* Add milk\.\n   Fry in butter\.\n/);
	assert.ok(r.text.trimEnd().endsWith("```"));
	// src/recipe.js reads it like any recipe note: flour 2x455 + milk 1.5x149 +
	// eggs 2x72 + butter 2x102 + garlic 2x4, over 4 servings; syrup's left out.
	const sync = recipeSync(r.text, "Recipes/Pancakes.md", DB);
	assert.equal(sync.ingredients, 7);
	assert.equal(sync.unmatched, 1);
	assert.equal(sync.per.calories, Math.round((910 + 223.5 + 144 + 204 + 8) / 4));
});

test("the template's sync block, the recipes folder, and notes already imported", () => {
	const tmpl = "---\nyield: 1\n---\n## Ingredients\n- \n\n```dataviewjs\nconst dbPath = \"Health/Nutrition Database.md\";\nconst groupName = \"Recipe\";\ndv.button(\"Sync to Nutrition Database\")\n```\n";
	assert.equal(templateSyncBlock(tmpl, isRecipeSync), "```dataviewjs\nconst dbPath = \"Health/Nutrition Database.md\";\nconst groupName = \"Recipe\";\ndv.button(\"Sync to Nutrition Database\")\n```");
	assert.equal(templateSyncBlock("no block", isRecipeSync), "");
	const notes = [
		{ path: "_templates/Recipe Template.md", text: tmpl },
		{ path: "Kitchen/Chili.md", text: "## Ingredients\n- Beef, 1" },
		{ path: "Kitchen/Soup.md", text: "## Ingredients\n- Leek, 1" },
		{ path: "Chili.md", text: "## Ingredients\n- Beef, 1" },
		{ path: "Kitchen/Pancakes.md", text: "---\ntandoor_id: 12\n---\n" },
	];
	assert.equal(recipeFolder(notes), "Kitchen/");
	assert.equal(recipeFolder([]), "Recipes/");
	assert.equal(noteForTandoorId(notes, 12), "Kitchen/Pancakes.md");
	assert.equal(noteForTandoorId(notes, 13), null);
});

const fakeFetch = (handler) => async (url, init) => {
	const r = handler(url, init);
	if (r instanceof Error) throw r;
	return { ok: r.status < 400, status: r.status, json: async () => r.body };
};

test("connecting tells a refused token from a blocked request", async () => {
	let auth = null;
	const ok = fakeFetch((url, init) => { auth = init.headers.Authorization; return { status: 200, body: { count: 0, results: [] } }; });
	assert.deepEqual(await connectTandoor({ server: "recipes.example.com/", token: " tda_x " }, ok), { server: "https://recipes.example.com", token: "tda_x" });
	assert.equal(auth, "Bearer tda_x");
	await assert.rejects(connectTandoor({ server: "r.example.com", token: "bad" }, fakeFetch(() => ({ status: 401, body: {} }))), (e) => e instanceof TandoorError && e.reason === "token");
	await assert.rejects(connectTandoor({ server: "r.example.com", token: "t" }, fakeFetch(() => new TypeError("Failed to fetch"))), (e) => e.reason === "blocked");
	await assert.rejects(connectTandoor({ server: "r.example.com", token: "t" }, fakeFetch(() => ({ status: 200, body: { hello: 1 } }))), (e) => e.reason === "address");
});

test("the recipe list follows Tandoor's pages", async () => {
	const seen = [];
	const f = fakeFetch((url) => {
		seen.push(url);
		return url.includes("page=2")
			? { status: 200, body: { next: null, results: [{ id: 2, name: "Soup", keywords: [] }] } }
			: { status: 200, body: { next: "http://internal:8080/api/recipe/?page=2&page_size=100", results: [{ id: 1, name: "Chili", keywords: [{ label: "Dinner" }] }] } };
	});
	const list = await listTandoorRecipes({ server: "https://recipes.example.com", token: "t" }, f);
	assert.deepEqual(list.map((r) => r.name), ["Chili", "Soup"]);
	assert.deepEqual(list[0].keywords, ["Dinner"]);
	assert.equal(seen[1], "https://recipes.example.com/api/recipe/?page=2&page_size=100");
});
