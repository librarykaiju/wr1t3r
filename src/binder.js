// A folder's order, for the corkboard, the outliner, Scrivenings and Compile.
// It lives in the folder as one small note, _Binder.md, whose body is a
// numbered list of links: [[Note]] for a note, [Name](Name/) for a subfolder.
// Obsidian shows it as a clickable outline, and a rename rewrites its links
// like any other note's. Its frontmatter holds the folder's compile settings.
// Nothing here touches the notes themselves; reordering rewrites only the list.

import { parseYaml } from "./bases.js";
import { resolveNote } from "./links.js";
import { linkFor } from "./home.js";
import { stripFrontmatter, countWords } from "./count.js";

export const BINDER = "_Binder.md";
export const BINDER_INTRO = "%% The order of this folder in wr1t3r (storyboard, outliner, compile). Reorder the list to reorder the folder. %%";

export const binderPath = (folder) => folder + BINDER;
export const isBinder = (path) => /(^|\/)_binder\.md$/i.test(path);

const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);
const noteName = (p) => baseName(p).replace(/\.md$/i, "");
const LIST = /^\s*(?:\d+[.)]|[-*+])\s+(.*)$/;

// The frontmatter's text (between the fences) and where the body starts.
function splitFrontmatter(text) {
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
	return m ? { yaml: m[1], body: text.slice(m[0].length), head: m[0] } : { yaml: "", body: text, head: "" };
}

export function frontmatterOf(text) {
	const { yaml } = splitFrontmatter(String(text || ""));
	if (!yaml.trim()) return {};
	try { const y = parseYaml(yaml); return y && typeof y === "object" && !Array.isArray(y) ? y : {}; } catch { return {}; }
}

// The link in one list item: { note } or { folder }, or null.
function entryOf(item) {
	let m = item.match(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/);
	if (m) return { note: m[1].trim() };
	m = item.match(/\[[^\]]*\]\(<?([^)>]+)>?\)/);
	if (!m) return null;
	let href = m[1].trim();
	try { href = decodeURIComponent(href); } catch {}
	if (/^[a-z][\w+.-]*:/i.test(href)) return null;
	if (href.endsWith("/")) return { folder: href.replace(/^\.\//, "").replace(/\/+$/, "") };
	return { note: href.replace(/^\.\//, "").replace(/\.md$/i, "") };
}

// The binder's entries, in order, and its compile settings.
export function readBinder(text) {
	const { body } = splitFrontmatter(String(text || ""));
	const entries = [];
	for (const line of body.split(/\r?\n/)) {
		const m = line.match(LIST);
		const e = m && entryOf(m[1]);
		if (e) entries.push(e);
	}
	const fm = frontmatterOf(text);
	const compile = fm.compile && typeof fm.compile === "object" && !Array.isArray(fm.compile) ? fm.compile : {};
	return { entries, compile };
}

// What's directly in folder: its notes (not the binder) and its subfolders
// (with their trailing /), each A to Z.
export function childrenOf(folder, paths) {
	const notes = [], folders = new Set();
	for (const p of paths) {
		if (!p.startsWith(folder)) continue;
		const rest = p.slice(folder.length);
		const slash = rest.indexOf("/");
		if (slash >= 0) folders.add(folder + rest.slice(0, slash + 1));
		else if (/\.md$/i.test(rest) && !isBinder(p)) notes.push(p);
	}
	const az = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
	return { notes: notes.sort(az), folders: [...folders].sort(az) };
}

// The folder's items in binder order: [{ kind: "note"|"folder", path, listed }].
// Items the binder doesn't list follow, A to Z (folders first), with listed
// false; entries for things no longer in the folder are skipped.
export function binderOrder(folder, paths, binderText) {
	const { notes, folders } = childrenOf(folder, paths);
	const out = [], used = new Set();
	const bp = binderPath(folder);
	const noteSet = new Map(notes.map((p) => [p.toLowerCase(), p]));
	const folderSet = new Map(folders.map((f) => [f.toLowerCase(), f]));
	for (const e of binderText == null ? [] : readBinder(binderText).entries) {
		let hit = null;
		if (e.folder != null) {
			hit = folderSet.get((folder + e.folder + "/").toLowerCase()) || folderSet.get((e.folder + "/").toLowerCase()) || null;
			if (hit && !used.has(hit)) { used.add(hit); out.push({ kind: "folder", path: hit, listed: true }); }
			continue;
		}
		const r = resolveNote({ note: e.note, heading: "", wiki: true }, bp, paths);
		hit = r && noteSet.get(r.toLowerCase());
		if (!hit) {
			const want = noteName(e.note).toLowerCase();
			hit = notes.find((p) => noteName(p).toLowerCase() === want && !used.has(p)) || null;
		}
		if (hit && !used.has(hit)) { used.add(hit); out.push({ kind: "note", path: hit, listed: true }); }
	}
	for (const f of folders) if (!used.has(f)) out.push({ kind: "folder", path: f, listed: false });
	for (const p of notes) if (!used.has(p)) out.push({ kind: "note", path: p, listed: false });
	return out;
}

const folderName = (f) => f.replace(/\/+$/, "").split("/").pop();
const hrefFor = (name) => encodeURI(name).replace(/\(/g, "%28").replace(/\)/g, "%29") + "/";

// One numbered line per item.
export function binderLines(items, paths) {
	return items.map((it, i) => `${i + 1}. ${it.kind === "folder" ? `[${folderName(it.path).replace(/([\[\]])/g, "\\$1")}](${hrefFor(folderName(it.path))})` : linkFor(it.path, paths)}`);
}

// text (the binder note, or "" for a new one) with its list replaced by items
// in order. The frontmatter and anything around the list stay as they were.
export function writeBinder(text, items, paths) {
	text = String(text || "");
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const list = binderLines(items, paths);
	if (!text.trim()) return [BINDER_INTRO, "", ...list, ""].join(nl);
	const { head, body } = splitFrontmatter(text);
	const lines = body.split(/\r?\n/);
	let first = -1, last = -1;
	for (let i = 0; i < lines.length; i++) {
		if (LIST.test(lines[i]) && entryOf(lines[i].match(LIST)[1])) {
			if (first < 0) first = i;
			last = i;
		} else if (first >= 0 && lines[i].trim() && !/^\s/.test(lines[i])) break; // the list ended
	}
	if (first < 0) {
		const kept = body.replace(/\s+$/, "");
		return head + (kept ? kept + nl + nl : "") + list.join(nl) + nl;
	}
	lines.splice(first, last - first + 1, ...list);
	return head + lines.join(nl);
}

// A subfolder's entry after it was renamed (from and to are folder names).
export function renameFolderEntry(text, from, to) {
	return String(text).replace(/(\[)([^\]]*)(\]\(<?)([^)>]+)(>?\))/g, (all, a, label, b, href, c) => {
		let h = href;
		try { h = decodeURIComponent(href); } catch {}
		if (h.replace(/^\.\//, "").replace(/\/+$/, "") !== from || !h.endsWith("/")) return all;
		return a + (label === from ? to : label) + b + hrefFor(to) + c;
	});
}

// ---- what a card shows ----------------------------------------------------------

// Body text without markdown marks, for a synopsis that isn't written yet.
export function plainText(body) {
	return body
		.replace(/%%[\s\S]*?%%/g, " ")
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.split(/\r?\n/)
		.filter((l) => !/^\s*#{1,6}\s/.test(l) && !/^\s*(\|.*\||[-*_]{3,}\s*|\[\^[^\]]+\]:.*)$/.test(l))
		.map((l) => l.replace(/^\s*(?:>\s*)+(\[![^\]]+\][+-]?)?/, "").replace(/^\s*(?:[-*+]|\d+[.)])\s+(\[.\]\s+)?/, ""))
		.join(" ")
		.replace(/!\[\[[^\]]*\]\]/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, (_, t) => t.split("#")[0].split("/").pop())
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[\^[^\]]+\]/g, "")
		.replace(/[*_~=`]+/g, "")
		.replace(/(?<=\s)\^[A-Za-z0-9-]+(?=\s|$)/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

const clip = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);

// { title, synopsis, written, label, status, words } for a note's card.
// title: the first # heading, else the title property, else the file name.
// synopsis: the synopsis property (written true), else the start of the text.
export function cardInfo(path, text) {
	const t = String(text || "");
	const fm = frontmatterOf(t);
	const body = stripFrontmatter(t);
	const h1 = body.match(/^#[ \t]+(.+?)[ \t#]*$/m);
	const str = (v) => (v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v)).trim();
	const title = (h1 && h1[1].trim()) || str(fm.title) || noteName(path);
	const own = str(fm.synopsis);
	const label = Number(fm.label);
	return {
		title,
		synopsis: own || clip(plainText(body), 220),
		written: !!own,
		label: Number.isInteger(label) && label >= 1 && label <= 7 ? label : null,
		status: str(fm.status),
		words: countWords(body),
	};
}
