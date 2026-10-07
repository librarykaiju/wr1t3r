// Import from Notion: its "Markdown & CSV" export (Settings > Export, or a
// page's ... > Export), a .zip of pages, pictures and databases. Page and
// folder names lose the ID codes Notion adds ("Trip 1a2b...ef.md" -> "Trip.md"),
// links between pages and pictures follow the new names, a database's rows
// get their properties as frontmatter, and each database becomes a board of
// its folder.

import { isAttachmentPath } from "./paths.js";
import { frontmatter, uniquePath, plural } from "./imports.js";

const ID = /[ _-]?[0-9a-f]{32}(?=(_all)?$)/i;
// A segment without Notion's ID: "Trip 1a2b…ef.md" -> "Trip.md", "Trip 1a2b…ef" -> "Trip".
export function cleanSegment(seg) {
	const dot = seg.lastIndexOf(".");
	const [stem, ext] = dot > 0 ? [seg.slice(0, dot), seg.slice(dot)] : [seg, ""];
	return (stem.replace(ID, "").trim() || stem) + ext;
}

const folderOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");

// The new path for every file: IDs gone, and a number added where two
// pages would end up with the same name. -> Map old -> new
export function renamePaths(paths) {
	const out = new Map(), taken = new Set();
	const folders = new Map(); // old folder -> new folder
	const folder = (old) => {
		if (!old) return "";
		if (!folders.has(old)) {
			// A page's subpages are in a folder named like the page, so it follows the page's new name.
			const page = out.get(old.slice(0, -1) + ".md");
			const parent = folder(folderOf(old.slice(0, -1)));
			folders.set(old, page ? page.slice(0, -3) + "/" : parent + cleanSegment(old.slice(folderOf(old.slice(0, -1)).length, -1)) + "/");
		}
		return folders.get(old);
	};
	for (const p of [...paths].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
		out.set(p, uniquePath(taken, folder(folderOf(p)) + cleanSegment(p.slice(folderOf(p).length))));
	}
	return out;
}

// From a note at from to a file at to, as a relative link target.
export function relative(from, to) {
	const a = folderOf(from).split("/").filter(Boolean), b = to.split("/");
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
	return "../".repeat(a.length - i) + b.slice(i).join("/");
}

function resolve(fromOld, target) {
	let t = target;
	try { t = decodeURIComponent(t); } catch {}
	const parts = [];
	for (const seg of (folderOf(fromOld) + t).split("/")) {
		if (seg === "..") parts.pop();
		else if (seg && seg !== ".") parts.push(seg);
	}
	return parts.join("/");
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// Notion's dates ("October 7, 2026", "October 7, 2026 3:05 PM", "… → …") as YYYY-MM-DD (HH:mm); null otherwise.
export function notionDate(v) {
	const m = /^([A-Za-z]+) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2}) ?([AP]M))?(?: \(\w+\))?(?: → .*)?$/i.exec(v.trim());
	const month = m && MONTHS.indexOf(m[1].toLowerCase());
	if (!m || month < 0) return null;
	const pad = (n) => String(n).padStart(2, "0");
	let out = `${m[3]}-${pad(month + 1)}-${pad(m[2])}`;
	if (m[4]) out += ` ${pad((Number(m[4]) % 12) + (m[6].toUpperCase() === "PM" ? 12 : 0))}:${m[5]}`;
	return out;
}

const LISTY = /^(tags?|labels?|categor(y|ies)|topics?|keywords?)$/i;

// A database row's properties ("Key: value" lines under its title) as
// frontmatter pairs, and the text without them; null when there are none.
export function rowProperties(text, linkName) {
	const m = /^(# [^\n]*\n)\n((?:[^\n:]{1,80}: [^\n]*\n)+)(\n|$)/.exec(text.replace(/\r\n/g, "\n"));
	if (!m) return null;
	const pairs = [];
	for (const line of m[2].trimEnd().split("\n")) {
		const i = line.indexOf(": ");
		const key = line.slice(0, i).trim().replace(/[:#[\]{}]/g, "").replace(/\s+/g, " ");
		let v = line.slice(i + 2).trim();
		if (!key) continue;
		// Relations: "Page (Page%20id.md), Other (Other%20id.md)" -> links
		const rel = [...v.matchAll(/([^,(]+?) \(([^)]+\.md)\)/g)];
		if (rel.length) { pairs.push([key, rel.map((r) => `[[${linkName(r[2]) || r[1].trim()}]]`)]); continue; }
		if (/^(yes|no)$/i.test(v)) { pairs.push([key, /^yes$/i.test(v)]); continue; }
		const date = notionDate(v);
		if (date) { pairs.push([key, date]); continue; }
		if (LISTY.test(key)) { pairs.push([key, v.split(/,\s*/)]); continue; }
		pairs.push([key, v]);
	}
	return { pairs, text: text.replace(/\r\n/g, "\n").slice(0, m[1].length) + "\n" + text.replace(/\r\n/g, "\n").slice(m[0].length) };
}

// entries: [{ path }] inside the export (the zip's own folder already gone).
// texts: Map path -> text for the .md files.
// -> { notes: [{ path, text } | { path, board }], files: [{ from, path }], skipped, remarks }
export function readNotion(paths, texts) {
	if (!paths.some((p) => /\.md$/i.test(p)) && paths.some((p) => /\.html$/i.test(p))) throw new Error("That's Notion's HTML export. Export again with “Markdown & CSV” as the format.");
	const names = renamePaths(paths);
	const dbs = new Map(); // new folder of rows -> new board path
	for (const p of paths) {
		if (!/\.csv$/i.test(p) || /_all\.csv$/i.test(p)) continue;
		const folder = names.get(p).replace(/\.csv$/i, "/");
		if (paths.some((q) => names.get(q).startsWith(folder) && /\.md$/i.test(q))) dbs.set(folder, folder.slice(0, -1) + ".board");
	}
	const notes = [], files = [], skipped = [];
	const linkName = (from) => (target) => {
		const n = names.get(resolve(from, target));
		return n ? n.replace(/\.md$/i, "") : null;
	};
	for (const p of paths) {
		const to = names.get(p);
		if (/\.md$/i.test(p)) {
			let text = texts.get(p) ?? "";
			// Links to pages and pictures in the export follow them to their new names.
			text = text.replace(/(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g, (all, bang, label, target) => {
				if (/^[a-z][\w+.-]*:/i.test(target) || target.startsWith("#")) return all;
				const n = names.get(resolve(p, target));
				return n ? `${bang}[${label}](<${relative(to, n)}>)` : all;
			});
			const row = dbs.has(folderOf(to)) && rowProperties(text, linkName(p));
			if (row) text = frontmatter(row.pairs) + row.text.replace(/\n{2,}$/, "\n");
			notes.push({ path: to, text });
		} else if (/\.csv$/i.test(p)) {
			const folder = to.replace(/\.csv$/i, "/").replace(/_all\/$/i, "/");
			if (!dbs.has(folder)) skipped.push({ path: p, why: "a database with no pages in it" });
		} else if (isAttachmentPath(to)) files.push({ from: p, path: to });
		else skipped.push({ path: p, why: "not a page or a picture" });
	}
	for (const [folder, board] of dbs) notes.push({ path: board, board: folder });
	const remarks = dbs.size ? [`${plural(dbs.size, "database")} became ${dbs.size === 1 ? "a board" : "boards"}, each showing its folder of pages. Their properties are in each page's frontmatter.`] : [];
	return { notes, files, skipped, remarks };
}
