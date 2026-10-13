import { test } from "node:test";
import assert from "node:assert/strict";
import * as Z from "@zxing/library";
import { decodeLuminance } from "../src/barcode.js";
import { productFood, lookupBarcode } from "../src/openfoodfacts.js";

// An EAN-13 drawn as grey levels: quiet zone, bars 3 pixels a module, w by h.
function ean13(digits, sideways = false) {
	const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
	const G = L.map((p) => [...p].reverse().map((b) => (b === "1" ? "0" : "1")).join(""));
	const R = L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).join(""));
	const parity = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"][digits[0]];
	let bits = "101";
	for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? L : G)[digits[i]];
	bits += "01010";
	for (let i = 7; i <= 12; i++) bits += R[digits[i]];
	bits += "101";
	const row = [..."0".repeat(12) + bits + "0".repeat(12)].flatMap((b) => Array(3).fill(b === "1" ? 0 : 255));
	const w = row.length, h = 60;
	const lum = new Uint8ClampedArray(w * h);
	for (let y = 0; y < h; y++) lum.set(row, y * w);
	if (!sideways) return { lum, w, h };
	const turned = new Uint8ClampedArray(w * h);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) turned[(w - 1 - x) * h + y] = lum[y * w + x];
	return { lum: turned, w: h, h: w };
}

test("a barcode is read upright and sideways, and a blank photo has none", () => {
	const code = "4006381333931";
	const up = ean13([...code].map(Number));
	assert.equal(decodeLuminance(Z, up.lum, up.w, up.h), code);
	const side = ean13([...code].map(Number), true);
	assert.equal(decodeLuminance(Z, side.lum, side.w, side.h), code);
	assert.equal(decodeLuminance(Z, new Uint8ClampedArray(200 * 100).fill(255), 200, 100), null);
});

test("Open Food Facts: per serving when the label gives it", () => {
	const f = productFood({
		product_name: "Crunchy Peanut Butter", brands: "Jif, J.M. Smucker", serving_size: "2 Tbsp (32 g)", serving_quantity: 32, categories: "Spreads, Nut butters, Peanut butters",
		nutriments: { "energy-kcal_serving": 190, fat_serving: 16, carbohydrates_serving: 8, proteins_serving: 7, fiber_serving: 2, "energy-kcal_100g": 594 },
	}, "0051500255162");
	assert.deepEqual(f, { name: "Crunchy Peanut Butter (Jif)", serving: "2 Tbsp (32g)", calories: 190, fat: 16, carbs: 8, protein: 7, fiber: 2, group: "Fat/Protein", aliases: ["0051500255162"] });
});

test("Open Food Facts: per 100 g scaled to the serving, kJ when there's no kcal, and no nutrition", () => {
	const f = productFood({ product_name: "Oat biscuits", serving_size: "2 biscuits", serving_quantity: 25, nutriments: { energy_100g: 2000, fat_100g: 20, carbohydrates_100g: 60, proteins_100g: 8 } }, "1");
	assert.equal(f.calories, Math.round((2000 / 4.184) * 0.25));
	assert.equal(f.fat, 5);
	assert.equal(f.carbs, 15);
	assert.equal(f.fiber, 0);
	assert.equal(productFood({ product_name: "Plain", nutriments: { "energy-kcal_100g": 50 } }).serving, "100g");
	assert.equal(productFood({ product_name: "Mystery", nutriments: {} }), null);
});

test("barcode lookup: a 12-digit UPC is also tried as EAN-13, and not found says so", async () => {
	const asked = [];
	const get = async (u) => {
		asked.push(u);
		return u.includes("/0012345678905.json")
			? new Response(JSON.stringify({ status: 1, product: { product_name: "Soda", nutriments: { "energy-kcal_serving": 140 }, serving_size: "1 can" } }))
			: new Response(JSON.stringify({ status: 0 }), { status: 404 });
	};
	const hit = await lookupBarcode("012345678905", get);
	assert.equal(asked.length, 2);
	assert.match(asked[0], /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/012345678905\.json\?fields=/);
	assert.equal(hit.found, true);
	assert.equal(hit.food.name, "Soda");
	assert.equal(hit.food.calories, 140);
	assert.deepEqual(await lookupBarcode("4006381333931", get), { code: "4006381333931", food: null, found: false });
	await assert.rejects(lookupBarcode("1", async () => new Response("", { status: 503 })), /Open Food Facts answered 503/);
});

test("the page's security policy lets it reach Open Food Facts", async () => {
	const { readFile } = await import("node:fs/promises");
	const csp = (await readFile(new URL("../public/_headers", import.meta.url), "utf8")).match(/connect-src ([^;]+)/)[1].split(/\s+/);
	assert.ok(csp.includes("https://world.openfoodfacts.org"));
});
