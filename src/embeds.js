// Embeds: a line holding just ![[Note]] (or ![[Note#Heading]], ![[Note#^id]])
// shows that note, or that part of it, in a box, as Obsidian does. Move the
// cursor onto the line (or press the pencil) to edit the embed itself; click
// the note's name to open it. The box is read-only and drawn with the same
// styling as the editor, but embeds inside it stay as text, so notes that
// embed each other can't loop. Attachments (![[photo.png]]) aren't shown,
// since wr1t3r doesn't sync them.

import { StateField, EditorState, RangeSetBuilder, Facet } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { resolveNote, linkOpener } from "./links.js";
import { embedSection } from "./vaultlinks.js";

// The extensions the box draws its text with (given by the editor, to avoid an import loop).
export const embedLook = Facet.define({ combine: (v) => v[0] || (() => []) });

const EMBED = /^\s*!\[\[([^\[\]\n]+)\]\]\s*$/;

// The note embeds in a state: [{ from, to, note, part, label }] (from/to cover the line).
export function embedsIn(state) {
	const out = [];
	const doc = state.doc;
	for (let n = 1; n <= doc.lines; n++) {
		const line = doc.line(n);
		if (!line.text.includes("![[")) continue;
		const m = line.text.match(EMBED);
		if (!m) continue;
		const [target, alias] = m[1].split("|");
		const hash = target.indexOf("#");
		const note = (hash < 0 ? target : target.slice(0, hash)).trim();
		if (/\.(?!md$)[a-z0-9]{1,5}$/i.test(note)) continue; // an attachment
		out.push({ from: line.from, to: line.to, note, part: hash < 0 ? "" : target.slice(hash + 1).trim(), label: (alias || "").trim() });
	}
	return out;
}

class EmbedWidget extends WidgetType {
	constructor(e, path, text) { super(); this.e = e; this.path = path; this.text = text; }
	eq(o) { return o.path === this.path && o.text === this.text && o.e.note === this.e.note && o.e.part === this.e.part && o.e.label === this.e.label; }
	toDOM(view) {
		const box = document.createElement("div");
		box.className = "md-embed" + (this.text == null ? " missing" : "");
		const top = document.createElement("div");
		top.className = "md-embed-top";
		const title = document.createElement("a");
		title.className = "md-embed-title";
		const name = this.e.label || (this.e.note || (this.path || "").split("/").pop().replace(/\.md$/i, "")) + (this.e.part ? " › " + this.e.part.replace(/^\^/, "^") : "");
		title.textContent = name;
		title.href = this.path ? "#" + encodeURIComponent(this.path) : "#";
		title.addEventListener("mousedown", (ev) => ev.preventDefault());
		title.addEventListener("click", (ev) => {
			ev.preventDefault();
			view.state.facet(linkOpener)?.({ note: this.path || this.e.note, heading: this.e.part, wiki: true });
		});
		const edit = document.createElement("button");
		edit.type = "button";
		edit.className = "md-embed-edit";
		edit.textContent = "✎";
		edit.title = "Edit the embed";
		edit.setAttribute("aria-label", "Edit the embed");
		edit.addEventListener("mousedown", (ev) => {
			ev.preventDefault();
			let pos = this.e.from;
			try { pos = view.posAtDOM(box); } catch {}
			view.dispatch({ selection: { anchor: view.state.doc.lineAt(pos).to }, scrollIntoView: true });
			view.focus();
		});
		top.append(title, edit);
		box.append(top);
		if (this.text == null) {
			const p = document.createElement("div");
			p.className = "md-embed-missing";
			p.textContent = !this.path ? "No note with this name yet" : this.e.part.startsWith("^") ? "That block isn't in the note" : "That heading isn't in the note";
			box.append(p);
			return box;
		}
		const inner = new EditorView({
			parent: box,
			state: EditorState.create({
				doc: this.text,
				selection: { anchor: this.text.length },
				extensions: [view.state.facet(embedLook)(), EditorState.readOnly.of(true), EditorView.editable.of(false), notePath.of(this.path)],
			}),
		});
		box.embedView = inner;
		requestAnimationFrame(() => view.requestMeasure());
		return box;
	}
	destroy(dom) { dom.embedView?.destroy(); }
	ignoreEvent() { return true; }
	get estimatedHeight() { return 120; }
}

function build(state) {
	const b = new RangeSetBuilder();
	const host = state.facet(vaultHost);
	const here = state.facet(notePath);
	if (!host || !here) return b.finish();
	const paths = host.paths();
	const sel = state.selection.ranges;
	for (const e of embedsIn(state)) {
		if (sel.some((r) => r.to >= e.from && r.from <= e.to)) continue; // being edited
		const path = e.note ? resolveNote({ note: e.note, wiki: true }, here, paths) : here;
		const text = path ? (path === here ? state.sliceDoc() : host.text(path)) : null;
		const shown = text == null ? null : embedSection(text, e.part);
		if (path === here && !e.part) continue; // a note can't embed all of itself
		b.add(e.from, e.to, Decoration.replace({ widget: new EmbedWidget(e, path, shown), block: true }));
	}
	return b.finish();
}

export const embeds = StateField.define({
	create: build,
	update(deco, tr) {
		if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(vaultChanged))) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});
