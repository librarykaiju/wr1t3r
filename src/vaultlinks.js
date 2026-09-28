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
