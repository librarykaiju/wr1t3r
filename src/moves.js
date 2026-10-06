// Moving notes and folders around the vault, as the sidebar's drag and drop
// and "Move to…" do. The vault has no moves: each moved note becomes a new
// note plus a delete of the old one (see renameNote in src/main.js), and links
// to it from other notes are rewritten the way a rename rewrites them.

import { renameEdits, applyChanges } from "./vaultlinks.js";
import { isBoardPath } from "./paths.js";

const baseName = (p) => p.slice(p.lastIndexOf("/") + 1);
const parentOf = (p) => {
	const q = p.endsWith("/") ? p.slice(0, -1) : p;
	return q.includes("/") ? q.slice(0, q.lastIndexOf("/") + 1) : "";
};

// Where things end up when dropped on folder (a path ending in "/", or "" for
// the vault root). item is a note path, or a folder path ending in "/".
// paths: every note in the vault. newName renames the item on the way (a
// folder's or note's name, without ".md"). -> { pairs: [{from, to}], error }
export function movePlan(paths, item, folder, newName = null) {
	if (newName != null && (!newName.trim() || /[\\/]/.test(newName))) return { pairs: [], error: "That isn't a usable name." };
	if (newName == null && parentOf(item) === folder) return { pairs: [], error: null }; // already there
	if (item.endsWith("/")) {
		if (folder.startsWith(item)) return { pairs: [], error: "A folder can't go inside itself." };
		const dest = folder + (newName?.trim() ?? baseName(item.slice(0, -1))) + "/";
		if (dest === item) return { pairs: [], error: null };
		const pairs = paths.filter((p) => p.startsWith(item)).map((p) => ({ from: p, to: dest + p.slice(item.length) }));
		return { pairs, error: clash(paths, pairs) };
	}
	const ext = isBoardPath(item) ? item.slice(item.lastIndexOf(".")) : ".md";
	const to = folder + (newName != null ? (/\.(md|board|base)$/i.test(newName.trim()) ? newName.trim() : newName.trim() + ext) : baseName(item));
	if (to === item) return { pairs: [], error: null };
	const pairs = [{ from: item, to }];
	return { pairs, error: clash(paths, pairs) };
}

// The first move that would land on a note that's already there.
function clash(paths, pairs) {
	const moving = new Set(pairs.map((p) => p.from.toLowerCase()));
	const staying = new Set(paths.filter((p) => !moving.has(p.toLowerCase())).map((p) => p.toLowerCase()));
	const hit = pairs.find((p) => staying.has(p.to.toLowerCase()));
	return hit ? `There's already a note at “${hit.to}”.` : null;
}

// The link rewrites a set of moves needs. text(path) is a note's text (null
// for notes that can't hold links). -> [{ path, text, count }] keyed by each
// note's path after the moves; the moved notes' own links to each other are
// included.
export function moveLinkEdits(pairs, paths, text) {
	let now = paths.slice();
	const texts = new Map(); // current path -> edited text
	const counts = new Map();
	const read = (p, orig) => (texts.has(p) ? texts.get(p) : text(orig));
	const origin = new Map(paths.map((p) => [p, p])); // current path -> original path
	for (const { from, to } of pairs) {
		for (const p of now) {
			const t = read(p, origin.get(p));
			if (!t || (!t.includes("[[") && !t.includes("]("))) continue;
			const ch = renameEdits(t, p, from, to, now);
			if (!ch.length) continue;
			texts.set(p, applyChanges(t, ch));
			counts.set(p, (counts.get(p) || 0) + ch.length);
		}
		now = now.map((p) => (p === from ? to : p));
		origin.set(to, origin.get(from));
		origin.delete(from);
		if (texts.has(from)) { texts.set(to, texts.get(from)); texts.delete(from); }
		if (counts.has(from)) { counts.set(to, counts.get(from)); counts.delete(from); }
	}
	return [...texts].map(([path, t]) => ({ path, text: t, count: counts.get(path) }));
}
