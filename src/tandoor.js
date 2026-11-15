// Recipes from Tandoor (https://tandoor.dev) as Recipe notes. Tandoor's
// export (Settings > Export, "Default" format) is a zip holding one zip per
// recipe, named by its id, each with a recipe.json. Each recipe becomes a
// note made from the vault's Recipe template (or a plain one), with its
// ingredients written the way src/recipe.js reads them: "Food, servings",
// the servings worked out from Tandoor's amount and unit against the food's
// serving size in the Nutrition Database ("200 g" of a "1 cup (125g)" food is
// 1.6). Tandoor's amount stays in brackets, so nothing is lost when it can't
// be converted. The note's `tandoor:` property holds the recipe's id, so a
// later import finds it again. src/main.js (importTandoor) runs it.

import { parseFrontmatter } from "./dvpage.js";
import { findFood } from "./planner.js";

// ---- Units ------------------------------------------------------------------

const MASS = { g: 1, gram: 1, gramme: 1, kg: 1000, kilogram: 1000, mg: 0.001, milligram: 0.001, oz: 28.3495, ounce: 28.3495, lb: 453.592, pound: 453.592 };
const VOLUME = {
	ml: 1, milliliter: 1, millilitre: 1, cl: 10, dl: 100, l: 1000, liter: 1000, litre: 1000,
	tsp: 4.92892, teaspoon: 4.92892, tbsp: 14.7868, tbs: 14.7868, tbl: 14.7868, tablespoon: 14.7868,
	cup: 236.588, c: 236.588, "fl oz": 29.5735, floz: 29.5735, "fluid ounce": 29.5735,
	pint: 473.176, pt: 473.176, quart: 946.353, qt: 946.353, gallon: 3785.41, gal: 3785.41,
};
// Units that just count the thing itself.
const COUNT = new Set(["", "piece", "pc", "pcs", "whole", "each", "ea", "item", "unit", "serving", "portion"]);
const known = (u) => u in MASS || u in VOLUME || COUNT.has(u);

// "Tablespoons." -> "tablespoon", "lbs" -> "lb", "Fl. oz" -> "fl oz".
export function normUnit(unit) {
	const u = String(unit ?? "").toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
	if (known(u)) return u;
	for (const cut of [u.replace(/es$/, ""), u.replace(/s$/, "")]) if (cut !== u && known(cut)) return cut;
	return u.replace(/(ches|shes|ses|xes)$/, (m) => m.slice(0, -2)).replace(/([^s])s$/, "$1");
}

// "1 1/2" -> 1.5, "1/2" -> 0.5, "0.5" -> 0.5, else NaN.
function quantity(s) {
	const m = String(s).trim().match(/^(\d+(?:\.\d+)?)?(?:\s*(\d+)\/(\d+))?$/);
	if (!m || (m[1] == null && m[2] == null)) return NaN;
	return (m[1] ? parseFloat(m[1]) : 0) + (m[2] ? parseInt(m[2], 10) / parseInt(m[3], 10) : 0);
}

// One "1 cup" or "118g" -> { qty, unit } (unit normalised), or null.
function measure(part) {
	const m = String(part).trim().toLowerCase().match(/^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(.*)$/);
	if (!m) return null;
	const qty = quantity(m[1]);
	if (!(qty > 0)) return null;
	const rest = m[2].replace(/[,;].*$/, "").replace(/\s+/g, " ").trim();
	const words = rest.split(" ");
	for (const u of [rest, words.slice(0, 2).join(" "), words[0]]) {
		const n = normUnit(u);
		if (n in MASS || n in VOLUME) return { qty, unit: n };
	}
	return { qty, unit: normUnit(words[0] || "") };
}

// A Nutrition Database serving, "1 medium (118g)", "0.5 cup (114g)",
// "100g", "8 fl oz (240 ml)" -> { grams, ml, count: { qty, unit } | null }.
// count is the leading measure when it isn't a weight or volume ("1 medium").
export function parseServing(serving) {
	const text = String(serving ?? "");
	const lead = text.replace(/\(.*$/, "").trim();
	const inner = [...text.matchAll(/\(([^)]*)\)/g)].flatMap((m) => m[1].split(/[,;]/));
	let grams = null, ml = null, count = null;
	for (const [i, part] of [lead, ...inner].entries()) {
		const m = measure(part);
		if (!m) continue;
		if (m.unit in MASS) grams ??= m.qty * MASS[m.unit];
		else if (m.unit in VOLUME) ml ??= m.qty * VOLUME[m.unit];
		else if (i === 0) count = m;
	}
	return { grams, ml, count };
}

const r2 = (n) => (n > 0 && n < 0.01 ? 0.01 : Math.round(n * 100) / 100);

// Tandoor's amount and unit in servings of `food` (a Nutrition Database row),
// or null when they don't fit its serving: grams against a serving's grams,
// volumes against its volume, and a count ("2", "2 cloves") against a serving
// that counts the same thing ("1 medium", "1 clove").
export function toServings(amount, unit, food) {
	const a = parseFloat(amount);
	if (!Number.isFinite(a) || a < 0) return null;
	if (a === 0) return 0;
	const s = parseServing(food?.serving);
	const u = normUnit(unit);
	if (u in MASS) return s.grams ? r2((a * MASS[u]) / s.grams) : null;
	if (u in VOLUME) return s.ml ? r2((a * VOLUME[u]) / s.ml) : null;
	if (s.count && (COUNT.has(u) || u === s.count.unit)) return r2(a / s.count.qty);
	return null;
}

// ---- The export --------------------------------------------------------------

// The export's bytes -> [{ id, recipe }]. Takes JSZip so it loads only when
// used. A single recipe's own zip (recipe.json at the top) works too.
export async function readExport(bytes, JSZip) {
	let zip;
	try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error("That isn't a zip file. In Tandoor, use Settings > Export with the Default format."); }
	const one = async (z, id) => {
		const f = z.file("recipe.json");
		if (!f) return null;
		let recipe;
		try { recipe = JSON.parse(await f.async("string")); } catch { return null; }
		return recipe && typeof recipe === "object" ? { id, recipe } : null;
	};
	const top = await one(zip, null);
	if (top) return [top];
	const out = [];
	for (const f of Object.values(zip.files)) {
		const m = !f.dir && f.name.match(/(?:^|\/)(\d+)\.zip$/i);
		if (!m) continue;
		try {
			const r = await one(await JSZip.loadAsync(await f.async("uint8array")), Number(m[1]));
			if (r) out.push(r);
		} catch { /* a broken recipe zip is left out */ }
	}
	if (!out.length) throw new Error("There are no Tandoor recipes in that zip. In Tandoor, use Settings > Export with the Default format.");
	return out.sort((x, y) => x.id - y.id);
}

// ---- Recipes as notes --------------------------------------------------------

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// A food's name as an ingredient line has it: no commas (src/recipe.js splits
// "Food, servings" at a comma) and no pipes (the database is a table).
export const foodName = (food) => clean(food?.name).replace(/\s*,\s*/g, " ").replace(/\|/g, "/");

const sortByOrder = (list) => [...(list || [])].sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
const ingredientsOf = (recipe) => sortByOrder(recipe?.steps).flatMap((s) => sortByOrder(s?.ingredients));

// Every food the recipes use, once each, as a note with an "## Ingredients"
// list, for src/ingredientview.js to find the ones the database lacks.
export function ingredientsNote(recipes) {
	const names = new Map();
	for (const { recipe } of recipes) for (const i of ingredientsOf(recipe)) {
		const n = !i?.is_header && foodName(i?.food);
		if (n) names.set(n.toLowerCase(), n);
	}
	return "## Ingredients\n" + [...names.values()].map((n) => `- ${n}, 1`).join("\n") + "\n";
}

const number = (n) => String(Math.round(parseFloat(n) * 1000) / 1000);

// Tandoor's own amount, "200 g" or "2 cloves".
function amountText(i) {
	if (i.no_amount) return "";
	const a = parseFloat(i.amount);
	const u = i.unit ? clean((a === 1 ? i.unit.name : i.unit.plural_name || i.unit.name)) : "";
	return Number.isFinite(a) && a > 0 ? (u ? `${number(a)} ${u}` : number(a)) : u;
}

// The recipe's ingredient lines -> { lines, unconverted (names whose amounts
// didn't fit their food's serving), loose (Tandoor lines with no food) }.
export function ingredientLines(recipe, foods) {
	const lines = [], unconverted = [], loose = [];
	for (const i of ingredientsOf(recipe)) {
		if (!i || i.is_header) continue;
		const name = foodName(i.food);
		const note = clean(i.note);
		if (!name) { if (note) loose.push(note); continue; }
		const amount = amountText(i);
		const food = findFood(foods, name);
		let servings, flag = "";
		if (i.no_amount || !(parseFloat(i.amount) > 0)) servings = 0;
		else if (!food) servings = 1;
		else {
			servings = toServings(i.amount, i.unit?.name, food);
			if (servings == null) {
				servings = 1;
				flag = `check the servings: 1 is ${food.serving}`;
				unconverted.push(name);
			}
		}
		const extra = [amount, note, flag].filter(Boolean).join("; ");
		lines.push(`- ${name}, ${servings}${extra ? ` (${extra})` : ""}`);
	}
	return { lines, unconverted, loose };
}

// Tandoor's steps as a numbered list; a step's later lines are indented
// under it, so a step with paragraphs stays one item.
export function instructionLines(recipe) {
	const out = [];
	let n = 0;
	for (const s of sortByOrder(recipe?.steps)) {
		const text = String(s?.instruction ?? "").replace(/\r\n?/g, "\n").trim();
		const title = clean(s?.name);
		if (!text && !title) continue;
		const [first, ...rest] = (text || "").split("\n");
		const head = title && !/^step\s*\d*$/i.test(title) ? `**${title}.**${first ? " " + first : ""}` : first || title;
		out.push(`${++n}. ${head}`, ...rest.map((l) => (l.trim() ? "   " + l : "")));
	}
	return out;
}

const BUILTIN = "---\ntitle: \"\"\ntags:\n  - recipe\nyield: 1\nsource:\n---\n\n## Ingredients\n\n## Instructions\n\n## Notes\n";

const yamlString = (s) => (/^[\w][\w ./:?=&%#~+-]*$/.test(s) && !/:\s|\s#|^(true|false|null|yes|no|on|off|[\d.]+)$/i.test(s) ? s : JSON.stringify(s));
const tagOf = (s) => clean(s).toLowerCase().replace(/[^\p{L}\p{N}/_-]+/gu, "-").replace(/^-+|-+$/g, "");

// The note's frontmatter with these keys set: each [key, lines] replaces the
// key's line and the indented lines under it, or is added at the end.
export function setProperties(text, entries) {
	const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
	if (!m) return "---\n" + entries.flatMap(([, lines]) => lines).join("\n") + "\n---\n\n" + text.replace(/^\s+/, "");
	let lines = m[1].split(/\r?\n/);
	for (const [key, set] of entries) {
		const at = lines.findIndex((l) => l.match(/^([^\s#:][^:]*):/)?.[1].trim() === key);
		if (at < 0) { lines.push(...set); continue; }
		let end = at + 1;
		while (end < lines.length && /^(\s+\S|\s*-\s)/.test(lines[end]) && !/^[^\s#:][^:]*:/.test(lines[end])) end++;
		lines = [...lines.slice(0, at), ...set, ...lines.slice(end)];
	}
	return "---\n" + lines.join("\n") + "\n---" + m[2] + text.slice(m[0].length);
}

// The section under "## heading" replaced by `body` (lines), up to the next
// heading of level 1 or 2; added before "## Nutrition…" or at the end when
// the note has no such heading.
export function setSection(text, heading, body) {
	const lines = text.split("\n");
	const isHead = (l) => /^#{1,2}\s/.test(l);
	const want = new RegExp(`^##\\s+${heading}\\s*$`, "i");
	const at = lines.findIndex((l) => want.test(l));
	const block = body.length ? [...body, ""] : [""];
	if (at >= 0) {
		let end = at + 1, fence = false;
		while (end < lines.length) {
			if (/^\s*(```|~~~)/.test(lines[end])) fence = !fence;
			if (!fence && isHead(lines[end])) break;
			end++;
		}
		return [...lines.slice(0, at + 1), ...block, ...lines.slice(end)].join("\n");
	}
	const before = lines.findIndex((l) => /^##\s+nutrition/i.test(l));
	const add = [`## ${heading}`, ...block];
	if (before >= 0) return [...lines.slice(0, before), ...add, ...lines.slice(before)].join("\n");
	return text.replace(/\n*$/, "\n\n") + add.join("\n") + "\n";
}

// A recipe's note: `template` is the vault's Recipe template already
// rendered for the title (src/daily.js renderTemplate), or null for a plain
// one. -> { text, unconverted }.
export function recipeNote({ id, recipe }, foods, template = null) {
	const title = clean(recipe?.name) || (id != null ? `Tandoor recipe ${id}` : "Tandoor recipe");
	let text = (template || BUILTIN).replace(/\r\n?/g, "\n");
	const fm = parseFrontmatter(text);
	const tags = [...new Set([...(Array.isArray(fm.tags) ? fm.tags : fm.tags ? String(fm.tags).split(/[,\s]+/) : []).map((t) => String(t).replace(/^#/, "")).filter(Boolean),
		"recipe", ...(recipe?.keywords || []).map((k) => tagOf(k?.name)).filter(Boolean)])];
	const servings = parseFloat(recipe?.servings);
	const props = [
		["title", [`title: ${JSON.stringify(title)}`]],
		["tags", ["tags:", ...tags.map((t) => `  - ${t}`)]],
		["yield", [`yield: ${servings > 0 ? number(servings) : 1}`]],
	];
	if (clean(recipe?.source_url)) props.push(["source", [`source: ${yamlString(clean(recipe.source_url))}`]]);
	if (id != null) props.push(["tandoor", [`tandoor: ${id}`]]);
	text = setProperties(text, props);
	const { lines, unconverted, loose } = ingredientLines(recipe, foods);
	text = setSection(text, "Ingredients", lines);
	text = setSection(text, "Instructions", instructionLines(recipe));
	const notes = [];
	if (clean(recipe?.description)) notes.push(String(recipe.description).trim(), "");
	const times = [recipe?.working_time > 0 && `Prep ${recipe.working_time} min`, recipe?.waiting_time > 0 && `Waiting ${recipe.waiting_time} min`].filter(Boolean);
	if (times.length) notes.push(times.join(" · "), "");
	if (clean(recipe?.servings_text) && servings > 0) notes.push(`Makes ${number(servings)} ${clean(recipe.servings_text)}.`, "");
	if (loose.length) notes.push("Also:", ...loose.map((l) => `- ${l}`), "");
	if (notes.length && notes.at(-1) === "") notes.pop();
	text = setSection(text, "Notes", notes);
	return { title, text: text.replace(/\n{3,}/g, "\n\n"), unconverted };
}

// ---- Where the notes go -------------------------------------------------------

// The recipe notes already in the vault: { path, text } with a recipe tag or a
// Recipe template's sync block, and an "## Ingredients" heading.
export const isRecipeNote = (text) => /^##\s+Ingredients\s*$/im.test(text) && (/^\s*-\s*recipe\s*$/im.test(text) || /tags:.*\brecipe\b/i.test(text) || /Sync to Nutrition Database/.test(text));

// The folder most recipe notes are in, else `fallback`.
export function recipesFolder(notes, fallback) {
	const count = new Map();
	for (const n of notes) if (isRecipeNote(n.text || "") && !/(^|\/)_templates\//i.test(n.path)) {
		const f = n.path.slice(0, n.path.lastIndexOf("/") + 1);
		count.set(f, (count.get(f) || 0) + 1);
	}
	return [...count].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? fallback;
}

const fileName = (title) => clean(title).replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").replace(/^\.+/, "").trim().slice(0, 120) || "Recipe";

// Where each recipe goes: the note already holding its `tandoor:` id (or,
// for a recipe with no id, its title), else a new path in `folder` that's
// free. -> [{ ...entry, path, existing }].
export function planImport(entries, notes, folder) {
	const byId = new Map(), byTitle = new Map();
	for (const n of notes) {
		const fm = parseFrontmatter(n.text || "");
		if (fm.tandoor != null && fm.tandoor !== "") byId.set(String(fm.tandoor), n.path);
		if (fm.title) byTitle.set(String(fm.title).toLowerCase(), n.path);
	}
	const taken = new Set(notes.map((n) => n.path.toLowerCase()));
	return entries.map((e) => {
		const title = clean(e.recipe?.name);
		const have = e.id != null ? byId.get(String(e.id)) : title && byTitle.get(title.toLowerCase());
		if (have) return { ...e, path: have, existing: true };
		const base = folder + fileName(title || `Tandoor recipe ${e.id ?? ""}`);
		let path = base + ".md";
		for (let k = 2; taken.has(path.toLowerCase()); k++) path = `${base} (${k}).md`;
		taken.add(path.toLowerCase());
		return { ...e, path, existing: false };
	});
}
