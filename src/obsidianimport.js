// Import from Obsidian: a vault's notes, boards, templates and attachments,
// copied in from the vault folder (or a .zip of it) picked on this device.
// Nothing signs in anywhere; the files go through the page like any other
// note or picture, so it's the same on every build. Notes keep their bytes;
// the only changes are .base files becoming .board, the templates folder
// becoming _templates, and links to either following them.

import { isNotePath, isAttachmentPath, BOARD_EXT } from "./paths.js";
import { moveLinkEdits } from "./moves.js";

export const MAX_FILE = 20 * 1024 * 1024; // what every storage takes for one attachment

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// The vault's own folder name and its files with paths inside it. A folder
// pick gives "Vault/Notes/a.md"; a zip may or may not wrap everything in one
// folder (and macOS adds __MACOSX/). entries: [{ path, ... }] -> { name, entries }
export function vaultRoot(entries, fallback = "") {
	const list = entries
		.map((e) => ({ ...e, path: e.path.replace(/\\/g, "/").replace(/^\/+/, "") }))
		.filter((e) => e.path && !e.path.endsWith("/") && !/^__MACOSX\//.test(e.path));
	let name = fallback;
	for (;;) {
		const first = list[0]?.path.split("/")[0];
		if (!first || !list.every((e) => e.path.startsWith(first + "/"))) break;
		name = first;
		for (const e of list) e.path = e.path.slice(first.length + 1);
	}
	return { name: name.replace(/\.zip$/i, ""), entries: list };
}

// The vault's templates folder ("Templates/"), from Obsidian's Templates
// settings or Templater's, else a top-level folder called Templates. configs:
// { templates: parsed .obsidian/templates.json, templater: parsed Templater data.json }
export function templatesFolderOf(paths, configs = {}) {
	const tidy = (f) => (typeof f === "string" && f.trim() ? f.trim().replace(/^\/+|\/+$/g, "") + "/" : null);
	const set = tidy(configs.templates?.folder) || tidy(configs.templater?.templates_folder);
	if (set) return set;
	const top = paths.find((p) => /^templates\//i.test(p));
	return top ? top.slice(0, top.indexOf("/") + 1) : null;
}

// What happens to each file. paths: the vault's files (inside the vault);
// sizes: path -> bytes, when known. templates: the templates folder or null.
// -> { notes: [{ from, to }], files: [{ from, to }], renames: [{ from, to }], skipped: [{ path, why }], hidden }
// "to" is still inside the vault (the target folder is added later); renames
// are the moves links have to follow.
export function planVault(paths, { sizes = new Map(), templates = null } = {}) {
	const notes = [], files = [], renames = [], skipped = [];
	let hidden = 0;
	for (const path of paths) {
		if (path.split("/").some((seg) => seg.startsWith("."))) { hidden++; continue; } // .obsidian, .trash, .git, .DS_Store
		if ((sizes.get(path) || 0) > MAX_FILE && !/\.(md|base)$/i.test(path)) { skipped.push({ path, why: "bigger than 20 MB" }); continue; }
		if (isNotePath(path)) {
			let to = path.replace(/\.base$/i, BOARD_EXT);
			if (templates && /\.md$/i.test(path) && path.toLowerCase().startsWith(templates.toLowerCase())) to = "_templates/" + path.slice(templates.length);
			notes.push({ from: path, to });
			if (to !== path) renames.push({ from: path, to });
		} else if (isAttachmentPath(path)) {
			files.push({ from: path, to: path });
		} else {
			skipped.push({ path, why: whyNot(path) });
		}
	}
	return { notes, files, renames, skipped, hidden };
}

function whyNot(path) {
	const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
	if (ext === "canvas") return "canvases don't open in wr1t3r";
	if (ext === "excalidraw") return "Excalidraw drawings don't open in wr1t3r";
	if (ext === "txt") return "a plain text file (Upload files turns it into a note)";
	if (ext === "docx" || ext === "html" || ext === "htm") return "not a note (Upload files turns it into one)";
	return ext ? `.${ext} files don't open in wr1t3r` : "not a note or attachment";
}

// A note's bytes as text, unchanged; null when they aren't UTF-8 (kept as bytes).
export function noteText(bytes) {
	try { return decoder.decode(bytes); } catch { return null; }
}

// The notes' texts with links following the renames. texts: Map from -> text.
// -> Map to -> text, for every note (changed or not).
export function followRenames(plan, texts) {
	const out = new Map(plan.notes.map((n) => [n.to, texts.get(n.from)]));
	// Moving a template only changes links that spell out its folder, so the
	// (slow) link rewrite runs for those moves only when some note does that.
	const all = [...texts.values()].filter((t) => t != null).join("\n").toLowerCase();
	const pairs = plan.renames.filter((r) => r.from.slice(r.from.lastIndexOf("/") + 1) !== r.to.slice(r.to.lastIndexOf("/") + 1) || all.includes(r.from.slice(0, r.from.lastIndexOf("/") + 1).toLowerCase()));
	if (!pairs.length) return out;
	for (const e of moveLinkEdits(pairs, plan.notes.map((n) => n.from), (p) => texts.get(p) ?? null)) out.set(e.path, e.text);
	return out;
}

// Plugin features in a note that wr1t3r keeps as text: [label].
const FENCES = [
	[/^[ \t]*(```|~~~)[ \t]*tasks[ \t]*$/im, "Tasks query"],
	[/^[ \t]*(```|~~~)[ \t]*query[ \t]*$/im, "embedded search"],
	[/^[ \t]*(```|~~~)[ \t]*ad-[\w-]+[ \t]*$/im, "Admonition block"],
	[/^[ \t]*(```|~~~)[ \t]*chart[ \t]*$/im, "chart"],
];
export function pluginFeatures(text) {
	if (!text) return [];
	const out = [];
	const fm = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/);
	if (fm && /^excalidraw-plugin:/m.test(fm[1])) out.push("Excalidraw drawing");
	if (fm && /^kanban-plugin:/m.test(fm[1])) out.push("Kanban board (shows as lists)");
	for (const [re, label] of FENCES) if (re.test(text)) out.push(label);
	return out;
}

// Where the vault goes: the top of the notebook (home) when nothing there
// has the same name, else a folder named after the vault.
export function defaultTarget(finalPaths, existing, home, vaultName) {
	const clash = finalPaths.some((p) => existing.has((home + p).toLowerCase()));
	return clash ? home + (vaultName || "Obsidian") + "/" : home;
}

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// The import's summary, written as a note beside what came in.
// done: { notes, boards, templates, files }, skipped: [{ path, why }],
// plugins: [{ path, features }], hidden: count; target is the folder the vault went into.
export function report({ vaultName, date, target, done, skipped, plugins, hidden }) {
	const linkTo = (p) => `[[${(target + p).replace(/\.md$/i, "")}|${p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "")}]]`;
	const lines = ["---", `date: ${date}`, "tags: []", "---", "", "# Obsidian import", ""];
	const what = [plural(done.notes, "note"), done.boards && plural(done.boards, "board"), done.templates && plural(done.templates, "template"), done.files && plural(done.files, "picture or file", "pictures and files")].filter(Boolean);
	const list = what.length > 1 ? what.slice(0, -1).join(", ") + " and " + what[what.length - 1] : what[0];
	lines.push(`Imported ${list} from “${vaultName}” on ${date}${target ? ` into ${target.replace(/\/$/, "")}` : ""}.`);
	if (done.templates) lines.push("", "Templates are in Settings > Templates.");
	if (hidden) lines.push("", `Left out ${plural(hidden, "file")} in hidden folders: Obsidian's settings (.obsidian), its trash (.trash) and the like.`);
	if (skipped.length) {
		lines.push("", "## Not imported", "");
		for (const s of skipped) lines.push(`- ${s.path}: ${s.why}`);
	}
	if (plugins.length) {
		lines.push("", "## Plugin features kept as text", "", "These notes came in unchanged, but wr1t3r doesn't draw these plugins' blocks, so they show as their text.", "");
		for (const p of plugins) lines.push(`- ${linkTo(p.path)}: ${p.features.join(", ")}`);
	}
	return lines.join("\n") + "\n";
}
