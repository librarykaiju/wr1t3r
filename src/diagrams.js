// ```mermaid blocks drawn as diagrams while the cursor is outside them, as
// Obsidian does. Mermaid is big, so it loads the first time a note has one.
// Its "strict" mode strips scripts and click handlers from the diagram.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { dataviewBlocks } from "./dataview.js";

let mermaidP = null;
let ids = 0;

// Light or dark, from the page's own background.
export function isDark(bg) {
	const s = String(bg || "").trim();
	const hex = s.startsWith("#") && s.length >= 7 ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) : null;
	const [r, g, b] = hex || (s.match(/\d+/g) || [255, 255, 255]).map(Number);
	return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

async function mermaid(dark) {
	mermaidP ||= import("mermaid").then((m) => m.default, (err) => { mermaidP = null; throw Object.assign(err, { load: true }); });
	const m = await mermaidP;
	m.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default", fontFamily: "inherit" });
	return m;
}

class DiagramWidget extends WidgetType {
	constructor(code, from) { super(); this.code = code; this.from = from; }
	eq(o) { return o.code === this.code; }
	get estimatedHeight() { return 200; }
	toDOM(view) {
		const wrap = document.createElement("div");
		wrap.className = "md-diagram";
		const out = document.createElement("div");
		out.className = "md-diagram-out";
		out.textContent = "Drawing diagram…";
		const edit = document.createElement("button");
		edit.type = "button";
		edit.className = "md-dv-edit";
		edit.textContent = "</>";
		edit.title = "Edit the diagram";
		edit.addEventListener("mousedown", (e) => {
			e.preventDefault();
			let pos = this.from;
			try { pos = view.posAtDOM(wrap); } catch {}
			const line = view.state.doc.lineAt(pos);
			view.dispatch({ selection: { anchor: Math.min(line.to + 1, view.state.doc.length) }, scrollIntoView: true });
			view.focus();
		});
		wrap.append(out, edit);
		const dark = isDark(getComputedStyle(document.documentElement).getPropertyValue("--bg"));
		mermaid(dark)
			.then((m) => m.render("wr1t3r-diagram-" + ++ids, this.code))
			.then(({ svg }) => { out.innerHTML = svg; })
			.catch((err) => {
				out.className = "md-diagram-out md-image-note";
				out.textContent = err?.load ? "Couldn't load the diagram drawer" + (navigator.onLine ? "" : " offline") : "Diagram has an error: " + String(err?.message || err).split("\n")[0];
				// A failed render leaves Mermaid's own error box in the page.
				document.querySelectorAll('[id^="dwr1t3r-diagram-"]').forEach((n) => n.remove());
			})
			.finally(() => view.requestMeasure());
		return wrap;
	}
	ignoreEvent() { return true; }
}

function build(state) {
	const b = new RangeSetBuilder();
	const sel = state.selection.ranges;
	for (const blk of dataviewBlocks(state, "mermaid")) {
		if (!blk.code.trim() || sel.some((r) => r.to >= blk.from && r.from <= blk.to)) continue;
		b.add(blk.from, blk.to, Decoration.replace({ widget: new DiagramWidget(blk.code, blk.from), block: true }));
	}
	return b.finish();
}

export const diagrams = StateField.define({
	create: build,
	update(deco, tr) { return tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? build(tr.state) : deco; },
	provide: (f) => EditorView.decorations.from(f),
});
