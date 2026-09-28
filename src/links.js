// Clickable links. A click on a web link opens it in a new tab; a click on a
// [[wikilink]] (or a markdown link to another note) opens that note here.
// A click on a link the cursor is already in just places the cursor, so link
// text stays editable: the first tap opens, the next one edits. Ctrl/Cmd-click
// always opens. Nothing here changes the note.

import { EditorView, ViewPlugin, Decoration } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

const WIKILINK = /(!?)\[\[([^\]\n]+)\]\]/g;
const CODE = /^(InlineCode|CodeText|FencedCode|CodeBlock|Comment)$/;

function inCode(state, pos) {
	for (let n = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (CODE.test(n.name)) return true;
	return false;
}

// What a link's target means: { url } for web and mail links, { note, heading }
// for another note in the vault, or null for anything else (other schemes are
// never opened).
export function target(href) {
	href = href.trim().replace(/^<|>$/g, "");
	if (/^www\./i.test(href)) return { url: "https://" + href };
	if (/^(https?|mailto):/i.test(href)) return { url: href };
	if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith("//")) return null;
	let path = href;
	try { path = decodeURIComponent(href); } catch {}
	const [note, heading = ""] = path.split("#");
	return note ? { note, heading } : null;
}

// "[[Note#Heading|shown text]]" -> { note: "Note", heading: "Heading" }.
export function wikiTarget(inner) {
	const [note, heading = ""] = inner.split("|")[0].split("#");
	return note.trim() ? { note: note.trim(), heading: heading.trim(), wiki: true } : null;
}

// A reference link's definition: "[label]: url" anywhere in the note.
function reference(state, label) {
	const want = label.replace(/^\[|\]$/g, "").trim().toLowerCase();
	let found = null;
	syntaxTree(state).iterate({
		enter(n) {
			if (found || n.name !== "LinkReference") return found ? false : undefined;
			const l = n.node.getChild("LinkLabel"), u = n.node.getChild("URL");
			if (l && u && state.sliceDoc(l.from + 1, l.to - 1).trim().toLowerCase() === want) found = state.sliceDoc(u.from, u.to);
			return false;
		},
	});
	return found;
}

// The links in [from, to): [{ from, to, url } or { from, to, note, heading }], in order.
export function linksIn(state, from = 0, to = state.doc.length) {
	const out = [];
	const doc = state.doc;
	const wikis = [];
	for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last; n++) {
		const line = doc.line(n);
		for (const m of line.text.matchAll(WIKILINK)) {
			const a = line.from + m.index, b = a + m[0].length;
			wikis.push([a, b]);
			if (m[1] || inCode(state, a)) continue; // ![[embeds]] are attachments
			const t = wikiTarget(m[2]);
			if (t) out.push({ from: a, to: b, ...t });
		}
	}
	const overlapsWiki = (a, b) => wikis.some(([f, t]) => a < t && b > f);
	syntaxTree(state).iterate({
		from, to,
		enter(n) {
			if (n.name === "Image") return false;
			if (n.name !== "Link" && n.name !== "Autolink" && n.name !== "URL") return;
			if (overlapsWiki(n.from, n.to)) return false;
			let href = null;
			if (n.name === "URL") href = state.sliceDoc(n.from, n.to);
			else {
				const u = n.node.getChild("URL");
				const label = n.node.getChild("LinkLabel");
				if (u) href = state.sliceDoc(u.from, u.to);
				else if (label) href = reference(state, state.sliceDoc(label.from, label.to));
				else if (n.name === "Link") {
					// "[label]" alone is a shortcut reference link when it's defined.
					const text = state.sliceDoc(n.from, n.to);
					if (/^\[[^\]]+\]$/.test(text)) href = reference(state, text);
				}
			}
			const t = href && target(href);
			if (t) out.push({ from: n.from, to: n.to, ...t });
			return false;
		},
	});
	return out.sort((a, b) => a.from - b.from);
}

export function linkAt(state, pos) {
	const line = state.doc.lineAt(pos);
	return linksIn(state, line.from, line.to).find((l) => pos >= l.from && pos <= l.to) || null;
}

// Which vault note a link points to, the way Obsidian finds it: a path from
// the linking note's folder or the vault root, else any note with that name
// (the one with the shortest path when several share it). Null when none.
export function resolveNote(link, fromPath, paths) {
	let want = link.note.trim().replace(/^\.\//, "").replace(/^\/+/, "");
	if (!want) return null;
	if (!/\.md$/i.test(want)) want += ".md";
	const lower = new Map(paths.map((p) => [p.toLowerCase(), p]));
	const folder = fromPath && fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/") + 1) : "";
	const parts = [];
	for (const seg of (folder + want).split("/")) {
		if (seg === "..") parts.pop();
		else if (seg !== ".") parts.push(seg);
	}
	for (const p of [parts.join("/"), want]) if (lower.has(p.toLowerCase())) return lower.get(p.toLowerCase());
	// Otherwise any note whose path ends with it ("Note" or "Folder/Note").
	if (want.includes("/") && !link.wiki) return null;
	const tail = want.toLowerCase();
	const hits = paths.filter((p) => p.toLowerCase() === tail || p.toLowerCase().endsWith("/" + tail));
	return hits.sort((a, b) => a.length - b.length || a.localeCompare(b))[0] || null;
}

const linkMark = Decoration.mark({ class: "md-a" });

function build(view) {
	const b = new RangeSetBuilder();
	let last = -1;
	for (const { from, to } of view.visibleRanges) {
		for (const l of linksIn(view.state, from, to)) {
			if (l.from < last) continue;
			b.add(l.from, l.to, linkMark);
			last = l.to;
		}
	}
	return b.finish();
}

// open(link) is called with a link from linksIn when one is clicked.
export function linkClicks(open) {
	let down = null;
	return ViewPlugin.define((view) => ({
		decorations: build(view),
		update(u) {
			if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view);
		},
	}), {
		decorations: (v) => v.decorations,
		eventHandlers: {
			mousedown(e, view) {
				down = null;
				if (e.button !== 0 || e.shiftKey || e.altKey || !e.target.closest?.(".md-a")) return false;
				const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
				const link = pos == null ? null : linkAt(view.state, pos);
				if (!link) return false;
				if (e.metaKey || e.ctrlKey) {
					e.preventDefault();
					open(link);
					return true;
				}
				const { main } = view.state.selection;
				const inside = view.hasFocus && main.from >= link.from && main.to <= link.to;
				if (!inside) down = link;
				return false;
			},
			click(e, view) {
				const link = down;
				down = null;
				if (!link || !view.state.selection.main.empty) return false; // a drag selected text
				e.preventDefault();
				open(link);
				return true;
			},
		},
	});
}
