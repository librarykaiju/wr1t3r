// The Recipe template's "Sync to Nutrition Database" button, done by wr1t3r
// itself (src/recipe.js works it out): dataviewjs scripts can't write here,
// so src/dataview.js draws this in place of that block. It shows the
// recipe's per-serving numbers and whether the database has them, and the
// button adds or updates the recipe's row. Obsidian still runs the block.

import { WidgetType } from "@codemirror/view";
import { vaultHost } from "./vault.js";
import { recipeSync, syncBlockDbPath, upsertRecipeRow } from "./recipe.js";

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// The database note: the block's dbPath if it's in the vault, else the
// shortest path ending in "Nutrition Database.md".
export function recipeDbPath(code, paths) {
	const named = syncBlockDbPath(code);
	if (named && paths.includes(named)) return named;
	return paths.filter((p) => /(^|\/)Nutrition Database\.md$/i.test(p)).sort((a, b) => a.length - b.length)[0] || null;
}

export class RecipeSyncWidget extends WidgetType {
	// info: recipeSync()'s result, or null when there's no database note.
	constructor(code, path, from, dbPath, info) {
		super();
		Object.assign(this, { code, path, from, dbPath, info });
		this.key = JSON.stringify([path, dbPath, info]);
	}
	eq(o) { return o.key === this.key; }
	toDOM(view) {
		const wrap = el("div", "md-recipe-sync");
		const info = this.info;
		const button = el("button", "md-recipe-sync-btn", "Sync to Nutrition Database");
		button.type = "button";
		const status = el("div", "md-recipe-sync-status");
		if (!info) {
			button.disabled = true;
			status.textContent = "There's no Nutrition Database note in the vault.";
		} else {
			const p = info.per;
			const numbers = `${p.calories} cal · ${p.fat} g fat · ${p.carbs} g carbs · ${p.protein} g protein · ${p.fiber} g fiber per serving (yield ${info.yield})`;
			const state = !info.ingredients ? "No ingredients to sync yet."
				: info.upToDate ? `“${info.name}” is in the database with these numbers.`
				: info.existing ? `“${info.name}” is in the database with older numbers. Sync to update it.`
				: `“${info.name}” isn't in the database yet.`;
			status.append(el("div", null, numbers), el("div", null, state));
			if (info.unmatched) status.append(el("div", "md-recipe-sync-warn", `${info.unmatched} ingredient${info.unmatched === 1 ? "" : "s"} not in the database; the numbers leave ${info.unmatched === 1 ? "it" : "them"} out.`));
			button.disabled = view.state.readOnly || !info.ingredients || info.upToDate;
			if (info.upToDate) button.textContent = "Synced";
		}
		button.addEventListener("mousedown", (e) => e.preventDefault());
		button.addEventListener("click", async () => {
			const host = view.state.facet(vaultHost);
			if (!host?.write || !info || !this.dbPath) return;
			button.disabled = true;
			let result = null;
			try {
				await host.write(this.dbPath, (t) => {
					const fresh = recipeSync(view.state.doc.toString(), this.path, t);
					result = upsertRecipeRow(t, fresh.name, fresh.row);
					return result.text;
				});
				status.replaceChildren(el("div", null, result?.error ? result.error : `${result?.action || "Kept"} “${info.name}” (${info.per.calories} cal per serving).`));
			} catch (e) {
				status.replaceChildren(el("div", null, String(e?.message || e)));
				button.disabled = false;
			}
		});
		const edit = el("button", "md-dv-edit", "</>");
		edit.type = "button";
		edit.title = "Show the block's script (Obsidian runs it)";
		edit.addEventListener("mousedown", (e) => {
			e.preventDefault();
			let pos = this.from;
			try { pos = view.posAtDOM(wrap); } catch {}
			const line = view.state.doc.lineAt(pos);
			view.dispatch({ selection: { anchor: Math.min(line.to + 1, view.state.doc.length) }, scrollIntoView: true });
			view.focus();
		});
		wrap.append(button, status, edit);
		return wrap;
	}
	ignoreEvent() { return true; }
	get estimatedHeight() { return 90; }
}
