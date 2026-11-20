// Highlights and audiobook bookmarks from Reader (librarykaiju/reader) into
// the matching book logs. Reader's Settings > Export notes makes a zip with
// one Markdown file per book ("Reader notes/<Title>.md"; its one-book Export
// Markdown makes a single file): YAML properties (title, author, series,
// volume, formats, status, reader: a link holding the book's id), then
// "## Highlights" (each a quote, its note under it, "---" between them) and
// "## Bookmarks" (one "- **1:23:45** · Chapter — note" line each).
//
// An import only ever adds: the highlights and bookmarks not brought over
// before go at the end of the log's "## Notes", and no line already in the
// log is changed or removed, so notes jotted in Reader can be fleshed out
// here. The log's `reader_imported:` property lists a key for each one
// brought over, so one edited or deleted here doesn't come back. (The other
// side of that: a note changed in Reader after it was imported isn't brought
// over again.) Each one's key is its id in Reader (h#12, m#45), from the
// hidden "<!-- reader:h:12 2026-11-20T12:00:00.000Z -->" Reader writes with
// it, which also says when it was made, so new ones go in in that order (the
// comment itself isn't copied). An export from before Reader wrote those is
// keyed by what it does have: a highlight's quoted words (h:<hash>, the note
// left out so a note added later doesn't make it new) and a bookmark's time
// (m:<time>). A log holding those older keys still counts the same ones as
// brought over, so nothing comes twice when the keys change.
//
// The log's `reader:` property holds Reader's book id, so a later import
// finds it again whatever it's called by then; the first import matches by
// title and author, as the StoryGraph import does. src/main.js
// (importReaderNotes) runs it.

import { parseFrontmatter } from "./dvpage.js";
import { setProperties } from "./tandoor.js";
import { titleKey, shortKey } from "./storygraph.js";

// ---- Reading the export ------------------------------------------------------

const unquote = (v) => {
	const s = String(v ?? "").trim();
	if (/^".*"$/.test(s)) { try { return JSON.parse(s); } catch { /* as it is */ } }
	return s.replace(/^'(.*)'$/, "$1");
};

// The lines under "## heading" up to the next heading of level 1 or 2.
function section(lines, heading) {
	const at = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`, "i").test(l));
	if (at < 0) return [];
	let end = at + 1;
	while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
	return lines.slice(at + 1, end);
}

// Blank lines at the ends dropped and runs of them made one.
function tidy(lines) {
	const out = [];
	for (const l of lines) if (l.trim() || (out.length && out.at(-1).trim())) out.push(l.replace(/\s+$/, ""));
	while (out.length && !out.at(-1).trim()) out.pop();
	return out;
}

// FNV-1a, 32 bits, as 8 hex digits: short, and the same on every device.
export function hash(s) {
	let h = 0x811c9dc5;
	for (const c of new TextEncoder().encode(s)) h = Math.imul(h ^ c, 0x01000193) >>> 0;
	return h.toString(16).padStart(8, "0");
}
// Words as a key sees them: no case, curly quotes or runs of spaces.
const norm = (s) => String(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
// Reader's hidden "<!-- reader:h:12 2026-11-20T12:00:00.000Z -->".
const TAG = /\s*<!--\s*reader:([hm]):(\d+)(?:\s+(\S+))?\s*-->/;

// An item: kind ("h" or "m"), textKey (what it's keyed by without the tag),
// key (h#12 from the tag, else textKey), made (when, from the tag, or null)
// and its lines without the tag. A textKey used twice in one book gets "~2",
// "~3", in an older export's order as in this one's.
// (An item from Reader's JSON brings its id and made along instead of a tag.)
function items(kind, list) {
	const seen = new Map();
	return list.map(({ lines, textKey, id, made }) => {
		const n = (seen.get(textKey) || 0) + 1;
		seen.set(textKey, n);
		if (n > 1) textKey += `~${n}`;
		const tag = lines.map((l) => TAG.exec(l)).find((m) => m && m[1] === kind);
		if (id == null && tag) id = tag[2];
		if (made == null) made = tag?.[3] && !Number.isNaN(Date.parse(tag[3])) ? tag[3] : null;
		return { kind, key: id != null && id > 0 ? `${kind}#${id}` : textKey, textKey, made, lines };
	});
}
// Lines without the tag; a line that was only the tag goes.
const untagged = (lines) => tidy(lines.filter((l) => !/^\s*<!--\s*reader:[hm]:\d+[^>]*-->\s*$/.test(l)).map((l) => l.replace(TAG, "")));

// "## Highlights" lines -> items: each a quote and the note under it, split
// at Reader's "---".
export function highlightItems(lines) {
	const groups = [[]];
	for (const l of lines) if (/^\s*-{3,}\s*$/.test(l)) groups.push([]); else groups.at(-1).push(l);
	return items("h", groups.filter((g) => untagged(g).length).map((g) => {
		const plain = untagged(g);
		const quote = plain.filter((l) => /^\s*>/.test(l)).map((l) => l.replace(/^\s*>\s?/, "")).join(" ");
		return { lines: g, textKey: "h:" + hash(norm(quote || plain.join(" "))) };
	})).map((it) => ({ ...it, lines: untagged(it.lines) }));
}

// "## Bookmarks" lines -> items, the text key being the time in bold
// ("1:23:45", "Clip 1:02–1:30").
export function bookmarkItems(lines) {
	return items("m", lines.filter((l) => /^\s*-\s/.test(l)).map((l) => {
		const plain = l.replace(TAG, "").replace(/\s+$/, "");
		const at = /^\s*-\s+\*\*(.+?)\*\*/.exec(plain)?.[1];
		return { lines: [l], textKey: "m:" + (at ? at.replace(/\s+/g, "") : hash(norm(plain))) };
	})).map((it) => ({ ...it, lines: untagged(it.lines) }));
}

// One exported file -> { id, title, authors, series, volume, formats, status,
// link, highlights: [item], bookmarks: [item] } (items as above), or null
// when it isn't one of Reader's (no reader: link to a book).
export function parseNote(text) {
	const t = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
	const m = t.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
	if (!m) return null;
	const raw = {};
	for (const line of m[1].split("\n")) {
		const kv = line.match(/^([\w-]+):\s*(.*)$/);
		if (kv) raw[kv[1]] = kv[2];
	}
	const link = unquote(raw.reader);
	const id = /#\/(?:book|record)\/(\d+)/.exec(link)?.[1];
	if (!id) return null;
	const title = unquote(raw.title).trim();
	if (!title) return null;
	const lines = t.slice(m[0].length).split("\n");
	return {
		id: Number(id),
		title,
		authors: splitAuthors(unquote(raw.author)),
		series: unquote(raw.series) || null,
		volume: unquote(raw.volume) || null,
		formats: String(raw.formats || "").replace(/^\[|\]$/g, "").split(",").map((f) => f.trim()).filter(Boolean),
		status: unquote(raw.status) || null,
		link,
		highlights: highlightItems(section(lines, "Highlights")),
		bookmarks: bookmarkItems(section(lines, "Bookmarks")),
	};
}

// "Neil Gaiman & Terry Pratchett", "A; B", "A and B", "A, B, C" -> names.
// One comma alone stays, since it's likely "Last, First".
export function splitAuthors(s) {
	return String(s || "").split(/\s*(?:;|&|\band\b)\s*/i)
		.flatMap((p) => ((p.match(/,/g) || []).length > 1 ? p.split(",") : [p]))
		.map((p) => p.trim()).filter(Boolean);
}

// The export's bytes (a zip, or one .md file) -> [book]. Takes JSZip so it
// loads only when used. Throws when there's nothing of Reader's in it.
export async function readExport(bytes, fileName, JSZip) {
	let texts;
	if (/\.(md|markdown|txt)$/i.test(fileName || "")) texts = [new TextDecoder().decode(bytes)];
	else {
		let zip;
		try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error("That isn't a zip or a Markdown file from Reader's Export notes."); }
		const files = Object.values(zip.files).filter((f) => !f.dir && /\.md$/i.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name));
		texts = await Promise.all(files.map((f) => f.async("string")));
	}
	const books = texts.map(parseNote).filter(Boolean);
	if (!books.length) throw new Error("No notes from Reader in that file. In Reader: Settings > Export notes, then choose the zip it saves.");
	return books;
}

// ---- Reading Reader's JSON (Pull notes from Reader) ---------------------------

// Reader's GET /api/export straight from the browser, with the token Reader
// keeps as NOTES_TOKEN (Reader answers this site across origins). Throws an
// Error that says what to fix.
export async function fetchExport(readerUrl, notesToken, fetchFn = (...a) => fetch(...a)) {
	const token = String(notesToken || "").trim();
	if (!token) throw new Error("there's no Reader notes token in Settings › Sync and files.");
	let base;
	try { base = new URL(String(readerUrl || "").trim()); } catch { throw new Error(`“${readerUrl}” isn't an address. Fix Reader's address in Settings › Sync and files.`); }
	const origin = base.origin + base.pathname.replace(/\/+$/, "");
	let res;
	try {
		res = await fetchFn(origin + "/api/export", { headers: { Authorization: "Bearer " + token }, credentials: "omit", cache: "no-store" });
	} catch {
		throw new Error(`couldn't reach ${origin}. Check Reader's address in Settings, and that Reader has the version that lets wr1t3r ask from this page (its NOTES_ORIGINS must include ${typeof location === "object" ? location.origin : "this site"}).`);
	}
	if (res.status === 401) throw new Error("Reader turned the token down. The Reader notes token in Settings must be the same string as Reader's NOTES_TOKEN secret.");
	if (res.status === 403) throw new Error(`Reader doesn't take requests from ${typeof location === "object" ? location.origin : "this site"}: add it to Reader's NOTES_ORIGINS.`);
	if (!res.ok) throw new Error(`Reader answered ${res.status}.`);
	let data;
	try { data = await res.json(); } catch { throw new Error(`${origin} didn't answer like Reader. Check Reader's address in Settings.`); }
	if (!Array.isArray(data?.books)) throw new Error(`${origin} didn't answer like Reader. Check Reader's address in Settings.`);
	return data;
}

// Seconds as Reader writes them: "12:04", "1:02:10".
export function clock(sec) {
	sec = Math.max(0, Math.floor(sec || 0));
	const hh = Math.floor(sec / 3600), mm = Math.floor(sec / 60) % 60, ss = sec % 60;
	return (hh ? hh + ":" + (mm < 10 ? "0" : "") : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
}
const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);

// Reader's GET /api/export ({ books: [...] }, one row per format of a book,
// each with its Library entry) -> [book] as parseNote makes them from the
// zip: one per entry, the same lines and keys, so a pull and a zip import
// never bring the same one over twice. readerUrl makes each book's link.
export function fromExport(data, readerUrl) {
	const rows = Array.isArray(data?.books) ? data.books : [];
	const groups = new Map();
	for (const r of rows) {
		const entry = r.entry ?? r.id;
		if (!groups.has(entry)) groups.set(entry, []);
		groups.get(entry).push(r);
	}
	const base = String(readerUrl || "").replace(/\/+$/, "");
	return [...groups].map(([entry, parts]) => {
		const head = parts.find((p) => p.id === entry) || parts[0];
		const audio = parts.some((p) => p.type === "audiobook");
		const hls = parts.flatMap((p) => (p.highlights || []).slice().sort((a, b) => a.start_pos - b.start_pos || a.id - b.id));
		const marks = parts.flatMap((p) => (p.marks || []).map((m) => ({ m, chapters: p.chapters || [] }))).sort((a, b) => a.m.t - b.m.t);
		const formats = [...new Set(parts.map((p) => p.type).filter(Boolean))];
		return {
			id: Number(entry),
			title: String(head.title || "").trim() || "Untitled",
			authors: splitAuthors(head.author),
			series: head.series || null,
			volume: head.volume != null && head.volume !== "" ? String(head.volume) : null,
			formats,
			status: parts.some((p) => p.finished_at) ? "finished" : "reading",
			link: base ? `${base}/#/${audio ? "record" : "book"}/${entry}` : "",
			highlights: items("h", hls.map((x) => {
				const quote = String(x.text || "").split("\n");
				const lines = [...quote.map((l) => "> " + l), ...(x.note ? ["", ...String(x.note).split("\n")] : [])];
				return { lines: tidy(lines), textKey: "h:" + hash(norm(quote.join(" "))), id: x.id, made: iso(x.created_at) };
			})),
			bookmarks: items("m", marks.map(({ m, chapters }) => {
				const at = m.end_t != null ? m.end_t : m.t;
				let ch = null;
				chapters.forEach((c, i) => { if (c.start <= at + 0.5) ch = c.title || "Chapter " + (i + 1); });
				const label = m.end_t != null ? `Clip ${clock(m.t)}–${clock(m.end_t)}` : clock(m.t);
				const line = `- **${label}**` + (ch ? ` · ${ch}` : "") + (m.note ? " — " + String(m.note).replace(/\n+/g, " ") : "");
				return { lines: [line], textKey: "m:" + label.replace(/\s+/g, ""), id: m.id, made: iso(m.created_at) };
			})),
		};
	}).filter((b) => b.highlights.length || b.bookmarks.length);
}

// ---- Matching ---------------------------------------------------------------

const asList = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map((x) => String(x).replace(/^\[\[|\]\]$/g, "").replace(/\|.*$/, "").trim()).filter(Boolean);
// The words of a name worth comparing: "J.R.R. Tolkien" and "Tolkien, J. R. R." share "tolkien".
const nameWords = (names) => new Set(names.flatMap((n) => n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^\p{L}\p{N}]+/u)).filter((w) => w.length >= 3));
// Whether the log's authors and the book's could be the same people: yes when
// either has none, else when they share a name.
export function authorsAgree(logAuthors, bookAuthors) {
	const a = nameWords(asList(logAuthors)), b = nameWords(bookAuthors);
	if (!a.size || !b.size) return true;
	for (const w of a) if (b.has(w)) return true;
	return false;
}

// Where each book's notes go. logs: [{ path, text }] of the book logs.
// -> [{ book, path, how, candidates }], how being
//   "linked": the log already holding the book's reader: id;
//   "matched": the one log of its title (or, without the subtitle, the one
//     whose shorter title nothing else shares) whose authors agree;
//   "ask": more than one could be it, or the title matches but the authors
//     don't: candidates are the paths to choose from;
//   "new": no log, so one is made.
export function planImport(books, logs) {
	const info = logs.map((l) => {
		const p = parseFrontmatter(l.text || "");
		const title = asList(p.title)[0] || l.path.split("/").pop().replace(/\.md$/i, "");
		return { path: l.path, title, key: titleKey(title), short: shortKey(title), authors: p.author ?? p.authors, reader: p.reader != null && p.reader !== "" ? String(p.reader) : null };
	});
	const byReader = new Map(info.filter((l) => l.reader).map((l) => [l.reader, l.path]));
	const ids = new Set(books.map((b) => String(b.id)));
	const shortCount = new Map();
	for (const b of books) shortCount.set(shortKey(b.title), (shortCount.get(shortKey(b.title)) || 0) + 1);
	const claimed = new Set(byReader.values());
	const seen = new Set();
	const out = [];
	for (const book of books) {
		if (seen.has(book.id)) continue;
		seen.add(book.id);
		const linked = byReader.get(String(book.id));
		if (linked) { out.push({ book, path: linked, how: "linked", candidates: [] }); continue; }
		// A log linked to another of Reader's books in this export is that book's.
		const free = info.filter((l) => !claimed.has(l.path) && !(l.reader && ids.has(l.reader)));
		const same = free.filter((l) => l.key && l.key === titleKey(book.title));
		const agree = same.filter((l) => authorsAgree(l.authors, book.authors));
		let pick = agree.length === 1 ? agree[0].path : null;
		let ask = agree.length > 1 ? agree : !agree.length && same.length ? same : [];
		if (!pick && !ask.length) {
			const s = shortKey(book.title);
			const loose = s ? free.filter((l) => l.short === s && authorsAgree(l.authors, book.authors)) : [];
			if (loose.length === 1 && shortCount.get(s) === 1) pick = loose[0].path;
			else if (loose.length) ask = loose;
		}
		if (pick) { claimed.add(pick); out.push({ book, path: pick, how: "matched", candidates: [] }); }
		else if (ask.length) out.push({ book, path: null, how: "ask", candidates: ask.map((l) => l.path) });
		else out.push({ book, path: null, how: "new", candidates: [] });
	}
	return out;
}

// ---- Writing -------------------------------------------------------------------

// `lines` put in after the last line of the "## Notes" section (up to the next
// heading of level 1 or 2, outside code fences), with a blank line before
// and after; "## Notes" is added at the end when there's none. Every line
// already there stays as it was.
export function appendToNotes(text, add) {
	if (!add.length) return text;
	const lines = text.split("\n");
	const at = lines.findIndex((l) => /^##\s+Notes\s*$/i.test(l));
	if (at < 0) return text.replace(/\n*$/, "\n\n") + ["## Notes", "", ...add].join("\n") + "\n";
	let end = at + 1, fence = false;
	while (end < lines.length) {
		if (/^\s*(```|~~~)/.test(lines[end])) fence = !fence;
		if (!fence && /^#{1,2}\s/.test(lines[end])) break;
		end++;
	}
	let last = end;
	while (last > at + 1 && !lines[last - 1].trim()) last--;
	const after = end < lines.length ? [""] : [];
	return [...lines.slice(0, last), "", ...add, ...after, ...lines.slice(end)].join("\n").replace(/\n*$/, "\n");
}

// The log's ledger: the keys already brought over.
export function imported(text) {
	const v = parseFrontmatter(text || "").reader_imported;
	return new Set((Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(String));
}

// The book's items not brought over before (by either key), in the order they
// go in: by when they were made, where the export says, then the rest,
// highlights before bookmarks, as the export has them.
export function newItems(book, have) {
	const all = [...book.highlights, ...book.bookmarks].filter((x) => !have.has(x.key) && !have.has(x.textKey));
	const dated = all.filter((x) => x.made).sort((a, b) => Date.parse(a.made) - Date.parse(b.made));
	return [...dated, ...all.filter((x) => !x.made)];
}

// A log's text with the book's new highlights and bookmarks added to its
// Notes (in newItems' order), and reader:, reader_synced: and
// reader_imported: set. -> { text, added }.
export function applyNotes(text, book, today) {
	const t = String(text || "").replace(/\r\n?/g, "\n");
	const have = imported(t);
	const fresh = newItems(book, have);
	const add = [];
	fresh.forEach((x, i) => {
		// Bookmarks in a row stay one list; a highlight has a blank line around it.
		if (add.length && !(x.kind === "m" && fresh[i - 1].kind === "m")) add.push("");
		add.push(...x.lines);
	});
	const keys = [...have, ...fresh.map((x) => x.key)];
	const props = [["reader", [`reader: ${book.id}`]], ["reader_synced", [`reader_synced: ${today}`]]];
	if (keys.length) props.push(["reader_imported", ["reader_imported:", ...keys.map((k) => `  - ${JSON.stringify(k)}`)]]);
	return { text: setProperties(appendToNotes(t, add), props), added: fresh.length };
}

// ---- New logs ------------------------------------------------------------------

// Reader's formats as the log's: an audiobook 🎧Audiobook, a comic 💬Comic,
// any other (txt, epub, pdf) 📱Ebook.
export function logFormats(formats) {
	const out = formats.map((f) => (/audio/i.test(f) ? "🎧Audiobook" : /cbz|comic/i.test(f) ? "💬Comic" : "📱Ebook"));
	return [...new Set(out.length ? out : ["📱Ebook"])];
}

// What src/storygraph.js bookNote needs to make a new log for the book.
export function newLogBook(book, today) {
	return {
		title: book.title, authors: book.authors, format: null, vibes: [], tags: [], review: "", rating: null,
		shelf: book.status === "finished" ? "Finished" : book.status === "reading" ? "Currently Reading" : null,
		finished: null, added: today,
	};
}

// A new log (bookNote's text) with the book's formats, series and volume,
// then its notes. -> { text, added }.
export function newLog(bookNoteText, book, today) {
	const props = [["format", ["format:", ...logFormats(book.formats).map((f) => `  - ${JSON.stringify(f)}`)]]];
	if (book.series) props.push(["series", ["series:", `  - ${JSON.stringify(book.series)}`]]);
	if (book.volume) props.push(["volume", [`volume: ${/^\d+(\.\d+)?$/.test(book.volume) ? book.volume : JSON.stringify(book.volume)}`]]);
	return applyNotes(setProperties(bookNoteText, props), book, today);
}
