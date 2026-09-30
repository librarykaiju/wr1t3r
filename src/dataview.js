// ```dataviewjs blocks, drawn the way Obsidian's Dataview plugin draws them:
// while the cursor is outside a block, its output shows in place of the code
// (click "</>" or move into it to edit the code). Each block runs in
// public/dv-sandbox.html inside <iframe sandbox="allow-scripts">: an opaque
// origin with no token, no storage and no network, which gets the note's
// Dataview page (src/dvpage.js) plus the pages of notes in the same folder or
// linked from it, and asks the app for anything else (a note's text, a web
// page through the clipper's /api/fetch). Scripts can't write: vault.modify
// and processFrontMatter do nothing here, so wr1t3r never changes a note
// behind your back. Blocks in _clippings/ and _uploads/ (text from outside
// the vault) are never run.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, ViewPlugin } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { pageFrom, linkedNames } from "./dvpage.js";
import { resolveNote, linkOpener } from "./links.js";
import { noteLinks } from "./vaultlinks.js";
import { vaultHost as dvHost, notePath, vaultChanged } from "./vault.js";
import { runQuery, show, DQLLink, DQLDate } from "./dql.js";
import { tickInText } from "./tasks.js";


const SANDBOX = "/dv-sandbox"; // public/dv-sandbox.html
const UNTRUSTED = /(^|\/)_(clippings|uploads)\//i;
const MAX_PAGES = 300;
const MAX_ALL = 5000; // dv.pages() gets every note, up to this many

// Page objects, rebuilt only when a note's text changes.
const pageCache = new Map();
function cachedPage(path, text, paths) {
	const hit = pageCache.get(path);
	if (hit && hit.text === text && hit.paths === paths) return hit.page;
	const page = pageFrom(path, text);
	page.file.outlinks = [...new Set(noteLinks(text).map((l) => (l.note ? resolveNote({ note: l.note, wiki: l.kind === "wiki" }, path, paths) : null)).filter(Boolean))];
	pageCache.set(path, { text, paths, page });
	return page;
}

// The dataviewjs fences in a note: [{ from, to, code }] (from/to cover the whole fence).
export function dataviewBlocks(state, lang = "dataviewjs") {
	const out = [];
	syntaxTree(state).iterate({
		enter(n) {
			if (n.name !== "FencedCode") return;
			const info = n.node.getChild("CodeInfo");
			if (!info || state.sliceDoc(info.from, info.to).trim().toLowerCase() !== lang) return false;
			const text = n.node.getChild("CodeText");
			const last = state.doc.lineAt(n.to);
			if (!/^\s*(`{3,}|~{3,})\s*$/.test(last.text) || last.number === state.doc.lineAt(n.from).number) return false; // not closed yet
			const first = state.doc.lineAt(n.from);
			out.push({ from: first.from, to: last.to, code: text ? state.sliceDoc(text.from, text.to) : "", codeFrom: text ? text.from : Math.min(first.to + 1, last.from), codeTo: text ? text.to : Math.min(first.to + 1, last.from) });
			return false;
		},
	});
	return out;
}

// Theme colors for the sandbox, under the names Obsidian scripts use.
function theme() {
	const cs = getComputedStyle(document.documentElement);
	const v = (n) => cs.getPropertyValue(n).trim();
	const bg = v("--bg") || "#fff";
	const rgb = (bg.match(/\d+/g) || [255, 255, 255]).map(Number);
	const hex = bg.startsWith("#") ? bg.slice(1) : null;
	const [r, g, b] = hex && hex.length >= 6 ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) : rgb;
	const dark = 0.299 * r + 0.587 * g + 0.114 * b < 128;
	const ed = document.querySelector(".cm-content");
	return {
		dark,
		vars: {
			"--text-normal": v("--fg"), "--text-muted": v("--muted"), "--text-faint": v("--muted"),
			"--text-accent": v("--accent"), "--interactive-accent": v("--accent"),
			"--background-primary": v("--card") || bg, "--background-secondary": v("--panel") || bg,
			"--background-modifier-border": v("--line"),
			"--font-text": v("--sans") || "system-ui, sans-serif", "--font-monospace": v("--mono"),
			"--font-size": ed ? getComputedStyle(ed).fontSize : "16px",
		},
	};
}

// What the script can see: its note's page, the pages of notes near it, and every note's path.
function payload(view, code) {
	const host = view.state.facet(dvHost);
	const path = view.state.facet(notePath);
	const text = view.state.sliceDoc();
	const paths = host.paths();
	const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
	const wanted = new Set(paths.filter((p) => p.startsWith(folder) && !p.slice(folder.length).includes("/")).slice(0, MAX_PAGES));
	for (const name of linkedNames(text)) {
		const hit = resolveNote({ note: name, wiki: true }, path, paths);
		if (hit) wanted.add(hit);
	}
	// Scripts that query the vault (dv.pages) get every note's page.
	const all = /\bdv\.(pages|pagePaths)\s*\(/.test(code);
	if (all) for (const p of paths.filter((x) => !UNTRUSTED.test(x)).slice(0, MAX_ALL)) wanted.add(p);
	const pages = {};
	for (const p of wanted) {
		const t = p === path ? text : host.text(p);
		if (t != null) pages[p] = cachedPage(p, t, paths);
	}
	pages[path] = cachedPage(path, text, paths);
	// Which notes link to each one (file.inlinks).
	if (all) {
		for (const pg of Object.values(pages)) pg.file.inlinks = [];
		for (const pg of Object.values(pages)) for (const o of pg.file.outlinks) pages[o]?.file.inlinks.push(pg.file.path);
	}
	return { type: "run", code, current: pages[path], pages, all, paths: paths.filter((p) => !UNTRUSTED.test(p)), theme: theme() };
}

const live = new Set(); // widgets on screen, to re-run when the note changes

// Ticking a task in a Dataview result ticks the real line in its note (with
// the done date, as ticking it there would). False when it couldn't be found.
function tick(view, path, line, text, checked) {
	const host = view.state.facet(dvHost);
	if (!host?.write || UNTRUSTED.test(path) || host.text(path) == null) return false;
	const now = path === view.state.facet(notePath) ? view.state.sliceDoc() : host.text(path);
	if (tickInText(now, line, text, checked) == null) return false;
	host.write(path, (t) => tickInText(t, line, text, checked) ?? t);
	return true;
}

// Folding. Blocks with only blank lines between them are a run (the daily
// note's health meters) and fold as one, to a strip with each block's summary.
// Remembered per device and keyed by the blocks' code, so every note made from
// the same template folds alike. The note's text never changes.
const FOLD_KEY = "wr1t3rDvFolded";
function foldedRuns() {
	try { return JSON.parse(localStorage.getItem(FOLD_KEY) || "[]"); } catch { return []; }
}
const isFolded = (run) => foldedRuns().includes(run);
function setFolded(run, on) {
	const list = foldedRuns().filter((r) => r !== run);
	if (on) list.push(run);
	try { localStorage.setItem(FOLD_KEY, JSON.stringify(list.slice(-200))); } catch {}
}

export function runKey(codes) {
	let h = 5381;
	for (const ch of codes.join("\0")) h = (h * 33 + ch.codePointAt(0)) >>> 0;
	return h.toString(36);
}

// Groups sorted blocks into runs: [[blk, ...], ...].
export function blockRuns(blocks, gap) {
	const runs = [];
	for (const blk of blocks) {
		const prev = runs.at(-1)?.at(-1);
		if (prev && !gap(prev.to, blk.from).trim()) runs.at(-1).push(blk);
		else runs.push([blk]);
	}
	return runs;
}

const runWraps = (view, run) => [...view.dom.querySelectorAll(".md-dv")].filter((w) => w.dataset.run === run);

function updateStrip(view, run) {
	const wraps = runWraps(view, run);
	const strip = wraps.find((w) => w.classList.contains("md-dv-lead"))?.querySelector(".md-dv-strip-text");
	if (!strip) return;
	const parts = wraps.map((w) => w.dvSummary).filter(Boolean);
	strip.textContent = parts.join(" · ") || (wraps.length > 1 ? `${wraps.length} blocks` : "Folded");
}

function toggleFold(view, run) {
	const on = !isFolded(run);
	setFolded(run, on);
	for (const w of runWraps(view, run)) w.classList.toggle("md-dv-folded", on);
	updateStrip(view, run);
	view.requestMeasure();
}

// The fold button, and (on the run's first block) the strip shown while folded.
function foldControls(view, wrap, fold, tools) {
	if (!fold) return;
	wrap.dataset.run = fold.run;
	wrap.classList.toggle("md-dv-folded", isFolded(fold.run));
	if (!fold.lead) return;
	wrap.classList.add("md-dv-lead");
	const noCursor = (e) => e.preventDefault();
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = "md-dv-fold";
	btn.textContent = "▾";
	btn.title = fold.count > 1 ? "Fold these blocks" : "Fold this block";
	btn.addEventListener("mousedown", noCursor);
	btn.addEventListener("click", () => toggleFold(view, fold.run));
	tools.prepend(btn);
	const strip = document.createElement("button");
	strip.type = "button";
	strip.className = "md-dv-strip";
	strip.title = "Unfold";
	const text = document.createElement("span");
	text.className = "md-dv-strip-text";
	strip.append("▸ ", text);
	strip.addEventListener("mousedown", noCursor);
	strip.addEventListener("click", () => toggleFold(view, fold.run));
	wrap.prepend(strip);
	requestAnimationFrame(() => updateStrip(view, fold.run)); // once the run's blocks are in the page
}

function toolsBar(wrap) {
	const tools = document.createElement("div");
	tools.className = "md-dv-tools";
	wrap.append(tools);
	return tools;
}

class DataviewWidget extends WidgetType {
	constructor(code, path, from, fold) { super(); this.code = code; this.path = path; this.from = from; this.fold = fold; }
	eq(o) { return o.code === this.code && o.path === this.path && o.fold?.run === this.fold?.run && o.fold?.lead === this.fold?.lead; }
	toDOM(view) {
		const wrap = document.createElement("div");
		wrap.className = "md-dv";
		const frame = document.createElement("iframe");
		frame.setAttribute("sandbox", "allow-scripts");
		frame.setAttribute("title", "dataviewjs output");
		frame.setAttribute("referrerpolicy", "no-referrer");
		frame.src = SANDBOX;
		const edit = document.createElement("button");
		edit.type = "button";
		edit.className = "md-dv-edit";
		edit.textContent = "</>";
		edit.title = "Edit the script";
		edit.addEventListener("mousedown", (e) => {
			e.preventDefault();
			let pos = this.from;
			try { pos = view.posAtDOM(wrap); } catch {}
			const line = view.state.doc.lineAt(pos);
			const at = Math.min(line.to + 1, view.state.doc.length);
			view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
			view.focus();
		});
		wrap.append(frame);
		toolsBar(wrap).append(edit);
		foldControls(view, wrap, this.fold, wrap.querySelector(".md-dv-tools"));

		const host = view.state.facet(dvHost);
		let ready = false;
		const send = () => {
			if (!ready || !frame.contentWindow) return;
			const msg = payload(view, this.code);
			frame.style.colorScheme = msg.theme.dark ? "dark" : "light"; // keeps the frame see-through
			frame.contentWindow.postMessage(msg, "*");
		};
		const reply = (req, value, error) => frame.contentWindow?.postMessage({ type: "reply", req, value, error }, "*");
		const onMessage = async (e) => {
			if (e.source !== frame.contentWindow || e.origin !== "null") return;
			const d = e.data || {};
			if (d.type === "ready") { ready = true; send(); }
			else if (d.type === "height") {
				frame.style.height = Math.min(Math.max(d.h, 0), 20000) + "px";
				view.requestMeasure();
			} else if (d.type === "tick") {
				// Only from a click in the block (the click's activation reaches this page).
				if (navigator.userActivation && !navigator.userActivation.isActive) return;
				tick(view, String(d.path || ""), Number(d.line), String(d.text ?? ""), !!d.checked);
			} else if (d.type === "summary") {
				wrap.dvSummary = String(d.text || "").slice(0, 120);
				if (this.fold) updateStrip(view, this.fold.run);
			} else if (d.type === "load") {
				let p = String(d.path || "").replace(/^\/+/, "");
				const paths = host.paths();
				const lower = new Map(paths.map((x) => [x.toLowerCase(), x]));
				p = lower.get(p.toLowerCase()) || lower.get((p + ".md").toLowerCase()) || resolveNote({ note: p, wiki: true }, view.state.facet(notePath), paths);
				if (!p || UNTRUSTED.test(p)) return reply(d.req, null);
				reply(d.req, p === view.state.facet(notePath) ? view.state.sliceDoc() : host.text(p));
			} else if (d.type === "open") {
				view.state.facet(linkOpener)?.({ note: String(d.note || ""), heading: "", wiki: true });
			} else if (d.type === "fetch") {
				try { reply(d.req, await host.fetch(String(d.url))); } catch (err) { reply(d.req, null, String(err?.message || err)); }
			}
		};
		window.addEventListener("message", onMessage);
		const entry = { view, send, wrap };
		live.add(entry);
		wrap.dvCleanup = () => { window.removeEventListener("message", onMessage); live.delete(entry); };
		return wrap;
	}
	destroy(dom) { dom.dvCleanup?.(); }
	ignoreEvent() { return true; }
	get estimatedHeight() { return 60; }
}

// ```dataview blocks (Dataview's query language): run here by src/dql.js, which
// reads the query rather than executing it, so they need no sandbox.
const queryCache = new Map(); // code+path -> { doc, result }; cleared when the vault changes
function queryResult(state, code, path) {
	const hit = queryCache.get(code + "\0" + path);
	if (hit && hit.doc === state.doc) return hit.result;
	const result = runFor(state, code, path);
	queryCache.set(code + "\0" + path, { doc: state.doc, result });
	return result;
}

function runFor(state, code, path) {
	const host = state.facet(dvHost);
	const paths = host.paths();
	const text = state.sliceDoc();
	const pages = {};
	for (const p of paths) {
		if (UNTRUSTED.test(p) && p !== path) continue;
		const t = p === path ? text : host.text(p);
		if (t != null) pages[p] = cachedPage(p, t, paths);
	}
	pages[path] = cachedPage(path, text, paths);
	for (const pg of Object.values(pages)) pg.file.inlinks = [];
	for (const pg of Object.values(pages)) for (const o of pg.file.outlinks) pages[o]?.file.inlinks.push(pg.file.path);
	try {
		return runQuery(code, pages, path, (name) => resolveNote({ note: name, wiki: true }, path, paths));
	} catch (err) {
		return { error: String(err?.message || err) };
	}
}

const fmt = (v) => {
	try { return JSON.stringify(v, (k, x) => (x instanceof DQLLink ? "L:" + x.path : x instanceof DQLDate ? "D:" + x.ms : x)); } catch { return String(Math.random()); }
};

// What a folded query block says in its strip.
export function querySummary(r) {
	const n = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
	if (r.error) return "Dataview error";
	if (r.type === "TABLE") return n(r.rows.length, "result");
	if (r.type === "LIST") return n(r.items.length, "item");
	const tasks = r.groups.flatMap((g) => g.tasks);
	return `${tasks.filter((t) => t.checked).length} of ${n(tasks.length, "task")} done`;
}

class QueryWidget extends WidgetType {
	constructor(code, path, from, result, fold) { super(); this.code = code; this.path = path; this.from = from; this.result = result; this.fold = fold; this.key = code + "\0" + path + "\0" + fmt(result) + "\0" + fold?.run + "\0" + fold?.lead; }
	eq(o) { return o.key === this.key; }
	toDOM(view) {
		const wrap = document.createElement("div");
		wrap.className = "md-dv md-dql";
		const go = (note) => view.state.facet(linkOpener)?.({ note, heading: "", wiki: true });
		const cell = (v) => {
			const span = document.createElement("span");
			const list = Array.isArray(v) ? v : [v];
			list.forEach((x, i) => {
				if (i) span.append(Array.isArray(v) && v.length > 1 && list.some((y) => y instanceof DQLLink) ? document.createElement("br") : ", ");
				if (x instanceof DQLLink) {
					const a = document.createElement("a");
					a.className = "md-dql-link";
					a.href = "#" + encodeURIComponent(x.path);
					a.textContent = x.name;
					a.addEventListener("mousedown", (e) => e.preventDefault());
					a.addEventListener("click", (e) => { e.preventDefault(); go(x.path); });
					span.append(a);
				} else if (x && typeof x === "object" && "text" in x && "checked" in x) {
					span.append((x.checked ? "☑ " : "☐ ") + x.text);
				} else span.append(show(x));
			});
			return span;
		};
		const r = this.result;
		if (r.error) {
			const p = document.createElement("div");
			p.className = "md-dql-error";
			p.textContent = "Dataview: " + r.error;
			wrap.append(p);
		} else if (r.type === "TABLE") {
			const t = document.createElement("table");
			const head = t.createTHead().insertRow();
			for (const h of r.headers) { const th = document.createElement("th"); th.textContent = h; head.append(th); }
			const body = t.createTBody();
			for (const row of r.rows) { const tr = body.insertRow(); for (const v of row) tr.insertCell().append(cell(v)); }
			const count = document.createElement("div");
			count.className = "md-dql-count";
			count.textContent = r.rows.length ? `${r.rows.length} result${r.rows.length === 1 ? "" : "s"}` : "No results";
			wrap.append(t, count);
		} else if (r.type === "LIST") {
			const ul = document.createElement("ul");
			for (const it of r.items) {
				const li = document.createElement("li");
				if (it.link != null) li.append(cell(it.link));
				if (it.value !== undefined) {
					if (it.link != null) li.append(": ");
					li.append(cell(it.value));
				}
				ul.append(li);
			}
			if (!r.items.length) ul.textContent = "No results";
			wrap.append(ul);
		} else {
			for (const g of r.groups) {
				const h = document.createElement("div");
				h.className = "md-dql-group";
				h.append(cell(g.link));
				const ul = document.createElement("ul");
				ul.className = "md-dql-tasks";
				for (const t of g.tasks) {
					const li = document.createElement("li");
					const box = document.createElement("input");
					box.type = "checkbox";
					box.checked = !!t.checked;
					box.disabled = view.state.readOnly || t.path == null;
					box.title = box.disabled ? "" : "Tick it in its note";
					box.addEventListener("mousedown", (e) => e.stopPropagation());
					box.addEventListener("change", () => {
						if (!tick(view, t.path, t.line, t.text, box.checked)) box.checked = !box.checked;
					});
					li.append(box, " " + t.text);
					ul.append(li);
				}
				wrap.append(h, ul);
			}
			if (!r.groups.length) wrap.append("No results");
		}
		const edit = document.createElement("button");
		edit.type = "button";
		edit.className = "md-dv-edit";
		edit.textContent = "</>";
		edit.title = "Edit the query";
		edit.addEventListener("mousedown", (e) => {
			e.preventDefault();
			let pos = this.from;
			try { pos = view.posAtDOM(wrap); } catch {}
			const line = view.state.doc.lineAt(pos);
			view.dispatch({ selection: { anchor: Math.min(line.to + 1, view.state.doc.length) }, scrollIntoView: true });
			view.focus();
		});
		toolsBar(wrap).append(edit);
		wrap.dvSummary = querySummary(r);
		foldControls(view, wrap, this.fold, wrap.querySelector(".md-dv-tools"));
		return wrap;
	}
	ignoreEvent() { return true; }
}

function build(state) {
	const b = new RangeSetBuilder();
	const path = state.facet(notePath);
	if (!state.facet(dvHost) || !path || UNTRUSTED.test(path)) return b.finish();
	const sel = state.selection.ranges;
	const found = [
		...dataviewBlocks(state).map((blk) => ({ ...blk, widget: (fold) => new DataviewWidget(blk.code, path, blk.from, fold) })),
		...dataviewBlocks(state, "dataview").map((blk) => ({ ...blk, widget: (fold) => new QueryWidget(blk.code, path, blk.from, queryResult(state, blk.code, path), fold) })),
	].sort((a, b) => a.from - b.from);
	for (const run of blockRuns(found, (f, t) => state.sliceDoc(f, t))) {
		const key = runKey(run.map((blk) => blk.code));
		let lead = true;
		for (const blk of run) {
			if (sel.some((r) => r.to >= blk.from && r.from <= blk.to)) continue; // being edited
			b.add(blk.from, blk.to, Decoration.replace({ widget: blk.widget({ run: key, lead, count: run.length }), block: true }));
			lead = false;
		}
	}
	return b.finish();
}

const blocks = StateField.define({
	create: build,
	update(deco, tr) {
		const vault = tr.effects.some((e) => e.is(vaultChanged));
		if (vault) queryCache.clear();
		if (tr.docChanged || tr.selection || vault || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

// Edits to the note re-run its blocks (after a pause), as Dataview does on save.
const rerun = ViewPlugin.fromClass(class {
	constructor() { this.timer = null; }
	update(u) {
		if (!u.docChanged) return;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => { for (const w of live) if (w.view === u.view && w.wrap.isConnected) w.send(); }, 700);
	}
	destroy() { clearTimeout(this.timer); }
});

// Re-sends every block on screen, e.g. after the theme changes (scripts get its colors).
export function rerunDataview() {
	for (const w of live) if (w.wrap.isConnected) w.send();
}

export const dataviewJs = [blocks, rerun];
