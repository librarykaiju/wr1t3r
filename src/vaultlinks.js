// Links between notes, read from note text: what a note links to, which notes
// link to a given one (backlinks), and the edits that keep those links
// working when a note is renamed. Plain functions over text; the editor parts
// live in src/backlinks.js and src/linkcomplete.js.

import { resolveNote } from "./links.js";

const WIKI = /(!?)\[\[([^\]\n]+?)\]\]/g;
const MD = /(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\s*\)/g;

// Text with fenced code and `inline code` blanked out (same length), so links
// shown as code aren't counted or rewritten.
function maskCode(text) {
	let out = "";
	let fence = null;
	for (const line of text.split(/(?<=\n)/)) {
		const f = line.match(/^\s*(`{3,}|~{3,})/);
		if (fence || f) {
			if (!fence) fence = f[1];
			else if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length).trim()) fence = null;
			out += line.replace(/[^\n]/g, " ");
			continue;
		}
		out += line.replace(/(`+)[^`\n]+?\1/g, (m) => " ".repeat(m.length));
	}
	return out;
}

// [{ kind: "wiki"|"md", embed, from, to, note, heading }] where from..to is
// the note part of the link in the text ("Note" in [[Note#Head|alias]]).
export function noteLinks(text) {
	const masked = maskCode(text);
	const out = [];
	for (const m of masked.matchAll(WIKI)) {
		const inner = text.slice(m.index + m[1].length + 2, m.index + m[0].length - 2);
		const target = inner.split("|")[0];
		const hash = target.indexOf("#");
		const note = hash < 0 ? target : target.slice(0, hash);
		const from = m.index + m[1].length + 2;
		out.push({ kind: "wiki", embed: !!m[1], from, to: from + note.length, note: note.trim(), heading: hash < 0 ? "" : target.slice(hash + 1) });
	}
	for (const m of masked.matchAll(MD)) {
		let href = text.slice(m.index + m[0].indexOf("(", m[1].length + m[2].length + 2) + 1).trimStart();
		const angle = href.startsWith("<");
		href = angle ? href.slice(1, href.indexOf(">")) : href.match(/^[^)\s]+/)[0];
		if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("#")) continue;
		const hash = href.indexOf("#");
		const raw = hash < 0 ? href : href.slice(0, hash);
		let note = raw;
		try { note = decodeURIComponent(raw); } catch {}
		const from = text.indexOf(angle ? "<" + raw : raw, m.index + m[1].length + m[2].length + 2) + (angle ? 1 : 0);
		out.push({ kind: "md", embed: !!m[1], from, to: from + raw.length, note, raw, angle, heading: hash < 0 ? "" : href.slice(hash + 1) });
	}
	return out.sort((a, b) => a.from - b.from);
}

const resolve = (l, fromPath, paths) => (l.note ? resolveNote({ note: l.note, wiki: l.kind === "wiki" }, fromPath, paths) : null);

// Notes that link to target: [{ path, count, snippet }], by path.
export function backlinksTo(target, notes, paths) {
	const out = [];
	for (const { path, text } of notes) {
		if (path === target || !text || (!text.includes("[[") && !text.includes("]("))) continue;
		const hits = noteLinks(text).filter((l) => resolve(l, path, paths) === target);
		if (!hits.length) continue;
		const start = text.lastIndexOf("\n", hits[0].from) + 1;
		let end = text.indexOf("\n", hits[0].from);
		if (end < 0) end = text.length;
		out.push({ path, count: hits.length, snippet: text.slice(start, end).trim().replace(/^([-*+]|\d+[.)]|#+|>)\s+/, "").slice(0, 160) });
	}
	return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));
}

const baseName = (p) => p.split("/").pop().replace(/\.md$/i, "");
const folderOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");

function relative(fromFolder, to) {
	const a = fromFolder.split("/").filter(Boolean);
	const b = to.split("/");
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
	return "../".repeat(a.length - i) + b.slice(i).join("/");
}

// The changes ({ from, to, insert }) to a note at notePath (text) that point
// its links at newPath instead of oldPath. paths are the vault's paths before
// the rename. Only the note part of each link changes; headings, aliases and
// the link's style (bare name or path, .md or not, relative or not, %20 or
// <...>) are kept.
export function renameEdits(text, notePath, oldPath, newPath, paths) {
	const after = paths.filter((p) => p !== oldPath).concat(newPath);
	const changes = [];
	for (const l of noteLinks(text)) {
		if (resolve(l, notePath, paths) !== oldPath) continue;
		let insert;
		if (l.kind === "wiki") {
			const md = /\.md$/i.test(l.note);
			const name = baseName(newPath);
			const unique = after.filter((p) => baseName(p).toLowerCase() === name.toLowerCase()).length === 1;
			insert = (!l.note.includes("/") && unique ? name : newPath.replace(/\.md$/i, "")) + (md ? ".md" : "");
		} else {
			const plain = l.note.replace(/^\.\//, "").replace(/^\/+/, "");
			const wasRelative = !l.note.startsWith("/") && resolveNote({ note: plain }, notePath, [oldPath]) === oldPath && (folderOf(notePath) + plain).toLowerCase().replace(/\.md$/i, "") !== plain.toLowerCase().replace(/\.md$/i, "")
				? true
				: l.note.startsWith("./") || l.note.startsWith("../");
			let target = wasRelative ? relative(folderOf(notePath), newPath) : (l.note.startsWith("/") ? "/" : "") + newPath;
			if (l.note.startsWith("./") && !target.startsWith("../")) target = "./" + target;
			if (!/\.md$/i.test(l.note)) target = target.replace(/\.md$/i, "");
			insert = l.angle ? target : target.split("/").map((s) => encodeURIComponent(s).replace(/%2B/g, "+")).join("/");
		}
		const current = text.slice(l.from, l.to);
		if (insert !== current) changes.push({ from: l.from, to: l.to, insert });
	}
	return changes;
}

export function applyChanges(text, changes) {
	let out = text;
	for (const c of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
	return out;
}

// A note's headings, for [[Note# completion.
export function headingsOf(text) {
	const out = [];
	const masked = maskCode(text);
	for (const m of masked.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) out.push(text.slice(m.index, m.index + m[0].length).replace(/^#{1,6}[ \t]+/, "").replace(/[ \t]+#*[ \t]*$/, "").trim());
	return out;
}

// The part of a note an embed shows: ![[Note]] the body (no frontmatter),
// ![[Note#Heading]] that heading's section (up to the next heading at the same
// level or higher), ![[Note#^id]] the block ending in "^id" (its paragraph, or
// the block just above a line holding only "^id"), without the id. Null when
// the heading or block isn't there.
export function embedSection(text, part = "") {
	const body = text.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, "");
	const lines = body.split(/\r?\n/);
	const masked = maskCode(body).split(/\r?\n/);
	part = part.trim();
	if (!part) return body.replace(/^\s*\n/, "");
	if (part.startsWith("^")) {
		const id = part.slice(1);
		const re = new RegExp("(^|\\s)\\^" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[ \\t]*$");
		const at = masked.findIndex((l) => re.test(l));
		if (at < 0 || !id) return null;
		let end = at;
		if (!lines[at].replace(re, "").trim()) {
			end = at - 1;
			while (end >= 0 && !lines[end].trim()) end--;
			if (end < 0) return null;
		}
		let start = end;
		while (start > 0 && lines[start - 1].trim() && !/^#{1,6}\s/.test(lines[start]) && !/^#{1,6}\s/.test(lines[start - 1])) start--;
		const out = lines.slice(start, end + 1);
		if (end === at) out[out.length - 1] = out[out.length - 1].replace(re, "");
		return out.join("\n");
	}
	const squash = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
	const want = squash(part);
	const heading = (l) => l.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
	const at = masked.findIndex((l) => { const h = heading(l); return h && squash(h[2]) === want; });
	if (at < 0) return null;
	const level = heading(masked[at])[1].length;
	let end = at + 1;
	while (end < lines.length) { const h = heading(masked[end]); if (h && h[1].length <= level) break; end++; }
	return lines.slice(at, end).join("\n").replace(/\s+$/, "");
}

// What a note links to: [{ name, path, count }], path null when no note has
// that name yet. Links to itself ([[#Heading]]) aren't listed.
export function outgoingLinks(text, fromPath, paths) {
	const byKey = new Map();
	for (const l of noteLinks(text)) {
		if (!l.note) continue;
		const path = resolve(l, fromPath, paths);
		if (path === fromPath) continue;
		const key = path || "?" + l.note.toLowerCase();
		const hit = byKey.get(key);
		if (hit) hit.count++;
		else byKey.set(key, { name: path ? baseName(path) : l.note.replace(/\.md$/i, ""), path, count: 1 });
	}
	return [...byKey.values()].sort((a, b) => (!a.path - !b.path) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

// Notes that name target in plain text without linking it (Obsidian's
// "unlinked mentions"): [{ path, count, snippet }]. Code, links and
// frontmatter don't count; names under three letters are skipped (too many
// false hits).
export function unlinkedMentions(target, notes, limit = 50) {
	const name = baseName(target);
	if (name.length < 3) return [];
	const re = new RegExp("(?<![\\p{L}\\p{N}_])" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\p{L}\\p{N}_])", "giu");
	const lowName = name.toLowerCase();
	const out = [];
	for (const { path, text } of notes) {
		if (path === target || !text || !text.toLowerCase().includes(lowName)) continue;
		let masked = maskCode(text).replace(/!?\[\[[^\]\n]*\]\]/g, (m) => " ".repeat(m.length)).replace(MD, (m) => " ".repeat(m.length));
		const fm = text.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
		if (fm) masked = " ".repeat(fm[0].length) + masked.slice(fm[0].length);
		const hits = [...masked.matchAll(re)];
		if (!hits.length) continue;
		const at = hits[0].index;
		const start = text.lastIndexOf("\n", at) + 1;
		let end = text.indexOf("\n", at);
		if (end < 0) end = text.length;
		out.push({ path, count: hits.length, snippet: text.slice(start, end).trim().replace(/^([-*+]|\d+[.)]|#+|>)\s+/, "").slice(0, 160) });
		if (out.length >= limit) break;
	}
	return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));
}
