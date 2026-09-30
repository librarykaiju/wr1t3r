// The links panel under a note's last line, in three parts that fold:
// "Linked from" (notes that link here, with the line each link sits on),
// "Links to" (notes this one links to; faded when the note doesn't exist yet)
// and "Unlinked mentions" (notes that name this one without linking it,
// folded at first). Built from notes on this device, so it works offline;
// redrawn when the vault changes (vaultChanged) or, for "Links to", as you type.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { backlinksTo, outgoingLinks, unlinkedMentions } from "./vaultlinks.js";
import { linkOpener } from "./links.js";

const open = { from: true, to: true, mentions: false }; // which parts are unfolded, kept across notes

function vaultSide(state) {
	const host = state.facet(vaultHost);
	const path = state.facet(notePath);
	if (!host || !path) return { from: [], mentions: [] };
	const paths = host.paths();
	const notes = paths.map((p) => ({ path: p, text: host.text(p) }));
	return { from: backlinksTo(path, notes, paths), mentions: unlinkedMentions(path, notes) };
}

function outgoing(state) {
	const host = state.facet(vaultHost);
	const path = state.facet(notePath);
	if (!host || !path) return [];
	return outgoingLinks(state.sliceDoc(), path, host.paths());
}

const nameOf = (p) => p.split("/").pop().replace(/\.md$/i, "");

class LinksWidget extends WidgetType {
	constructor(v) { super(); this.v = v; this.key = JSON.stringify([v.from, v.to, v.mentions]); }
	eq(o) { return o.key === this.key; }
	toDOM(view) {
		const box = document.createElement("section");
		box.className = "md-backlinks";
		const go = (note) => view.state.facet(linkOpener)?.({ note, heading: "", wiki: true });
		const item = (label, snippet, note, missing) => {
			const a = document.createElement("a");
			a.href = "#" + encodeURIComponent(note);
			a.className = "md-backlink" + (missing ? " md-unresolved" : "");
			if (missing) a.title = "No note with this name yet";
			const name = document.createElement("span");
			name.className = "md-backlink-name";
			name.textContent = label;
			a.append(name);
			if (snippet) {
				const snip = document.createElement("span");
				snip.className = "md-backlink-line";
				snip.textContent = snippet;
				a.append(snip);
			}
			a.addEventListener("mousedown", (e) => e.preventDefault());
			a.addEventListener("click", (e) => { e.preventDefault(); go(note); });
			return a;
		};
		const part = (key, title, list, draw) => {
			if (!list.length) return;
			const d = document.createElement("details");
			d.open = open[key];
			d.addEventListener("toggle", () => { open[key] = d.open; view.requestMeasure(); });
			const s = document.createElement("summary");
			s.textContent = `${title} ${list.length} note${list.length === 1 ? "" : "s"}`;
			d.append(s, ...list.map(draw));
			box.append(d);
		};
		const count = (n) => (n > 1 ? ` (${n})` : "");
		part("from", "Linked from", this.v.from, (b) => item(nameOf(b.path) + count(b.count), b.snippet, b.path));
		part("to", "Links to", this.v.to, (l) => item(l.name + count(l.count), "", l.path || l.name, !l.path));
		part("mentions", "Unlinked mentions in", this.v.mentions, (b) => item(nameOf(b.path) + count(b.count), b.snippet, b.path));
		return box;
	}
	ignoreEvent() { return true; }
}

function deco(state, v) {
	const b = new RangeSetBuilder();
	if (v.from.length || v.to.length || v.mentions.length) b.add(state.doc.length, state.doc.length, Decoration.widget({ widget: new LinksWidget(v), block: true, side: 1 }));
	return b.finish();
}

// Whether an edit could change what the note links to: only when a line it
// touches, before or after, has link or code syntax. Plain typing skips
// rescanning the whole note, which lagged long notes.
const LINKISH = /[[\]()`~]/;
function touchesLinks(tr) {
	let hit = false;
	const lines = (doc, from, to) => doc.sliceString(doc.lineAt(from).from, doc.lineAt(to).to);
	tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
		if (!hit && (LINKISH.test(lines(tr.startState.doc, fromA, toA)) || LINKISH.test(lines(tr.state.doc, fromB, toB)))) hit = true;
	});
	return hit;
}

const make = (state, side, to) => { const v = { ...side, to }; return { v, deco: deco(state, v) }; };

export const backlinks = StateField.define({
	create: (state) => make(state, vaultSide(state), outgoing(state)),
	update(cur, tr) {
		const vault = tr.effects.some((e) => e.is(vaultChanged));
		if (!vault && !tr.docChanged) return cur;
		if (!vault && !touchesLinks(tr)) return { v: cur.v, deco: cur.deco.map(tr.changes) };
		const to = outgoing(tr.state);
		const side = vault ? vaultSide(tr.state) : cur.v;
		if (!vault && JSON.stringify(to) === JSON.stringify(cur.v.to)) return { v: cur.v, deco: cur.deco.map(tr.changes) };
		return make(tr.state, side, to);
	},
	provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});
