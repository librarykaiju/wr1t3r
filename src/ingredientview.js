// Recipe ingredients the Nutrition Database has nothing for, looked up in the
// USDA tables shipped with the app (src/foodtable.js): a dialog lists each
// one with its closest foods to pick from (or skip), showing each food's
// serving, since a recipe's amounts count in servings of the food it names.
// The picks come back as foods to add, each with the ingredient's name as an
// alias (src/recipe.js matchIngredients, asIngredient).

import { missingIngredients, matchIngredients, asIngredient } from "./recipe.js";
import { loadBundled } from "./foodtable.js";

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// -> { foods: [...] to add (empty if none were picked), missing: names } or
// null when cancelled. Nothing missing -> { foods: [], missing: [] } with no
// dialog.
export async function pickIngredientFoods(noteText, dbText) {
	const missing = missingIngredients(noteText, dbText);
	if (!missing.length) return { foods: [], missing };
	const table = await loadBundled();
	const choices = matchIngredients(missing, table);
	const picks = await dialog(choices);
	if (!picks) return null;
	// One row per food, carrying every ingredient name that picked it.
	const byName = new Map();
	for (const { ingredient, food } of picks) {
		const have = byName.get(food.name.toLowerCase());
		byName.set(food.name.toLowerCase(), asIngredient(have || food, ingredient));
	}
	return { foods: [...byName.values()], missing };
}

const label = (f) => `${f.name} · ${f.serving} · ${Math.round(f.calories)} cal`;

function dialog(choices) {
	return new Promise((resolve) => {
		document.querySelector(".palette")?.remove();
		const wrap = el("div", "palette");
		wrap.setAttribute("role", "dialog");
		wrap.setAttribute("aria-label", "Missing ingredients");
		const box = el("div", "palette-box ingredient-box");
		wrap.append(box);
		const back = document.activeElement;
		const close = (value) => {
			wrap.remove();
			document.removeEventListener("keydown", esc, true);
			back?.focus?.();
			resolve(value);
		};
		const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); close(null); } };
		document.addEventListener("keydown", esc, true);
		wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) { e.preventDefault(); close(null); } });

		box.append(
			el("div", "ingredient-title", `${choices.length} ingredient${choices.length === 1 ? " isn't" : "s aren't"} in your Nutrition Database`),
			el("p", "ingredient-hint", "Pick the closest USDA food for each, or skip it. Your recipe's amounts count in the food's serving: if it says 1 cup, “Rice, 2” means 2 cups."),
		);
		const selects = [];
		for (const { ingredient, options } of choices) {
			const row = el("label", "ingredient-row");
			const s = el("select");
			for (const [i, f] of options.entries()) s.append(new Option(label(f), String(i)));
			s.append(new Option(options.length ? "Skip this one" : "Nothing close in the USDA tables", ""));
			s.value = options.length ? "0" : "";
			// The pick's serving, in full: a phone cuts the option text short.
			const serving = el("span", "ingredient-serving");
			const show = () => { const f = options[Number(s.value)]; serving.textContent = s.value !== "" && f ? `1 serving = ${f.serving}, ${Math.round(f.calories)} cal` : ""; };
			s.addEventListener("change", show);
			show();
			selects.push({ ingredient, options, s });
			row.append(el("span", "ingredient-name", ingredient), s, serving);
			box.append(row);
		}
		const buttons = el("div", "ingredient-buttons");
		const add = el("button", "ingredient-add", "Add to Nutrition Database");
		const cancel = el("button", null, "Cancel");
		add.type = cancel.type = "button";
		add.addEventListener("click", () => close(selects.filter((x) => x.s.value !== "").map((x) => ({ ingredient: x.ingredient, food: x.options[Number(x.s.value)] }))));
		cancel.addEventListener("click", () => close(null));
		buttons.append(cancel, add);
		box.append(buttons);
		document.body.append(wrap);
		(selects[0]?.s || add).focus();
	});
}
