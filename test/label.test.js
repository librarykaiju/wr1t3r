import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLabel, addsUp } from "../src/label.js";

test("a clean label", () => {
	const text = `Nutrition Facts
8 servings per container
Serving size 2/3 cup (55g)

Amount per serving
Calories 230
% Daily Value*
Total Fat 8g 10%
Saturated Fat 1g 5%
Trans Fat 0g
Cholesterol 0mg 0%
Sodium 160mg 7%
Total Carbohydrate 37g 13%
Dietary Fiber 4g 14%
Total Sugars 12g
Protein 3g`;
	assert.deepEqual(parseLabel(text), { serving: "2/3 cup (55g)", perContainer: 8, calories: 230, fat: 8, carbs: 37, fiber: 4, protein: 3 });
	assert.equal(addsUp(parseLabel(text)), true);
});

test("what the text reader gets wrong", () => {
	const text = `Serving Size 1 bar (409)
Servings Per Container about 6
Calories 19O  Calories from Fat 7O
Total Fat 89 12%
Total Carb. 2lg 7%
Dietary Fibre Og
Protein 4 g`;
	assert.deepEqual(parseLabel(text), { serving: "1 bar (40g)", perContainer: 6, calories: 190, fat: 8, carbs: 21, fiber: 0, protein: 4 });
	assert.deepEqual(parseLabel("a blurry photo"), {});
	assert.equal(addsUp({ calories: 900, fat: 8, carbs: 21, protein: 4 }), false);
	// A nut bar's label: 15 g fat, 16 g carbs with 7 g fiber, 6 g protein, 170
	// calories (nut fat counts for less than 9 a gram).
	assert.equal(addsUp({ calories: 170, fat: 15, carbs: 16, protein: 6, fiber: 7 }), true);
	assert.equal(addsUp({ calories: 470, fat: 15, carbs: 16, protein: 6, fiber: 7 }), false);
});

test("a label printed as running text, as on a bar's wrapper", () => {
	const text = `Nutrition Facts Servings: 1, Serv. size: 1 bar (40g),
Amount per serving: Calories 170, Total Fat 150 (19% DV), Sat. Fat 3g (15% DV), Trans
Fat 0g, Poly. Fat 3.5g, Mono. Fat 9g, Cholest. 0mg (0% DV), Sodium 125mg (5% DV), Total Carbs.
16g (6% DV), Fiber 7g (25% DV), Total Sugars 5g (Incl. 4g Added Sugars, 8% DV), Protein 6g`;
	assert.deepEqual(parseLabel(text), { serving: "1 bar (40g)", perContainer: 1, calories: 170, fat: 15, carbs: 16, fiber: 7, protein: 6 });
});
