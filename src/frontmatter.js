// Frontmatter ("properties"): drawn as a box that folds, with a button to add
// a property. Adding only ever inserts one new line (and the two fences when a
// note has no frontmatter yet); existing keys, their order and formatting are
// untouched, and folding is display only.

import { snippet } from "@codemirror/autocomplete";
import { StateField, StateEffect, RangeSetBuilder, Prec } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, keymap } from "@codemirror/view";

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

// Enter at the end of a line inside the frontmatter: the edit that starts the
// next property (or list item), as { from, to, template }, or null to let Enter
// do what it normally does.
//   title: A|        -> a new "key: " line
//   tags:|           -> a list item under it
//     - novel|       -> another list item
//     - |            -> (empty item) replaced by a new "key: " line
export function propertyEnter(doc, pos) {
	const fm = frontmatterLines(doc);
	if (!fm) return null;
	const line = doc.lineAt(pos);
	if (line.number <= fm.open || line.number >= fm.close || pos !== line.to) return null;
	const t = line.text;
	if (/^\s+-\s*$/.test(t)) return { from: line.from, to: line.to, template: "${key}: ${}" };
	// snippet() carries the line's own indentation onto new lines, so none here.
	if (/^\s+- \S/.test(t)) return { from: pos, to: pos, template: "\n- ${}" };
	if (/^[^\s#-][^:]*:\s*$/.test(t)) return { from: pos, to: pos, template: "\n  - ${}" };
	if (/^[^\s#-][^:]*:\s*\S/.test(t)) return { from: pos, to: pos, template: "\n${key}: ${}" };
	return null;
}

function enter(view) {
	const sel = view.state.selection;
	if (view.state.readOnly || sel.ranges.length > 1 || !sel.main.empty) return false;
	const e = propertyEnter(view.state.doc, sel.main.head);
	if (!e) return false;
	snippet(e.template)(view, null, e.from, e.to);
	return true;
}

// The tags property, in either YAML form:
//   tags: [novel, draft]   (or "tags: novel, draft", or one bare tag)
//   tags:
//     - novel
// -> { first, last } (its line numbers), the stretch to draw pills over
// ({ from, to }: the value, or everything after "tags:" through the last
// item), and the tags without quotes or "#". Null when there's no tags
// property or it's empty.
export function tagsIn(doc, fm) {
	for (let n = fm.open + 1; n < fm.close; n++) {
		const l = doc.line(n);
		const m = l.text.match(/^tags?:[ \t]*/);
		if (!m) continue;
		const clean = (t) => t.trim().replace(/^["']|["']$/g, "").replace(/^#/, "").trim();
		const value = l.text.slice(m[0].length).replace(/\s+#.*$/, "");
		if (value.trim()) {
			const inner = value.trim().replace(/^\[|\]$/g, "");
			const tags = inner.split(inner.includes(",") ? "," : /\s+/).map(clean).filter(Boolean);
			return tags.length ? { first: n, last: n, from: l.from + m[0].length, to: l.to, tags } : null;
		}
		const tags = [];
		let last = n;
		for (let i = n + 1; i < fm.close; i++) {
			const item = doc.line(i).text.match(/^\s+-\s*(.*)$/);
			if (!item) break;
			if (clean(item[1])) tags.push(clean(item[1]));
			last = i;
		}
		return tags.length ? { first: n, last, from: l.to, to: doc.line(last).to, tags } : null;
	}
	return null;
}

// Same tag, same color, everywhere.
export function tagHue(tag) {
	let h = 0;
	for (const c of tag.toLowerCase()) h = (h * 31 + c.codePointAt(0)) >>> 0;
	return h % 8;
}

class TagsWidget extends WidgetType {
	constructor(tags, pos) { super(); this.tags = tags; this.pos = pos; }
	eq(o) { return o.pos === this.pos && o.tags.join("\n") === this.tags.join("\n"); }
	toDOM() {
		const wrap = document.createElement("span");
		wrap.className = "md-tags";
		wrap.dataset.pos = this.pos;
		for (const t of this.tags) {
			const pill = document.createElement("span");
			pill.className = `md-tag md-tag-${tagHue(t)}`;
			pill.textContent = t;
			wrap.append(pill);
		}
		return wrap;
	}
	ignoreEvent() { return false; }
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
	// Tags show as pills unless the cursor is in them; tapping the pills opens them for editing.
	const tags = tagsIn(doc, fm);
	let pills = tags;
	for (let n = tags?.first; pills && n <= tags.last; n++) if (editing.has(n)) pills = null;
	for (let n = fm.open; n <= fm.close; n++) {
		if (pills && n > pills.first && n <= pills.last) continue; // folded into the pills line
		const l = doc.line(n);
		const fence = n === fm.open || n === fm.close;
		const cls = "md-fm" + (fence ? " md-fm-fence" : "") + (n === fm.open ? " md-first" : "") + (n === fm.close ? " md-last" : "");
		b.add(l.from, l.from, Decoration.line({ class: cls }));
		if (fence && !editing.has(n)) b.add(l.from, l.to, Decoration.replace({ widget: new FmWidget(n === fm.open ? "open" : "add"), atomic: true }));
		if (pills && n === pills.first) b.add(pills.from, pills.to, Decoration.replace({ widget: new TagsWidget(pills.tags, pills.to), atomic: true }));
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
		const pills = t.closest?.(".md-tags");
		if (pills) {
			e.preventDefault();
			view.dispatch({ selection: { anchor: Number(pills.dataset.pos) } });
			view.focus();
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

export const frontmatterStyle = [folded, decorations, clicks, Prec.high(keymap.of([{ key: "Enter", run: enter }]))];
