// Clickable links. A click on a web link opens it in a new tab; a click on a
// [[wikilink]] (or a markdown link to another note) opens that note here.
// A click on a link the cursor is already in just places the cursor, so link
// text stays editable: the first tap opens, the next one edits. Ctrl/Cmd-click
// always opens. Nothing here changes the note.

import { EditorView, ViewPlugin, Decoration } from "@codemirror/view";
import { RangeSetBuilder, Facet } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { vaultHost, notePath, vaultChanged } from "./vault.js";

// What opens a link (the app's handler), for widgets that draw their own links.
export const linkOpener = Facet.define({ combine: (v) => v[0] || null });

const WIKILINK = /(!?)\[\[([^\]\n]+)\]\]/g;
export const HASHTAG = /(?<=^|\s)#[\p{L}_][\p{L}\p{N}_\/-]*/gu;
const FOOTNOTE = /\[\^([^\]\s]+)\](:?)/g;
const CODE = /^(InlineCode|CodeText|FencedCode|CodeBlock|Comment)$/;

// Whether line n is inside the note's frontmatter (its tags are drawn as pills there).
function inFrontmatter(doc, n) {
	if (doc.lines < 2 || !/^---[ \t]*$/.test(doc.line(1).text)) return false;
	for (let i = 2; i <= doc.lines; i++) if (/^(?:---|\.\.\.)[ \t]*$/.test(doc.line(i).text)) return n <= i;
	return false;
}

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
	return note || heading ? { note, heading } : null; // "#Heading" alone: this note
}

// "[[Note#Heading|shown text]]" -> { note: "Note", heading: "Heading" }.
export function wikiTarget(inner) {
	const [note, heading = ""] = inner.split("|")[0].split("#");
	return note.trim() || heading.trim() ? { note: note.trim(), heading: heading.trim(), wiki: true } : null;
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

// The links in [from, to): [{ from, to, url }, { from, to, note, heading } or
// { from, to, footnote, def }], in order.
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
		// #tags in the text (not headings, which need a space after the #).
		for (const m of line.text.matchAll(HASHTAG)) {
			const a = line.from + m.index, b = a + m[0].length;
			if (inCode(state, a) || inFrontmatter(doc, n)) continue;
			wikis.push([a, b]);
			out.push({ from: a, to: b, tag: m[0].slice(1) });
		}
		// Footnotes: "[^1]" in the text and its "[^1]: ..." definition.
		for (const m of line.text.matchAll(FOOTNOTE)) {
			const a = line.from + m.index, b = a + m[0].length;
			wikis.push([a, b]);
			if (inCode(state, a)) continue;
			const def = !!m[2] && !line.text.slice(0, m.index).trim();
			out.push({ from: a, to: b, footnote: m[1], def });
		}
	}
	const overlapsWiki = (a, b) => wikis.some(([f, t]) => a < t && b > f);
	syntaxTree(state).iterate({
		from, to,
		enter(n) {
			if (n.name === "Image") return false;
			if (n.name === "LinkReference" && state.sliceDoc(n.from, n.from + 2) === "[^") return false; // a footnote definition
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
	if (!link.note.trim()) return fromPath || null; // [[#Heading]] or [text](#heading)
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

// The line ending in a block id ("... ^quote-1"), for [[Note#^quote-1]] links.
export function blockFor(state, id) {
	const want = id.replace(/^\^/, "");
	if (!want) return null;
	const re = new RegExp("(^|\\s)\\^" + want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$");
	for (let n = 1; n <= state.doc.lines; n++) {
		const line = state.doc.line(n);
		if (re.test(line.text)) return line.from;
	}
	return null;
}

// The heading a link's "#part" names, from toc.headings(): matched the way both
// Obsidian ("#My Heading") and web-style anchors ("#my-heading") write it.
// Block references ("#^id") aren't headings.
const squash = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
export function headingFor(list, want) {
	if (!want || want.startsWith("^")) return null;
	let w = want;
	try { w = decodeURIComponent(want); } catch {}
	return list.find((h) => squash(h.text) === squash(w)) || null;
}

const linkMark = Decoration.mark({ class: "md-a" });
const missingMark = Decoration.mark({ class: "md-a md-unresolved", attributes: { title: "No note with this name yet" } });

// Links to notes that don't exist are drawn fainter, as in Obsidian.
function build(view) {
	const b = new RangeSetBuilder();
	const host = view.state.facet(vaultHost);
	const here = view.state.facet(notePath);
	const paths = host ? host.paths() : null;
	let last = -1;
	for (const { from, to } of view.visibleRanges) {
		for (const l of linksIn(view.state, from, to)) {
			if (l.from < last) continue;
			const missing = paths?.length && l.note != null && l.note.trim() && !resolveNote(l, here, paths);
			b.add(l.from, l.to, missing ? missingMark : linkMark);
			last = l.to;
		}
	}
	return b.finish();
}

// Where a footnote click goes: from "[^1]" to the start of its definition's
// text, and from the definition back to the first "[^1]" in the note. Null
// when there's nothing to go to.
export function footnoteJump(state, link) {
	for (const l of linksIn(state)) {
		if (l.footnote !== link.footnote || l.def === link.def) continue;
		if (!l.def) return l.from;
		const line = state.doc.lineAt(l.to);
		return l.to + (line.text.slice(l.to - line.from).length - line.text.slice(l.to - line.from).trimStart().length);
	}
	return null;
}

// open(link) is called with a link from linksIn when one is clicked; footnotes
// are handled here, in the note itself.
export function linkClicks(openLink) {
	const open = (link, view) => {
		if (!link.footnote) return openLink(link);
		const pos = footnoteJump(view.state, link);
		if (pos == null) return;
		view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
		view.focus();
	};
	let down = null;
	return ViewPlugin.define((view) => ({
		decorations: build(view),
		update(u) {
			if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state) || u.transactions.some((tr) => tr.effects.some((e) => e.is(vaultChanged)))) this.decorations = build(u.view);
		},
	}), {
		decorations: (v) => v.decorations,
		eventHandlers: {
			mousedown(e, view) {
				down = null;
				const span = e.target.closest?.(".md-a");
				if (e.button !== 0 || e.shiftKey || e.altKey || !span) return false;
				// From the clicked element, not the coordinates: widgets above (images,
				// the properties box) can leave the editor's height estimates stale.
				let pos = null;
				try { pos = view.posAtDOM(span); } catch {}
				const link = pos == null ? null : linkAt(view.state, pos);
				if (!link) return false;
				if (e.metaKey || e.ctrlKey) {
					e.preventDefault();
					open(link, view);
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
				open(link, view);
				return true;
			},
		},
	});
}
