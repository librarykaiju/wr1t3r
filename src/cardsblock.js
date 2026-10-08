// Cards in a note: a ```wr1t3r-cards block holds the same entries as Home's
// pinned tiles (src/home.js), as a bare YAML list, and shows as the same 4:3
// tiles while the cursor is outside it:
//
//   ```wr1t3r-cards
//   - link: "[[Reading log]]"
//     color: 3
//   - section: Writing
//   - link: "folder:content/_writing"
//   ```
//
// Tiles open what they point at, have Home's menu (color, cover, rename,
// move, sections, remove), drag to reorder, and + adds one; each change
// rewrites only the block's list. Obsidian shows the block as code. The block
// never runs anything by itself: a command tile runs only when clicked.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { dataviewBlocks, blockBodyChange } from "./dataview.js";
import { readCards, writeCards } from "./home.js";
import { drawHome } from "./homeview.js";
import { notePath, vaultChanged } from "./vault.js";

export const CARDS = "wr1t3r-cards";
const UNTRUSTED = /(^|\/)_(clippings|uploads)\//i;

// Set by main.js: { paths(), text(path), image(ref, from), open(pin, path),
// menu(store, index, x, y), add(store), glance(folder), habits() }.
let host = null;
export const setCardsHost = (h) => { host = h; };

// The nth cards block in the view, to read and rewrite: { list(), save(list) }.
export function cardsStore(view, n) {
	const block = () => dataviewBlocks(view.state, CARDS)[n];
	return {
		list: () => readCards(block()?.code),
		save(list) {
			const b = block();
			if (!b || view.state.readOnly) return;
			const text = writeCards(list);
			view.dispatch({ changes: blockBodyChange(view.state, b, text), userEvent: "input.cards" });
		},
	};
}

let vaultStamp = 0;

class CardsWidget extends WidgetType {
	constructor(code, path, n, from) { super(); this.code = code; this.path = path; this.n = n; this.from = from; this.stamp = vaultStamp; }
	eq(o) { return o.code === this.code && o.path === this.path && o.n === this.n && o.stamp === this.stamp; }
	toDOM(view) {
		const wrap = document.createElement("div");
		wrap.className = "md-cards";
		const grid = document.createElement("div");
		grid.className = "home-grid md-cards-grid";
		grid.setAttribute("role", "list");
		grid.setAttribute("aria-label", "Cards");
		const store = () => cardsStore(view, this.n);
		const ro = view.state.readOnly;
		if (host) {
			drawHome(grid, {
				pins: readCards(this.code), homeFile: this.path, paths: host.paths(),
				text: host.text, image: host.image, open: host.open, glance: host.glance, habits: host.habits,
				menu: (i, x, y) => (ro ? null : host.menu(store(), i, x, y)),
				add: ro ? null : () => host.add(store()),
				emptyLabel: "Add cards: notes, folders, commands and web pages",
				reorder: (from, to) => {
					if (ro) return;
					const list = store().list();
					const [moved] = list.splice(from, 1);
					list.splice(to, 0, moved);
					store().save(list);
				},
			});
		}
		const edit = document.createElement("button");
		edit.type = "button";
		edit.className = "md-dv-edit md-cards-edit";
		edit.textContent = "</>";
		edit.title = "Edit the list";
		edit.addEventListener("mousedown", (e) => {
			e.preventDefault();
			let pos = this.from;
			try { pos = view.posAtDOM(wrap); } catch {}
			const line = view.state.doc.lineAt(pos);
			view.dispatch({ selection: { anchor: Math.min(line.to + 1, view.state.doc.length) }, scrollIntoView: true });
			view.focus();
		});
		wrap.append(grid, edit);
		return wrap;
	}
	ignoreEvent() { return true; }
	get estimatedHeight() { return 180; }
}

function build(state) {
	const b = new RangeSetBuilder();
	const path = state.facet(notePath);
	if (!path || UNTRUSTED.test(path)) return b.finish();
	const sel = state.selection.ranges;
	dataviewBlocks(state, CARDS).forEach((blk, n) => {
		if (sel.some((r) => r.to >= blk.from && r.from <= blk.to)) return; // being edited
		b.add(blk.from, blk.to, Decoration.replace({ widget: new CardsWidget(blk.code, path, n, blk.from), block: true }));
	});
	return b.finish();
}

export const cardsBlocks = StateField.define({
	create: build,
	update(deco, tr) {
		const vault = tr.effects.some((e) => e.is(vaultChanged));
		if (vault) vaultStamp++;
		if (tr.docChanged || tr.selection || vault || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});
