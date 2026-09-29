// Bases on screen: a .base note shows its views in place of its YAML (the
// </> button shows the YAML to edit, "Show base" goes back), and ```base
// blocks in notes do the same while the cursor is outside them, like
// dataview blocks. Views are tables, cards or lists (src/bases.js works out
// what's in them). Clicking a column head sorts by it for now (the base's own
// sort comes back on the third click); clicking a cell of a note property
// edits it, and the value is written into that note's frontmatter.

import { StateField, StateEffect, EditorState, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { dataviewBlocks } from "./dataview.js";
import { linkOpener } from "./links.js";
import { readBase, runView, show, BLink, BDate, BImage, noteKey, setProperty, parseInput } from "./bases.js";

const isBase = (path) => /\.base$/i.test(path || "");
const IMAGE = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#]\S*)?$/i;
// Properties whose web links are pictures even without an image extension.
const IMAGE_PROP = /cover|image|poster|thumb|banner|artwork|photo/i;

// Per base (its path, plus the block's place for ```base), what's picked on
// screen: the view, and a sort from clicking a column head.
const picked = new Map();

const setSource = StateEffect.define();
const repicked = StateEffect.define();
const showSource = StateField.define({
	create: () => false,
	update(v, tr) {
		for (const e of tr.effects) if (e.is(setSource)) return e.value;
		return v;
	},
});

// While a .base note shows its views, typing can't change the hidden YAML.
const guard = EditorState.transactionFilter.of((tr) => {
	if (!tr.docChanged || !(tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("move"))) return tr;
	return isBase(tr.startState.facet(notePath)) && !tr.startState.field(showSource, false) ? [] : tr;
});

// Every note on the device, as { path, text }; the open one from the editor.
function filesFor(state, host, path) {
	const paths = host.files ? host.files() : host.paths();
	const out = [];
	for (const p of paths) {
		const text = p === path ? state.sliceDoc() : host.text(p);
		if (text != null) out.push({ path: p, text });
	}
	return out;
}

let vaultVersion = 0;
const cache = new Map(); // key -> { doc, version, pick, result }
function resultFor(state, code, path, key) {
	const pick = picked.get(key) || {};
	const pickKey = JSON.stringify(pick);
	const hit = cache.get(key);
	if (hit && hit.code === code && hit.doc === state.doc && hit.version === vaultVersion && hit.pick === pickKey) return hit.result;
	let result;
	try {
		const base = readBase(code);
		const index = Math.min(pick.view ?? 0, base.views.length - 1);
		result = { base, index, ...runView(base, index, filesFor(state, state.facet(vaultHost), path), { thisPath: isBase(path) ? null : path, sortBy: pick.sort }) };
	} catch (e) {
		result = { error: String(e?.message || e) };
	}
	cache.set(key, { code, doc: state.doc, version: vaultVersion, pick: pickKey, result });
	return result;
}

// A fingerprint of what's drawn, so unchanged views aren't redrawn.
function stamp(r) {
	if (r.error) return "E" + r.error;
	const rows = r.groups.map((g) => g.key + ":" + g.rows.map((x) => x.path + "=" + x.values.map(show).join("\u0001")).join("\u0002")).join("\u0003");
	return [r.index, r.columns.join(","), r.view.type, r.view.image, rows, r.errors.join()].join("\u0004");
}

function el(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text != null) e.textContent = text;
	return e;
}

class BaseWidget extends WidgetType {
	constructor(key, path, from, whole, result) {
		super();
		this.key = key; this.path = path; this.from = from; this.whole = whole; this.result = result;
		this.stamp = stamp(result);
	}
	eq(o) { return o.key === this.key && o.stamp === this.stamp && o.whole === this.whole; }
	toDOM(view) {
		const wrap = el("div", "md-base" + (this.whole ? " md-base-whole" : ""));
		const r = this.result;
		const host = view.state.facet(vaultHost);
		const editable = !!host?.write && view.state.facet(EditorView.editable) && !view.state.readOnly;
		const open = (path) => view.state.facet(linkOpener)?.({ note: path, heading: "", wiki: true });
		const repick = (change) => {
			picked.set(this.key, { ...(picked.get(this.key) || {}), ...change });
			view.dispatch({ effects: repicked.of(null) });
		};

		const bar = el("div", "md-base-bar");
		if (!r.error && r.base.views.length > 1) {
			r.base.views.forEach((v, i) => {
				const b = el("button", "md-base-tab" + (i === r.index ? " on" : ""), v.name);
				b.type = "button";
				b.addEventListener("mousedown", (e) => { e.preventDefault(); repick({ view: i, sort: null }); });
				bar.append(b);
			});
		} else if (!r.error) bar.append(el("span", "md-base-title", r.view.name));
		if (!r.error) bar.append(el("span", "md-base-count", r.total === 1 ? "1 note" : `${r.total} notes`));
		const src = el("button", "md-dv-edit md-base-src", "</>");
		src.type = "button";
		src.title = this.whole ? "Edit the base's YAML" : "Edit the base";
		src.addEventListener("mousedown", (e) => {
			e.preventDefault();
			if (this.whole) view.dispatch({ effects: setSource.of(true), selection: { anchor: 0 } });
			else {
				let pos = this.from;
				try { pos = view.posAtDOM(wrap); } catch {}
				const line = view.state.doc.lineAt(pos);
				view.dispatch({ selection: { anchor: Math.min(line.to + 1, view.state.doc.length) }, scrollIntoView: true });
			}
			view.focus();
		});
		bar.append(src);
		wrap.append(bar);

		if (r.error) {
			wrap.append(el("div", "md-dql-error", "Base: " + r.error));
			return wrap;
		}
		for (const msg of r.errors.slice(0, 3)) wrap.append(el("div", "md-dql-error", msg));

		// One value, drawn: links, pills for lists, checkboxes, images.
		const draw = (v, into, { image = false, cover = false } = {}) => {
			if (v == null || v === "") return;
			if (Array.isArray(v)) {
				for (const x of v) {
					const pill = el("span", "md-base-pill");
					draw(x, pill);
					into.append(pill);
				}
				return;
			}
			if (v instanceof BLink) {
				const a = el("a", "md-base-link", v.display);
				a.href = "#" + encodeURIComponent(v.path);
				a.addEventListener("click", (e) => { e.preventDefault(); open(v.path); });
				into.append(a);
				return;
			}
			if (v instanceof BImage || (typeof v === "string" && (IMAGE.test(v.trim()) || (image && /^https?:\/\/\S+$/.test(v.trim()))))) {
				const img = el("img", cover ? "md-base-cover" : "md-base-thumb");
				img.loading = "lazy";
				img.alt = "";
				img.referrerPolicy = "no-referrer";
				img.addEventListener("error", () => img.remove()); // offline, or gone: no broken-image icon
				img.src = v instanceof BImage ? v.src : v.trim();
				into.append(img);
				return;
			}
			if (typeof v === "boolean") {
				const box = el("input");
				box.type = "checkbox";
				box.checked = v;
				box.disabled = true;
				into.append(box);
				return;
			}
			if (typeof v === "string") {
				const wiki = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/.exec(v.trim());
				if (wiki) {
					const a = el("a", "md-base-link", wiki[2] || wiki[1]);
					a.href = "#";
					a.addEventListener("click", (e) => { e.preventDefault(); open(wiki[1]); });
					into.append(a);
					return;
				}
				if (/^https?:\/\/\S+$/.test(v.trim())) {
					const a = el("a", "md-base-link", v.trim());
					a.href = v.trim();
					a.target = "_blank";
					a.rel = "noopener noreferrer";
					into.append(a);
					return;
				}
			}
			into.append(v instanceof BDate ? show(v) : show(v));
		};

		// A note property's cell can be edited in place.
		const editCell = (cell, row, id, value) => {
			const key = noteKey(id);
			if (!editable || !key) return;
			cell.classList.add("md-base-editable");
			if (typeof value === "boolean") {
				const box = cell.querySelector("input[type=checkbox]");
				if (box) {
					box.disabled = false;
					box.addEventListener("change", () => host.write(row.path, (t) => setProperty(t, key, box.checked)));
				}
				return;
			}
			cell.addEventListener("click", (e) => {
				if (e.target.closest("a, input") || cell.querySelector(".md-base-input")) return;
				const input = el("input", "md-base-input");
				input.value = Array.isArray(value) ? value.map(show).join(", ") : show(value);
				const before = input.value;
				cell.replaceChildren(input);
				input.focus();
				input.select();
				let done = false;
				const finish = (save) => {
					if (done) return;
					done = true;
					if (save && input.value !== before) host.write(row.path, (t) => setProperty(t, key, parseInput(input.value, value)));
					else { cell.replaceChildren(); draw(value, cell); }
				};
				input.addEventListener("keydown", (e) => {
					if (e.key === "Enter") { e.preventDefault(); finish(true); }
					else if (e.key === "Escape") { e.preventDefault(); finish(false); }
				});
				input.addEventListener("blur", () => finish(true));
			});
		};

		const type = ["table", "cards", "list"].includes(r.view.type) ? r.view.type : "table";
		if (type !== r.view.type) wrap.append(el("div", "md-base-note", `wr1t3r can't draw ${r.view.type} views yet, so this one is a table.`));
		if (!r.total) wrap.append(el("div", "md-base-empty", "No notes match."));
		const sort = picked.get(this.key)?.sort;

		if (type === "table" && r.total) {
			const box = el("div", "md-base-scroll");
			const table = el("table", "md-base-table");
			const head = table.createTHead().insertRow();
			r.columns.forEach((id, c) => {
				const th = el("th", null, r.names[c]);
				if (sort?.property === id) th.append(sort.direction === "DESC" ? " ▾" : " ▴");
				th.title = "Sort by " + r.names[c];
				th.addEventListener("mousedown", (e) => {
					e.preventDefault();
					const next = sort?.property !== id ? { property: id, direction: "ASC" } : sort.direction === "ASC" ? { property: id, direction: "DESC" } : null;
					repick({ sort: next });
				});
				head.append(th);
			});
			const body = table.createTBody();
			for (const g of r.groups) {
				if (g.key !== null) {
					const tr = body.insertRow();
					tr.className = "md-base-group";
					const td = tr.insertCell();
					td.colSpan = r.columns.length;
					td.textContent = g.key || "(none)";
				}
				for (const row of g.rows) {
					const tr = body.insertRow();
					row.values.forEach((v, c) => {
						const td = tr.insertCell();
						draw(v, td, { image: IMAGE_PROP.test(r.columns[c]) });
						editCell(td, row, r.columns[c], v);
					});
				}
			}
			box.append(table);
			wrap.append(box);
		} else if (r.total) {
			const imageId = r.view.image ? String(r.view.image) : null;
			const list = el("div", type === "cards" ? "md-base-cards" : "md-base-list");
			for (const g of r.groups) {
				if (g.key !== null) list.append(el("div", "md-base-group", g.key || "(none)"));
				for (const row of g.rows) {
					const item = el("div", type === "cards" ? "md-base-card" : "md-base-item");
					if (imageId) {
						const v = row.value(imageId);
						const pic = el("div", "md-base-pic");
						if (v) draw(Array.isArray(v) ? v[0] : v, pic, { image: true, cover: true });
						item.append(pic);
					}
					const text = el("div", "md-base-text");
					const title = el("div", "md-base-name");
					draw(new BLink(row.path, row.file.name), title);
					text.append(title);
					row.values.forEach((v, c) => {
						const id = r.columns[c];
						if (id === "file.name" || id === imageId || v == null || v === "" || (Array.isArray(v) && !v.length)) return;
						const line = el("div", "md-base-prop");
						line.append(el("span", "md-base-label", r.names[c]));
						const val = el("span", "md-base-value");
						draw(v, val, { image: IMAGE_PROP.test(id) });
						editCell(val, row, id, v);
						line.append(val);
						text.append(line);
					});
					item.append(text);
					list.append(item);
				}
			}
			wrap.append(list);
		}
		return wrap;
	}
	ignoreEvent() { return true; }
}

// "Show base" over a .base note's YAML.
class SourceBar extends WidgetType {
	eq() { return true; }
	toDOM(view) {
		const bar = el("div", "md-base-sourcebar");
		const b = el("button", "md-base-back", "▦ Show base");
		b.type = "button";
		b.addEventListener("mousedown", (e) => { e.preventDefault(); view.dispatch({ effects: setSource.of(false) }); });
		bar.append(b);
		return bar;
	}
	ignoreEvent() { return true; }
}

function build(state) {
	const b = new RangeSetBuilder();
	const host = state.facet(vaultHost);
	const path = state.facet(notePath);
	if (!host || !path) return b.finish();
	if (isBase(path)) {
		if (state.field(showSource, false)) b.add(0, 0, Decoration.widget({ widget: new SourceBar(), block: true, side: -1 }));
		else {
			const w = new BaseWidget(path, path, 0, true, resultFor(state, state.sliceDoc(), path, path));
			if (state.doc.length) b.add(0, state.doc.length, Decoration.replace({ widget: w, block: true }));
			else b.add(0, 0, Decoration.widget({ widget: w, block: true, side: 1 }));
		}
		return b.finish();
	}
	const sel = state.selection.ranges;
	dataviewBlocks(state, "base").forEach((blk, i) => {
		if (sel.some((r) => r.to >= blk.from && r.from <= blk.to)) return; // being edited
		const key = path + "\0" + i;
		b.add(blk.from, blk.to, Decoration.replace({ widget: new BaseWidget(key, path, blk.from, false, resultFor(state, blk.code, path, key)), block: true }));
	});
	return b.finish();
}

const views = StateField.define({
	create: build,
	update(deco, tr) {
		const vault = tr.effects.some((e) => e.is(vaultChanged));
		if (vault) vaultVersion++;
		if (tr.docChanged || tr.selection || vault || tr.effects.some((e) => e.is(setSource) || e.is(repicked)) || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

// No text cursor beside a .base note's views.
const mode = EditorView.editorAttributes.compute([notePath, showSource], (state) =>
	isBase(state.facet(notePath)) && !state.field(showSource, false) ? { class: "md-base-mode" } : {});

export const bases = [showSource, guard, views, mode];
