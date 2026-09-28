// "Linked from": the notes that link to the open one, listed under its last
// line with the line each link sits on. Built from notes on this device, so
// it works offline; redrawn when the vault changes (vaultChanged).

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { backlinksTo } from "./vaultlinks.js";
import { linkOpener } from "./links.js";

function compute(state) {
	const host = state.facet(vaultHost);
	const path = state.facet(notePath);
	if (!host || !path) return null;
	const paths = host.paths();
	return backlinksTo(path, paths.map((p) => ({ path: p, text: host.text(p) })), paths);
}

class BacklinksWidget extends WidgetType {
	constructor(list) { super(); this.list = list; this.key = JSON.stringify(list); }
	eq(o) { return o.key === this.key; }
	toDOM(view) {
		const box = document.createElement("section");
		box.className = "md-backlinks";
		const h = document.createElement("h2");
		h.textContent = `Linked from ${this.list.length} note${this.list.length === 1 ? "" : "s"}`;
		box.append(h);
		for (const b of this.list) {
			const a = document.createElement("a");
			a.href = "#" + encodeURIComponent(b.path);
			a.className = "md-backlink";
			const name = document.createElement("span");
			name.className = "md-backlink-name";
			name.textContent = b.path.split("/").pop().replace(/\.md$/i, "") + (b.count > 1 ? ` (${b.count})` : "");
			const snip = document.createElement("span");
			snip.className = "md-backlink-line";
			snip.textContent = b.snippet;
			a.append(name, snip);
			a.addEventListener("mousedown", (e) => e.preventDefault());
			a.addEventListener("click", (e) => {
				e.preventDefault();
				view.state.facet(linkOpener)?.({ note: b.path, heading: "" });
			});
			box.append(a);
		}
		return box;
	}
	ignoreEvent() { return true; }
}

function deco(state, list) {
	const b = new RangeSetBuilder();
	if (list?.length) b.add(state.doc.length, state.doc.length, Decoration.widget({ widget: new BacklinksWidget(list), block: true, side: 1 }));
	return b.finish();
}

export const backlinks = StateField.define({
	create: (state) => { const list = compute(state); return { list, deco: deco(state, list) }; },
	update(v, tr) {
		if (tr.effects.some((e) => e.is(vaultChanged))) { const list = compute(tr.state); return { list, deco: deco(tr.state, list) }; }
		if (tr.docChanged) return { list: v.list, deco: deco(tr.state, v.list) };
		return v;
	},
	provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});
