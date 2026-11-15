// Tandoor (a self-hosted recipe manager) as a source of recipe notes.
//
// The page talks to the person's own Tandoor over its REST API with an API
// token (Tandoor: Settings > API), so no server of ours is involved. Like
// Nextcloud, that only works when Tandoor's server sends CORS headers for
// this page's address, which a stock Tandoor doesn't: its admin adds them in
// the reverse proxy in front of it. connectTandoor() tells a blocked request
// from a refused token so Settings can say which one it is.
//
// A Tandoor ingredient is an amount and a unit of a food ("200 g flour"),
// while a recipe note's ingredient is a food from the Nutrition Database and
// how many of *its* servings go in ("Flour, 1.6"). servingsOf() converts
// between the two from the food's serving size ("1 cup (125g)"), by weight,
// by volume or by count; an amount it can't convert is kept in the line's
// note, at 1 serving, flagged to check. src/recipe.js then works out the
// recipe's numbers as for any other recipe note.

import { parseFrontmatter } from "./dvpage.js";

const CREDS = "wr1t3r-tandoor";
const local = () => globalThis.localStorage;

export const tandoorCreds = () => {
	try { const c = JSON.parse(local().getItem(CREDS) || "null"); return c?.server && c?.token ? c : null; } catch { return null; }
};
export const saveTandoorCreds = (v) => {
	try { v == null ? local().removeItem(CREDS) : local().setItem(CREDS, JSON.stringify(v)); } catch {}
};

// Why connecting failed:
//   insecure  an http:// address from an https:// page (the browser blocks it)
//   blocked   no answer the page may read: CORS isn't set up for this page,
//             or the address is wrong or offline (or off the home network)
//   token     Tandoor answered and refused the token
//   address   something answered, but not Tandoor's API
export class TandoorError extends Error {
	constructor(reason, message) {
		super(message);
		this.reason = reason;
	}
}

// What someone pasted, as Tandoor's address: "recipes.example.com",
// "https://recipes.example.com/recipe/12" -> "https://recipes.example.com".
export function tandoorServer(input) {
	let s = String(input || "").trim();
	if (!s) return "";
	if (!/^[a-z]+:\/\//i.test(s)) s = "https://" + s;
	try {
		const u = new URL(s);
		// Anything after a known Tandoor page is the page, not where it lives.
		const path = u.pathname.replace(/\/(api|recipe|view|search|settings|list|mealplan|shopping|accounts)(\/.*)?$/i, "").replace(/\/+$/, "");
		return `${u.protocol}//${u.host}${path}`;
	} catch {
		return "";
	}
}

async function call(creds, path, fetchImpl = globalThis.fetch) {
	const server = tandoorServer(creds.server);
	if (/^http:/i.test(server) && globalThis.location?.protocol === "https:") throw new TandoorError("insecure", "This page is https, so the browser won't let it reach an http:// address. Use Tandoor's https address.");
	let res;
	try {
		res = await fetchImpl(server + path, { headers: { Authorization: `Bearer ${creds.token}`, Accept: "application/json" }, credentials: "omit" });
	} catch {
		throw new TandoorError("blocked", `Couldn't read an answer from ${server}. Either it isn't sending CORS headers for this page yet, or it can't be reached from here (Tandoor on a home network needs this device at home or on Tailscale).`);
	}
	if (res.status === 401 || res.status === 403) throw new TandoorError("token", "Tandoor didn't accept that API token. Make one in Tandoor under Settings > API, with read access.");
	if (!res.ok) throw new TandoorError("address", `Tandoor answered ${res.status} at ${server + path}.`);
	try { return await res.json(); } catch { throw new TandoorError("address", `${server} answered, but not with Tandoor's API. Check the address.`); }
}

// Checks the address and token with the smallest call there is.
// -> { server, token } to save.
export async function connectTandoor({ server, token }, fetchImpl) {
	const creds = { server: tandoorServer(server), token: String(token || "").trim() };
	if (!creds.server) throw new TandoorError("address", "Enter Tandoor's address.");
	if (!creds.token) throw new TandoorError("token", "Paste an API token from Tandoor's Settings > API.");
	const r = await call(creds, "/api/recipe/?page_size=1", fetchImpl);
	if (!r || !Array.isArray(r.results)) throw new TandoorError("address", `${creds.server} answered, but not with Tandoor's recipe list. Check the address.`);
	return creds;
}

// Every recipe's id and name (and when it changed), newest first, up to `max`.
export async function listTandoorRecipes(creds, fetchImpl, max = 1000) {
	const out = [];
	let path = "/api/recipe/?page_size=100&sort_order=-updated_at";
	while (path && out.length < max) {
		const r = await call(creds, path, fetchImpl);
		for (const x of r.results || []) out.push({ id: x.id, name: x.name, description: x.description || "", keywords: (x.keywords || []).map((k) => k.label || k.name).filter(Boolean) });
		// "next" is a full URL on Tandoor's own idea of its address; keep its path.
		path = r.next ? (() => { try { const u = new URL(r.next); return u.pathname + u.search; } catch { return null; } })() : null;
	}
	return out.slice(0, max);
}

export const getTandoorRecipe = (creds, id, fetchImpl) => call(creds, `/api/recipe/${encodeURIComponent(id)}/`, fetchImpl);

// ---- Units ---------------------------------------------------------------------------

// Grams per unit, and millilitres per unit (US measures).
const MASS = { g: 1, gram: 1, gramm: 1, kg: 1000, kilogram: 1000, mg: 0.001, milligram: 0.001, oz: 28.3495, ounce: 28.3495, lb: 453.592, pound: 453.592 };
const VOLUME = {
	ml: 1, milliliter: 1, millilitre: 1, cl: 10, dl: 100, l: 1000, liter: 1000, litre: 1000,
	tsp: 4.92892, teaspoon: 4.92892, t: 4.92892, tbsp: 14.7868, tablespoon: 14.7868, tbs: 14.7868, tbl: 14.7868,
	cup: 236.588, c: 236.588, "fl oz": 29.5735, floz: 29.5735, "fluid ounce": 29.5735, pint: 473.176, pt: 473.176, quart: 946.353, qt: 946.353, gallon: 3785.41, gal: 3785.41,
};
// Words that mean "one of the thing", so "2 eggs" and "1 large (50g)" count alike.
const COUNT = new Set(["", "piece", "pc", "pcs", "whole", "each", "ea", "item", "unit", "small", "medium", "large", "extra large", "jumbo", "serving", "portion", "stück"]);

const singular = (w) => w.replace(/\.$/, "").replace(/(ches|shes|sses|xes)$/, (m) => m.slice(0, -2)).replace(/ies$/, "y").replace(/([^s])s$/, "$1");

// A unit name -> { kind: "mass" | "volume" | "count", per (g or ml per unit;
// 1 for counts), word (the count word, for "clove" vs "slice") }, or null.
export function unitKind(name) {
	const raw = String(name ?? "").trim().toLowerCase();
	const u = raw.replace(/\s+/g, " ");
	const s = singular(u);
	for (const w of [u, s]) {
		if (MASS[w] != null) return { kind: "mass", per: MASS[w] };
		if (VOLUME[w] != null) return { kind: "volume", per: VOLUME[w] };
	}
	if (raw === "T") return { kind: "volume", per: VOLUME.tbsp };
	if (COUNT.has(s)) return { kind: "count", per: 1, word: "" };
	// Anything else that's a plain word is a count of that thing: clove, slice, can.
	if (/^[\p{L} -]+$/u.test(s)) return { kind: "count", per: 1, word: s };
	return null;
}

// "1 cup (125g)", "100g", "1 large (50 g)", "2 tbsp", "1 serving" -> what one
// serving is: { mass (g) or null, volume (ml) or null, count: { n, word } or null }.
export function parseServing(text) {
	const s = String(text || "").toLowerCase().trim();
	const out = { mass: null, volume: null, count: null };
	const num = (t) => {
		const m = t.match(/^(\d+)\s+(\d+)\/(\d+)/) || t.match(/^(\d+)\/(\d+)/) || t.match(/^(\d*\.?\d+)/);
		if (!m) return null;
		if (m.length === 4) return { n: +m[1] + m[2] / m[3], rest: t.slice(m[0].length) };
		if (m.length === 3) return { n: m[1] / m[2], rest: t.slice(m[0].length) };
		return { n: parseFloat(m[1]), rest: t.slice(m[0].length) };
	};
	// Every "number unit" in it, the bracketed ones too.
	const parts = s.split(/[()]/).map((p) => p.trim()).filter(Boolean);
	for (const p of parts) {
		const n = num(p);
		if (!n) continue;
		const unit = n.rest.trim().replace(/^of\s+/, "").replace(/,.*$/, "").trim();
		const k = unitKind(unit) || unitKind(unit.split(" ")[0]);
		if (!k) continue;
		if (k.kind === "mass") out.mass ??= n.n * k.per;
		else if (k.kind === "volume") out.volume ??= n.n * k.per;
		else out.count ??= { n: n.n, word: k.word };
	}
	if (!parts.length || (!out.mass && !out.volume && !out.count)) out.count = { n: 1, word: "" };
	return out;
}

const round2 = (n) => Math.round(n * 100) / 100;

// How many of a food's servings `amount` `unit` is, or null when the two
// can't be compared (grams of a food measured in cups, say).
export function servingsOf(amount, unit, serving) {
	const a = Number(amount);
	if (!Number.isFinite(a)) return null;
	const k = unitKind(unit);
	const sv = parseServing(serving);
	if (!k) return null;
	if (k.kind === "mass" && sv.mass) return round2((a * k.per) / sv.mass);
	if (k.kind === "volume" && sv.volume) return round2((a * k.per) / sv.volume);
	if (k.kind === "count" && sv.count && (!k.word || !sv.count.word || singular(k.word) === singular(sv.count.word))) return round2(a / sv.count.n);
	return null;
}

// ---- Recipes -------------------------------------------------------------------------

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const fmtNum = (n) => String(+Number(n).toFixed(2));

// A Tandoor recipe's ingredients, in order, headers and empty rows left out:
// [{ name, amount, unit, note, noAmount, original }].
export function tandoorIngredients(recipe) {
	const out = [];
	for (const step of recipe?.steps || []) {
		for (const ing of step.ingredients || []) {
			if (ing.is_header || !ing.food?.name) continue;
			const amount = Number(ing.amount);
			const plural = amount !== 1 && ing.unit?.plural_name ? ing.unit.plural_name : ing.unit?.name;
			out.push({
				name: clean(ing.food.name),
				amount: Number.isFinite(amount) ? amount : 0,
				unit: clean(ing.unit?.name),
				unitShown: clean(plural),
				note: clean(ing.note),
				noAmount: !!ing.no_amount || !(amount > 0),
				original: clean(ing.original_text),
			});
		}
	}
	return out;
}

// One ingredient's line for the note: "Flour, 1.6 (200 g, sifted)". `food`
// is its Nutrition Database row, or null. -> { line, converted, missing }.
export function ingredientLine(ing, food) {
	// A name with a comma would read as name + amount; a pipe would break tables.
	const name = food ? food.matchedAs || food.name : ing.name.replace(/[,|]/g, " ").replace(/\s+/g, " ").trim();
	const measure = ing.noAmount ? "" : clean(`${fmtNum(ing.amount)} ${ing.unitShown || ing.unit}`);
	if (ing.noAmount) {
		const note = [ing.note || "to taste"].filter(Boolean).join(", ");
		return { line: `${name}, 0 (${note})`, converted: true, missing: !food };
	}
	const servings = food ? servingsOf(ing.amount, ing.unit, food.serving) : null;
	// A plain count ("2" eggs) says nothing the servings don't.
	const notes = [servings != null && !ing.unit ? "" : measure, ing.note].filter(Boolean);
	if (servings != null) return { line: `${name}, ${fmtNum(servings)}${notes.length ? ` (${notes.join(", ")})` : ""}`, converted: true, missing: false };
	const why = food ? `check: 1 serving is ${food.serving}` : "check the servings";
	return { line: `${name}, 1 (${[...notes, why].join(", ")})`, converted: false, missing: !food };
}

// Tandoor's instructions are Markdown with its own template tags for scaled
// amounts ({{ ingredients[0] }}, {{ scale(100) }}); those become plain text.
const instruction = (s) => String(s || "").replace(/\{\{\s*scale\(\s*([\d.]+)\s*\)\s*\}\}/g, "$1").replace(/\{\{[^}]*\}\}/g, "").replace(/[ \t]{2,}/g, " ").trim();

const yamlString = (s) => JSON.stringify(String(s));

// The recipe note for a Tandoor recipe. find(name) -> the Nutrition Database
// food an ingredient name means (or null). syncBlock: the Recipe template's
// "Sync to Nutrition Database" block to end the note with, if there is one.
// -> { text, title, ingredients, converted, unconverted, missing }.
export function tandoorRecipeNote(recipe, find, { syncBlock = "" } = {}) {
	const title = clean(recipe.name) || "Untitled recipe";
	const ings = tandoorIngredients(recipe);
	const lines = [];
	let unconverted = 0;
	const missing = [];
	for (const ing of ings) {
		const r = ingredientLine(ing, find(ing.name));
		lines.push(`- ${r.line}`);
		if (!r.converted) unconverted++;
		if (r.missing) missing.push(ing.name);
	}
	const fm = ["---", `title: ${yamlString(title)}`, `yield: ${recipe.servings > 0 ? recipe.servings : 1}`];
	if (recipe.servings_text) fm.push(`yield_text: ${yamlString(clean(recipe.servings_text))}`);
	if (recipe.source_url) fm.push(`source: ${yamlString(recipe.source_url)}`);
	fm.push(`tandoor_id: ${recipe.id}`);
	if (recipe.working_time) fm.push(`prep_minutes: ${recipe.working_time}`);
	if (recipe.waiting_time) fm.push(`wait_minutes: ${recipe.waiting_time}`);
	const tags = (recipe.keywords || []).map((k) => clean(k.label || k.name).replace(/\s+/g, "-")).filter(Boolean);
	fm.push(`tags: [${["recipe", ...tags].map((t) => yamlString(t)).join(", ")}]`, "---");
	const out = [...fm, "", `# ${title}`, ""];
	if (recipe.description) out.push(clean(recipe.description), "");
	out.push("## Ingredients", ...(lines.length ? lines : ["- "]), "");
	const steps = (recipe.steps || []).map((s) => ({ name: clean(s.name), text: instruction(s.instruction) })).filter((s) => s.text || s.name);
	if (steps.length) {
		out.push("## Instructions");
		steps.forEach((s, i) => out.push("", `${i + 1}. ${s.name ? `**${s.name}** ` : ""}${s.text.replace(/\n+/g, "\n   ")}`.trimEnd()));
		out.push("");
	}
	if (syncBlock) out.push(syncBlock.trim(), "");
	return { text: out.join("\n"), title, ingredients: ings.length, converted: ings.length - unconverted, unconverted, missing: [...new Set(missing)] };
}

// The fenced dataviewjs block in a Recipe template that's its "Sync to
// Nutrition Database" button, or "".
export function templateSyncBlock(templateText, isRecipeSync) {
	for (const m of String(templateText || "").matchAll(/^(`{3,})dataviewjs[^\n]*\n([\s\S]*?)\n\1[ \t]*$/gm)) if (isRecipeSync(m[2])) return m[0];
	return "";
}

// Where imported recipes go: the folder with the most notes that have a
// "## Ingredients" heading (templates aside), else "Recipes/".
export function recipeFolder(notes) {
	const counts = new Map();
	for (const { path, text } of notes) {
		if (/(^|\/)_templates\//i.test(path) || !/^##\s+Ingredients\s*$/im.test(text || "")) continue;
		const folder = path.slice(0, path.lastIndexOf("/") + 1);
		counts.set(folder, (counts.get(folder) || 0) + 1);
	}
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? "Recipes/";
}

// The note already made from Tandoor recipe `id`, if any.
export function noteForTandoorId(notes, id) {
	return notes.find(({ text }) => String(parseFrontmatter(text || "")?.tandoor_id ?? "") === String(id))?.path ?? null;
}
