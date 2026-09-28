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
import { resolveNote } from "./links.js";
import { vaultHost as dvHost, notePath } from "./vault.js";


const SANDBOX = "/dv-sandbox"; // public/dv-sandbox.html
const UNTRUSTED = /(^|\/)_(clippings|uploads)\//i;
const MAX_PAGES = 300;

// The dataviewjs fences in a note: [{ from, to, code }] (from/to cover the whole fence).
export function dataviewBlocks(state) {
	const out = [];
	syntaxTree(state).iterate({
		enter(n) {
			if (n.name !== "FencedCode") return;
			const info = n.node.getChild("CodeInfo");
			if (!info || state.sliceDoc(info.from, info.to).trim().toLowerCase() !== "dataviewjs") return false;
			const text = n.node.getChild("CodeText");
			const last = state.doc.lineAt(n.to);
			if (!/^\s*(`{3,}|~{3,})\s*$/.test(last.text) || last.number === state.doc.lineAt(n.from).number) return false; // not closed yet
			out.push({ from: state.doc.lineAt(n.from).from, to: last.to, code: text ? state.sliceDoc(text.from, text.to) : "" });
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
	const pages = {};
	for (const p of wanted) {
		const t = p === path ? text : host.text(p);
		if (t != null) pages[p] = pageFrom(p, t);
	}
	pages[path] = pageFrom(path, text);
	return { type: "run", code, current: pages[path], pages, paths: paths.filter((p) => !UNTRUSTED.test(p)), theme: theme() };
}

const live = new Set(); // widgets on screen, to re-run when the note changes

class DataviewWidget extends WidgetType {
	constructor(code, path, from) { super(); this.code = code; this.path = path; this.from = from; }
	eq(o) { return o.code === this.code && o.path === this.path; }
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
		wrap.append(frame, edit);

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
			} else if (d.type === "load") {
				let p = String(d.path || "").replace(/^\/+/, "");
				const paths = host.paths();
				const lower = new Map(paths.map((x) => [x.toLowerCase(), x]));
				p = lower.get(p.toLowerCase()) || lower.get((p + ".md").toLowerCase()) || resolveNote({ note: p, wiki: true }, view.state.facet(notePath), paths);
				if (!p || UNTRUSTED.test(p)) return reply(d.req, null);
				reply(d.req, p === view.state.facet(notePath) ? view.state.sliceDoc() : host.text(p));
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

function build(state) {
	const b = new RangeSetBuilder();
	const path = state.facet(notePath);
	if (!state.facet(dvHost) || !path || UNTRUSTED.test(path)) return b.finish();
	const sel = state.selection.ranges;
	for (const blk of dataviewBlocks(state)) {
		if (sel.some((r) => r.to >= blk.from && r.from <= blk.to)) continue; // being edited
		b.add(blk.from, blk.to, Decoration.replace({ widget: new DataviewWidget(blk.code, path, blk.from), block: true }));
	}
	return b.finish();
}

const blocks = StateField.define({
	create: build,
	update(deco, tr) {
		if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
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

export const dataviewJs = [blocks, rerun];
