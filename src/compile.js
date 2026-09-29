// Compile: a folder's notes, in binder order (subfolders too), joined into one
// markdown document for export. Each note loses what only matters inside the
// vault: its properties, %% comments %%, block ids and HTML comments. Its
// title can become a heading, footnotes are renumbered across the whole
// document so every note's [^1] stays its own, and [[links]] turn into plain
// words. Notes with `compile: false` or `status: cut` are left out.
//
// The same markdown feeds every format: as is for .md, through markdown-it
// for HTML and PDF, and through the same parse for Word (src/exporter.js).

import { stripFrontmatter } from "./count.js";
import { frontmatterOf, cardInfo } from "./binder.js";

export const HEADINGS = { title: "Note titles as headings", none: "Text only" };
export const SEPARATORS = { scene: "Scene break (* * *)", blank: "Blank line", page: "New page" };
export const PAGE_BREAK = '<div class="pagebreak"></div>';

// The settings as saved in the binder's `compile:` property, with defaults.
export function compileSettings(raw = {}) {
	const s = (v) => (v == null ? "" : String(v).trim());
	return {
		title: s(raw.title),
		author: s(raw.author),
		headings: raw.headings in HEADINGS ? raw.headings : "title",
		separator: raw.separator in SEPARATORS ? raw.separator : "scene",
	};
}

// Whether a note is left out of the compile.
export function leftOut(text) {
	const fm = frontmatterOf(text);
	return fm.compile === false || /^(false|no)$/i.test(String(fm.compile ?? "")) || /^cut$/i.test(String(fm.status ?? "").trim());
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Renames a note's footnotes to numbers after `start`, in the order they're
// first used (definitions nobody refers to come last). -> { text, next }
export function renumberFootnotes(text, start) {
	const order = [];
	const see = (label) => { if (!order.includes(label)) order.push(label); };
	for (const m of text.matchAll(/\[\^([^\]\s]+)\](?!:)/g)) see(m[1]);
	for (const m of text.matchAll(/^\[\^([^\]\s]+)\]:/gm)) see(m[1]);
	if (!order.length) return { text, next: start };
	const map = new Map(order.map((l, i) => [l, String(start + i + 1)]));
	const out = text.replace(/\[\^([^\]\s]+)\]/g, (all, l) => (map.has(l) ? `[^${map.get(l)}]` : all));
	return { text: out, next: start + order.length };
}

// Moves every heading down `by` levels (to at most ######).
export function shiftHeadings(text, by) {
	if (!by) return text;
	let fence = null;
	return text.split("\n").map((line) => {
		const f = line.match(/^\s*(`{3,}|~{3,})/);
		if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return line; }
		if (fence) return line;
		return line.replace(/^(#{1,6})(?=[ \t])/, (h) => "#".repeat(Math.min(6, h.length + by)));
	}).join("\n");
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

// [[links]] to words, and (for rendering) ![[images]] to image links the
// exporter can find, ==highlights== to <mark>, callouts to quotes with a bold
// title, and task boxes to ☐ / ☑.
export function flatten(text, { render = false, embed = null } = {}) {
	let t = text.replace(/!\[\[([^\]]+)\]\]/g, (all, inner) => {
		const [target, alias] = inner.split("|");
		const name = target.split("#")[0].trim();
		if (IMAGE_EXT.test(name)) return render ? `![${(alias || "").trim()}](wr1t3r-image:${encodeURIComponent(name)})` : all;
		const body = embed?.(name);
		return body != null ? body : "";
	});
	t = t.replace(/(?<!!)\[\[([^\]]+)\]\]/g, (_, inner) => {
		const [target, alias] = inner.split("|");
		if (alias != null && alias.trim()) return alias.trim();
		const [note, heading] = target.split("#");
		const word = note.trim().split("/").pop().replace(/\.md$/i, "");
		return word || (heading || "").replace(/^\^/, "").trim();
	});
	if (!render) return t;
	let fence = null;
	return t.split("\n").map((line) => {
		const f = line.match(/^\s*(`{3,}|~{3,})/);
		if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return line; }
		if (fence) return line;
		return line
			.replace(/^(\s*(?:>\s*)+)\[!([^\]]+)\][+-]?[ \t]*(.*)$/, (_, q, kind, title) => `${q}**${(title || kind).trim()}**`)
			.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]\s/, (_, lead, x) => `${lead}${x === " " ? "☐" : "☑"} `)
			.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
	}).join("\n");
}

// One note's text, ready to join: without its vault-only parts.
export function cleanNote(text) {
	return stripFrontmatter(text)
		.replace(/%%[\s\S]*?%%/g, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/gm, "")
		.replace(/^\n+|\s+$/g, "");
}

// parts: the reading order, [{ kind: "note"|"folder", path, depth }] (see
// src/scrivenings.js readingOrder). text(path) gives a note's text.
// opts.render: for HTML and Word (see flatten); opts.titlePage: include one.
// -> { markdown, notes, words }
export function compileMarkdown(parts, settings, text, { render = false, titlePage = true, embed = null } = {}) {
	const s = compileSettings(settings);
	const out = [];
	let footnotes = 0, notes = 0, words = 0, lastWasNote = false;
	const sep = () => {
		if (!lastWasNote) return;
		out.push(s.separator === "page" ? PAGE_BREAK : s.separator === "scene" ? "* * *" : "");
	};
	if (titlePage && (s.title || s.author)) {
		out.push(`<div class="title-page">\n\n${s.title ? `# ${s.title}\n\n` : ""}${s.author ? `by ${s.author}\n\n` : ""}</div>`);
		out.push(PAGE_BREAK);
	}
	const top = s.title && titlePage ? 1 : 0; // below the title page's own heading
	for (const p of parts) {
		if (p.kind === "folder") {
			if (s.headings !== "title") continue;
			if (lastWasNote && s.separator === "page") out.push(PAGE_BREAK);
			out.push("#".repeat(Math.min(6, top + p.depth + 1)) + " " + p.path.replace(/\/+$/, "").split("/").pop());
			lastWasNote = false;
			continue;
		}
		const raw = text(p.path);
		if (raw == null || leftOut(raw)) continue;
		let body = cleanNote(raw);
		const info = cardInfo(p.path, raw);
		const level = top + p.depth + 1;
		if (s.headings === "title") {
			// The note's own # title would repeat the heading: it goes.
			const h1 = body.match(/^#[ \t]+(.+?)[ \t#]*$/m);
			if (h1 && h1[1].trim() === info.title && !body.slice(0, h1.index).trim()) body = body.slice(h1.index + h1[0].length).replace(/^\n+/, "");
		}
		body = shiftHeadings(body, s.headings === "title" ? level : top + p.depth);
		const r = renumberFootnotes(body, footnotes);
		footnotes = r.next;
		body = flatten(r.text, { render, embed });
		sep();
		if (s.headings === "title") out.push("#".repeat(Math.min(6, level)) + " " + info.title);
		if (body) out.push(body);
		notes++;
		words += info.words;
		lastWasNote = true;
	}
	return { markdown: out.join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n", notes, words };
}

// The binder's text with its `compile:` settings set (other properties and
// the list untouched).
export function writeCompileSettings(text, settings) {
	const s = compileSettings(settings);
	const q = (v) => (/^[\w][\w .,'-]*$/.test(v) && !/^(true|false|null|yes|no|~)$/i.test(v) && !/^[\d.+-]/.test(v) ? v : JSON.stringify(v));
	const block = ["compile:"];
	if (s.title) block.push("  title: " + q(s.title));
	if (s.author) block.push("  author: " + q(s.author));
	block.push("  headings: " + s.headings, "  separator: " + s.separator);
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = String(text).split(/\r?\n/);
	let close = -1;
	if (/^---\s*$/.test(lines[0] ?? "")) for (let i = 1; i < lines.length; i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) { close = i; break; }
	if (close < 0) return ["---", ...block, "---", ""].join(nl) + text;
	let at = lines.findIndex((l, i) => i > 0 && i < close && /^compile\s*:/.test(l));
	if (at < 0) { lines.splice(close, 0, ...block); return lines.join(nl); }
	let end = at + 1;
	while (end < close && (/^\s+\S/.test(lines[end]) || !lines[end].trim())) end++;
	lines.splice(at, end - at, ...block);
	return lines.join(nl);
}
