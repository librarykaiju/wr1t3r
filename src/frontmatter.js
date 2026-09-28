// Frontmatter ("properties"): drawn as a box that folds, with a button to add
// a property. Adding only ever inserts one new line (and the two fences when a
// note has no frontmatter yet); existing keys, their order and formatting are
// untouched, and folding is display only.

import { snippet } from "@codemirror/autocomplete";
import { StateField, StateEffect, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";

const FENCE = /^---[ \t]*$/;
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/;

// The frontmatter's line numbers in a CodeMirror Text: { open, close } (the
// fence lines, 1-based), or null when the note has none or it's never closed.
export function frontmatterLines(doc) {
	if (doc.lines < 2 || !FENCE.test(doc.line(1).text)) return null;
	for (let n = 2; n <= doc.lines; n++) {
		if (CLOSE.test(doc.line(n).text)) return { open: 1, close: n };
	}
	return null;
}

// The edit (as a snippet and where it goes) that adds a property. With
// frontmatter, the new "key: " line goes just above the closing fence;
// without, a new block goes at the very top of the note.
export function propertyEdit(doc, template = "${key}: ${}") {
	const fm = frontmatterLines(doc);
	if (fm) return { at: doc.line(fm.close).from, text: template + "\n" };
	return { at: 0, text: "---\n" + template + "\n---\n" };
}

// Command: add a property and put the cursor on its name. Tab moves to the value.
export function addProperty(view) {
	if (view.state.readOnly) return false;
	if (view.state.field(folded, false)) view.dispatch({ effects: setFolded.of(false) });
	const { at, text } = propertyEdit(view.state.doc);
	snippet(text)(view, null, at, at);
	view.focus();
	return true;
}

// Top-level "key:" lines between the fences.
export function propertyCount(doc, fm) {
	let n = 0;
	for (let i = fm.open + 1; i < fm.close; i++) if (/^[^\s#-][^:]*:/.test(doc.line(i).text)) n++;
	return n;
}

// Folded or not is one setting for every note, remembered on this device.
const FOLD_KEY = "wr1t3rPropsFolded";
const remembered = () => { try { return localStorage.getItem(FOLD_KEY) === "1"; } catch { return false; } };
const remember = (v) => { try { localStorage.setItem(FOLD_KEY, v ? "1" : "0"); } catch {} };

const setFolded = StateEffect.define();
const folded = StateField.define({
	create: () => remembered(),
	update(value, tr) {
		for (const e of tr.effects) if (e.is(setFolded)) value = e.value;
		// Something put the cursor inside the folded block (search, undo): open it.
		if (value && tr.selection) {
			const fm = frontmatterLines(tr.state.doc);
			if (fm) {
				const from = tr.state.doc.line(fm.open).to, to = tr.state.doc.line(fm.close).from;
				if (tr.state.selection.ranges.some((r) => r.head > from && r.head < to)) value = false;
			}
		}
		return value;
	},
});

class FmWidget extends WidgetType {
	// kind: "open" (the Properties header), "folded" (header with a count), "add" (the button).
	constructor(kind, count = 0) { super(); this.kind = kind; this.count = count; }
	eq(o) { return o.kind === this.kind && o.count === this.count; }
	toDOM() {
		const b = document.createElement("button");
		b.type = "button";
		if (this.kind === "add") {
			b.className = "md-fm-add";
			b.textContent = "+ Add property";
		} else {
			b.className = "md-fm-toggle";
			b.setAttribute("aria-expanded", String(this.kind === "open"));
			b.textContent = this.kind === "open" ? "▾ Properties" : `▸ Properties · ${this.count}`;
		}
		return b;
	}
	ignoreEvent() { return false; }
}

function decorate(state) {
	const doc = state.doc;
	const fm = frontmatterLines(doc);
	if (!fm) return Decoration.none;
	const open = doc.line(fm.open), close = doc.line(fm.close);
	const b = new RangeSetBuilder();
	if (state.field(folded)) {
		b.add(open.from, open.from, Decoration.line({ class: "md-fm md-fm-fence md-first md-last" }));
		b.add(open.from, close.to, Decoration.replace({ widget: new FmWidget("folded", propertyCount(doc, fm)), atomic: true }));
		return b.finish();
	}
	// The fence lines show as "---" while the cursor is on them, so they can be edited.
	const editing = new Set();
	for (const r of state.selection.ranges) {
		for (let n = doc.lineAt(r.from).number, last = doc.lineAt(r.to).number; n <= last; n++) editing.add(n);
	}
	for (let n = fm.open; n <= fm.close; n++) {
		const l = doc.line(n);
		const fence = n === fm.open || n === fm.close;
		const cls = "md-fm" + (fence ? " md-fm-fence" : "") + (n === fm.open ? " md-first" : "") + (n === fm.close ? " md-last" : "");
		b.add(l.from, l.from, Decoration.line({ class: cls }));
		if (fence && !editing.has(n)) b.add(l.from, l.to, Decoration.replace({ widget: new FmWidget(n === fm.open ? "open" : "add"), atomic: true }));
	}
	return b.finish();
}

const decorations = StateField.define({
	create: decorate,
	update(value, tr) {
		const refold = tr.effects.some((e) => e.is(setFolded)) || tr.startState.field(folded) !== tr.state.field(folded);
		return tr.docChanged || tr.selection || refold ? decorate(tr.state) : value;
	},
	provide: (f) => [
		EditorView.decorations.from(f),
		EditorView.atomicRanges.of((view) => {
			const b = new RangeSetBuilder();
			view.state.field(f).between(0, view.state.doc.length, (from, to, d) => { if (d.spec.atomic) b.add(from, to, d); });
			return b.finish();
		}),
	],
});

const clicks = EditorView.domEventHandlers({
	mousedown(e, view) {
		const t = e.target;
		if (t.classList?.contains("md-fm-toggle")) {
			e.preventDefault();
			const next = !view.state.field(folded);
			remember(next);
			view.dispatch({ effects: setFolded.of(next) });
			return true;
		}
		if (t.classList?.contains("md-fm-add")) {
			e.preventDefault();
			addProperty(view);
			return true;
		}
		return false;
	},
});

export const frontmatterStyle = [folded, decorations, clicks];
