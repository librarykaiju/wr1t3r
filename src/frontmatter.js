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
//   tags: <pills>|   -> a new "key: " line after the last tag
export function propertyEnter(doc, pos) {
	const fm = frontmatterLines(doc);
	if (!fm) return null;
	const line = doc.lineAt(pos);
	if (line.number <= fm.open || line.number >= fm.close) return null;
	const tagsLine = /^tags?:/.test(line.text);
	if (pos !== line.to && !tagsLine) return null;
	const t = line.text;
	// The tags line: its items are drawn as pills, so the next property goes after them.
	if (/^tags?:/.test(t)) {
		const tags = tagsIn(doc, fm);
		return { from: tags.to, to: tags.to, template: "\n${key}: ${}" };
	}
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
//   tags:                  (form "list")
//     - novel
//   tags: [novel, draft]   (form "flow"; also "tags: novel, draft" or bare words)
// -> { form, first, last } (its line numbers), the stretch the pills are drawn
// over ({ from, to }: the value, or everything after "tags:" through the last
// item), the tags without quotes or "#", and for lists each item's line.
// Null when the note has no tags property.
const cleanTag = (t) => t.trim().replace(/^["']|["']$/g, "").replace(/^#/, "").trim();
export function tagsIn(doc, fm) {
	for (let n = fm.open + 1; n < fm.close; n++) {
		const l = doc.line(n);
		const m = l.text.match(/^tags?:[ \t]*/);
		if (!m) continue;
		const value = l.text.slice(m[0].length);
		if (value.trim()) {
			const inner = value.trim().replace(/^\[|\]$/g, "");
			const tags = inner.split(inner.includes(",") ? "," : /\s+/).map(cleanTag).filter(Boolean);
			return { form: "flow", first: n, last: n, from: l.from + m[0].length, to: l.to, tags, value };
		}
		const tags = [], items = [];
		let last = n, indent = "  ";
		for (let i = n + 1; i < fm.close; i++) {
			const item = doc.line(i).text.match(/^(\s+)-\s*(.*)$/);
			if (!item) break;
			indent = item[1];
			if (cleanTag(item[2])) { tags.push(cleanTag(item[2])); items.push(i); }
			last = i;
		}
		return { form: "list", first: n, last, from: l.to, to: doc.line(last).to, tags, items, indent };
	}
	return null;
}

// Flow values are rewritten in the shape they had: [a, b], "a, b" or "a b".
function flowValue(old, tags) {
	if (!tags.length) return "";
	if (/^\s*\[/.test(old)) return "[" + tags.join(", ") + "]";
	return tags.join(old.includes(",") ? ", " : " ");
}

// A tag as typed into the add box: no "#", no spaces (Obsidian tags can't have them).
export const tagName = (s) => cleanTag(s).replace(/\s+/g, "-");

// The edit that removes tag i, or adds a tag. For lists that's one item line;
// for flow values, just that line's value.
export function tagRemoveEdit(doc, t, i) {
	if (t.form === "list") {
		const line = doc.line(t.items[i]);
		return { from: doc.line(t.items[i] - 1).to, to: line.to, insert: "" };
	}
	return { from: t.from, to: t.to, insert: flowValue(t.value, t.tags.filter((_, k) => k !== i)) };
}
export function tagAddEdit(doc, t, name) {
	if (t.form === "list") return { from: t.to, to: t.to, insert: "\n" + t.indent + "- " + name };
	return { from: t.from, to: t.to, insert: flowValue(t.value, [...t.tags, name]) };
}

// Same tag, same color, everywhere.
export function tagHue(tag) {
	let h = 0;
	for (const c of tag.toLowerCase()) h = (h * 31 + c.codePointAt(0)) >>> 0;
	return h % 8;
}

// The tags as pills, each with a remove button, and a box to add one. Editing
// happens here rather than in the text, so the pills stay while you work.
class TagsWidget extends WidgetType {
	constructor(tags) { super(); this.tags = tags; }
	eq(o) { return o.tags.join("\n") === this.tags.join("\n"); }
	toDOM(view) {
		const wrap = document.createElement("span");
		wrap.className = "md-tags";
		const apply = (edit) => {
			const fm = frontmatterLines(view.state.doc);
			const t = fm && tagsIn(view.state.doc, fm);
			if (!t || view.state.readOnly) return;
			view.dispatch({ changes: edit(view.state.doc, t), userEvent: "input.tags" });
			// The pills are redrawn; put the typing back in the new add box.
			requestAnimationFrame(() => view.dom.querySelector(".md-tag-input")?.focus());
		};
		this.tags.forEach((t, i) => {
			const pill = document.createElement("span");
			pill.className = `md-tag md-tag-${tagHue(t)}`;
			pill.textContent = t;
			const x = document.createElement("button");
			x.type = "button";
			x.className = "md-tag-x";
			x.textContent = "×";
			x.setAttribute("aria-label", `Remove tag ${t}`);
			x.addEventListener("mousedown", (e) => { e.preventDefault(); apply((doc, tags) => tagRemoveEdit(doc, tags, i)); });
			pill.append(x);
			wrap.append(pill);
		});
		const input = document.createElement("input");
		input.className = "md-tag-input";
		input.placeholder = "+ tag";
		input.setAttribute("aria-label", "Add a tag");
		input.size = 6;
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === ",") {
				e.preventDefault();
				const name = tagName(input.value);
				if (name) apply((doc, tags) => tagAddEdit(doc, tags, name));
			} else if (e.key === "Backspace" && !input.value && this.tags.length) {
				e.preventDefault();
				apply((doc, tags) => tagRemoveEdit(doc, tags, tags.tags.length - 1));
			} else if (e.key === "Escape") {
				view.focus();
			}
		});
		wrap.append(input);
		return wrap;
	}
	// The pills handle their own clicks and typing.
	ignoreEvent() { return true; }
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
	// The styling stays put while editing: fences are always the header and
	// the add button, and tags always pills (edited through the pills).
	const pills = tagsIn(doc, fm);
	for (let n = fm.open; n <= fm.close; n++) {
		if (pills && n > pills.first && n <= pills.last) continue; // folded into the pills line
		const l = doc.line(n);
		const fence = n === fm.open || n === fm.close;
		const cls = "md-fm" + (fence ? " md-fm-fence" : "") + (n === fm.open ? " md-first" : "") + (n === fm.close ? " md-last" : "");
		b.add(l.from, l.from, Decoration.line({ class: cls }));
		if (fence) b.add(l.from, l.to, Decoration.replace({ widget: new FmWidget(n === fm.open ? "open" : "add"), atomic: true }));
		if (pills && n === pills.first) b.add(pills.from, pills.to, Decoration.replace({ widget: new TagsWidget(pills.tags), atomic: true }));
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

export const frontmatterStyle = [folded, decorations, clicks, Prec.high(keymap.of([{ key: "Enter", run: enter }]))];
