// A Nutrition Facts label's numbers from the text read off a photo of it
// (src/localocr.js). US labels use fixed wording ("Serving size", "Calories",
// "Total Fat", "Total Carbohydrate", "Dietary Fiber", "Protein"), so each is
// found by its words; what the text reader commonly gets wrong in numbers
// (O for 0, l or I for 1, a "g" read as 9) is put right. Anything not found
// is left out, and src/labelview.js shows it all for checking before saving.

// "O" -> "0", "l"/"I"/"|" -> "1", "S" -> "5", "," -> "." -> a number, or null.
function num(s) {
	const t = String(s ?? "").replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/S/g, "5").replace(/,/g, ".");
	const n = parseFloat(t);
	return Number.isFinite(n) ? n : null;
}

// The grams after a label's words: "Total Fat 8g", "Total Fat 8 g", "Total
// Fat Og", and "Total Fat 89" where the g was read as a 9.
function grams(text, words) {
	const m = text.match(new RegExp(`${words}[^\\n\\d%OoIlS]{0,12}([\\dOoIlS][\\dOoIlS.,]*)\\s*(mg|g|9)?\\b`, "i"));
	if (!m) return null;
	let v = m[1], unit = m[2];
	// A "g" read as "9" with no unit after it: "89" is 8 g.
	if (!unit && /\d9$/.test(v)) { v = v.slice(0, -1); unit = "g"; }
	const n = num(v);
	if (n == null) return null;
	return unit && unit.toLowerCase() === "mg" ? Math.round(n / 100) / 10 : n;
}

// -> { serving, calories, fat, carbs, protein, fiber, perContainer } with
// only what was found.
export function parseLabel(text) {
	const t = String(text || "").replace(/\r/g, "");
	const out = {};
	const serving = t.match(/serving\s*size[:\s]*([^\n]+)/i);
	// "(55g)" read as "(559)": a gram weight in brackets with no unit.
	if (serving) out.serving = serving[1].replace(/\s{2,}/g, " ").replace(/[^\w)]+$/, "").trim().replace(/\((\d+)9\)$/, "($1g)");
	const per = t.match(/(?:about\s*)?([\dOoIl.,]+)\s*servings?\s*per\s*container/i) || t.match(/servings?\s*per\s*container[:\s]*(?:about\s*)?([\dOoIl.,]+)/i);
	if (per && num(per[1]) != null) out.perContainer = num(per[1]);
	const cal = t.match(/\bcalories\b(?!\s*from)[^\n\d]{0,6}([\dOoIlS][\dOoIlS,]*)/i);
	if (cal && num(cal[1].replace(/,(\d{3})/, "$1")) != null) out.calories = num(cal[1].replace(/,(\d{3})/, "$1"));
	const fields = { fat: "total\\s*fat", carbs: "total\\s*carb\\w*\\.?", fiber: "dietary\\s*fib(?:er|re)", protein: "protein" };
	for (const [k, words] of Object.entries(fields)) {
		const g = grams(t, words);
		if (g != null) out[k] = g;
	}
	return out;
}

// Whether the calories roughly match 4 per gram of protein and carbs and 9
// per gram of fat (labels round, so within a quarter, or 20 calories).
export function addsUp({ calories, fat, carbs, protein }) {
	if ([calories, fat, carbs, protein].some((v) => v == null)) return true;
	const worked = 4 * protein + 4 * carbs + 9 * fat;
	return Math.abs(worked - calories) <= Math.max(20, calories * 0.25);
}
