// The script layout in the editor (see src/script.js): the editor gets the
// class sp-layout while the note asks for it, and each line gets a class for
// its part (sp-scene, sp-character, sp-dialogue...), which the stylesheet
// sets out like a screenplay page.

import { RangeSetBuilder } from "@codemirror/state";
import { EditorView, ViewPlugin, Decoration } from "@codemirror/view";
import { isScript, scriptKinds } from "./script.js";

const on = (state) => {
	const head = state.sliceDoc(0, Math.min(state.doc.length, 4000));
	return head.startsWith("---") && isScript(head);
};

const deco = Object.fromEntries(["scene", "action", "character", "paren", "dialogue", "transition"].map((k) => [k, Decoration.line({ class: "sp-" + k })]));

// Every line's kind, the properties at the top left blank.
function kinds(state) {
	const lines = state.doc.toString().split("\n");
	if (/^---\s*$/.test(lines[0] ?? "")) {
		for (let i = 1; i < lines.length; i++) {
			const close = /^(---|\.\.\.)\s*$/.test(lines[i]);
			for (let j = 0; j <= i && close; j++) lines[j] = "";
			if (close) break;
		}
	}
	return scriptKinds(lines);
}

function build(view, all) {
	const b = new RangeSetBuilder();
	if (!all) return b.finish();
	const { doc } = view.state;
	let last = -1;
	for (const { from, to } of view.visibleRanges) {
		for (let n = doc.lineAt(from).number, end = doc.lineAt(to).number; n <= end; n++) {
			const k = all[n - 1];
			const at = doc.line(n).from;
			if (k && at > last) { b.add(at, at, deco[k]); last = at; }
		}
	}
	return b.finish();
}

export const scriptLayout = [
	EditorView.editorAttributes.compute(["doc"], (state) => (on(state) ? { class: "sp-layout" } : {})),
	ViewPlugin.define((view) => {
		const p = {
			all: on(view.state) ? kinds(view.state) : null,
			update(u) {
				if (u.docChanged) this.all = on(u.state) ? kinds(u.state) : null;
				if (u.docChanged || u.viewportChanged) this.decorations = build(u.view, this.all);
			},
		};
		p.decorations = build(view, p.all);
		return p;
	}, { decorations: (v) => v.decorations }),
];
