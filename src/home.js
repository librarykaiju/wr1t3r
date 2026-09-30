// Home: a grid of pinned tiles, kept in one vault note so every device shows
// the same ones, and Obsidian can read and edit them. The pins are a YAML list
// in the note's frontmatter, in grid order:
//
//   ---
//   pins:
//     - link: "[[Reading log]]"          a note or a .base
//       color: 3                         1-7: the theme's rainbow (--f1..--f7), or "#hex"
//       cover: "[[covers/reading.jpg]]"  any image Pretty Properties takes, or "none"
//     - link: "folder:content/_daily"    a folder: opens it as a corkboard
//     - link: "outliner:content/Novel"   a folder as an outline (or scrivenings:, corkboard:)
//     - link: "command:Open today's daily note"   a palette command
//     - link: "https://example.com"      a web page
//       title: Example                   the tile's name, for any kind
//     - section: Reading                 a header; the tiles after it are its
//   ---
//
// Without a color a tile takes the next rainbow color in turn; without a
// cover a note's tile shows the note's own cover (or banner). Keys this file
// doesn't know are kept. Nothing else in the note is touched.

import { Text } from "@codemirror/state";
import { parseYaml } from "./bases.js";
import { resolveNote } from "./links.js";
import { prettyOf, imageRef } from "./pretty.js";

export const HOME_FOLDER = "_wr1t3r/";
export const HOME_NAME = "Home.md";
export const HOME_BODY = "Pinned tiles for wr1t3r's Home screen, in order. Pin and change them from Home, or edit the list above.\n";

// Whether path is one of wr1t3r's own files (the Home note's _wr1t3r/ folder),
// which the notes list leaves out. They still sync like any note.
export const isAppFile = (path) => /(^|\/)_wr1t3r\//i.test(path);

// Where the Home note is: an existing _wr1t3r/Home.md anywhere, else one in
// the notes' folder (root: "content/" or "").
export function homePath(paths, root) {
	const want = (HOME_FOLDER + HOME_NAME).toLowerCase();
	const found = paths.filter((p) => p.toLowerCase() === want || p.toLowerCase().endsWith("/" + want));
	return found.sort((a, b) => a.length - b.length)[0] || root + HOME_FOLDER + HOME_NAME;
}

// The frontmatter's lines as [open, close] indexes into lines, or null.
function fence(lines) {
	if (!/^---\s*$/.test(lines[0] ?? "")) return null;
	for (let i = 1; i < lines.length; i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) return [0, i];
	return null;
}

// A section header in the pins list rather than a tile.
export const isSection = (p) => p != null && typeof p === "object" && p.section != null && typeof p.section !== "object" && typeof p.link !== "string";

// For each entry, its place among the tiles (headers skipped), or -1 for a
// header: what a tile's automatic color goes by, so adding a header doesn't
// change the colors.
export function tileOrdinals(pins) {
	let n = 0;
	return pins.map((p) => (isSection(p) ? -1 : n++));
}

// The pins in a Home note's text: [{ link, title?, color?, cover?, ... }],
// with { section } entries for headers.
export function readPins(text) {
	const lines = String(text || "").split("\n");
	const f = fence(lines);
	if (!f) return [];
	let y;
	try { y = parseYaml(lines.slice(f[0] + 1, f[1]).join("\n")); } catch { return []; }
	if (!y || !Array.isArray(y.pins)) return [];
	return y.pins
		.map((p) => (typeof p === "string" ? { link: p } : p))
		.filter((p) => p && typeof p === "object" && !Array.isArray(p) && ((typeof p.link === "string" && p.link.trim()) || isSection(p)));
}

const ORDER = ["section", "link", "title", "color", "cover"];

function yamlValue(v) {
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return JSON.stringify(v); // a double-quoted YAML string, or a flow list/map
}

function pinsYaml(pins) {
	if (!pins.length) return ["pins: []"];
	const out = ["pins:"];
	for (const p of pins) {
		const keys = [...ORDER.filter((k) => k in p), ...Object.keys(p).filter((k) => !ORDER.includes(k))]
			.filter((k) => p[k] != null && p[k] !== "");
		keys.forEach((k, i) => out.push(`${i ? "    " : "  - "}${/^[\w-]+$/.test(k) ? k : JSON.stringify(k)}: ${yamlValue(p[k])}`));
	}
	return out;
}

// text with its pins list replaced by pins. The rest of the frontmatter and
// the body stay as they were; a note without frontmatter gets some.
export function writePins(text, pins) {
	const lines = String(text || "").split("\n");
	const block = pinsYaml(pins);
	const f = fence(lines);
	if (!f) return ["---", ...block, "---", ...(text ? lines : [HOME_BODY])].join("\n");
	let at = -1;
	for (let i = f[0] + 1; i < f[1]; i++) if (/^pins\s*:/.test(lines[i])) { at = i; break; }
	if (at < 0) {
		lines.splice(f[1], 0, ...block);
		return lines.join("\n");
	}
	let end = at + 1;
	// The list under pins: indented lines, or "- " items at the left edge.
	while (end < f[1] && (/^[ \t]/.test(lines[end]) || /^-(\s|$)/.test(lines[end]) || (!lines[end].trim() && end + 1 < f[1] && /^[ \t-]/.test(lines[end + 1])))) end++;
	lines.splice(at, end - at, ...block);
	return lines.join("\n");
}

// What a pin points at: { kind: "note", target } | { kind: "folder", folder }
// (with its trailing /) | { kind: "view", view, folder } (a folder's
// corkboard, outliner or scrivenings) | { kind: "command", command } |
// { kind: "url", url }.
export function pinKind(link) {
	const l = String(link || "").trim();
	if (/^https?:\/\//i.test(l)) return { kind: "url", url: l };
	let m = l.match(/^command:\s*(.+)$/i);
	if (m) return { kind: "command", command: m[1].trim() };
	m = l.match(/^(corkboard|outliner|scrivenings):\s*(.*)$/i);
	if (m) return { kind: "view", view: m[1].toLowerCase(), folder: m[2].trim().replace(/^\/+|\/+$/g, "") + "/" };
	m = l.match(/^folder:\s*(.*)$/i);
	if (m) return { kind: "folder", folder: m[1].trim().replace(/^\/+|\/+$/g, "") + "/" };
	m = l.match(/^!?\[\[(.+)\]\]$/);
	const inner = (m ? m[1] : l).split("|")[0].split("#")[0].trim();
	return { kind: "note", target: inner };
}

const baseName = (p) => p.split("/").pop();
const shown = (p) => baseName(p).replace(/\.md$/i, "");

// The vault path a note pin opens, or null. A .base is found by its name, or
// its path from the vault root; a note the way Obsidian finds a [[link]].
export function pinPath(pin, paths, fromPath) {
	const k = pinKind(pin.link);
	if (k.kind !== "note" || !k.target) return null;
	if (/\.base$/i.test(k.target)) {
		const want = k.target.replace(/^\/+/, "").toLowerCase();
		const hits = paths.filter((p) => p.toLowerCase() === want || p.toLowerCase().endsWith("/" + want));
		return hits.sort((a, b) => a.length - b.length || a.localeCompare(b))[0] || null;
	}
	return resolveNote({ note: k.target, heading: "", wiki: true }, fromPath, paths);
}

// The [[link]] for a note or base: its name when no other file has it,
// else its path from the vault root. (.md dropped, as Obsidian writes it.)
export function linkFor(path, paths) {
	const n = shown(path).toLowerCase();
	const unique = paths.filter((p) => shown(p).toLowerCase() === n).length <= 1;
	return `[[${unique ? shown(path) : path.replace(/\.md$/i, "")}]]`;
}

export const folderLink = (folder) => "folder:" + folder.replace(/\/+$/, "");
export const viewLink = (view, folder) => view + ":" + folder.replace(/\/+$/, "");

// The tile's name when the pin doesn't give one.
export function pinTitle(pin, path) {
	if (pin.title != null && String(pin.title).trim()) return String(pin.title).trim();
	const k = pinKind(pin.link);
	if (k.kind === "url") { try { return new URL(k.url).hostname.replace(/^www\./, ""); } catch { return k.url; } }
	if (k.kind === "command") return k.command;
	if (k.kind === "folder") return k.folder.slice(0, -1).split("/").pop() || "Folder";
	if (k.kind === "view") return k.folder.slice(0, -1).split("/").pop() || "Folder";
	return (path ? baseName(path) : baseName(k.target)).replace(/\.(md|base)$/i, "") || "Note";
}

// "var(--f3)" for colors 1-7 (the theme's rainbow), a "#hex" as is, or the
// color for the tile's place in the grid when none is set.
export function pinColor(pin, index) {
	const c = pin.color;
	const n = Number(c);
	if (c != null && c !== "" && Number.isInteger(n) && n >= 1 && n <= 7) return `var(--f${n})`;
	if (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c.trim())) return c.trim();
	return `var(--f${(index % 7) + 1})`;
}

// The tile's picture: { ref, from } (ref as imageRef gives it; from is the
// path its [[name]] is found from), or null. The pin's own cover wins ("none"
// turns it off); else a note's cover, then its banner.
export function pinCover(pin, path, noteText, homeFile) {
	const own = pin.cover == null ? "" : String(pin.cover).trim();
	if (/^none$/i.test(own)) return null;
	if (own) { const ref = imageRef(own); return ref ? { ref, from: homeFile } : null; }
	if (!path || noteText == null) return null;
	const { cover, banner } = prettyOf(Text.of(noteText.split("\n")));
	const ref = cover?.ref || banner?.ref;
	return ref ? { ref, from: path } : null;
}

// Pins pointed at new places after notes or folders moved. moved: Map of old
// path -> new path; folderFrom/folderTo: a moved folder (with trailing /).
// Returns null when no pin changed.
export function retargetPins(pins, moved, oldPaths, newPaths, homeFile, folderFrom = null, folderTo = null) {
	let changed = false;
	const out = pins.map((p) => {
		if (isSection(p)) return p;
		const k = pinKind(p.link);
		if (k.kind === "note") {
			const was = pinPath(p, oldPaths, homeFile);
			if (was && moved.has(was)) { changed = true; return { ...p, link: linkFor(moved.get(was), newPaths) }; }
		} else if (k.kind === "folder" && folderFrom && k.folder.toLowerCase().startsWith(folderFrom.toLowerCase())) {
			changed = true;
			return { ...p, link: folderLink(folderTo + k.folder.slice(folderFrom.length)) };
		} else if (k.kind === "view" && folderFrom && k.folder.toLowerCase().startsWith(folderFrom.toLowerCase())) {
			changed = true;
			return { ...p, link: viewLink(k.view, folderTo + k.folder.slice(folderFrom.length)) };
		}
		return p;
	});
	return changed ? out : null;
}

// Whether a pin opens path (a note), folder, or a folder's view.
export function pinOpens(pin, { path = null, folder = null, view = null }, paths, homeFile) {
	if (isSection(pin)) return false;
	const k = pinKind(pin.link);
	// A folder: pin opens the corkboard, so it counts as the corkboard's pin too.
	if (view) return (k.kind === "view" ? k.view === view : k.kind === "folder" && view === "corkboard") && k.folder.toLowerCase() === folder.toLowerCase();
	if (folder) return k.kind === "folder" && k.folder.toLowerCase() === folder.toLowerCase();
	return k.kind === "note" && pinPath(pin, paths, homeFile) === path;
}
