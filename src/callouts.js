// Foldable callouts, as in Obsidian: "> [!note]-" starts folded and
// "> [!note]+" starts open. A chevron at the end of the title line folds and
// unfolds it. Folding is display only (the "-" or "+" in the note is left
// alone), and it lasts until the note is closed.

import { StateField, StateEffect, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { calloutOf } from "./blocks.js";

const toggle = StateEffect.define({ map: (pos, change) => change.mapPos(pos) });

// Callouts (by the start of their first line) whose fold differs from what the note says.
const flipped = StateField.define({
	create: () => new Set(),
	update(set, tr) {
		let next = set;
		if (tr.docChanged) next = new Set([...set].map((p) => tr.changes.mapPos(p)));
		for (const e of tr.effects) {
			if (!e.is(toggle)) continue;
			next = new Set(next);
			if (next.has(e.value)) next.delete(e.value);
			else next.add(e.value);
		}
		return next;
	},
});

class ChevronWidget extends WidgetType {
	constructor(at, folded) { super(); this.at = at; this.folded = folded; }
	eq(o) { return o.at === this.at && o.folded === this.folded; }
	toDOM(view) {
		const b = document.createElement("button");
		b.type = "button";
		b.className = "md-callout-fold" + (this.folded ? " folded" : "");
		b.textContent = "›";
		b.setAttribute("aria-label", this.folded ? "Show callout" : "Fold callout");
		b.addEventListener("mousedown", (e) => {
			e.preventDefault();
			view.dispatch({ effects: toggle.of(this.at) });
		});
		return b;
	}
	ignoreEvent() { return true; }
}

class MoreWidget extends WidgetType {
	eq() { return true; }
	toDOM() {
		const s = document.createElement("span");
		s.className = "md-callout-more";
		s.textContent = "…";
		return s;
	}
}

const lastLine = Decoration.line({ class: "md-last md-callout-folded" });

// The foldable callouts in a state: [{ from, titleEnd, to, folded }].
export function foldables(state) {
	const out = [];
	const doc = state.doc;
	const flips = state.field(flipped, false) || new Set();
	syntaxTree(state).iterate({
		enter(n) {
			if (n.name !== "Blockquote") return;
			const first = doc.lineAt(n.from);
			const c = calloutOf(first.text);
			if (c && c.fold) {
				const last = doc.lineAt(n.to);
				out.push({ from: first.from, titleEnd: first.to, to: last.to, folded: (c.fold === "-") !== flips.has(first.from) });
			}
			return false;
		},
	});
	return out;
}

const decorations = StateField.define({
	create: (state) => build(state),
	update(deco, tr) {
		if (tr.docChanged || tr.effects.some((e) => e.is(toggle)) || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

function build(state) {
	const b = new RangeSetBuilder();
	for (const c of foldables(state)) {
		const hide = c.folded && c.to > c.titleEnd;
		if (hide) b.add(c.from, c.from, lastLine);
		b.add(c.titleEnd, c.titleEnd, Decoration.widget({ widget: new ChevronWidget(c.from, c.folded), side: -1 }));
		if (hide) b.add(c.titleEnd, c.to, Decoration.replace({ widget: new MoreWidget() }));
	}
	return b.finish();
}

export const calloutFolds = [flipped, decorations, EditorView.atomicRanges.of((view) => view.state.field(decorations))];
