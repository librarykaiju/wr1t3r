// Frontmatter ("properties"): drawn as a box that folds, with a button to add
// a property. Values get Obsidian's editors where their type is plain from the
// text: a checkbox for true/false, a date picker for dates, pills for lists;
// each edit rewrites only that value. Adding only ever inserts one new line (and the two fences when a
// note has no frontmatter yet); existing keys, their order and formatting are
// untouched, and folding is display only.

import { snippet } from "@codemirror/autocomplete";
import { StateField, StateEffect, RangeSetBuilder, Prec, Text } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, keymap } from "@codemirror/view";
import { linkOpener } from "./links.js";

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
		if (/^tags?:/.test(doc.line(n).text)) return listAt(doc, n, { loose: true, clean: cleanTag });
	}
	return null;
}

// The list property whose "key:" is on line n, in the same shape as tagsIn
// (items as "values"-free "tags"), plus blank: the first "- " item with nothing
// in it (templates leave '- ""'), which adding fills in. loose: a bare value
// like "a, b" or "a b" counts as a list (only for tags); otherwise only
// [a, b] or "- " items do. Null when the property isn't a list.
// "a, 'b, c', "d"" -> ["a", " 'b, c'", ' "d"']: commas inside quotes don't split.
function splitFlow(text) {
	const out = [];
	let cur = "", q = null;
	for (const ch of text) {
		if (q) { if (ch === q) q = null; cur += ch; }
		else if (ch === '"' || ch === "'") { q = ch; cur += ch; }
		else if (ch === ",") { out.push(cur); cur = ""; }
		else cur += ch;
	}
	out.push(cur);
	return out;
}
const cleanItem = (t) => t.trim().replace(/^"(.*)"$|^'(.*)'$/, "$1$2").trim();
export function listAt(doc, n, { loose = false, clean = cleanItem } = {}) {
	const l = doc.line(n);
	const m = l.text.match(/^[^\s#-][^:]*:[ \t]*/);
	if (!m) return null;
	const value = l.text.slice(m[0].length);
	if (value.trim()) {
		if (!loose && !/^\[.*\]\s*$/.test(value.trim())) return null;
		const inner = value.trim().replace(/^\[|\]$/g, "");
		const parts = (inner.includes(",") || !loose ? splitFlow(inner) : inner.split(/\s+/)).map((x) => x.trim()).filter((x) => clean(x));
		return { form: "flow", first: n, last: n, from: l.from + m[0].length, to: l.to, tags: parts.map(clean), raw: parts, value };
	}
	const tags = [], items = [];
	let last = n, indent = "  ", blank = null;
	for (let i = n + 1; i <= doc.lines; i++) {
		const item = doc.line(i).text.match(/^(\s+)-(?:\s+(.*))?$/);
		if (!item) break;
		indent = item[1];
		if (clean(item[2] || "")) { tags.push(clean(item[2])); items.push(i); }
		else if (blank == null) blank = i;
		last = i;
	}
	if (!loose && last === n) return null;
	return { form: "list", first: n, last, from: l.to, to: doc.line(last).to, tags, items, indent, blank };
}

// All of a note's tags: the tags property plus #tags in the text (outside code).
export function noteTags(text) {
	const doc = Text.of(text.split(/\r?\n/));
	const fm = frontmatterLines(doc);
	const out = fm ? [...(tagsIn(doc, fm)?.tags || [])] : [];
	const body = fm ? text.split(/\r?\n/).slice(fm.close).join("\n") : text;
	const prose = body.replace(/^(```|~~~)[\s\S]*?^\1/gm, "").replace(/`[^`\n]*`/g, "");
	for (const m of prose.matchAll(/(?<=^|\s)#([\p{L}_][\p{L}\p{N}_\/-]*)/gu)) out.push(m[1]);
	return out;
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
	return { from: t.from, to: t.to, insert: flowValue(t.value, (t.raw || t.tags).filter((_, k) => k !== i)) };
}
export function tagAddEdit(doc, t, name) {
	if (t.form === "list" && t.blank != null) { const b = doc.line(t.blank); return { from: b.from, to: b.to, insert: t.indent + "- " + name }; }
	if (t.form === "list") return { from: t.to, to: t.to, insert: "\n" + t.indent + "- " + name };
	return { from: t.from, to: t.to, insert: flowValue(t.value, [...(t.raw || t.tags), name]) };
}

// A list item as YAML: quoted when it would otherwise read as something else
// (a colon-space, a comment, a leading symbol, or a comma inside [a, b]).
export function yamlItem(text, flow = false) {
	return /^[\s\-?:,\[\]{}#&*!|>'"%@`]|: | #|\s$/.test(text) || (flow && /[,\[\]{}]/.test(text)) ? JSON.stringify(text) : text;
}

// Same tag, same color, everywhere.
export function tagHue(tag) {
	let h = 0;
	for (const c of tag.toLowerCase()) h = (h * 31 + c.codePointAt(0)) >>> 0;
	return h % 8;
}

// Typed values, read from the text the way Obsidian's property types show
// them: true/false as a checkbox, dates and date-times as pickers, lists as
// pills. [{ key, line, type, from, to, value, quote, list }] for the note's
// top-level properties (tags aside: they have their own pills). An empty value
// counts as a date when the key sounds like one (date, created, due, ...).
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$/;
const DATE_KEY = /(^|[_ -])(date|day|created|updated|modified|due|published|start|end)([_ -]|$)|date$/i;
export function propertiesIn(doc, fm) {
	const out = [];
	for (let n = fm.open + 1; n < fm.close; n++) {
		const l = doc.line(n);
		const m = l.text.match(/^([^\s#-][^:]*):[ \t]*/);
		if (!m || /^tags?$/.test(m[1])) continue;
		const key = m[1];
		const from = l.from + m[0].length;
		const raw = l.text.slice(m[0].length).replace(/[ \t]+$/, "");
		const to = from + raw.length;
		const list = listAt(doc, n);
		if (list) { out.push({ key, line: n, type: "list", from: list.from, to: list.to, list }); n = list.last; continue; }
		const q = raw.match(/^(["'])(.*)\1$/);
		const value = q ? q[2] : raw;
		const quote = q ? q[1] : "";
		let type = "text";
		if (!q && /^(true|false)$/i.test(value)) type = "bool";
		else if (DATE.test(value)) type = "date";
		else if (DATETIME.test(value)) type = "datetime";
		else if (!value && DATE_KEY.test(key) && !(n + 1 < fm.close && /^\s/.test(doc.line(n + 1).text))) type = "date";
		if (type !== "text") out.push({ key, line: n, type, from, to, value, quote });
	}
	return out;
}

// The new text for a property's value, keeping its quotes and (for
// true/false) its capitals.
export function valueText(p, next) {
	if (p.type === "bool") {
		const word = next ? "true" : "false";
		return /^[A-Z]{2}/.test(p.value) ? word.toUpperCase() : /^[A-Z]/.test(p.value) ? word[0].toUpperCase() + word.slice(1) : word;
	}
	if (p.type === "datetime" && next && p.value.includes(" ")) next = next.replace("T", " ");
	if (p.type === "datetime" && next && /:\d{2}:\d{2}$/.test(p.value) && !/:\d{2}:\d{2}$/.test(next)) next += ":00";
	return next || !p.quote ? p.quote + next + p.quote : p.quote + p.quote;
}

// The property named key, found again at edit time (the text may have moved).
function propertyNamed(state, key) {
	const fm = frontmatterLines(state.doc);
	return fm ? propertiesIn(state.doc, fm).find((p) => p.key === key) || null : null;
}

// A checkbox for true/false.
class BoolWidget extends WidgetType {
	constructor(key, on) { super(); this.key = key; this.on = on; }
	eq(o) { return o.key === this.key && o.on === this.on; }
	toDOM(view) {
		const box = document.createElement("input");
		box.type = "checkbox";
		box.className = "md-prop-check";
		box.checked = this.on;
		box.setAttribute("aria-label", this.key);
		box.addEventListener("mousedown", (e) => e.stopPropagation());
		box.addEventListener("change", () => {
			const p = propertyNamed(view.state, this.key);
			if (!p || p.type !== "bool" || view.state.readOnly) { box.checked = this.on; return; }
			view.dispatch({ changes: { from: p.from, to: p.to, insert: valueText(p, box.checked) }, userEvent: "input.property" });
		});
		return box;
	}
	ignoreEvent() { return true; }
}

// A date or date-and-time picker.
class DateWidget extends WidgetType {
	constructor(key, type, value) { super(); this.key = key; this.type = type; this.value = value; }
	eq(o) { return o.key === this.key && o.type === this.type && o.value === this.value; }
	toDOM(view) {
		const input = document.createElement("input");
		input.type = this.type === "datetime" ? "datetime-local" : "date";
		input.className = "md-prop-date";
		input.value = this.type === "datetime" ? this.value.replace(" ", "T").slice(0, 16) : this.value;
		input.setAttribute("aria-label", this.key);
		input.addEventListener("mousedown", (e) => e.stopPropagation());
		input.addEventListener("change", () => {
			const p = propertyNamed(view.state, this.key);
			if (!p || (p.type !== "date" && p.type !== "datetime") || view.state.readOnly) return;
			let insert = valueText(p, input.value);
			if (p.from === p.to && view.state.sliceDoc(p.from - 1, p.from) === ":") insert = " " + insert;
			if (view.state.sliceDoc(p.from, p.to) !== insert) view.dispatch({ changes: { from: p.from, to: p.to, insert }, userEvent: "input.property" });
		});
		return input;
	}
	ignoreEvent() { return true; }
}

// The tags as pills, each with a remove button, and a box to add one. Editing
// happens here rather than in the text, so the pills stay while you work.
// Other list properties (key set) get the same pills, uncolored.
class TagsWidget extends WidgetType {
	constructor(tags, key = null) { super(); this.tags = tags; this.key = key; }
	eq(o) { return o.key === this.key && o.tags.join("\n") === this.tags.join("\n"); }
	toDOM(view) {
		const wrap = document.createElement("span");
		wrap.className = "md-tags";
		const which = this.key ? `[data-key="${CSS.escape(this.key)}"]` : ":not([data-key])";
		const apply = (edit) => {
			const fm = frontmatterLines(view.state.doc);
			const t = fm && (this.key ? propertyNamed(view.state, this.key)?.list : tagsIn(view.state.doc, fm));
			if (!t || view.state.readOnly) return;
			view.dispatch({ changes: edit(view.state.doc, t), userEvent: "input.tags" });
			// The pills are redrawn; put the typing back in the new add box.
			requestAnimationFrame(() => view.dom.querySelector(`.md-tag-input${which}`)?.focus());
		};
		this.tags.forEach((t, i) => {
			const pill = document.createElement("span");
			pill.className = this.key ? "md-tag md-item" : `md-tag md-tag-${tagHue(t)}`;
			pill.textContent = t;
			const x = document.createElement("button");
			x.type = "button";
			x.className = "md-tag-x";
			x.textContent = "×";
			x.setAttribute("aria-label", `Remove tag ${t}`);
			x.addEventListener("mousedown", (e) => { e.preventDefault(); apply((doc, tags) => tagRemoveEdit(doc, tags, i)); });
			pill.append(x);
			if (this.key) { wrap.append(pill); return; }
			pill.title = `Notes tagged #${t}`;
			pill.addEventListener("mousedown", (e) => {
				if (e.target !== pill) return;
				e.preventDefault();
				view.state.facet(linkOpener)?.({ tag: t });
			});
			wrap.append(pill);
		});
		const input = document.createElement("input");
		input.className = "md-tag-input";
		input.placeholder = this.key ? "+ add" : "+ tag";
		input.setAttribute("aria-label", this.key ? `Add to ${this.key}` : "Add a tag");
		if (this.key) input.dataset.key = this.key;
		input.size = 6;
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === ",") {
				e.preventDefault();
				const name = this.key ? input.value.trim() : tagName(input.value);
				if (name) apply((doc, tags) => tagAddEdit(doc, tags, this.key ? yamlItem(name, tags.form === "flow") : name));
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

// A new note's frontmatter, matching the vault's Note template
// (content/_templates/Note.md) so the site reads it the same way. The date is
// written once, when the note is made: without one, the site falls back to
// the file's creation time, which is new on every build.
export function newNoteFrontmatter(title, date) {
	return [
		"---",
		`title: ${JSON.stringify(title)}`,
		"publish: false",
		"tags:",
		"status: seed",
		`date: "${date}"`,
		"sticky: false",
		"callout:",
		"---",
		"",
	].join("\n");
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
// Whether the properties box is folded to its header line (src/pretty.js
// leaves the cover out then).
export const propertiesFolded = (state) => !!state.field(folded, false);
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
	const typed = new Map(propertiesIn(doc, fm).map((p) => [p.line, p]));
	const hidden = (n) => (pills && n > pills.first && n <= pills.last) || [...typed.values()].some((p) => p.list && n > p.list.first && n <= p.list.last);
	for (let n = fm.open; n <= fm.close; n++) {
		if (hidden(n)) continue; // folded into a pills line
		const l = doc.line(n);
		const fence = n === fm.open || n === fm.close;
		const cls = "md-fm" + (fence ? " md-fm-fence" : "") + (n === fm.open ? " md-first" : "") + (n === fm.close ? " md-last" : "");
		b.add(l.from, l.from, Decoration.line({ class: cls }));
		if (fence) b.add(l.from, l.to, Decoration.replace({ widget: new FmWidget(n === fm.open ? "open" : "add"), atomic: true }));
		if (pills && n === pills.first) b.add(pills.from, pills.to, Decoration.replace({ widget: new TagsWidget(pills.tags), atomic: true }));
		const p = typed.get(n);
		if (p) {
			const widget = p.type === "list" ? new TagsWidget(p.list.tags, p.key) : p.type === "bool" ? new BoolWidget(p.key, /^true$/i.test(p.value)) : new DateWidget(p.key, p.type, p.value);
			if (p.from === p.to) b.add(p.from, p.to, Decoration.widget({ widget, side: 1 }));
			else b.add(p.from, p.to, Decoration.replace({ widget, atomic: true }));
		}
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

// Folds a view's properties box without changing the remembered setting
// (Scrivenings' sections start folded so the text reads on).
export function foldProperties(view) {
	if (frontmatterLines(view.state.doc)) view.dispatch({ effects: setFolded.of(true) });
}

export const frontmatterStyle = [folded, decorations, clicks, Prec.high(keymap.of([{ key: "Enter", run: enter }]))];
