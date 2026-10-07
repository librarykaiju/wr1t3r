// Import from Day One: its JSON export (Settings > Import/Export > Export >
// JSON, a .zip with a .json file per journal and folders of photos, videos,
// audio and PDFs). Each entry becomes a note named by its date, with its
// tags, place, weather and star as properties, and its photos and other
// media saved alongside and shown where they were in the entry.

import { frontmatter, uniquePath, fileName, isoDate, embed } from "./imports.js";
import { isAttachmentPath } from "./paths.js";

// Day One escapes punctuation in its Markdown ("Done\!", "1\. item" stays); the
// ones that can't change what the text means come back unescaped.
export function unescapeDayOne(text) {
	return text.replace(/\\([.!,:;'"?()\-+&@%=~/$])/g, (all, c, i) => {
		// "1\." and "\-" or "\+" starting a line stay escaped: unescaped they'd make a list.
		const before = text.slice(text.lastIndexOf("\n", i - 1) + 1, i);
		if ((c === "." && /^\s*\d+$/.test(before)) || ("-+".includes(c) && /^\s*$/.test(before))) return all;
		return c;
	});
}

const MEDIA = [["photos", "photos"], ["videos", "videos"], ["audios", "audios"], ["pdfAttachments", "pdfs"]];

// One journal. json: the parsed .json file; journal: its name; has(path):
// whether the export has that file (e.g. "photos/<md5>.jpeg"). base: the
// folder its entries go in, inside the import ("" or "Travel/"). taken: paths used.
// -> { notes: [{ path, text }], files: [{ from, path }], skipped }
export function readDayOne(json, journal, has, { base = "", taken = new Set() } = {}) {
	if (!Array.isArray(json?.entries)) throw new Error(`${journal}.json isn't a Day One journal.`);
	const notes = [], files = [], skipped = [];
	for (const e of json.entries) {
		const tz = e.timeZone || undefined;
		const date = isoDate(e.creationDate, { timeZone: tz });
		const time = isoDate(e.creationDate, { withTime: true, timeZone: tz }).slice(11);
		let text = unescapeDayOne(String(e.text || "")).replace(/\r\n/g, "\n");
		const heading = /^#{1,6} +(.+)\n?/.exec(text);
		const title = heading ? heading[1].trim() : "";
		const path = uniquePath(taken, base + fileName(date ? `${date}${title ? " " + title : ""}` : title || "Entry") + ".md");
		// Media named in the text by identifier: dayone-moment://ID, or dayone-moment:/video/ID and the like.
		const byId = new Map();
		for (const [key, dir] of MEDIA) {
			for (const m of e[key] || []) {
				const ext = String(m.type || m.fileExtension || (dir === "pdfs" ? "pdf" : dir === "audios" ? "m4a" : "")).toLowerCase();
				const from = `${dir}/${m.md5}.${ext}`;
				if (!m.md5 || !has(from)) { byId.set(m.identifier, null); skipped.push({ path: `${date} entry: ${from}`, why: "not in the export (Day One leaves out media it hasn't downloaded)" }); continue; }
				const name = `${date || "entry"} ${m.md5.slice(0, 8)}.${ext}`;
				if (!isAttachmentPath(name)) { byId.set(m.identifier, null); skipped.push({ path: `${date} entry: ${from}`, why: "a kind of file wr1t3r doesn't open" }); continue; }
				const at = uniquePath(taken, "attachments/" + name);
				files.push({ from, path: at });
				byId.set(m.identifier, at);
			}
		}
		text = text.replace(/!\[([^\]]*)\]\(dayone-moment:\/*(?:[a-z]+\/)?([^)\s]+)\)/gi, (all, alt, id) => {
			if (!byId.has(id)) return all;
			const at = byId.get(id);
			return at ? embed("../".repeat(base.split("/").length - 1) + at, alt) : "";
		});
		const loc = e.location || {};
		const place = [loc.placeName, loc.localityName, loc.administrativeArea, loc.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
		const w = e.weather || {};
		const weather = [w.conditionsDescription, Number.isFinite(w.temperatureCelsius) ? `${Math.round(w.temperatureCelsius)}°C` : ""].filter(Boolean).join(", ");
		notes.push({
			path,
			text: frontmatter([
				["title", title],
				["date", date && time ? `${date} ${time}` : date],
				["tags", e.tags || []],
				["location", place],
				["weather", weather],
				["starred", e.starred ? true : ""],
			]) + (text.trim() ? text.trim() + "\n" : ""),
		});
	}
	return { notes, files, skipped };
}
