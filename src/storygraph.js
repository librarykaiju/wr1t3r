// Importing a StoryGraph library export (Manage Account > Export StoryGraph
// Library: a CSV with a row per book) as book logs. A book that already has
// a log (same title) gets what the log is missing; the rest become new logs
// shaped like the book lookup's (worker/media.js). Covers and summaries are
// looked up afterwards (src/main.js), since StoryGraph's file has neither.
//
// The columns used, matched by name so their order doesn't matter:
//   Title, Authors, ISBN/UID, Format, Read Status, Date Added, Last Date Read,
//   Moods, Pace, Character- or Plot-Driven?, Star Rating, Review, Tags

import { parseFrontmatter } from "./dvpage.js";
import { setProperty } from "./bases.js";
import { formatFor } from "./properties.js";
import { genresFromSubjects, JUNK_SUBJECT } from "../worker/genres.js";

// RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks.
export function parseCsv(text) {
	const rows = [];
	let row = [], field = "", q = false;
	const s = String(text || "").replace(/^﻿/, "");
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (q) {
			if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
			else if (c === '"') q = false;
			else field += c;
		} else if (c === '"') q = true;
		else if (c === ",") { row.push(field); field = ""; }
		else if (c === "\n" || c === "\r") {
			if (c === "\r" && s[i + 1] === "\n") i++;
			row.push(field); field = "";
			if (row.some((f) => f !== "")) rows.push(row);
			row = [];
		} else field += c;
	}
	row.push(field);
	if (row.some((f) => f !== "")) rows.push(row);
	return rows;
}

const SHELVES = { "read": "Finished", "currently-reading": "Currently Reading", "to-read": "TBR", "did-not-finish": "DNF", "paused": "Paused" };

const cap = (s) => s.replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const list = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
// "2024/03/15" or "2024-03-15" -> "2024-03-15"
const day = (s) => {
	const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(String(s || ""));
	return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
};

// The export's books, or throws when it isn't a StoryGraph export.
export function readExport(text) {
	const [head, ...rows] = parseCsv(text);
	const col = (name) => (head || []).findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
	const at = { title: col("Title"), authors: col("Authors"), isbn: col("ISBN/UID"), format: col("Format"), status: col("Read Status"), added: col("Date Added"), last: col("Last Date Read"), dates: col("Dates Read"), moods: col("Moods"), pace: col("Pace"), driven: col("Character- or Plot-Driven?"), rating: col("Star Rating"), review: col("Review"), tags: col("Tags") };
	if (at.title < 0 || at.status < 0) throw new Error("That isn't a StoryGraph library export (no Title and Read Status columns).");
	const get = (r, k) => (at[k] >= 0 ? String(r[at[k]] ?? "").trim() : "");
	return rows.map((r) => {
		const rating = Number(get(r, "rating"));
		const pace = get(r, "pace").toLowerCase();
		const driven = get(r, "driven").toLowerCase();
		// The last read date; else the end of the last range in Dates Read.
		// ISBN/UID holds StoryGraph's own id when it has no ISBN.
		const isbn = get(r, "isbn").replace(/[\s-]/g, "").toUpperCase();
		const finished = day(get(r, "last")) || day(get(r, "dates").split(/[-–,]/).filter((x) => /\d{4}/.test(x)).pop());
		return {
			title: get(r, "title"),
			authors: list(get(r, "authors")),
			isbn: /^(97[89]\d{10}|\d{9}[\dX])$/.test(isbn) ? isbn : null,
			format: formatFor(get(r, "format")),
			shelf: SHELVES[get(r, "status").toLowerCase()] || (get(r, "status") ? cap(get(r, "status").replace(/-/g, " ")) : null),
			added: day(get(r, "added")),
			finished,
			rating: rating > 0 ? "⭐".repeat(Math.min(5, Math.max(1, Math.round(rating)))) : null,
			vibes: [
				...list(get(r, "moods")).map(cap),
				...(/^(fast|medium|slow)$/.test(pace) ? [cap(pace) + "-paced"] : []),
				...(/^plot/.test(driven) ? ["Plot-driven"] : /^character/.test(driven) ? ["Character-driven"] : []),
			],
			tags: list(get(r, "tags")).map((t) => t.replace(/^#/, "").replace(/\s+/g, "-").toLowerCase()),
			review: get(r, "review"),
		};
	}).filter((b) => b.title);
}

// A title for matching: no case, punctuation or "(2021)". The whole title,
// so "Batman: Year One" and "Batman: The Long Halloween" stay two books.
export const titleKey = (t) => String(t || "").replace(/\s*\(\d{4}\)\s*$/, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// The same without a subtitle: "Onyx Storm: Empyrean 3" -> "onyx storm".
const shortKey = (t) => titleKey(String(t || "").replace(/\s*\(\d{4}\)\s*$/, "").split(/[:(]/)[0]);

const yamlList = (key, values) => (values.length ? [`${key}:`, ...values.map((v) => `  - ${JSON.stringify(v)}`)] : [`${key}: []`]);

// A new book log for b, in the book lookup's order of properties.
export function bookNote(b, today) {
	const lines = [
		"---",
		`title: ${JSON.stringify(b.title)}`,
		...yamlList("author", b.authors),
		"series: []",
		"volume:",
		...yamlList("format", b.format ? [b.format] : []),
		"pages:",
		"subjects: []",
		"genre: []",
		...yamlList("vibesAndThemes", b.vibes),
		...yamlList("shelf", b.shelf ? [b.shelf] : []),
		...yamlList("rating", b.rating ? [b.rating] : []),
		"coverImage:",
		"summary:",
		"sticky: false",
		"publish: false",
		...(b.finished ? [`finished: ${b.finished}`] : []),
		`date: ${b.added || today}`,
		"eyebrow:",
		...(b.tags.length ? yamlList("tags", b.tags) : []),
		"---",
		"",
		"## Notes",
		"",
		...(b.review ? [b.review.replace(/\r\n?/g, "\n").trim(), ""] : []),
	];
	return lines.join("\n");
}

const empty = (v) => v == null || (Array.isArray(v) ? !v.some((x) => String(x ?? "").trim()) : !String(v).trim());

// An existing log with what StoryGraph knows filled in where the log has
// nothing (shelf, rating, finished, format), and moods and tags added to
// what's there. Nothing already written is changed, and the body is left alone.
export function mergeBook(text, b) {
	const p = parseFrontmatter(text);
	let t = text;
	if (b.shelf && empty(p.shelf)) t = setProperty(t, "shelf", [b.shelf]);
	if (b.rating && empty(p.rating)) t = setProperty(t, "rating", [b.rating]);
	if (b.finished && empty(p.finished)) t = setProperty(t, "finished", b.finished);
	if (b.format && empty(p.format)) t = setProperty(t, "format", [b.format]);
	const add = (key, values) => {
		const have = Array.isArray(p[key]) ? p[key].map(String) : empty(p[key]) ? [] : [String(p[key])];
		const lower = new Set(have.map((x) => x.toLowerCase()));
		const more = values.filter((v) => !lower.has(v.toLowerCase()));
		if (more.length) t = setProperty(t, key, [...have, ...more]);
	};
	add("vibesAndThemes", b.vibes);
	if (b.tags.length) add("tags", b.tags);
	return t;
}

// What importing would do: { add: [book], update: [{ path, book }] }.
// logs: [{ path, text }] of the existing book logs.
export function planImport(books, logs) {
	const byTitle = new Map(), byShort = new Map();
	for (const l of logs) {
		const p = parseFrontmatter(l.text);
		const title = Array.isArray(p.title) ? p.title[0] : p.title || l.path.split("/").pop().replace(/\.md$/i, "");
		const key = titleKey(title);
		if (key && !byTitle.has(key)) byTitle.set(key, l.path);
		const s = shortKey(title);
		if (s) byShort.set(s, [...(byShort.get(s) || []), l.path]);
	}
	// A log titled without its subtitle still matches, unless the title
	// before the colon is shared by more than one log or book.
	const shared = new Map();
	for (const b of new Map(books.map((b) => [titleKey(b.title), b])).values()) shared.set(shortKey(b.title), (shared.get(shortKey(b.title)) || 0) + 1);
	const add = [], update = [], seen = new Set();
	for (const b of books) {
		const key = titleKey(b.title);
		if (seen.has(key)) continue;
		seen.add(key);
		const s = shortKey(b.title), loose = byShort.get(s);
		const path = byTitle.get(key) || (loose?.length === 1 && shared.get(s) === 1 ? loose[0] : null);
		if (path) update.push({ path, book: b }); else add.push(b);
	}
	return { add, update };
}

// What Open Library has for b: { coverImage, pages, subjects, genre, summary },
// any of them missing; null when it doesn't know the book. By ISBN when the
// export has one, else (or when Open Library doesn't know it) by title and author.
export async function lookUpBook(b, fetchFn = fetch) {
	const search = async (params) => {
		const q = new URLSearchParams({ ...params, fields: "key,cover_i,number_of_pages_median,subject", limit: "1" });
		const res = await fetchFn("https://openlibrary.org/search.json?" + q);
		if (!res.ok) throw new Error(`Open Library: ${res.status}`);
		return (await res.json()).docs?.[0];
	};
	let doc = b.isbn ? await search({ isbn: b.isbn }) : null;
	if (!doc) doc = await search({ title: b.title.split(":")[0], ...(b.authors[0] ? { author: b.authors[0] } : {}) });
	if (!doc) return null;
	const out = {};
	if (doc.cover_i) out.coverImage = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
	if (doc.number_of_pages_median > 0) out.pages = doc.number_of_pages_median;
	const subjects = [...new Set((doc.subject || []).filter((s) => s.length < 40 && !/[,:(]|fiction$/i.test(s) && !JUNK_SUBJECT.test(s)))].slice(0, 8);
	if (subjects.length) out.subjects = subjects;
	// Genres from all of them, "Fantasy fiction" and "Fiction, romance" included.
	const genre = genresFromSubjects(doc.subject);
	if (genre.length) out.genre = genre;
	if (/^\/works\/OL\d+W$/.test(doc.key || "")) {
		try {
			const w = await (await fetchFn(`https://openlibrary.org${doc.key}.json`)).json();
			const d = typeof w.description === "string" ? w.description : w.description?.value;
			if (d) out.summary = d.replace(/\r\n?/g, "\n").split(/\n-{3,}|\n\(\[source\]/)[0].trim();
		} catch {}
	}
	return out;
}

// Whether a log is missing anything lookUpBook could fill in.
export const needsLookup = (text) => {
	const p = parseFrontmatter(text);
	return ["coverImage", "pages", "subjects", "genre", "summary"].some((k) => empty(p[k]));
};

// A book log's text with genres from its own subjects, when it has subjects
// and an empty genre; null when there's nothing to do. No lookups, so it
// works offline and on logs made by the book lookup before genres were.
export function genresFromLog(text) {
	const p = parseFrontmatter(text);
	if (!("genre" in p) || !empty(p.genre) || empty(p.subjects)) return null;
	const genre = genresFromSubjects(Array.isArray(p.subjects) ? p.subjects.map(String) : [String(p.subjects)]);
	return genre.length ? setProperty(text, "genre", genre) : null;
}

// A log's text with what lookUpBook found, where the log has nothing.
export function fillBook(text, found) {
	const p = parseFrontmatter(text);
	let t = text;
	for (const [k, v] of Object.entries(found || {})) if (empty(p[k])) t = setProperty(t, k, v);
	return t;
}
