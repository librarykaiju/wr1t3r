// Bases on screen: a .base note shows its views in place of its YAML (the
// </> button shows the YAML, "Show base" goes back), and ```base blocks in
// notes do the same while the cursor is outside them, like dataview blocks.
//
// A view is a Grid (Obsidian's table), a Gallery (cards), a List or a
// Kanban board, and it's set up from its toolbar the way Anytype sets are:
// Source (which folders and tags the notes come from), Properties (which
// show, in what order), Filter, Sort, Group and Layout. Every change is
// written into the base's YAML in Obsidian's own keys (src/baseconfig.js),
// so the base looks the same on every device and in Obsidian. Only the open
// tab and a sort clicked on a column head stay on this device (the head sort
// until "Save sort").
//
// Editing a note's value in a cell, on a card or by dragging a card to
// another lane writes that one property into the note's frontmatter.

import { StateField, StateEffect, EditorState, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { dataviewBlocks } from "./dataview.js";
import { linkOpener } from "./links.js";
import { parseYaml, readBase, runView, show, fileFor, BLink, BDate, BImage, noteKey, displayName, setProperty } from "./bases.js";
import {
	writeYaml, viewsOf, freshName, extra, VIEW_TYPES, viewLabel, sameProp, propType, conditionsFor,
	readFilters, writeFilters, rawText, readSource, writeSource, prefill, moveValue, lanesFor, laneKeys,
} from "./baseconfig.js";
import { el, button, onMenu, menu, openPanel, closePanel, redrawPanel, panelOpen, select, suggestions, valuesOf, editValue, cardColorPicker } from "./basesui.js";
import { makeCard } from "./cards.js";
import { SUMMARIES, summarize, summaryFor } from "./basessummary.js";
import { isOpen, openAsText } from "./drawnblocks.js";
import { isArchived } from "./search.js";
import { sortable, reorder } from "./drag.js";
import { binderOrder, binderPath, isBinder } from "./binder.js";
import { isAppFile } from "./home.js";
import { imageRef } from "./pretty.js";
import { parseFrontmatter } from "./dvpage.js";
import { noteTags } from "./frontmatter.js";
import { calendar, timeline } from "./basescalendar.js";

const isBase = (path) => /\.base$/i.test(path || "");
// A board in a note: ```board (what wr1t3r writes), or Obsidian's ```base.
export const BOARD_FENCES = ["board", "base"];
// A board block's own look, from its top-level wr1t3r: key:
//   wr1t3r: { title: Reading, color: 3, width: full }
// -> { title, color (1-7) or null, full }.
export function boardLook(code) {
	let w = null;
	try { w = parseYaml(code)?.wr1t3r; } catch {}
	if (!w || typeof w !== "object" || Array.isArray(w)) w = {};
	const color = Number(w.color);
	return {
		title: w.title == null ? "" : String(w.title).trim(),
		color: Number.isInteger(color) && color >= 1 && color <= 7 ? color : null,
		full: String(w.width || "").toLowerCase() === "full",
	};
}
const IMAGE = /^https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#]\S*)?$/i;
// Properties whose web links are pictures even without an image extension.
const IMAGE_PROP = /cover|image|poster|thumb|banner|artwork|photo/i;
const CARD_SIZES = [["160", "Small"], ["220", "Medium"], ["300", "Large"]];
const SHAPES = [["", "Automatic"], ["0.5625", "Wide"], ["0.75", "Landscape"], ["1", "Square"], ["1.5", "Portrait"]];

// ---- What's picked on this device ---------------------------------------------

// Per base (its path, plus the block's place for ```base): the open view, and
// a sort from clicking a column head.
const picked = new Map();
const VIEW_KEY = "wr1t3r-base-views";
function storedViews() { try { return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}") || {}; } catch { return {}; } }
function pick(key) {
	if (!picked.has(key)) picked.set(key, { view: Number(storedViews()[key]) || 0, sort: null });
	return picked.get(key);
}
function setPick(key, change) {
	const p = { ...pick(key), ...change };
	picked.set(key, p);
	if ("view" in change) {
		const all = storedViews();
		all[key] = p.view;
		try { localStorage.setItem(VIEW_KEY, JSON.stringify(all)); } catch {}
	}
}

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

// ---- Working a view out ------------------------------------------------------

// Every note on the device, as { path, text }; the open one from the editor.
function filesFor(state, host, path) {
	const paths = host.files ? host.files() : host.paths();
	const out = [];
	for (const p of paths) {
		const text = p === path ? state.sliceDoc() : host.text(p);
		// Archived notes stay out of boards (only a search that asks finds them),
		// and so do folders' _Binder.md (their order) and wr1t3r's own notes.
		if (p !== path && (isBinder(p) || isAppFile(p))) continue;
		if (text != null && (p === path || !isArchived(text))) out.push({ path: p, text });
	}
	return out;
}

// A note's place in its folder's binder (the corkboard's order).
function ranker(host) {
	const paths = host.paths();
	const folders = new Map();
	return (p) => {
		const folder = p.slice(0, p.lastIndexOf("/") + 1);
		if (!folders.has(folder)) {
			const list = binderOrder(folder, paths, host.text(binderPath(folder)));
			folders.set(folder, new Map(list.filter((x) => x.kind === "note").map((x, i) => [x.path, i])));
		}
		return folders.get(folder).get(p);
	};
}

let vaultVersion = 0;
const cache = new Map(); // key -> { code, doc, version, pick, result }
function resultFor(state, code, path, key) {
	const p = pick(key);
	const pickKey = JSON.stringify(p);
	const hit = cache.get(key);
	if (hit && hit.code === code && hit.doc === state.doc && hit.version === vaultVersion && hit.pick === pickKey) return hit.result;
	let result;
	try {
		const host = state.facet(vaultHost);
		const base = readBase(code);
		const index = Math.max(0, Math.min(p.view, base.views.length - 1));
		result = { base, index, ...runView(base, index, filesFor(state, host, path), { thisPath: isBase(path) ? null : path, sortBy: p.sort, rank: ranker(host) }) };
	} catch (e) {
		result = { error: String(e?.message || e) };
	}
	cache.set(key, { code, doc: state.doc, version: vaultVersion, pick: pickKey, result });
	return result;
}

// A fingerprint of what's drawn, so unchanged views aren't redrawn.
function stamp(r) {
	if (r.error) return "E" + r.error;
	// Calendar and timeline place notes by dates that may not be shown columns.
	const w = r.view?.wr1t3r || {};
	const dates = [w.date, w.end].filter((x) => typeof x === "string");
	const rows = r.groups.map((g) => g.key + ":" + g.rows.map((x) => x.path + "=" + x.values.map(show).join("\u0001") + dates.map((id) => "\u0001" + JSON.stringify(x.value(id) ?? null)).join("")).join("\u0002")).join("\u0003");
	return [r.index, r.columns.join(","), JSON.stringify(r.view), JSON.stringify(r.base.filters ?? null), r.base.views.map((v) => v.name + v.type).join(), rows, r.errors.join()].join("\u0004");
}

// A board block's card: its title (click to rename), a color dot and the
// width toggle, all kept under the block's wr1t3r: key.
function boardHead(ctx, wrap, look, editable) {
	wrap.classList.add("md-board");
	if (look.color) { wrap.classList.add("md-colored"); wrap.style.setProperty("--card-c", `var(--f${look.color})`); }
	if (look.full) wrap.classList.add("md-board-full");
	const setLook = (patch) => ctx.save((cfg) => {
		const w = { ...(cfg.wr1t3r && typeof cfg.wr1t3r === "object" ? cfg.wr1t3r : {}), ...patch };
		for (const k of Object.keys(w)) if (w[k] == null || w[k] === "") delete w[k];
		if (Object.keys(w).length) cfg.wr1t3r = w; else delete cfg.wr1t3r;
	});
	const head = el("div", "md-board-head");
	const title = el("span", "md-board-title" + (look.title ? "" : " empty"), look.title || (editable ? "Untitled board" : ""));
	head.append(title);
	if (editable) {
		title.title = "Rename the board";
		title.tabIndex = 0;
		const rename = () => {
			const input = el("input", "md-board-title-input");
			Object.assign(input, { type: "text", value: look.title, placeholder: "Board title" });
			let done = false;
			const finish = (keep) => {
				if (done) return;
				done = true;
				const v = input.value.trim();
				if (keep && v !== look.title) setLook({ title: v || null });
				else input.replaceWith(title);
			};
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") { e.preventDefault(); finish(true); }
				else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
			});
			input.addEventListener("blur", () => finish(true));
			title.replaceWith(input);
			input.focus();
			input.select();
		};
		title.addEventListener("click", rename);
		title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); rename(); } });
		const tools = el("span", "md-board-headtools");
		const width = button("md-board-width", look.full ? "Fit column" : "Full width", () => setLook({ width: look.full ? null : "full" }));
		width.title = look.full ? "Keep the board inside the note's column" : "Let the board use the pane's whole width";
		const dot = el("button", "planner-card-dot" + (look.color ? "" : " none"));
		dot.type = "button";
		dot.title = "Board color";
		dot.setAttribute("aria-label", "Board color");
		dot.addEventListener("mousedown", (e) => e.preventDefault());
		dot.addEventListener("click", () => {
			const r = dot.getBoundingClientRect();
			cardColorPicker(look.color, r.left, r.bottom + 6, (n) => setLook({ color: n }));
		});
		tools.append(width, dot);
		head.append(tools);
	}
	if (look.title || editable) wrap.append(head);
}

// Where a board's YAML is: the whole note, or the inside of its block.
function codeAt(state, t) {
	if (t.whole) return { from: 0, to: state.doc.length, code: state.sliceDoc() };
	const b = dataviewBlocks(state, BOARD_FENCES)[t.index];
	return b ? { from: b.codeFrom, to: b.codeTo, code: b.code } : null;
}

// Changes the base: fn(cfg, view, index) edits the YAML as an object (return
// false for no change), and the base is written back. Undo takes it back.
function commit(cm, t, fn) {
	const at = codeAt(cm.state, t);
	if (!at) return;
	let cfg;
	try { cfg = parseYaml(at.code); } catch { return; }
	if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) cfg = {};
	const views = viewsOf(cfg);
	const i = Math.max(0, Math.min(pick(t.key).view, views.length - 1));
	if (fn(cfg, views[i], i) === false) return;
	for (const v of cfg.views) if (v.wr1t3r && !Object.keys(v.wr1t3r).length) delete v.wr1t3r;
	let text = writeYaml(cfg);
	if (!t.whole) text = text.replace(/\n$/, "") + (at.from === at.to ? "\n" : "");
	if (text !== at.code) cm.dispatch({ changes: { from: at.from, to: at.to, insert: text }, userEvent: "base.config" });
}

// The latest result for a base (after a commit, the widget's own is stale).
function latest(cm, t) {
	const at = codeAt(cm.state, t);
	return at ? resultFor(cm.state, at.code, cm.state.facet(notePath), t.key) : { error: "The board is gone." };
}

// ---- Properties ----------------------------------------------------------------

const FILE_PROPS = ["file.name", "file.folder", "file.tags", "file.links", "file.ext", "file.size"];

// Every property the base's notes have (all notes when none match yet), then
// the file's own and the base's formulas.
function catalog(r, host) {
	const seen = new Set();
	const paths = host.paths?.() || [];
	const rows = r.rows?.length ? r.rows.map((x) => x.file) : paths.slice(0, 400).map((p) => { const t = host.text(p); return t == null ? null : fileFor(p, t, paths); }).filter(Boolean);
	for (const f of rows) for (const k of Object.keys(f.properties)) seen.add(k);
	const notes = [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
	const formulas = Object.keys(r.base.formulas || {}).map((k) => "formula." + k);
	return { notes, all: [...notes, ...FILE_PROPS, ...formulas] };
}
const nameOf = (id, r) => displayName(id, r.base);

// The date property a Calendar or Timeline view places notes by (its
// wr1t3r: date key, or for "end" its end date), as the catalog names it.
function dateProp(r, host, which = "date") {
	const want = r.view.wr1t3r?.[which];
	if (!want) return null;
	const { all } = catalog(r, host);
	return all.find((p) => sameProp(p, want)) ?? String(want);
}
// A likely date property, for a view just switched to Calendar or Timeline.
function guessDate(r, notes) {
	const dates = notes.filter((p) => typeOf(p, r) === "date");
	return dates.find((p) => /^(due|date|start|scheduled|deadline|publish)/i.test(p)) || dates[0] || notes.find((p) => /date|due|start/i.test(p)) || null;
}
const typeOf = (id, r) => propType((r.rows || []).map((x) => x.value(id)), id);

// ---- Drawing values -------------------------------------------------------------

function drawValue(v, into, open, { image = false, cover = false, checkbox = false } = {}) {
	if (checkbox && (v == null || v === "")) v = false;
	if (v == null || v === "") return;
	if (Array.isArray(v)) {
		for (const x of v) {
			const pill = el("span", "md-base-pill");
			drawValue(x, pill, open);
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
	into.append(show(v));
}

// A card's picture: a web address, or an image in the vault.
function coverFor(host, row, imageId) {
	let v = row.value(imageId);
	if (Array.isArray(v)) v = v[0];
	if (v == null || v === "") return null;
	if (v instanceof BImage) return v.src;
	if (v instanceof BLink) v = `[[${v.path}]]`;
	const ref = imageRef(show(v));
	if (!ref) return null;
	if (ref.url) return ref.url;
	const p = host.resolveAttachment?.(ref.name, row.path);
	return p && host.attachmentURL ? host.attachmentURL(p).catch(() => null) : null;
}

// The Scrivener label (1-7) colors a card, as on the corkboard.
function labelColor(row) {
	const n = Number(show(row.value("label")));
	return Number.isInteger(n) && n >= 1 && n <= 7 ? n : null;
}

// ---- The widget -------------------------------------------------------------------

class BaseWidget extends WidgetType {
	constructor(t, path, result, editable) {
		super();
		this.t = t; this.key = t.key; this.path = path; this.result = result; this.canEdit = editable;
		this.stamp = stamp(result) + (editable ? "" : "\u0005ro") + JSON.stringify(pick(t.key).sort) + JSON.stringify(t.look || null);
	}
	eq(o) { return o.key === this.key && o.stamp === this.stamp && o.t.whole === this.t.whole; }
	// CodeMirror also calls this when it keeps the same DOM for an equal
	// widget, so only let go of the drag handlers once the DOM is really gone.
	destroy(dom) { setTimeout(() => { if (!dom.isConnected) for (const off of dom._off || []) off(); }); }
	ignoreEvent() { return true; }

	toDOM(cm) {
		const wrap = el("div", "md-base" + (this.t.whole ? " md-base-whole" : ""));
		wrap._off = [];
		const r = this.result;
		const host = cm.state.facet(vaultHost);
		const t = this.t, key = this.key, editable = this.canEdit;
		const open = (path) => cm.state.facet(linkOpener)?.({ note: path, heading: "", wiki: true });
		const repick = (change) => { setPick(key, change); cm.dispatch({ effects: repicked.of(null) }); };
		const save = (fn, { redraw = true } = {}) => { commit(cm, t, fn); if (redraw) redrawPanel(key); };
		const ctx = { cm, t, key, host, open, save, repick, fresh: () => latest(cm, t), path: this.path };
		ctx.newNote = (props) => newNote(ctx, props);

		if (!t.whole) boardHead(ctx, wrap, t.look, editable);
		wrap.append(toolbar(ctx, r, editable, wrap));
		if (r.error) {
			wrap.append(el("div", "md-dql-error", "Board: " + r.error));
			return wrap;
		}
		for (const msg of r.errors.slice(0, 3)) wrap.append(el("div", "md-dql-error", msg));

		const type = VIEW_TYPES.some((x) => x.type === r.view.type) ? r.view.type : "table";
		if (type !== r.view.type) wrap.append(el("div", "md-base-note", `wr1t3r can't draw ${r.view.type} views, so this one shows as a grid.`));
		const cells = cellTools(ctx, r, editable);
		if (type === "kanban") kanban(ctx, r, editable, cells, wrap);
		else if (type === "calendar") calendar(ctx, r, editable, wrap, dateProp(r, host));
		else if (type === "timeline") {
			timeline(ctx, r, editable, wrap, dateProp(r, host), dateProp(r, host, "end"));
			if (editable && host?.create) wrap.append(button("md-base-new", "+ New", () => newNote(ctx), "New note in this board"));
		} else {
			if (!r.total) wrap.append(el("div", "md-base-empty", "No notes match."));
			if (type === "table" && r.total) grid(ctx, r, editable, cells, wrap);
			else if (type === "cards" && r.total) gallery(ctx, r, editable, cells, wrap);
			else if (type === "list" && r.total) list(ctx, r, editable, cells, wrap);
			if (editable && host?.create) wrap.append(button("md-base-new", "+ New", () => newNote(ctx), "New note in this board"));
		}
		return wrap;
	}
}

// ---- Toolbar ------------------------------------------------------------------------

function toolbar(ctx, r, editable, wrap) {
	const { cm, t, key, save, repick } = ctx;
	const bar = el("div", "md-base-bar");
	const tabs = el("div", "md-base-tabs");
	bar.append(tabs);
	if (!r.error) {
		r.base.views.forEach((v, i) => {
			const on = i === r.index;
			const b = el("button", "md-base-tab" + (on ? " on" : ""), v.name);
			b.type = "button";
			b.title = viewLabel(v.type);
			b.addEventListener("mousedown", (e) => { if (e.button === 0) { e.preventDefault(); if (!on) { closePanel(); repick({ view: i, sort: null }); } } });
			if (editable) {
				onMenu(b, (x, y) => viewMenu(ctx, r, i, x, y));
				b.addEventListener("dblclick", () => renameView(ctx, r, i));
				if (on) {
					const more = button("md-base-tabmenu", "▾", (e) => { const rc = e.currentTarget.getBoundingClientRect(); viewMenu(ctx, r, i, rc.left, rc.bottom + 4); }, "View options");
					b.append(more);
				}
			}
			tabs.append(b);
		});
		if (editable) {
			tabs.append(button("md-base-addview", "+", () => {
				let at = 0;
				save((cfg, cur) => {
					const v = { type: "table", name: freshName(cfg.views, "Table") };
					if (cur?.order) v.order = [...cur.order];
					cfg.views.push(v);
					at = cfg.views.length - 1;
				});
				repick({ view: at, sort: null });
			}, "Add a view"));
		}
		bar.append(el("span", "md-base-count", r.total === 1 ? "1 note" : `${r.total} notes`));
	}
	const tools = el("div", "md-base-tools");
	if (!r.error && editable) {
		const sortPick = pick(key).sort;
		if (sortPick) {
			tools.append(button("md-base-tool md-base-savesort", "Save sort", () => {
				save((cfg, v) => { v.sort = [{ property: sortPick.property, direction: sortPick.direction }]; const x = extra(v); delete x.sort; });
				repick({ sort: null });
			}, "Save this sort into the view"));
		}
		const f = readFilters(r.view.filters).rows.length;
		const s = r.view.wr1t3r?.sort === "binder" ? 1 : (Array.isArray(r.view.sort) ? r.view.sort.length : 0);
		const g = r.view.groupBy ? 1 : 0;
		const tool = (kind, label, render, count = 0) => {
			const b = button("md-base-tool" + (count ? " on" : "") + (panelOpen(key, kind) ? " open" : ""), count ? `${label} · ${count}` : label, (e) => openPanel(key, kind, e.currentTarget, (box) => render(box, ctx)));
			b.dataset.panel = kind;
			tools.append(b);
		};
		tool("source", "Source", sourcePanel, readSource(r.base.filters).folders.length + readSource(r.base.filters).tags.length);
		tool("props", "Properties", propsPanel);
		tool("filter", "Filter", filterPanel, f);
		tool("sort", "Sort", sortPanel, s);
		if (!["kanban", "calendar", "timeline"].includes(r.view.type)) tool("group", "Group", groupPanel, g);
		tool("layout", viewLabel(VIEW_TYPES.some((x) => x.type === r.view.type) ? r.view.type : "table"), layoutPanel);
	}
	const src = el("button", "md-dv-edit md-base-src", "</>");
	src.type = "button";
	src.title = t.whole ? "Edit the board's settings (YAML)" : "Edit the board's settings";
	src.addEventListener("mousedown", (e) => {
		e.preventDefault();
		closePanel();
		if (t.whole) cm.dispatch({ effects: setSource.of(true), selection: { anchor: 0 } });
		else {
			const at = codeAt(cm.state, t);
			if (at) openAsText(cm, at.from);
		}
		cm.focus();
	});
	tools.append(src);
	bar.append(tools);
	return bar;
}

function renameView(ctx, r, i) {
	const name = prompt("Name this view:", r.base.views[i].name);
	if (name == null || !name.trim()) return;
	ctx.save((cfg) => { cfg.views[i].name = name.trim(); });
}

function viewMenu(ctx, r, i, x, y) {
	const { save, repick } = ctx;
	const n = r.base.views.length;
	const entries = [
		["Rename…", () => renameView(ctx, r, i)],
		["Duplicate", () => {
			save((cfg) => { const copy = JSON.parse(JSON.stringify(cfg.views[i])); copy.name = freshName(cfg.views, cfg.views[i].name + " copy"); cfg.views.splice(i + 1, 0, copy); });
			repick({ view: i + 1, sort: null });
		}],
		null,
		...VIEW_TYPES.filter((v) => v.type !== r.base.views[i].type).map((v) => [`Show as ${v.label}`, () => save((cfg) => { cfg.views[i].type = v.type; })]),
		null,
	];
	if (i > 0) entries.push(["Move left", () => { save((cfg) => { cfg.views.splice(i - 1, 0, cfg.views.splice(i, 1)[0]); }); repick({ view: i - 1 }); }]);
	if (i < n - 1) entries.push(["Move right", () => { save((cfg) => { cfg.views.splice(i + 1, 0, cfg.views.splice(i, 1)[0]); }); repick({ view: i + 1 }); }]);
	if (n > 1) entries.push(["Delete view", () => {
		if (!confirm(`Delete the view "${r.base.views[i].name}"? Its notes stay.`)) return;
		save((cfg) => { cfg.views.splice(i, 1); });
		repick({ view: Math.max(0, Math.min(pick(ctx.key).view, n - 2)), sort: null });
	}, "danger"]);
	menu(entries.filter((e, k, a) => e || (k > 0 && a[k - 1])), x, y);
}

// ---- Panels -----------------------------------------------------------------------

function heading(box, text, hint) {
	box.append(el("div", "base-panel-title", text));
	if (hint) box.append(el("p", "base-panel-hint", hint));
}

// Where the notes come from: folders and tags (a note must match all).
function sourcePanel(box, ctx) {
	const r = ctx.fresh();
	if (r.error) return false;
	const host = ctx.host;
	const src = readSource(r.base.filters);
	heading(box, "Source", "Which notes this board shows. A note has to match every folder and tag here. Leave it empty for every note in the vault.");
	const put = (fn) => ctx.save((cfg) => { const s = readSource(cfg.filters); fn(s); const f = writeSource(s); if (f) cfg.filters = f; else delete cfg.filters; });
	const chips = el("div", "base-chips");
	src.folders.forEach((f, i) => chips.append(chip("📁 " + f.replace(/^content\//, ""), () => put((s) => s.folders.splice(i, 1)))));
	src.tags.forEach((tg, i) => chips.append(chip("#" + tg, () => put((s) => s.tags.splice(i, 1)))));
	if (!src.folders.length && !src.tags.length) chips.append(el("span", "base-panel-hint", "Every note"));
	box.append(chips);

	const paths = host.paths?.() || [];
	const folders = [...new Set(paths.map((p) => p.slice(0, p.lastIndexOf("/"))).filter(Boolean).flatMap((f) => f.split("/").map((_, i, a) => a.slice(0, i + 1).join("/"))))].sort();
	const tags = new Set();
	for (const p of paths.slice(0, 3000)) { const tx = host.text(p); if (tx != null) for (const tg of noteTags(tx)) tags.add(String(tg).replace(/^#/, "")); }
	box.append(adder("Add a folder", folders, (v) => { v = v.replace(/\/+$/, ""); if (!folders.includes(v) && folders.includes("content/" + v)) v = "content/" + v; put((s) => { if (!s.folders.includes(v)) s.folders.push(v); }); }, "src-folder"));
	box.append(adder("Add a tag", [...tags].sort(), (v) => { v = v.replace(/^#/, ""); put((s) => { if (!s.tags.includes(v)) s.tags.push(v); }); }, "src-tag"));
	if (src.rest.length) {
		box.append(el("div", "base-panel-sub", "Also required"));
		src.rest.forEach((row, i) => box.append(rawRow(row.raw != null ? rawText(row.raw) : null, row, () => put((s) => s.rest.splice(i, 1)))));
	}
}

function chip(text, remove) {
	const c = el("span", "base-chip", text);
	c.append(button("base-chip-x", "×", remove, "Remove " + text));
	return c;
}

// A box with suggestions; Enter or picking one adds it.
function adder(placeholder, options, add, focus) {
	const row = el("div", "base-adder");
	const input = el("input", "base-input");
	input.placeholder = placeholder;
	input.dataset.focus = focus;
	const list = suggestions(options);
	input.setAttribute("list", list.id);
	const go = () => { const v = input.value.trim(); if (v) { input.value = ""; add(v); } };
	input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); go(); } });
	input.addEventListener("change", go);
	row.append(input, list, button("base-btn", "Add", go));
	return row;
}

// Which properties show, and in what order (drag the shown ones).
function propsPanel(box, ctx) {
	const r = ctx.fresh();
	if (r.error) return false;
	const { all } = catalog(r, ctx.host);
	const shown = r.columns;
	heading(box, "Properties", r.view.type === "table" ? "Tick what shows as columns. Drag to reorder." : "Tick what shows on each note. Drag to reorder.");
	const set = (order) => ctx.save((cfg, v) => { v.order = order; });
	const on = el("div", "base-proplist");
	shown.forEach((id, i) => {
		const row = el("label", "base-prop");
		row.dataset.sort = "";
		row.append(el("span", "base-grip", "⠿"));
		const box2 = el("input");
		box2.type = "checkbox";
		box2.checked = true;
		box2.addEventListener("change", () => set(shown.filter((_, k) => k !== i)));
		row.append(box2, el("span", "base-prop-name", nameOf(id, r)));
		on.append(row);
	});
	box.append(on);
	const s = sortable(on, { item: ".base-prop", layout: "list", onDrop: ({ from, to }) => set(reorder(shown, from, to)) });
	box._off = () => s.destroy();
	const rest = all.filter((id) => !shown.some((x) => sameProp(x, id)));
	if (rest.length) {
		box.append(el("div", "base-panel-sub", "Hidden"));
		const off = el("div", "base-proplist base-proplist-off");
		for (const id of rest) {
			const row = el("label", "base-prop");
			const b = el("input");
			b.type = "checkbox";
			b.addEventListener("change", () => set([...shown, id]));
			row.append(b, el("span", "base-prop-name", nameOf(id, r)));
			off.append(row);
		}
		box.append(off);
	}
}

// Rows of "property · condition · value", all or any of them.
function filterPanel(box, ctx) {
	const r = ctx.fresh();
	if (r.error) return false;
	const { notes, all } = catalog(r, ctx.host);
	const f = readFilters(r.view.filters);
	heading(box, "Filter");
	const put = (fn, redraw = true) => ctx.save((cfg, v) => { const g = readFilters(v.filters); fn(g); const out = writeFilters(g); if (out) v.filters = out; else delete v.filters; }, { redraw });
	if (f.rows.length > 1) {
		const mode = el("div", "base-row");
		mode.append(el("span", null, "Show notes that match"), select([["and", "all"], ["or", "any"]], f.mode, (m) => put((g) => { g.mode = m; })), el("span", null, "of these"));
		box.append(mode);
	}
	f.rows.forEach((row, i) => {
		if (row.raw != null) { box.append(rawRow(rawText(row.raw), row, () => put((g) => g.rows.splice(i, 1)))); return; }
		const type = typeOf(row.prop, r);
		const line = el("div", "base-row base-filter");
		const ids = all.some((x) => sameProp(x, row.prop)) ? all : [row.prop, ...all];
		line.append(select(ids.map((id) => [id, nameOf(id, r)]), all.find((x) => sameProp(x, row.prop)) ?? row.prop, (p) => put((g) => {
			const conds = conditionsFor(typeOf(p, r));
			g.rows[i] = { prop: p, op: conds.some((c) => c.op === g.rows[i].op) ? g.rows[i].op : conds[0].op, value: g.rows[i].value };
		}), "base-sel-prop"));
		const conds = conditionsFor(type);
		const cond = conds.find((c) => c.op === row.op) || conds[0];
		line.append(select(conds.map((c) => [c.op, c.label]), cond.op, (op) => put((g) => { g.rows[i].op = op; })));
		if (cond.arg) {
			const input = el("input", "base-input");
			input.dataset.focus = "f" + i;
			if (cond.arg === "number" || cond.arg === "days") { input.type = "number"; input.step = "any"; }
			else if (cond.arg === "date") input.type = "date";
			else {
				const list = suggestions(valuesOf(r.rows.map((x) => x.value(row.prop))));
				input.setAttribute("list", list.id);
				line.append(list);
			}
			input.value = row.value ?? "";
			const commitValue = () => { if (String(input.value) !== String(row.value ?? "")) put((g) => { g.rows[i].value = input.value; }, false); };
			input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); commitValue(); } });
			input.addEventListener("change", commitValue);
			line.append(input);
			if (cond.arg === "days") line.append(el("span", null, "days"));
		}
		line.append(button("base-x", "×", () => put((g) => g.rows.splice(i, 1)), "Remove this filter"));
		box.append(line);
	});
	box.append(button("base-btn base-add", "+ Add filter", () => put((g) => {
		const prop = r.columns.find((c) => noteKey(c) && !/^file\./.test(c)) || notes[0] || "file.name";
		g.rows.push({ prop, op: conditionsFor(typeOf(prop, r))[0].op, value: "" });
	})));
}

function rawRow(text, row, remove) {
	const line = el("div", "base-row base-raw");
	line.append(el("code", null, text ?? rawText(row.raw)), button("base-x", "×", remove, "Remove"));
	line.title = "Written by hand in the board's settings. It still applies; edit it with </>.";
	return line;
}

// Sort levels, or the binder's order.
function sortPanel(box, ctx) {
	const r = ctx.fresh();
	if (r.error) return false;
	const { all } = catalog(r, ctx.host);
	heading(box, "Sort");
	const binder = r.view.wr1t3r?.sort === "binder";
	const top = el("div", "base-row");
	top.append(el("span", null, "Order by"), select([["props", "properties"], ["binder", "binder order"]], binder ? "binder" : "props", (m) => ctx.save((cfg, v) => {
		const x = extra(v);
		if (m === "binder") x.sort = "binder"; else delete x.sort;
	})));
	box.append(top);
	if (binder) {
		box.append(el("p", "base-panel-hint", "Notes follow each folder's corkboard order (its _Binder.md)."));
		return;
	}
	const sorts = (Array.isArray(r.view.sort) ? r.view.sort : []).filter((s) => s && s.property);
	const put = (fn) => ctx.save((cfg, v) => { const s = (Array.isArray(v.sort) ? v.sort : []).filter((x) => x && x.property); fn(s); if (s.length) v.sort = s; else delete v.sort; });
	const listEl = el("div", "base-sortlist");
	sorts.forEach((s, i) => {
		const line = el("div", "base-row base-sort-row");
		line.dataset.sort = "";
		const id = all.find((x) => sameProp(x, s.property)) ?? String(s.property);
		line.append(el("span", "base-grip", "⠿"));
		line.append(select((all.includes(id) ? all : [id, ...all]).map((p) => [p, nameOf(p, r)]), id, (p) => put((a) => { a[i].property = p; })));
		line.append(select([["ASC", "A → Z, 1 → 9"], ["DESC", "Z → A, 9 → 1"]], String(s.direction || "ASC").toUpperCase(), (d) => put((a) => { a[i].direction = d; })));
		line.append(button("base-x", "×", () => put((a) => a.splice(i, 1)), "Remove this sort"));
		listEl.append(line);
	});
	box.append(listEl);
	const s = sortable(listEl, { item: ".base-sort-row", layout: "list", onDrop: ({ from, to }) => put((a) => { const next = reorder(a, from, to); a.splice(0, a.length, ...next); }) });
	box._off = () => s.destroy();
	box.append(button("base-btn base-add", "+ Add sort", () => put((a) => a.push({ property: all.find((p) => !a.some((x) => sameProp(x.property, p))) || "file.name", direction: "ASC" }))));
}

function groupPanel(box, ctx) {
	const r = ctx.fresh();
	if (r.error) return false;
	const { all } = catalog(r, ctx.host);
	heading(box, "Group");
	const g = r.view.groupBy && (typeof r.view.groupBy === "string" ? { property: r.view.groupBy } : r.view.groupBy);
	const cur = g?.property ? all.find((x) => sameProp(x, g.property)) ?? String(g.property) : "";
	const line = el("div", "base-row");
	line.append(el("span", null, "Group by"), select([["", "nothing"], ...all.map((p) => [p, nameOf(p, r)])], cur, (p) => ctx.save((cfg, v) => {
		if (!p) delete v.groupBy; else v.groupBy = { property: p, direction: g?.direction || "ASC" };
	})));
	box.append(line);
	if (cur) {
		const d = el("div", "base-row");
		d.append(el("span", null, "Groups"), select([["ASC", "A → Z"], ["DESC", "Z → A"]], String(g.direction || "ASC").toUpperCase(), (dir) => ctx.save((cfg, v) => { v.groupBy = { property: cur, direction: dir }; })));
		box.append(d);
	}
}

// The view's type, and what that type can change.
function layoutPanel(box, ctx) {
	const r = ctx.fresh();
	if (r.error) return false;
	const { notes, all } = catalog(r, ctx.host);
	const v = r.view;
	heading(box, "Layout");
	const row = (label, control) => { const l = el("div", "base-row"); l.append(el("span", "base-row-label", label), control); box.append(l); return l; };
	const type = VIEW_TYPES.some((x) => x.type === v.type) ? v.type : "table";
	row("Show as", select(VIEW_TYPES.map((x) => [x.type, x.label]), type, (ty) => ctx.save((cfg, view) => {
		view.type = ty;
		if ((ty === "calendar" || ty === "timeline") && !view.wr1t3r?.date) {
			const guess = guessDate(r, notes);
			if (guess) extra(view).date = guess;
		}
		if (ty === "kanban" && !view.groupBy) {
			// A board needs lanes: the first property that looks like a status.
			const guess = notes.find((p) => /status|shelf|stage|state/i.test(p)) || notes.find((p) => typeOf(p, r) !== "list" && typeOf(p, r) !== "date");
			if (guess) view.groupBy = { property: guess, direction: "ASC" };
		}
	})));
	const imageId = v.image ? String(v.image) : "";
	if (type === "cards" || type === "list" || type === "kanban") {
		const ids = all.filter((p) => p !== "file.name");
		const cur = imageId ? ids.find((p) => sameProp(p, imageId)) ?? imageId : "";
		row("Cover", select([["", "none"], ...(!cur || ids.includes(cur) ? ids : [cur, ...ids]).map((p) => [p, nameOf(p, r)])], cur, (p) => ctx.save((cfg, view) => {
			if (!p) delete view.image; else view.image = /^(file|formula)\./.test(p) ? p : "note." + p.replace(/^note\./, "");
		})));
	}
	if (type === "cards" || type === "kanban") {
		if (imageId) {
			row("Picture", select([["cover", "fill the card"], ["contain", "fit inside"]], v.imageFit === "contain" ? "contain" : "cover", (fit) => ctx.save((cfg, view) => { if (fit === "cover") delete view.imageFit; else view.imageFit = fit; })));
			row("Shape", select(SHAPES, SHAPES.some(([s]) => s && Number(s) === Number(v.imageAspectRatio)) ? SHAPES.find(([s]) => s && Number(s) === Number(v.imageAspectRatio))[0] : "", (s) => ctx.save((cfg, view) => { if (!s) delete view.imageAspectRatio; else view.imageAspectRatio = Number(s); })));
		}
	}
	if (type === "cards") {
		const size = CARD_SIZES.find(([s]) => Number(s) === Number(v.cardSize))?.[0] ?? (v.cardSize ? String(v.cardSize) : "220");
		row("Card size", select(CARD_SIZES.some(([s]) => s === size) ? CARD_SIZES : [[size, size + "px"], ...CARD_SIZES], size, (s) => ctx.save((cfg, view) => { if (s === "220") delete view.cardSize; else view.cardSize = Number(s); })));
	}
	if (type === "calendar" || type === "timeline") {
		const pickDate = (which, none) => {
			const cur = v.wr1t3r?.[which] ? notes.find((p) => sameProp(p, v.wr1t3r[which])) ?? String(v.wr1t3r[which]) : "";
			return select([["", none], ...(cur && !notes.includes(cur) ? [cur, ...notes] : notes).map((p) => [p, nameOf(p, r)])], cur, (p) => ctx.save((cfg, view) => {
				const x = extra(view);
				if (p) x[which] = p; else delete x[which];
			}));
		};
		row("Date from", pickDate("date", "pick a property"));
		if (type === "timeline") row("Ends on", pickDate("end", "one day per note"));
	}
	if (type === "kanban") {
		const g = v.groupBy && (typeof v.groupBy === "string" ? { property: v.groupBy } : v.groupBy);
		const cur = g?.property ? notes.find((p) => sameProp(p, g.property)) ?? String(g.property) : "";
		row("Lanes from", select([["", "pick a property"], ...(cur && !notes.includes(cur) ? [cur, ...notes] : notes).map((p) => [p, nameOf(p, r)])], cur, (p) => ctx.save((cfg, view) => {
			if (!p) delete view.groupBy; else view.groupBy = { property: p, direction: "ASC" };
			const x = extra(view);
			delete x.lanes; delete x.hidden;
		})));
		const hide = el("input");
		hide.type = "checkbox";
		hide.checked = !!v.wr1t3r?.hideEmpty;
		hide.addEventListener("change", () => ctx.save((cfg, view) => { const x = extra(view); if (hide.checked) x.hideEmpty = true; else delete x.hideEmpty; }));
		row("Hide empty lanes", hide);
	}
	const lim = el("input", "base-input base-num");
	lim.type = "number";
	lim.min = "0";
	lim.placeholder = "all";
	lim.value = v.limit > 0 ? String(v.limit) : "";
	lim.dataset.focus = "limit";
	const setLimit = () => ctx.save((cfg, view) => { const n = Math.floor(Number(lim.value)); if (n > 0) view.limit = n; else delete view.limit; }, { redraw: false });
	lim.addEventListener("change", setLimit);
	lim.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") setLimit(); });
	row("Show at most", lim).append(el("span", null, "notes"));
}

// ---- Cells ------------------------------------------------------------------------

// Drawing and editing one note's value, the same in every layout.
function cellTools(ctx, r, editable) {
	const types = new Map();
	const optionsCache = new Map();
	const typeFor = (id) => { if (!types.has(id)) types.set(id, typeOf(id, r)); return types.get(id); };
	const optionsFor = (id) => { if (!optionsCache.has(id)) optionsCache.set(id, valuesOf((r.rows || []).map((x) => x.value(id)))); return optionsCache.get(id); };
	const draw = (v, into, id, opts = {}) => drawValue(v, into, ctx.open, { image: IMAGE_PROP.test(id), checkbox: noteKey(id) && typeFor(id) === "checkbox", ...opts });
	const edit = (cell, row, id, value) => {
		const k = noteKey(id);
		if (!editable || !k || !ctx.host?.write) return;
		const type = typeFor(id);
		cell.classList.add("md-base-editable");
		const write = (v) => ctx.host.write(row.path, (text) => setProperty(text, k, v));
		if (type === "checkbox") {
			const box = cell.querySelector("input[type=checkbox]");
			if (box) {
				box.disabled = false;
				box.addEventListener("change", () => write(box.checked));
			}
			return;
		}
		cell.addEventListener("click", (e) => {
			if (e.target.closest("a, input, button, .md-base-listedit")) return;
			e.stopPropagation();
			editValue(cell, {
				type, value, options: optionsFor(id),
				save: (v) => { cell.replaceChildren(); draw(v instanceof Array ? v : v, cell, id); write(v); },
				cancel: () => { cell.replaceChildren(); draw(value, cell, id); },
			});
		});
	};
	return { draw, edit, typeFor };
}

// ---- Grid ---------------------------------------------------------------------------

function grid(ctx, r, editable, cells, wrap) {
	const sort = pick(ctx.key).sort;
	const sizes = r.view.columnSize && typeof r.view.columnSize === "object" ? r.view.columnSize : {};
	const box = el("div", "md-base-scroll");
	const table = el("table", "md-base-table");
	const head = table.createTHead().insertRow();
	const widthOf = (id) => { const k = Object.keys(sizes).find((x) => sameProp(x, id)); return k ? Number(sizes[k]) : 0; };
	const size = (cell, w) => { if (w > 0) { cell.style.width = cell.style.minWidth = cell.style.maxWidth = w + "px"; } };
	r.columns.forEach((id, c) => {
		const th = el("th");
		th.dataset.col = c;
		th.dataset.sort = "";
		const label = el("span", "md-base-th", r.names[c]);
		if (sort?.property === id) label.append(sort.direction === "DESC" ? " ▾" : " ▴");
		th.append(label);
		th.title = "Sort by " + r.names[c] + (editable ? " (drag to move)" : "");
		size(th, widthOf(id));
		th.addEventListener("click", (e) => {
			if (e.target.closest(".md-base-resize")) return;
			const next = sort?.property !== id ? { property: id, direction: "ASC" } : sort.direction === "ASC" ? { property: id, direction: "DESC" } : null;
			ctx.repick({ sort: next });
		});
		if (editable) th.append(resizer(ctx, table, th, id, c));
		head.append(th);
	});
	if (editable) {
		const s = sortable(head, { item: "th", layout: "grid", onDrop: ({ from, to }) => ctx.save((cfg, v) => { v.order = reorder(r.columns, from, to); }) });
		wrap._off.push(() => s.destroy());
	}
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
				td.dataset.col = c;
				size(td, widthOf(r.columns[c]));
				cells.draw(v, td, r.columns[c]);
				cells.edit(td, row, r.columns[c], v);
			});
		}
	}
	totals(ctx, r, editable, table, widthOf, size);
	box.append(table);
	wrap.append(box);
}

// The totals row under the grid: each column's summary (Sum, Average, a
// count...), picked by clicking its cell and saved in the view's summaries:.
function totals(ctx, r, editable, table, widthOf, size) {
	const set = r.columns.map((id) => summaryFor(r.view, id, sameProp));
	if (!editable && !set.some(Boolean)) return;
	const rows = r.groups.flatMap((g) => g.rows);
	const foot = table.createTFoot().insertRow();
	foot.className = "md-base-totals";
	r.columns.forEach((id, c) => {
		const td = foot.insertCell();
		td.dataset.col = c;
		size(td, widthOf(id));
		const name = set[c];
		if (name) {
			const label = SUMMARIES.find(([n]) => n === name)?.[1] || name;
			td.append(el("span", "md-base-total-name", label + " "), el("span", "md-base-total", summarize(name, rows.map((row) => row.value(id)))));
		} else if (editable) td.append(el("span", "md-base-total-add", "Total"));
		if (!editable) return;
		td.classList.add("pick");
		td.title = "Pick a total for " + r.names[c];
		td.addEventListener("click", (e) => {
			const choose = (n) => ctx.save((cfg, v) => {
				const s = v.summaries && typeof v.summaries === "object" ? v.summaries : {};
				for (const k of Object.keys(s)) if (sameProp(k, id)) delete s[k];
				if (n) s[id] = n;
				if (Object.keys(s).length) v.summaries = s; else delete v.summaries;
			});
			menu([...SUMMARIES.map(([n, l]) => [(n === name ? "✓ " : "") + l, () => choose(n)]), null, ["None", () => choose(null)]], e.clientX, e.clientY);
		});
	});
}

// The handle on a column head's right edge: drag to size the column, double
// click to let it size itself again.
function resizer(ctx, table, th, id, c) {
	const h = el("span", "md-base-resize no-drag");
	h.title = "Drag to resize";
	h.addEventListener("pointerdown", (e) => {
		e.preventDefault();
		e.stopPropagation();
		const start = e.clientX, w0 = th.getBoundingClientRect().width;
		let w = w0;
		const cellsOf = () => table.querySelectorAll(`[data-col="${c}"]`);
		const move = (ev) => {
			w = Math.max(48, Math.round(w0 + ev.clientX - start));
			for (const cell of cellsOf()) cell.style.width = cell.style.minWidth = cell.style.maxWidth = w + "px";
		};
		const up = () => {
			window.removeEventListener("pointermove", move, true);
			window.removeEventListener("pointerup", up, true);
			document.documentElement.classList.remove("base-resizing");
			if (Math.abs(w - w0) > 2) ctx.save((cfg, v) => {
				const sizes = v.columnSize && typeof v.columnSize === "object" ? v.columnSize : {};
				for (const k of Object.keys(sizes)) if (sameProp(k, id)) delete sizes[k];
				sizes[id] = w;
				v.columnSize = sizes;
			});
		};
		document.documentElement.classList.add("base-resizing");
		window.addEventListener("pointermove", move, true);
		window.addEventListener("pointerup", up, true);
	});
	h.addEventListener("dblclick", (e) => {
		e.stopPropagation();
		ctx.save((cfg, v) => {
			const sizes = v.columnSize && typeof v.columnSize === "object" ? v.columnSize : null;
			if (!sizes) return false;
			for (const k of Object.keys(sizes)) if (sameProp(k, id)) delete sizes[k];
			if (!Object.keys(sizes).length) delete v.columnSize;
		});
	});
	h.addEventListener("click", (e) => e.stopPropagation());
	return h;
}

// ---- Gallery, List ----------------------------------------------------------------

// A note as a card: picture, title, the shown properties (editable).
function noteCard(ctx, r, row, cells, { menu: cardMenu = null } = {}) {
	const imageId = r.view.image ? String(r.view.image) : null;
	const cover = imageId ? coverFor(ctx.host, row, imageId) : null;
	const card = makeCard({ title: row.file.name, text: "", color: labelColor(row), cover, open: () => ctx.open(row.path), menu: cardMenu });
	card.dataset.path = row.path;
	card.querySelector(".card-text")?.remove();
	if (imageId) {
		// Shows when there's no picture, or it can't load (offline, gone).
		const blank = el("div", "card-cover card-blank", row.file.name.slice(0, 1).toUpperCase());
		card.insertBefore(blank, card.querySelector(".card-head"));
	}
	const props = el("div", "md-base-cardprops");
	row.values.forEach((v, c) => {
		const id = r.columns[c];
		if (id === "file.name" || (imageId && sameProp(id, imageId)) || v == null || v === "" || (Array.isArray(v) && !v.length)) return;
		const line = el("div", "md-base-prop");
		line.append(el("span", "md-base-label", r.names[c]));
		const val = el("span", "md-base-value");
		cells.draw(v, val, id);
		cells.edit(val, row, id, v);
		line.append(val);
		props.append(line);
	});
	if (props.childNodes.length) card.append(props);
	return card;
}

function galleryStyle(target, v) {
	const size = Number(v.cardSize) > 0 ? Number(v.cardSize) : 220;
	target.style.setProperty("--card-min", size + "px");
	if (Number(v.imageAspectRatio) > 0) target.style.setProperty("--card-ar", `1 / ${Number(v.imageAspectRatio)}`);
	if (v.imageFit === "contain") target.classList.add("fit-contain");
}

function gallery(ctx, r, editable, cells, wrap) {
	const out = el("div", "md-base-galleries");
	for (const g of r.groups) {
		if (g.key !== null) out.append(el("div", "md-base-group", g.key || "(none)"));
		const box = el("div", "md-base-gallery");
		galleryStyle(box, r.view);
		for (const row of g.rows) box.append(noteCard(ctx, r, row, cells));
		out.append(box);
	}
	wrap.append(out);
}

function list(ctx, r, editable, cells, wrap) {
	const imageId = r.view.image ? String(r.view.image) : null;
	const out = el("div", "md-base-list");
	for (const g of r.groups) {
		if (g.key !== null) out.append(el("div", "md-base-group", g.key || "(none)"));
		for (const row of g.rows) {
			const item = el("div", "md-base-item");
			if (imageId) {
				const pic = el("div", "md-base-pic");
				const src = coverFor(ctx.host, row, imageId);
				if (src) {
					const img = el("img", "md-base-cover");
					img.alt = "";
					img.loading = "lazy";
					img.referrerPolicy = "no-referrer";
					img.addEventListener("error", () => img.remove());
					Promise.resolve(src).then((u) => { if (u) img.src = u; else img.remove(); });
					pic.append(img);
				}
				item.append(pic);
			}
			const name = el("div", "md-base-name");
			drawValue(new BLink(row.path, row.file.name), name, ctx.open);
			item.append(name);
			const pills = el("div", "md-base-pills");
			row.values.forEach((v, c) => {
				const id = r.columns[c];
				if (id === "file.name" || (imageId && sameProp(id, imageId)) || v == null || v === "" || (Array.isArray(v) && !v.length)) return;
				const val = el("span", "md-base-chipval");
				val.title = r.names[c];
				cells.draw(v, val, id);
				cells.edit(val, row, id, v);
				pills.append(val);
			});
			item.append(pills);
			out.append(item);
		}
	}
	wrap.append(out);
}

// ---- Kanban --------------------------------------------------------------------------

function kanban(ctx, r, editable, cells, wrap) {
	const v = r.view;
	const g = v.groupBy && (typeof v.groupBy === "string" ? { property: v.groupBy } : v.groupBy);
	const prop = g?.property ? String(g.property) : null;
	const key = prop && noteKey(prop);
	if (!prop) {
		wrap.append(el("div", "md-base-empty", editable ? "Pick the property whose values become the lanes (Kanban > Lanes from)." : "This Kanban view has no lanes set."));
		return;
	}
	const x = v.wr1t3r || {};
	const hidden = (Array.isArray(x.hidden) ? x.hidden : []).map(String);
	const all = lanesFor(r.rows, prop, Array.isArray(x.lanes) ? x.lanes : []);
	if (String(g.direction).toUpperCase() === "DESC" && !Array.isArray(x.lanes)) all.reverse();
	const lanes = all.filter((l) => !hidden.includes(l.key) && !(x.hideEmpty && !l.count));
	const canMove = editable && !!key && !!ctx.host?.write;
	const name = nameOf(prop, r);
	const laneTitle = (k) => (k === "" ? "No " + name : k);
	const saveLanes = (fn) => ctx.save((cfg, view) => {
		const e = extra(view);
		const order = Array.isArray(e.lanes) ? e.lanes.map(String) : all.map((l) => l.key);
		for (const l of all) if (!order.includes(l.key)) order.push(l.key);
		const res = fn(e, order);
		if (res === false) return false;
		e.lanes = order;
	});

	const board = el("div", "md-base-board");
	const byPath = new Map(r.rows.map((row) => [row.path, row]));
	const move = (path, from, to) => {
		const row = byPath.get(path);
		if (!row || from === to || !canMove) return;
		ctx.host.write(path, (text) => setProperty(text, key, moveValue(row.value(prop), from, to)));
	};
	for (const lane of lanes) {
		const col = el("section", "md-base-lane");
		col.dataset.lane = lane.key;
		const head = el("div", "md-base-lanehead");
		head.append(el("span", "md-base-lanename", laneTitle(lane.key)), el("span", "md-base-lanecount", String(lane.count)));
		if (editable) {
			if (canMove && ctx.host?.create) head.append(button("md-base-laneadd", "+", () => newNote(ctx, { [key]: laneValue(r, prop, lane.key) }), `New note in ${laneTitle(lane.key)}`));
			const laneMenu = (mx, my) => {
				const i = lanes.indexOf(lane);
				const items = [];
				if (i > 0) items.push(["Move left", () => saveLanes((e, order) => { const a = order.indexOf(lane.key), b = order.indexOf(lanes[i - 1].key); order.splice(a, 1); order.splice(b, 0, lane.key); })]);
				if (i < lanes.length - 1) items.push(["Move right", () => saveLanes((e, order) => { const a = order.indexOf(lane.key), b = order.indexOf(lanes[i + 1].key); order.splice(a, 1); order.splice(b + (b > a ? 0 : 1), 0, lane.key); })]);
				items.push(["Hide lane", () => ctx.save((cfg, view) => { const e = extra(view); e.hidden = [...new Set([...(Array.isArray(e.hidden) ? e.hidden.map(String) : []), lane.key])]; })]);
				menu(items, mx, my);
			};
			head.append(button("md-base-lanemore", "⋯", (e) => { const rc = e.currentTarget.getBoundingClientRect(); laneMenu(rc.left, rc.bottom + 4); }, "Lane options"));
			onMenu(head, laneMenu);
		}
		col.append(head);
		const body = el("div", "md-base-lanebody");
		body.dataset.lane = lane.key;
		for (const row of r.rows) {
			if (!laneKeys(row, prop).includes(lane.key)) continue;
			const card = noteCard(ctx, r, row, cells, {
				menu: canMove ? (mx, my) => menu([
					["Open", () => ctx.open(row.path)],
					null,
					...lanes.filter((l) => l.key !== lane.key).map((l) => [`Move to ${laneTitle(l.key)}`, () => move(row.path, lane.key, l.key)]),
				], mx, my) : null,
			});
			body.append(card);
		}
		col.append(body);
		if (canMove) {
			const s = sortable(body, {
				item: ".card",
				group: "kanban:" + ctx.key,
				layout: "list",
				onDrop: ({ el: card, source, target }) => move(card.dataset.path, source.dataset.lane, target.dataset.lane),
				onHold: (card, hx, hy) => card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: hx, clientY: hy })),
			});
			wrap._off.push(() => s.destroy());
			// A card's press is the card's, not the lane's (lanes move by their heads).
			body.addEventListener("pointerdown", (e) => { if (e.target.closest(".card")) e.stopPropagation(); });
		}
		board.append(col);
	}
	if (editable) {
		const tail = el("div", "md-base-lanetail");
		if (canMove) tail.append(button("base-btn", "+ Add lane", () => {
			const val = prompt(`New lane (a value of ${name}):`);
			if (!val || !val.trim()) return;
			saveLanes((e, order) => { if (order.includes(val.trim())) return false; order.push(val.trim()); });
		}));
		if (hidden.length) tail.append(button("base-btn", `Show hidden lanes (${hidden.length})`, () => ctx.save((cfg, view) => { delete extra(view).hidden; })));
		if (tail.childNodes.length) board.append(tail);
		const s = sortable(board, {
			item: ".md-base-lane",
			group: "lanes:" + ctx.key,
			layout: "grid",
			onDrop: ({ from, to }) => {
				const next = reorder(lanes.map((l) => l.key), from, to);
				saveLanes((e, order) => {
					// The shown lanes take the new order; hidden ones keep their places after.
					const rest = order.filter((k) => !next.includes(k));
					order.splice(0, order.length, ...next, ...rest);
				});
			},
		});
		wrap._off.push(() => s.destroy());
	}
	wrap.append(board);
}

// The value a lane stands for, typed like the notes' values.
function laneValue(r, prop, laneKey) {
	if (laneKey === "") return null;
	const sample = r.rows.map((x) => x.value(prop)).find((v) => v != null && v !== "");
	if (Array.isArray(sample)) return [laneKey];
	if (typeof sample === "number" && /^[-+]?\d+(\.\d+)?$/.test(laneKey)) return Number(laneKey);
	if (typeof sample === "boolean") return laneKey === "true";
	return laneKey;
}

// ---- New notes ------------------------------------------------------------------------

// A note made from the view: in the source folder (or the base's), already
// holding what the filters ask for, so it shows up in the view; then opened.
async function newNote(ctx, props = {}) {
	const r = ctx.fresh();
	if (r.error || !ctx.host?.create) return;
	const src = readSource(r.base.filters);
	const viewSrc = readSource(r.view.filters);
	const here = ctx.path.slice(0, ctx.path.lastIndexOf("/"));
	const folder = (src.folders[0] ?? viewSrc.folders[0] ?? here).replace(/\/+$/, "");
	const noteName = prompt(`New note in ${folder.replace(/^content\/?/, "") || "the vault"}:`, "Untitled");
	if (noteName == null) return;
	const clean = noteName.trim().replace(/\.md$/i, "").replace(/[\\/:*?"<>|#^[\]]/g, " ").trim() || "Untitled";
	const fill = { ...prefill([r.base.filters, r.view.filters]), ...props };
	const tags = [...src.tags, ...viewSrc.tags];
	await ctx.host.create(folder ? folder + "/" : "", clean, (path) => {
		let text = ctx.host.newNoteText?.(path) ?? "";
		if (tags.length) {
			const have = parseFrontmatter(text).tags;
			const list = [...(Array.isArray(have) ? have : have ? [have] : []).map(String), ...tags].filter((t, i, a) => a.indexOf(t) === i);
			text = setProperty(text, "tags", list);
		}
		for (const [k, v] of Object.entries(fill)) if (v != null) text = setProperty(text, k, v);
		return text;
	});
}

// ---- Around the widget --------------------------------------------------------------

// "Show base" over a .base note's YAML.
class SourceBar extends WidgetType {
	eq() { return true; }
	toDOM(view) {
		const bar = el("div", "md-base-sourcebar");
		const b = el("button", "md-base-back", "▦ Show board");
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
	const editable = !!host.write && state.facet(EditorView.editable) && !state.readOnly;
	if (isBase(path)) {
		if (state.field(showSource, false)) b.add(0, 0, Decoration.widget({ widget: new SourceBar(), block: true, side: -1 }));
		else {
			const t = { whole: true, index: 0, key: path };
			const w = new BaseWidget(t, path, resultFor(state, state.sliceDoc(), path, path), editable);
			if (state.doc.length) b.add(0, state.doc.length, Decoration.replace({ widget: w, block: true }));
			else b.add(0, 0, Decoration.widget({ widget: w, block: true, side: 1 }));
		}
		return b.finish();
	}
	dataviewBlocks(state, BOARD_FENCES).forEach((blk, i) => {
		if (isOpen(state, blk)) return; // opened as text with its </> button
		const t = { whole: false, index: i, key: path + "\0" + i, look: boardLook(blk.code) };
		b.add(blk.from, blk.to, Decoration.replace({ widget: new BaseWidget(t, path, resultFor(state, blk.code, path, t.key), editable), block: true }));
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

// A panel left open when its base goes away (another note opened) closes.
const panelCleanup = EditorView.updateListener.of((u) => {
	if (u.startState.facet(notePath) !== u.state.facet(notePath)) closePanel();
});

export const bases = [showSource, guard, views, mode, panelCleanup];
