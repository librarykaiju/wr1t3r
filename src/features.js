// Which parts of wr1t3r are on, and where its own folders are: settings for
// the whole notebook, kept in _wr1t3r/Settings.md beside the Home note so
// every device has the same ones. Only what differs from the defaults is
// written, so a notebook with no Settings note behaves as wr1t3r always has.
//
//   ---
//   features:
//     health: false
//   folders:
//     uploads: Imports/
//   ---

import { parseYaml } from "./bases.js";

export const SETTINGS_NAME = "Settings.md";

// Areas that can be turned off as a whole. What isn't listed (the editor,
// sync, search, links, properties, tags, templates, themes...) is always on.
export const FEATURE_AREAS = [
	{ id: "longform", label: "Long-form writing", detail: "Corkboard, outliner, scrivenings and compile" },
	{ id: "boards", label: "Boards", detail: "Board files and board blocks in notes" },
	{ id: "daily", label: "Daily notes and planner", detail: "The Today button, the planner page and its timeline" },
	{ id: "health", label: "Health and food", detail: "Food logging, recipes and nutrition, and the planner's health buttons" },
	{ id: "media", label: "Media logs", detail: "Book, movie, TV, music, game, comic and podcast notes" },
	{ id: "calendar", label: "Calendar", detail: "The agenda, the month calendar and calendar events in the timeline" },
	{ id: "audio", label: "Transcripts and voice memos", detail: "Transcribe video and audio files, and record voice memos" },
	{ id: "ocr", label: "Searchable pictures and PDFs", detail: "Read the text in pictures and PDFs so search finds them" },
	{ id: "capture", label: "Capture and clipping", detail: "The Inbox, quick capture and the web clipper" },
	{ id: "reminders", label: "Reminders", detail: "Notifications for tasks with a time" },
];

// wr1t3r's own folders, relative to the notes' folder ("content/" or the top).
// The inbox is a note; the rest are folders and end in "/".
export const FOLDER_SETTINGS = [
	{ id: "inbox", label: "Inbox note", detail: "Where captures and shared links go", dflt: "Inbox.md" },
	{ id: "uploads", label: "Uploads", detail: "Notes made from uploaded files", dflt: "_uploads/" },
	{ id: "clippings", label: "Clippings", detail: "Clipped web pages", dflt: "_clippings/" },
	{ id: "compiled", label: "Compiled", detail: "Compiled folders saved as notes", dflt: "_compiled/" },
	{ id: "lists", label: "Task lists", detail: "The Critical and To Do list notes", dflt: "_docs/" },
];

// Palette commands that belong to an area (by label, or a label's start).
// Anything else stays whatever the areas say.
const COMMAND_AREAS = [
	["longform", ["Open corkboard", "Open outliner", "Open scrivenings", "Compile a folder"]],
	["boards", ["New board file", "Rename .base files to .board", "Insert board"]],
	["daily", ["Open today's daily note"]],
	["health", ["Log food"]],
	["media", ["New book log", "New movie log", "New TV series log", "New music log", "New game log", "New podcast log", "New comic log"]],
	["calendar", ["Add calendar events to the timeline"]],
	["audio", ["Transcribe a video or audio file", "Record a voice memo"]],
	["ocr", ["Make pictures and PDFs searchable", "Stop reading new pictures and PDFs"]],
	["capture", ["Capture to the Inbox", "Clip a web page"]],
	["reminders", ["Turn on reminders on this device", "Turn off reminders on this device"]],
];
const byLabel = new Map(COMMAND_AREAS.flatMap(([area, labels]) => labels.map((l) => [l, area])));

// The area a palette command belongs to, or null for the always-on core.
export const commandArea = (label) => byLabel.get(label) ?? null;

const fence = (lines) => {
	if (!/^---\s*$/.test(lines[0] ?? "")) return null;
	for (let i = 1; i < lines.length; i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) return [0, i];
	return null;
};

const isMap = (v) => v != null && typeof v === "object" && !Array.isArray(v);

// A folder setting as typed: no leading slash, no "..", folders end in "/",
// the inbox ends in ".md". "" or nonsense means the default.
export function cleanFolder(id, value) {
	const s = FOLDER_SETTINGS.find((f) => f.id === id);
	if (!s) return null;
	let v = String(value ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
	if (!v || v.split("/").some((seg) => seg === ".." || seg === ".") || v.split("/").some((seg, i, a) => !seg && i < a.length - 1)) return s.dflt;
	if (id === "inbox") {
		v = v.replace(/\/+$/, "");
		if (!v) return s.dflt;
		return /\.md$/i.test(v) ? v : v + ".md";
	}
	return v.endsWith("/") ? v : v + "/";
}

// The settings in a Settings note's text, defaults filled in:
// { features: {id: bool}, folders: {id: path} }.
export function readSettings(text) {
	const lines = String(text || "").split("\n");
	const f = fence(lines);
	let y = null;
	if (f) try { y = parseYaml(lines.slice(f[0] + 1, f[1]).join("\n")); } catch {}
	const feats = isMap(y?.features) ? y.features : {};
	const dirs = isMap(y?.folders) ? y.folders : {};
	return {
		features: Object.fromEntries(FEATURE_AREAS.map((a) => [a.id, feats[a.id] !== false])),
		folders: Object.fromEntries(FOLDER_SETTINGS.map((s) => [s.id, typeof dirs[s.id] === "string" ? cleanFolder(s.id, dirs[s.id]) : s.dflt])),
	};
}

const yamlString = (s) => (/^[\w./ -]+$/.test(s) && !/^[\s-]|\s$/.test(s) && !/^(true|false|null|yes|no|~)$/i.test(s) ? s : JSON.stringify(s));

// The YAML lines for settings, leaving out every default.
function settingsYaml(settings) {
	const out = [];
	const feats = FEATURE_AREAS.filter((a) => settings.features?.[a.id] === false);
	if (feats.length) out.push("features:", ...feats.map((a) => `  ${a.id}: false`));
	const dirs = FOLDER_SETTINGS.map((s) => [s, cleanFolder(s.id, settings.folders?.[s.id])]).filter(([s, v]) => v !== s.dflt);
	if (dirs.length) out.push("folders:", ...dirs.map(([s, v]) => `  ${s.id}: ${yamlString(v)}`));
	return out;
}

export const SETTINGS_BODY = "wr1t3r's settings for this notebook: which parts are on, and where its own folders are. Change them in Settings > Features, or edit the list above.\n";

// text with its features and folders replaced by settings'. Other frontmatter
// and the body stay as they were.
export function writeSettings(text, settings) {
	const lines = String(text || "").split("\n");
	const block = settingsYaml(settings);
	const f = fence(lines);
	if (!f) return ["---", ...block, "---", ...(text ? lines : [SETTINGS_BODY])].join("\n");
	// Drop the old features: and folders: blocks (each key and its indented lines).
	const keep = [];
	for (let i = f[0] + 1; i < f[1]; i++) {
		if (/^(features|folders)\s*:/.test(lines[i])) {
			while (i + 1 < f[1] && (/^[ \t]/.test(lines[i + 1]) || !lines[i + 1].trim())) i++;
			continue;
		}
		keep.push(lines[i]);
	}
	return [lines[f[0]], ...keep, ...block, ...lines.slice(f[1])].join("\n");
}

// Where the Settings note is: an existing _wr1t3r/Settings.md anywhere, else
// one beside the Home note (homeFolder: "content/_wr1t3r/", say).
export function settingsPath(paths, homeFolder) {
	const want = "_wr1t3r/" + SETTINGS_NAME.toLowerCase();
	const found = paths.filter((p) => p.toLowerCase() === want || p.toLowerCase().endsWith("/" + want));
	return found.sort((a, b) => a.length - b.length)[0] || homeFolder + SETTINGS_NAME;
}
