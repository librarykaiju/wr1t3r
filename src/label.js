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
	// The number can be on the next line ("Total Carbs.\n16g" on a label
	// printed as running text).
	const m = text.match(new RegExp(`${words}[^\\d%OoIlS]{0,12}([\\dOoIlS][\\dOoIlS.,]*)\\s*(mg|g|9)?\\b`, "i"));
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
	// "Serving size 2/3 cup (55g)", or "Serv. size: 1 bar (40g), ..." on a
	// label printed as running text: up to the weight in brackets, or a comma.
	const serving = t.match(/serv(?:ing|\.)?\s*size[:\s]*([^\n]+)/i);
	// "(55g)" read as "(559)": a gram weight in brackets with no unit.
	if (serving) out.serving = serving[1].replace(/^([^()]*\([^)]*\)).*/, "$1").replace(/^([^(,]*),.*/, "$1").replace(/\s{2,}/g, " ").replace(/[^\w)]+$/, "").trim().replace(/\((\d+)9\)$/, "($1g)");
	const per = t.match(/(?:about\s*)?([\dOoIl.,]+)\s*servings?\s*per\s*container/i) || t.match(/servings?\s*per\s*container[:\s]*(?:about\s*)?([\dOoIl.,]+)/i) || t.match(/\bservings?\s*:\s*(?:about\s*)?([\dOoIl.,]+)/i);
	if (per && num(per[1]) != null) out.perContainer = num(per[1]);
	const cal = t.match(/\bcalories\b(?!\s*from)[^\n\d]{0,6}([\dOoIlS][\dOoIlS,]*)/i);
	if (cal && num(cal[1].replace(/,(\d{3})/, "$1")) != null) out.calories = num(cal[1].replace(/,(\d{3})/, "$1"));
	const fields = { fat: "total\\s*fat", carbs: "total\\s*carb\\w*\\.?", fiber: "(?:dietary\\s*)?fib(?:er|re)", protein: "protein" };
	for (const [k, words] of Object.entries(fields)) {
		const g = grams(t, words);
		if (g != null) out[k] = g;
	}
	// A "g" read as "0" or "9" makes 15g into 150: more fat, carbs or protein
	// than the calories allow, ending in 0 or 9, is taken a digit shorter.
	const per_g = { fat: 9, carbs: 4, protein: 4 };
	if (out.calories) for (const [k, kcal] of Object.entries(per_g)) {
		if (out[k] >= 10 && out[k] * kcal > out.calories * 1.5 && /[09]$/.test(String(out[k]))) out[k] = Math.floor(out[k] / 10);
	}
	if (out.fiber >= 10 && out.carbs != null && out.fiber > out.carbs && /[09]$/.test(String(out.fiber))) out.fiber = Math.floor(out.fiber / 10);
	return out;
}

// Whether the calories roughly match 4 per gram of protein and carbs and 9
// per gram of fat, with fiber (counted in the carbs) at 2. Makers may use
// each food's own factors (nuts give less than 9 a gram of fat), and labels
// round, so within 30%, or 20 calories. A misread digit is far further off.
export function addsUp({ calories, fat, carbs, protein, fiber }) {
	if ([calories, fat, carbs, protein].some((v) => v == null)) return true;
	const fib = Math.min(fiber || 0, carbs);
	const worked = 4 * protein + 4 * (carbs - fib) + 2 * fib + 9 * fat;
	return Math.abs(worked - calories) <= Math.max(20, calories * 0.3);
}
