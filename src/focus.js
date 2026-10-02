// Focus mode: the page's side columns and toolbar fold away (main.js), the
// line you're typing stays in the middle of the screen, and paragraphs other
// than the one you're in are dimmed. Off unless turned on.

import { StateEffect } from "@codemirror/state";
import { ViewPlugin, Decoration, EditorView } from "@codemirror/view";

let on = false;
const refresh = StateEffect.define();

export function setFocusMode(view, value) {
	on = !!value;
	view?.dispatch({ effects: refresh.of(null) });
	if (on && view) center(view);
}

function center(view) {
	requestAnimationFrame(() => {
		if (!view.dom.isConnected) return;
		view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }) });
	});
}

// The [first, last] line numbers of the paragraph holding pos: the lines
// around it up to a blank line.
export function paragraphAt(doc, pos) {
	let a = doc.lineAt(pos).number, b = a;
	if (!doc.line(a).text.trim()) return [a, a];
	while (a > 1 && doc.line(a - 1).text.trim()) a--;
	while (b < doc.lines && doc.line(b + 1).text.trim()) b++;
	return [a, b];
}

const dim = Decoration.line({ class: "cm-dimmed" });

export const focusMode = ViewPlugin.fromClass(class {
	constructor(view) { this.decorations = this.build(view); }
	update(u) {
		const changed = u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(refresh)));
		if (changed || u.viewportChanged) this.decorations = this.build(u.view);
		if (on && (u.docChanged || u.selectionSet) && u.view.hasFocus) center(u.view);
	}
	build(view) {
		if (!on) return Decoration.none;
		const { doc } = view.state;
		const [a, b] = paragraphAt(doc, view.state.selection.main.head);
		const ranges = [];
		for (const { from, to } of view.visibleRanges) {
			for (let pos = from; pos <= to; ) {
				const line = doc.lineAt(pos);
				if (line.number < a || line.number > b) ranges.push(dim.range(line.from));
				pos = line.to + 1;
			}
		}
		return Decoration.set(ranges);
	}
}, { decorations: (v) => v.decorations });
