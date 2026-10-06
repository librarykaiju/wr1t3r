// Frontmatter ("properties"): drawn as a box that folds. Each property is a
// row with a control for its type (a text box, a checkbox, a date picker, pills
// for lists and tags); clicking its name renames it, changes its type or
// removes it, and + Add property adds one with its type. The box is drawn over
// the YAML, so typing and Backspace never reach it; Toggle source shows the
// YAML as text. Each edit rewrites only the lines of the property it's about
// (src/properties.js), so other keys, their order and formatting stay as typed.

import { EditorState, StateField, StateEffect, RangeSetBuilder, Prec, Text, Facet } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, keymap } from "@codemirror/view";
import { snippet } from "@codemirror/autocomplete";
import { linkOpener } from "./links.js";
import { notePath, vaultHost, vaultChanged } from "./vault.js";
import { SITE_KEYS } from "./sitekeys.js";
import { TYPES, TYPE_LABELS, DATE_KEY, isTagsKey, readRows, itemsOf, setEdit, convertEdit, removeEdit, renameEdit, addEdit, keyProblem, suggest } from "./properties.js";

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

// Same tag, same color, everywhere: 0-6, one of the theme's rainbow colors
// (--f1..--f7, the sidebar's folder colors), so tags follow the theme.
export function tagHue(tag) {
	let h = 0;
	for (const c of tag.toLowerCase()) h = (h * 31 + c.codePointAt(0)) >>> 0;
	return h % 7;
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
		"eyebrow:",
		"---",
		"",
	].join("\n");
}

// A new note's text with its title as a "# " heading at the top of the body:
// the frontmatter's title, or the file name when it has none. A body that
// already opening with that heading is left alone; any other heading (a
// template's "# Notes") goes below it. The site hides a first heading that
// matches the title, since its pages print the title themselves.
export function withTitleHeading(text, fallback) {
	const fm = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/);
	const head = fm ? fm[0] : "", body = text.slice(head.length);
	const raw = head.match(/^title[ \t]*:[ \t]*(.*)$/m)?.[1].trim() ?? "";
	const title = raw.replace(/^(["'])(.*)\1$/, "$2").replace(/\\"/g, '"').trim() || fallback;
	if (!title) return text;
	const first = body.replace(/^\s+/, "").split(/\r?\n/, 1)[0];
	if (/^#[ \t]/.test(first) && first.replace(/^#[ \t]+|[ \t#]*$/g, "") === title) return text;
	return `${head}${head && !head.endsWith("\n") ? "\n" : ""}# ${title}\n\n${body.replace(/^\s*\n/, "")}`;
}

// Top-level "key:" lines between the fences.
export function propertyCount(doc, fm) {
	let n = 0;
	for (let i = fm.open + 1; i < fm.close; i++) if (/^[^\s#-][^:]*:/.test(doc.line(i).text)) n++;
	return n;
}

// Banner and cover properties (src/pretty.js) stay out of the box: they show
// once you click the banner or cover (or the box's "Images" button), or when
// something puts the cursor on one (the Banner image and Cover image commands).
export const IMAGE_KEYS = ["banner", "banner_position", "cover", "coverImage", "image", "thumbnail"];

// The image properties that have a value, as { first, last } line numbers
// (last > first when the value is a list under the key).
export function imagePropertyLines(doc, fm) {
	const out = [];
	for (let n = fm.open + 1; n < fm.close; n++) {
		const m = doc.line(n).text.match(/^([^\s#-][^:]*?)\s*:[ \t]*(.*)$/);
		if (!m || !IMAGE_KEYS.includes(m[1])) continue;
		let last = n;
		while (last + 1 < fm.close && /^\s+\S/.test(doc.line(last + 1).text)) last++;
		const hasValue = m[2].replace(/\s+#.*$/, "").trim() !== "" && !/^(""|''|\[\])$/.test(m[2].trim());
		if (hasValue || last > n) out.push({ first: n, last });
		n = last;
	}
	return out;
}

export const showImageProps = StateEffect.define();
// Whether the image properties are showing in this note's box.
export const imagePropsShown = (state) => !!state.field(imagesShown, false);
const imagesShown = StateField.define({
	create: () => false,
	update(value, tr) {
		for (const e of tr.effects) if (e.is(showImageProps)) value = e.value;
		// A click lands beside a hidden line, never in it, so only a cursor
		// put there by a command (or search, or undo) shows them.
		if (!value && tr.selection && !tr.isUserEvent("select.pointer")) {
			const fm = frontmatterLines(tr.state.doc);
			const doc = tr.state.doc;
			if (fm && imagePropertyLines(doc, fm).some((g) => tr.state.selection.ranges.some((r) => r.head >= doc.line(g.first).from && r.head <= doc.line(g.last).to))) value = true;
		}
		return value;
	},
});

// The properties box starts hidden, shown as a small "Properties" button at
// the top of the note, except in logs/, sketchbooks/ and catalog/, whose properties
// (covers, ratings, shelves) are what the notes are for. A planner page
// (src/plannerview.js) hides it with no button at all; the planner's header
// has one. Showing or hiding it is remembered per note until the page reloads.
const SHOWN_FOLDERS = /(^|\/)(logs|sketchbooks|catalog)\//i;
const PLANNER_FENCE = /(^|\n)```wr1t3r-planner[ \t]*\r?\n/;
export const isPlannerPage = (doc) => PLANNER_FENCE.test(doc.sliceString(0, Math.min(doc.length, 20000)));
const chosen = new Map(); // path -> hidden

function startsHidden(state) {
	const path = state.facet(notePath);
	if (path && chosen.has(path)) return chosen.get(path);
	return isPlannerPage(state.doc) || !SHOWN_FOLDERS.test(path || "");
}

const setFolded = StateEffect.define();
// Whether the properties box is hidden (src/pretty.js leaves the cover out then).
export const propertiesFolded = (state) => !!state.field(folded, false);
// Shows or hides the box, remembering the choice for the note.
export function setPropertiesHidden(view, hidden) {
	const path = view.state.facet(notePath);
	if (path) chosen.set(path, hidden);
	view.dispatch({ effects: setFolded.of(hidden) });
}
const folded = StateField.define({
	create: startsHidden,
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

// ---- The drawn box ------------------------------------------------------------
//
// The frontmatter is drawn as one box (a block widget over its lines), so the
// cursor, typing and Backspace never reach the YAML: each property is a row,
// its name a button (Rename, Type, Remove) and its value a control for its
// type (src/properties.js reads them and makes the edits). Toggle source
// shows the YAML as text instead, for what the box can't edit.

// The vault-wide property types ({ key: type }), from the vault host, with
// the ones just chosen here on top until the vault has saved them.
const chosenTypes = {};
const typesOf = (state) => ({ ...(state.facet(vaultHost)?.propertyTypes?.() || {}), ...chosenTypes });
function chooseType(view, key, type) {
	chosenTypes[key] = type;
	view.state.facet(vaultHost)?.setPropertyType?.(key, type);
}

const setSource = StateEffect.define();
// Whether the box shows its YAML as text (Toggle source).
const source = StateField.define({
	create: () => false,
	update(v, tr) {
		for (const e of tr.effects) if (e.is(setSource)) v = e.value;
		return v;
	},
});

const setAdding = StateEffect.define();
// Whether the box's "new property" row is open (in a note with no
// frontmatter yet, the box shows just for it).
const adding = StateField.define({
	create: () => false,
	update(v, tr) {
		for (const e of tr.effects) if (e.is(setAdding)) v = e.value;
		return v;
	},
});

// Redraws the box when the types change.
const typesChanged = StateEffect.define();

// A cover beside the box (src/pretty.js provides it): { info(state) -> null |
// { src, shape, position, width }, dom(view, info) -> element }.
export const boxCover = Facet.define({ combine: (v) => v[0] || null });

// Where to put the focus once the box is drawn again: { key, part } per view.
const pendingFocus = new WeakMap();
function focusLater(view, key, part = "value") {
	pendingFocus.set(view, { key, part });
}
function takeFocus(view, dom) {
	const want = pendingFocus.get(view);
	if (!want) return;
	pendingFocus.delete(view);
	requestAnimationFrame(() => {
		const sel = want.part === "add" ? ".md-props-new input" : `.md-prop[data-key="${CSS.escape(want.key)}"] :is(.md-tag-input, textarea, input)`;
		dom.querySelector(sel)?.focus();
	});
}

const ICONS = { text: "Aa", list: "☰", tags: "#", number: "12", checkbox: "☑", date: "▦", datetime: "◷", yaml: "{}" };

// What the box shows, as plain data (so redraws can compare it).
function boxSpec(state, rows) {
	const doc = state.doc;
	const fm = frontmatterLines(doc);
	const images = fm ? imagePropertyLines(doc, fm) : [];
	const showImages = state.field(imagesShown);
	const hiddenLines = new Set();
	if (!showImages) for (const g of images) for (let n = g.first; n <= g.last; n++) hiddenLines.add(n);
	const cover = state.facet(boxCover);
	return {
		rows: rows.filter((r) => !hiddenLines.has(r.first)).map((r) => ({ key: r.key, type: r.type, value: r.value, items: r.items, mismatch: r.mismatch, raw: r.kind === "yaml" ? doc.sliceString(doc.line(r.first).from, r.to) : "" })),
		images: images.length ? showImages : null,
		readOnly: state.readOnly,
		adding: state.field(adding),
		cover: (fm && cover?.info(state)) || null,
	};
}
const shape = (spec) => JSON.stringify([spec.rows.map((r) => [r.key, r.type, r.mismatch, r.raw]), spec.images, spec.readOnly, spec.adding, spec.cover]);

// The property named key as it is now (the text may have moved).
function rowNamed(state, key) {
	const fm = frontmatterLines(state.doc);
	return fm ? readRows(state.doc, fm, typesOf(state)).find((r) => r.key === key) || null : null;
}
function edit(view, change, effects = []) {
	if (view.state.readOnly) return;
	view.dispatch({ changes: change, effects, userEvent: "input.property" });
}

function el(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text != null) e.textContent = text;
	return e;
}

class BoxWidget extends WidgetType {
	constructor(spec) { super(); this.spec = spec; }
	eq(o) { return JSON.stringify(o.spec) === JSON.stringify(this.spec); }
	toDOM(view) {
		const box = el("div", "md-props" + (this.spec.readOnly ? " md-props-ro" : ""));
		box.wr1t3rShape = shape(this.spec);
		const head = el("div", "md-props-head");
		const fold = el("button", "md-fm-toggle", "▾ Properties");
		fold.type = "button";
		fold.title = "Hide the properties";
		head.append(fold, el("span", "md-props-space"));
		if (!this.spec.readOnly) {
			const src = el("button", "md-props-source", "Toggle source");
			src.type = "button";
			src.title = "Show the properties as YAML text";
			head.append(src);
		}
		box.append(head);
		const body = el("div", "md-props-body");
		const c = this.spec.cover;
		if (c) {
			body.classList.add("md-props-cover-" + c.position);
			body.style.setProperty("--cover-w", c.width + "px");
			const cover = view.state.facet(boxCover).dom(view, c);
			body.append(cover);
		}
		const list = el("div", "md-props-rows");
		for (const r of this.spec.rows) list.append(rowDOM(view, r, this.spec.readOnly));
		if (this.spec.adding && !this.spec.readOnly) list.append(newRowDOM(view));
		body.append(list);
		box.append(body);
		if (!this.spec.readOnly) {
			const foot = el("div", "md-props-foot");
			if (!this.spec.adding) {
				const add = el("button", "md-fm-add", "+ Add property");
				add.type = "button";
				foot.append(add);
			}
			if (this.spec.images != null) {
				const img = el("button", "md-fm-images", this.spec.images ? "Hide image properties" : "Image properties");
				img.type = "button";
				img.setAttribute("aria-pressed", String(this.spec.images));
				foot.append(img);
			}
			if (foot.childNodes.length) box.append(foot);
		}
		box.addEventListener("mousedown", (e) => {
			const t = e.target;
			if (t.closest(".md-fm-toggle")) { e.preventDefault(); setPropertiesHidden(view, true); }
			else if (t.closest(".md-props-source")) { e.preventDefault(); view.dispatch({ effects: setSource.of(true) }); }
			else if (t.closest(".md-fm-images")) { e.preventDefault(); view.dispatch({ effects: showImageProps.of(!view.state.field(imagesShown)) }); }
			else if (t.closest(".md-fm-add")) { e.preventDefault(); openAdd(view); }
		});
		// Text boxes grow with their text, so they're measured again when the box's width changes.
		if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => box.querySelectorAll(".md-prop-text").forEach(fitText)).observe(box);
		takeFocus(view, box);
		return box;
	}
	// Same rows, same types: values change in place, so a box being typed in
	// keeps its focus and cursor.
	updateDOM(dom, view) {
		if (dom.wr1t3rShape !== shape(this.spec)) return false;
		for (const r of this.spec.rows) {
			const row = dom.querySelector(`.md-prop[data-key="${CSS.escape(r.key)}"]`);
			if (!row) return false;
			const old = row.querySelector(".md-prop-val");
			if (old.contains(document.activeElement) && r.type !== "list" && r.type !== "tags") continue;
			const fresh = valueDOM(view, r, this.spec.readOnly);
			const had = old.contains(document.activeElement);
			old.replaceWith(fresh);
			if (had) fresh.querySelector(".md-tag-input")?.focus();
		}
		takeFocus(view, dom);
		return true;
	}
	ignoreEvent() { return true; }
}

// Suggestions under a box as it's typed in (the vault's property names, or
// the values a property has in other notes). The first one is picked when it
// starts with what's typed: Enter or Tab takes it, ↑ ↓ choose another, Escape
// hides them. With none picked, what's typed stays as typed.
// options(typed) -> [{ text, prefix }]; empty: show them before anything's
// typed; take(): what a click does after filling the box in (Enter's job).
function typeAhead(input, options, { empty = false, take = null } = {}) {
	let box = null, items = [], active = -1;
	const close = () => { box?.remove(); box = null; items = []; active = -1; };
	const draw = () => {
		box.replaceChildren(...items.map((s, i) => {
			const b = el("div", "md-suggest-item" + (i === active ? " active" : ""), s.text);
			b.setAttribute("role", "option");
			b.setAttribute("aria-selected", String(i === active));
			b.addEventListener("mousedown", (e) => { e.preventDefault(); fill(s.text); take?.(); });
			return b;
		}));
		const r = input.getBoundingClientRect();
		box.style.left = r.left + "px";
		box.style.top = r.bottom + 4 + "px";
		box.style.minWidth = Math.min(Math.max(r.width, 160), innerWidth - 16) + "px";
		box.style.left = Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8)) + "px";
		box.querySelector(".active")?.scrollIntoView({ block: "nearest" });
	};
	const open = () => {
		const typed = input.value.trim();
		if (!input.isConnected || document.activeElement !== input || (!typed && !empty)) return close();
		items = options(typed).filter((s) => s.text !== typed);
		if (!items.length) return close();
		active = typed && items[0].prefix ? 0 : -1;
		if (!box) {
			document.querySelector(".md-suggest")?.remove();
			box = el("div", "md-suggest");
			box.setAttribute("role", "listbox");
			document.body.append(box);
		}
		draw();
	};
	let filling = false;
	const fill = (text) => {
		close();
		input.value = text;
		filling = true;
		input.dispatchEvent(new Event("input", { bubbles: true }));
		filling = false;
	};
	input.setAttribute("autocomplete", "off");
	input.addEventListener("input", () => { if (!filling) open(); });
	input.addEventListener("focus", open);
	input.addEventListener("blur", close);
	input.addEventListener("keydown", (e) => {
		if (!box || e.isComposing) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			e.stopImmediatePropagation();
			const n = items.length;
			active = e.key === "ArrowDown" ? (active + 1) % n : active <= 0 ? n - 1 : active - 1;
			draw();
		} else if (e.key === "Tab" && active >= 0 && !e.shiftKey) {
			e.preventDefault();
			e.stopImmediatePropagation();
			fill(items[active].text);
		} else if (e.key === "Enter" && active >= 0) {
			fill(items[active].text); // then the box's own Enter runs with it
		} else if (e.key === "Escape") {
			e.preventDefault();
			e.stopImmediatePropagation();
			close();
		}
	});
}

// The vault's property names and values ({ names, values }, src/properties.js).
const usageOf = (state) => state.facet(vaultHost)?.propertyUsage?.() || { names: new Map(), values: new Map() };

// Suggestions for a property's values: the ones it has in other notes.
const valueOptions = (view, key, skip = () => []) => (typed) => suggest(usageOf(view.state).values.get(key), typed, { skip: skip() });

const fitText = (t) => { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; };

function rowDOM(view, r, readOnly) {
	const row = el("div", "md-prop" + (r.mismatch ? " md-prop-mismatch" : ""));
	row.dataset.key = r.key;
	const key = el(readOnly ? "span" : "button", "md-prop-key");
	if (!readOnly) { key.type = "button"; key.title = "Rename, change the type or remove"; }
	key.append(el("span", "md-prop-icon", ICONS[r.type] || "Aa"), el("span", "md-prop-name", r.key));
	if (r.mismatch) key.title = `This value isn't a ${TYPE_LABELS[typesOf(view.state)[r.key]] || "match"}; it shows as ${TYPE_LABELS[r.type]}`;
	if (!readOnly) key.addEventListener("click", () => keyMenu(view, r.key, key));
	row.append(key, valueDOM(view, r, readOnly));
	return row;
}

// The control for a row's value.
function valueDOM(view, r, readOnly) {
	const wrap = el("div", "md-prop-val");
	const set = (value) => { const now = rowNamed(view.state, r.key); if (now) edit(view, setEdit(now, value)); };
	const next = (from) => {
		const rows = [...from.closest(".md-props-rows").querySelectorAll(".md-prop")];
		const at = rows.indexOf(from.closest(".md-prop"));
		const to = rows[at + 1]?.querySelector(":is(textarea, input)");
		if (to) to.focus(); else openAdd(view);
	};
	if (r.type === "checkbox") {
		const box = el("input", "md-prop-check");
		box.type = "checkbox";
		box.checked = /^true$/i.test(r.value);
		box.disabled = readOnly;
		box.setAttribute("aria-label", r.key);
		box.addEventListener("change", () => set(box.checked));
		wrap.append(box);
	} else if (r.type === "date" || r.type === "datetime") {
		const input = el("input", "md-prop-date");
		input.type = r.type === "datetime" ? "datetime-local" : "date";
		input.value = r.type === "datetime" ? r.value.replace(" ", "T").slice(0, 16) : r.value.slice(0, 10);
		input.disabled = readOnly;
		input.setAttribute("aria-label", r.key);
		input.addEventListener("change", () => set(input.value));
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); next(input); } });
		wrap.append(input);
	} else if (r.type === "list" || r.type === "tags") {
		wrap.append(pillsDOM(view, r, readOnly));
	} else if (r.type === "yaml") {
		const preview = r.raw.slice(r.raw.indexOf(":") + 1).replace(/\\[rnt]/g, " ").replace(/\s+/g, " ").trim();
		const code = el("button", "md-prop-yaml", preview);
		code.type = "button";
		code.title = "Edit this property as YAML (Toggle source)";
		code.disabled = readOnly;
		code.addEventListener("click", () => view.dispatch({ effects: setSource.of(true) }));
		wrap.append(code);
	} else {
		const input = el("textarea", "md-prop-text");
		input.rows = 1;
		input.value = r.value;
		input.readOnly = readOnly;
		input.spellcheck = r.type === "text";
		if (r.type === "number") input.inputMode = "decimal";
		input.placeholder = "Empty";
		input.setAttribute("aria-label", r.key);
		const fit = () => fitText(input);
		requestAnimationFrame(fit);
		input.addEventListener("input", () => {
			input.value = input.value.replace(/\n/g, " ");
			fit();
			if (r.type === "number" && input.value.trim() && !/^-?(\d+\.?\d*|\.\d+)$/.test(input.value.trim())) { input.classList.add("bad"); return; }
			input.classList.remove("bad");
			// Spaces at the ends aren't kept (they'd need quotes); the box keeps
			// showing them while it's being typed in.
			set(input.value.trim());
		});
		if (r.type === "text" && !readOnly) typeAhead(input, valueOptions(view, r.key));
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") { e.preventDefault(); next(input); }
			else if (e.key === "Escape") { e.preventDefault(); view.focus(); }
		});
		wrap.append(input);
	}
	return wrap;
}

// A list's items as pills (in the tag colors), with × on each and a box to add one.
function pillsDOM(view, r, readOnly) {
	const tags = r.type === "tags";
	const wrap = el("span", "md-tags");
	const change = (fn) => {
		const now = rowNamed(view.state, r.key);
		if (!now) return;
		edit(view, setEdit(now, fn(now.type === "list" || now.type === "tags" ? itemsOf(now) : [])));
		focusLater(view, r.key);
	};
	r.items.forEach((t, i) => {
		const pill = el("span", `md-tag md-tag-${tagHue(t)}`, t);
		if (tags) {
			pill.title = `Notes tagged #${t}`;
			pill.addEventListener("mousedown", (e) => {
				if (e.target !== pill) return;
				e.preventDefault();
				view.state.facet(linkOpener)?.({ tag: t });
			});
		}
		if (!readOnly) {
			const x = el("button", "md-tag-x", "×");
			x.type = "button";
			x.setAttribute("aria-label", `Remove ${t}`);
			x.addEventListener("mousedown", (e) => { e.preventDefault(); change((items) => items.filter((_, k) => k !== i)); });
			pill.append(x);
		}
		wrap.append(pill);
	});
	if (readOnly) return wrap;
	const input = el("input", "md-tag-input");
	input.placeholder = tags ? "+ tag" : "+ add";
	input.setAttribute("aria-label", tags ? "Add a tag" : `Add to ${r.key}`);
	input.size = 6;
	const add = () => {
		const name = tags ? tagName(input.value) : input.value.trim();
		if (name) change((items) => [...items, name]);
	};
	typeAhead(input, valueOptions(view, r.key, () => rowNamed(view.state, r.key)?.items || []), { empty: true, take: add });
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter" || e.key === ",") {
			e.preventDefault();
			add();
		} else if (e.key === "Backspace" && !input.value && r.items.length) {
			e.preventDefault();
			change((items) => items.slice(0, -1));
		} else if (e.key === "Escape") view.focus();
	});
	wrap.append(input);
	return wrap;
}

// A small menu (the app's .item-menu look). entries: [label, run, cls?] or
// null for a divider. Closes on a pick, Escape or a press elsewhere.
function menu(entries, x, y) {
	document.querySelector(".item-menu")?.remove();
	const box = el("div", "item-menu");
	box.setAttribute("role", "menu");
	for (const entry of entries) {
		if (!entry) { box.append(el("hr", "menu-rule")); continue; }
		const [label, run, cls] = entry;
		const b = el("button", cls || "", label);
		b.type = "button";
		b.setAttribute("role", "menuitem");
		b.addEventListener("click", () => { close(); run(); });
		box.append(b);
	}
	document.body.append(box);
	const r = box.getBoundingClientRect();
	box.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
	box.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
	const away = (e) => { if (!box.contains(e.target)) close(); };
	const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
	function close() {
		box.remove();
		document.removeEventListener("pointerdown", away, true);
		document.removeEventListener("keydown", esc, true);
	}
	setTimeout(() => {
		document.addEventListener("pointerdown", away, true);
		document.addEventListener("keydown", esc, true);
	});
	box.querySelector("button")?.focus();
}

// A property name's menu: Rename, its type, Remove.
function keyMenu(view, key, anchor) {
	const r = rowNamed(view.state, key);
	if (!r) return;
	const at = anchor.getBoundingClientRect();
	const fixed = r.type === "tags" || r.type === "yaml";
	const types = fixed ? [] : TYPES.map((t) => [(t === r.type ? "✓ " : " ") + TYPE_LABELS[t], () => setType(view, key, t), "md-type-item"]);
	menu([
		["Rename…", () => renameRow(view, key)],
		...(types.length ? [null, ...types] : []),
		null,
		["Remove", () => { const now = rowNamed(view.state, key); if (now) edit(view, removeEdit(view.state.doc, now)); }, "danger"],
	], at.left, at.bottom + 4);
}

// Changes a property's type, here (converting its value) and for the name
// everywhere (the vault's property types).
function setType(view, key, type) {
	const r = rowNamed(view.state, key);
	// The website reads this property: changing its shape can change how
	// (or whether) a page shows, so ask first.
	if (r && r.type !== type && SITE_KEYS.has(key) && !confirm(`The website reads “${key}” as ${TYPE_LABELS[r.type]}. Changing it to ${TYPE_LABELS[type]} rewrites its value in this note (and shows it as ${TYPE_LABELS[type]} in every note), which may change how the site shows it.\n\nChange it anyway?`)) return;
	chooseType(view, key, type);
	if (!r) return;
	const change = r.type === type ? null : convertEdit(r, type);
	view.dispatch({ ...(change && !view.state.readOnly ? { changes: change, userEvent: "input.property" } : {}), effects: typesChanged.of(null) });
	focusLater(view, key);
}

// Turns the name into a box; Enter renames, Escape doesn't.
function renameRow(view, key) {
	const row = view.dom.querySelector(`.md-prop[data-key="${CSS.escape(key)}"]`);
	const btn = row?.querySelector(".md-prop-key");
	if (!btn) return;
	const input = el("input", "md-prop-rename");
	input.value = key;
	input.setAttribute("aria-label", "New name");
	btn.replaceWith(input);
	input.focus();
	input.select();
	let done = false;
	const finish = (save) => {
		if (done) return;
		done = true;
		const name = input.value.trim();
		const r = rowNamed(view.state, key);
		const fm = frontmatterLines(view.state.doc);
		const problem = save && r && name !== key ? keyProblem(name, readRows(view.state.doc, fm), key) : null;
		if (problem) { done = false; input.setCustomValidity(problem); input.reportValidity(); return; }
		input.replaceWith(btn);
		if (save && r && name !== key) { edit(view, renameEdit(view.state.doc, r, name)); focusLater(view, name); }
	};
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") { e.preventDefault(); finish(true); }
		else if (e.key === "Escape") { e.preventDefault(); finish(false); }
		else input.setCustomValidity("");
	});
	input.addEventListener("blur", () => finish(true));
}

// The row for a new property: its name (with the vault's names offered), its
// type (the name's own type when it has one) and Add.
function newRowDOM(view) {
	const row = el("div", "md-props-new");
	const types = typesOf(view.state);
	const name = el("input", "md-props-new-name");
	name.placeholder = "Property name";
	name.setAttribute("aria-label", "New property's name");
	// The vault's names, most used first (named types and the website's keys too).
	const names = new Map(usageOf(view.state).names);
	for (const k of [...Object.keys(types), ...SITE_KEYS]) if (!names.has(k)) names.set(k, 0);
	const fm = frontmatterLines(view.state.doc);
	const here = fm ? readRows(view.state.doc, fm).map((r) => r.key) : [];
	typeAhead(name, (typed) => suggest(names, typed, { skip: here }), { empty: true });
	const pick = el("select", "md-props-new-type");
	pick.setAttribute("aria-label", "Type");
	for (const t of TYPES) pick.append(Object.assign(el("option", null, TYPE_LABELS[t]), { value: t }));
	let picked = false;
	pick.addEventListener("change", () => { picked = true; });
	name.addEventListener("input", () => {
		name.setCustomValidity("");
		const k = name.value.trim();
		if (!picked) pick.value = types[k] || (isTagsKey(k) ? "list" : DATE_KEY.test(k) ? "date" : "text");
	});
	const add = el("button", "md-props-new-add", "Add");
	add.type = "button";
	const cancel = el("button", "md-props-new-cancel", "Cancel");
	cancel.type = "button";
	const submit = () => {
		const key = name.value.trim();
		const doc = view.state.doc;
		const fm = frontmatterLines(doc);
		const problem = keyProblem(key, fm ? readRows(doc, fm) : []);
		if (problem) { name.setCustomValidity(problem); name.reportValidity(); return; }
		const type = pick.value;
		if (!isTagsKey(key) && (types[key] ? types[key] !== type : type !== "text")) chooseType(view, key, type);
		focusLater(view, key);
		view.dispatch({ changes: addEdit(doc, fm, key, type), effects: [setAdding.of(false), setFolded.of(false), typesChanged.of(null)], userEvent: "input.property" });
	};
	const close = () => { view.dispatch({ effects: setAdding.of(false) }); view.focus(); };
	for (const input of [name, pick]) input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") { e.preventDefault(); submit(); }
		else if (e.key === "Escape") { e.preventDefault(); close(); }
	});
	add.addEventListener("click", submit);
	cancel.addEventListener("click", close);
	row.append(name, pick, add, cancel);
	return row;
}

function openAdd(view) {
	focusLater(view, null, "add");
	view.dispatch({ effects: [setAdding.of(true), setFolded.of(false)] });
}

// Command: open the box's new-property row (also in a note with no
// properties yet).
export function addProperty(view) {
	if (view.state.readOnly) return false;
	if (view.state.field(source, false)) { view.dispatch({ effects: setSource.of(false) }); }
	openAdd(view);
	return true;
}

// Command: put the focus in a property's value, adding it (as text) when the
// note doesn't have it yet (Banner image, Cover image).
export function focusProperty(view, key) {
	if (view.state.readOnly) return false;
	const effects = [setFolded.of(false), showImageProps.of(true), setSource.of(false)];
	focusLater(view, key);
	if (rowNamed(view.state, key)) view.dispatch({ effects, scrollIntoView: true });
	else view.dispatch({ changes: addEdit(view.state.doc, frontmatterLines(view.state.doc), key, "text"), effects, userEvent: "input.property" });
	return true;
}

// The pill or header shown for a folded box, an empty note, and the YAML view.
class FmWidget extends WidgetType {
	// kind: "folded" (a pill with the count), "none" (+ Properties, a note
	// with none), "source" (the header over the YAML), "end" (under it).
	constructor(kind, count = 0) { super(); this.kind = kind; this.count = count; }
	eq(o) { return o.kind === this.kind && o.count === this.count; }
	toDOM(view) {
		const b = el("button");
		b.type = "button";
		if (this.kind === "end") return el("span", "md-props-srcend");
		if (this.kind === "source") {
			const head = el("span", "md-props-head md-props-srchead");
			if (this.kind === "source") {
				head.append(el("span", "md-props-srclabel", "Properties · YAML"), el("span", "md-props-space"));
				b.className = "md-props-source";
				b.textContent = "Toggle source";
				b.title = "Show the properties as a box again";
				b.addEventListener("mousedown", (e) => { e.preventDefault(); view.dispatch({ effects: setSource.of(false) }); });
				head.append(b);
			}
			return head;
		}
		const row = el("div", "md-fm-hidden" + (this.kind === "none" ? " md-fm-none" : ""));
		if (this.kind === "none") {
			b.className = "md-fm-add md-fm-pill";
			b.textContent = "+ Properties";
			b.title = "Add properties to this note";
			b.addEventListener("mousedown", (e) => { e.preventDefault(); openAdd(view); });
		} else {
			b.className = "md-fm-toggle md-fm-pill";
			b.setAttribute("aria-expanded", "false");
			b.textContent = `Properties · ${this.count}`;
			b.title = "Show the properties";
			b.addEventListener("mousedown", (e) => { e.preventDefault(); setPropertiesHidden(view, false); });
		}
		row.append(b);
		return row;
	}
	ignoreEvent() { return true; }
}

function decorate(state) {
	const doc = state.doc;
	const fm = frontmatterLines(doc);
	if (!fm) {
		if (state.readOnly || isPlannerPage(doc)) return Decoration.none;
		const widget = state.field(adding) ? new BoxWidget(boxSpec(state, [])) : new FmWidget("none");
		return Decoration.set(Decoration.widget({ widget, block: true, side: -1 }).range(0));
	}
	const open = doc.line(fm.open), close = doc.line(fm.close);
	if (state.field(folded)) {
		const planner = isPlannerPage(doc);
		return Decoration.set(Decoration.replace({ widget: planner ? undefined : new FmWidget("folded", propertyCount(doc, fm)), block: true, atomic: true }).range(open.from, close.to));
	}
	if (state.field(source)) {
		const b = new RangeSetBuilder();
		for (let n = fm.open; n <= fm.close; n++) {
			const l = doc.line(n);
			b.add(l.from, l.from, Decoration.line({ class: "md-fm md-fm-src" + (n === fm.open ? " md-first" : "") + (n === fm.close ? " md-last" : "") }));
			if (n === fm.open || n === fm.close) b.add(l.from, l.to, Decoration.replace({ widget: new FmWidget(n === fm.open ? "source" : "end"), atomic: true }));
		}
		return b.finish();
	}
	const rows = readRows(doc, fm, typesOf(state));
	return Decoration.set(Decoration.replace({ widget: new BoxWidget(boxSpec(state, rows)), block: true, atomic: true }).range(open.from, close.to));
}

const decorations = StateField.define({
	create: decorate,
	update(value, tr) {
		const redraw = tr.docChanged || tr.effects.some((e) => e.is(setFolded) || e.is(setSource) || e.is(setAdding) || e.is(showImageProps) || e.is(typesChanged) || e.is(vaultChanged))
			|| tr.startState.field(folded) !== tr.state.field(folded) || tr.startState.field(imagesShown) !== tr.state.field(imagesShown);
		return redraw ? decorate(tr.state) : value;
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

// Typing, pasting and deleting never reach into a drawn box: the box edits
// itself (its edits carry "input.property"). Typing just after it goes on a
// new line; deleting that only partly covers it does nothing. In the YAML
// view (Toggle source) it's all text.
const TYPING = ["input.type", "input.paste", "input.drop", "input.complete", "delete", "move"];
const guardBox = EditorState.transactionFilter.of((tr) => {
	if (!tr.docChanged || !TYPING.some((e) => tr.isUserEvent(e)) || tr.startState.field(source, false)) return tr;
	const doc = tr.startState.doc;
	const fm = frontmatterLines(doc);
	if (!fm) return tr;
	const from = doc.line(fm.open).from, to = doc.line(fm.close).to;
	let hit = false, after = null, count = 0;
	tr.changes.iterChanges((fA, tA, _fB, _tB, ins) => {
		count++;
		const text = ins.toString();
		if (tA > fA) {
			if (fA <= from && tA >= to) return; // the whole box goes
			// Into it, or the line break just after it (gluing a line onto its fence).
			if ((fA < to && tA > from) || fA === to) hit = true;
		} else if (fA >= from && fA < to) hit = true;
		else if (fA === to && !text.startsWith("\n")) after = text;
	});
	if (hit) return [];
	if (after != null && count === 1) {
		return { changes: { from: to, insert: "\n" + after }, selection: { anchor: to + 1 + after.length }, userEvent: "input.type", scrollIntoView: true };
	}
	return tr;
});

// Folds a view's properties box without changing the remembered setting
// (Scrivenings' sections start folded so the text reads on).
export function foldProperties(view) {
	if (frontmatterLines(view.state.doc)) view.dispatch({ effects: setFolded.of(true) });
}

// Where the note's body starts: just after the closing fence's line break, or
// null when there's no frontmatter (or nothing after it).
export function bodyStart(doc) {
	const fm = frontmatterLines(doc);
	if (!fm || fm.close >= doc.lines) return null;
	return doc.line(fm.close + 1).from;
}

// Deleting from the body never reaches into the properties: Backspace at the
// body's start does nothing, and a delete that started in the body (Ctrl+
// Backspace, Delete line...) stops at the closing fence. Selections that
// reach into the properties delete as usual.
const guardBody = EditorState.changeFilter.of((tr) => {
	if (!tr.docChanged || !tr.isUserEvent("delete")) return true;
	const start = bodyStart(tr.startState.doc);
	if (start == null || tr.startState.selection.ranges.some((r) => r.from < start)) return true;
	return [0, start];
});

function backspaceAtBody(view) {
	const sel = view.state.selection;
	const start = bodyStart(view.state.doc);
	return start != null && sel.ranges.every((r) => r.empty && r.head === start);
}

export const frontmatterStyle = [folded, imagesShown, source, adding, decorations, guardBox, guardBody,
	Prec.high(keymap.of([{ key: "Enter", run: enter }, { key: "Backspace", run: backspaceAtBody }, { key: "Mod-Backspace", run: backspaceAtBody }]))];
