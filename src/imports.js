// What the imports from other apps share (src/obsidianimport.js,
// notionimport.js, wordpressimport.js, evernoteimport.js, dayoneimport.js):
// each turns the person's own export file into notes and attachments in the
// page, and src/main.js writes them the same way for every app. Nothing
// signs in to the other service, so it's the same on every build.

import { yamlItem } from "./frontmatter.js";
import { noteName } from "./convert-text.js";

export const MAX_FILE = 20 * 1024 * 1024; // what every storage takes for one attachment

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// A note's bytes as text, unchanged; null when they aren't UTF-8 (kept as bytes).
export function noteText(bytes) {
	try { return decoder.decode(bytes); } catch { return null; }
}

export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// A file name from a title: none of the characters Windows or links refuse.
export const fileName = (title, fallback = "Untitled") => noteName(String(title || "").replace(/\s+/g, " ").trim() + ".x") || fallback;

// path, or "path 2.md" and so on when the name (in any case) is taken. taken: Set of lower-case paths, added to.
export function uniquePath(taken, path) {
	const dot = path.lastIndexOf(".");
	const [stem, ext] = dot > path.lastIndexOf("/") ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
	let p = path;
	for (let n = 2; taken.has(p.toLowerCase()); n++) p = `${stem} ${n}${ext}`;
	taken.add(p.toLowerCase());
	return p;
}

// A YAML value: plain where that reads back as the same string, quoted otherwise.
export function yamlValue(v, flow = false) {
	if (v == null || v === "") return "";
	if (typeof v === "boolean" || typeof v === "number") return String(v);
	const s = String(v).replace(/\r?\n/g, " ");
	if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) return s; // a date stays a date
	if (/^(true|false|yes|no|on|off|null|~)$/i.test(s) || /^[-+]?(\d|\.\d)/.test(s)) return JSON.stringify(s);
	return yamlItem(s, flow);
}

// Frontmatter from [key, value] pairs (a list value is a YAML list); empty values are left out.
export function frontmatter(pairs) {
	const lines = ["---"];
	for (const [k, v] of pairs) {
		if (Array.isArray(v)) {
			const items = v.filter((x) => x != null && String(x).trim());
			lines.push(items.length ? `${k}: [${items.map((x) => yamlValue(x, true)).join(", ")}]` : `${k}: []`);
		} else if (v != null && v !== "") lines.push(`${k}: ${yamlValue(v)}`);
	}
	lines.push("---", "");
	return lines.join("\n");
}

// A date as YYYY-MM-DD (and HH:mm when withTime) in timeZone, or "" when it isn't a date.
export function isoDate(d, { withTime = false, timeZone } = {}) {
	const date = d instanceof Date ? d : new Date(d);
	if (Number.isNaN(date.getTime())) return "";
	let parts;
	try {
		parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((p) => [p.type, p.value]));
	} catch {
		return isoDate(date, { withTime }); // an unknown time zone: the device's
	}
	return `${parts.year}-${parts.month}-${parts.day}` + (withTime ? ` ${parts.hour}:${parts.minute}` : "");
}

// ---- XML (WordPress and Evernote exports), without a DOM so it runs anywhere -----------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
	if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
	return ENTITIES[e.toLowerCase()] ?? m;
});

// An element's text: CDATA sections as they are, everything else with entities decoded.
export function xmlText(inner) {
	let out = "";
	const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
	let at = 0, m;
	while ((m = re.exec(inner))) {
		out += decodeEntities(inner.slice(at, m.index)) + m[1];
		at = re.lastIndex;
	}
	return (out + decodeEntities(inner.slice(at))).trim();
}

const esc = (tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Every <tag ...>inner</tag> in xml: [{ attrs, inner }]. Tags of the same name don't nest in these exports.
export function xmlAll(xml, tag) {
	const out = [];
	const re = new RegExp(`<${esc(tag)}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${esc(tag)}>)`, "g");
	for (const m of xml.matchAll(re)) out.push({ attrs: attrsOf(m[1] || ""), inner: m[2] || "" });
	return out;
}
export const xmlOne = (xml, tag) => { const a = xmlAll(xml, tag); return a.length ? xmlText(a[0].inner) : ""; };

export function attrsOf(s) {
	const out = {};
	for (const m of s.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = decodeEntities(m[2] ?? m[3]);
	return out;
}

export function base64Bytes(b64) {
	const bin = atob(b64.replace(/\s+/g, ""));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

// The file extension for a MIME type, for attachments that come without a name.
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic", "image/svg+xml": "svg", "application/pdf": "pdf", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav", "video/mp4": "mp4", "video/quicktime": "mov" };
export const extFor = (mime) => EXT[String(mime || "").toLowerCase()] || "";

// A link to an attachment from a note: relative, in <...> so spaces need no escaping.
export const embed = (rel, alt = "") => `![${alt.replace(/[[\]]/g, "")}](<${rel}>)`;

// The import's summary, written as a note beside what came in.
// done: { notes, boards, templates, files }; skipped: [{ path, why }];
// plugins: [{ path, features }]; remarks: paragraphs to add after the first.
export function report({ source, name, date, target, done, skipped = [], plugins = [], remarks = [] }) {
	const linkTo = (p) => `[[${(target + p).replace(/\.md$/i, "")}|${p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "")}]]`;
	const lines = ["---", `date: ${date}`, "tags: []", "---", "", `# ${source} import`, ""];
	const what = [plural(done.notes, "note"), done.boards && plural(done.boards, "board"), done.templates && plural(done.templates, "template"), done.files && plural(done.files, "picture or file", "pictures and files")].filter(Boolean);
	const list = what.length > 1 ? what.slice(0, -1).join(", ") + " and " + what[what.length - 1] : what[0];
	lines.push(`Imported ${list} from “${name}” on ${date}${target ? ` into ${target.replace(/\/$/, "")}` : ""}.`);
	if (done.templates) lines.push("", "Templates are in Settings > Templates.");
	for (const n of remarks) lines.push("", n);
	if (skipped.length) {
		lines.push("", "## Not imported", "");
		for (const s of skipped) lines.push(`- ${s.path}: ${s.why}`);
	}
	if (plugins.length) {
		lines.push("", "## Kept as text", "", "These notes came in, but wr1t3r doesn't draw these parts, so they show as their text.", "");
		for (const p of plugins) lines.push(`- ${linkTo(p.path)}: ${p.features.join(", ")}`);
	}
	return lines.join("\n") + "\n";
}
