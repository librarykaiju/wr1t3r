import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseNote, readExport, splitAuthors, authorsAgree, planImport, applyNotes, appendToNotes, imported, newLog, newLogBook, logFormats, hash } from "../src/readernotes.js";
import { bookNote } from "../src/storygraph.js";
import { parseFrontmatter } from "../src/dvpage.js";

// Files as Reader's notesMarkdown (librarykaiju/reader, src/index.js) writes them.
const EBOOK = `---
title: "The Left Hand of Darkness"
author: "Ursula K. Le Guin"
formats: [epub]
status: "reading"
reader: https://reader.brandonj.ink/#/book/12
exported: 2026-11-20
tags: [book-notes]
---

# The Left Hand of Darkness

*Ursula K. Le Guin*

## Highlights

> Light is the left hand of darkness
> and darkness the right hand of light.

Lovely. Come back to this.

---

> The only thing that makes life possible is permanent, intolerable uncertainty.

---

> Truth is a matter of the imagination.

`;
const AUDIO = `---
title: "Project Hail Mary"
author: "Andy Weir"
series: "Standalone"
formats: [epub, audiobook]
status: "finished"
reader: https://reader.brandonj.ink/#/record/40
exported: 2026-11-20
tags: [book-notes]
---

# Project Hail Mary

*Andy Weir · Standalone*

## Highlights

> Amaze, amaze, amaze.

## Bookmarks

- **12:04** · Chapter 1 — waking up
- **Clip 1:02:10–1:03:00** · Chapter 9
- **3:15:42** · Chapter 20 — Rocky!

`;

const LOG = `---
title: "The Left Hand of Darkness"
author:
  - "Ursula K. Le Guin"
format:
  - "📖Book"
rating:
  - "⭐⭐⭐⭐⭐"
---

## Notes

My own thoughts on Gethen.

## Quotes

- something else
`;

test("an exported file is read: properties, highlights and bookmarks with keys", () => {
	const b = parseNote(EBOOK);
	assert.equal(b.id, 12);
	assert.equal(b.title, "The Left Hand of Darkness");
	assert.deepEqual(b.authors, ["Ursula K. Le Guin"]);
	assert.deepEqual(b.formats, ["epub"]);
	assert.equal(b.status, "reading");
	assert.equal(b.highlights.length, 3);
	assert.deepEqual(b.highlights[0].lines, ["> Light is the left hand of darkness", "> and darkness the right hand of light.", "", "Lovely. Come back to this."]);
	assert.match(b.highlights[0].key, /^h:[0-9a-f]{8}$/);
	assert.equal(b.bookmarks.length, 0);
	const a = parseNote(AUDIO);
	assert.equal(a.id, 40);
	assert.equal(a.series, "Standalone");
	assert.deepEqual(a.bookmarks.map((x) => x.key), ["m:12:04", "m:Clip1:02:10–1:03:00", "m:3:15:42"]);
	assert.deepEqual(a.bookmarks[0].lines, ["- **12:04** · Chapter 1 — waking up"]);
});

test("a highlight's key is its quote alone, so a note added in Reader later doesn't make it new", () => {
	const later = EBOOK.replace("> Truth is a matter of the imagination.\n", "> Truth is a matter of the imagination.\n\nA note added later.\n");
	assert.equal(parseNote(later).highlights[2].key, parseNote(EBOOK).highlights[2].key);
	assert.equal(hash("abc"), hash("abc"));
	assert.notEqual(hash("abc"), hash("abd"));
});

test("the same quote twice in a book gets two keys", () => {
	const twice = EBOOK.replace("> Truth is a matter of the imagination.", "> Amaze.\n\n---\n\n> Amaze.");
	const keys = parseNote(twice).highlights.map((h) => h.key);
	assert.equal(new Set(keys).size, keys.length);
	assert.match(keys.at(-1), /~2$/);
});

test("files that aren't Reader's are left out", () => {
	assert.equal(parseNote("# Just a note"), null);
	assert.equal(parseNote("---\ntitle: x\n---\n"), null);
});

test("the export is read from a zip or a single .md", async () => {
	const zip = new JSZip();
	zip.file("Reader notes/The Left Hand of Darkness.md", EBOOK);
	zip.file("Reader notes/Project Hail Mary.md", AUDIO);
	zip.file("__MACOSX/Reader notes/._Project Hail Mary.md", "junk");
	const books = await readExport(await zip.generateAsync({ type: "uint8array" }), "Reader notes 2026-11-20.zip", JSZip);
	assert.deepEqual(books.map((b) => b.id).sort(), [12, 40]);
	const one = await readExport(new TextEncoder().encode(AUDIO), "Project Hail Mary.md", null);
	assert.equal(one[0].title, "Project Hail Mary");
	await assert.rejects(readExport(new TextEncoder().encode("hello"), "x.md", null), /No notes from Reader/);
	await assert.rejects(readExport(new TextEncoder().encode("not a zip"), "x.zip", JSZip), /isn't a zip/);
});

test("authors are split and compared loosely", () => {
	assert.deepEqual(splitAuthors("Neil Gaiman & Terry Pratchett"), ["Neil Gaiman", "Terry Pratchett"]);
	assert.deepEqual(splitAuthors("Tolkien, J. R. R."), ["Tolkien, J. R. R."]);
	assert.deepEqual(splitAuthors("A One, B Two, C Three"), ["A One", "B Two", "C Three"]);
	assert.ok(authorsAgree(["[[J.R.R. Tolkien]]"], ["Tolkien, J. R. R."]));
	assert.ok(authorsAgree([], ["Anyone"]));
	assert.ok(!authorsAgree(["Andy Weir"], ["Ursula K. Le Guin"]));
});

test("matching: reader: id first, then title and author, else ask or make a new log", () => {
	const books = [parseNote(EBOOK), parseNote(AUDIO)];
	const logs = [
		{ path: "logs/books/The Left Hand of Darkness.md", text: LOG },
		{ path: "logs/books/Something else.md", text: "---\ntitle: Something else\n---\n" },
	];
	let plan = planImport(books, logs);
	assert.deepEqual(plan.map((p) => [p.book.id, p.how, p.path]), [[12, "matched", "logs/books/The Left Hand of Darkness.md"], [40, "new", null]]);
	// Linked by id even after the log is renamed.
	plan = planImport(books, [{ path: "logs/books/PHM.md", text: "---\ntitle: PHM\nreader: 40\n---\n" }]);
	assert.equal(plan.find((p) => p.book.id === 40).how, "linked");
	// A subtitle left off still matches when nothing else shares the shorter title.
	plan = planImport([parseNote(AUDIO.replace('title: "Project Hail Mary"', 'title: "Project Hail Mary: A Novel"'))], [{ path: "logs/books/Project Hail Mary.md", text: "---\ntitle: Project Hail Mary\nauthor:\n  - Andy Weir\n---\n" }]);
	assert.equal(plan[0].how, "matched");
	// Same title, other author: asked, not guessed.
	plan = planImport([parseNote(AUDIO)], [{ path: "logs/books/Project Hail Mary.md", text: "---\ntitle: Project Hail Mary\nauthor: Someone Else\n---\n" }]);
	assert.equal(plan[0].how, "ask");
	// Two logs of the title: asked.
	plan = planImport([parseNote(AUDIO)], [{ path: "a/Project Hail Mary.md", text: "---\ntitle: Project Hail Mary\n---\n" }, { path: "b/Project Hail Mary.md", text: "---\ntitle: Project Hail Mary\n---\n" }]);
	assert.deepEqual(plan[0].candidates, ["a/Project Hail Mary.md", "b/Project Hail Mary.md"]);
	// A log linked to a different Reader book isn't taken.
	plan = planImport([parseNote(AUDIO)], [{ path: "x.md", text: "---\ntitle: Project Hail Mary\nreader: 99\n---\n" }]);
	assert.equal(plan[0].how, "new");
});

test("notes go at the end of ## Notes and every line already there stays", () => {
	const b = parseNote(EBOOK);
	const r = applyNotes(LOG, b, "2026-11-20");
	assert.equal(r.added, 3);
	const before = LOG.split("\n").filter((l) => l.trim() && l !== "---");
	const after = r.text.split("\n");
	for (const l of before) assert.ok(after.includes(l), `kept: ${l}`);
	// In order, after his own note and before the next heading.
	const body = r.text.slice(r.text.indexOf("## Notes"), r.text.indexOf("## Quotes"));
	assert.ok(body.indexOf("My own thoughts") < body.indexOf("> Light is the left hand"));
	assert.ok(body.indexOf("> Light is") < body.indexOf("> The only thing") && body.indexOf("> The only thing") < body.indexOf("> Truth"));
	assert.match(r.text, /Truth is a matter of the imagination\.\n\n## Quotes/);
	const fm = parseFrontmatter(r.text);
	assert.equal(String(fm.reader), "12");
	assert.equal(String(fm.reader_synced), "2026-11-20");
	assert.deepEqual(fm.reader_imported, b.highlights.map((h) => h.key));
	assert.deepEqual(fm.rating, ["⭐⭐⭐⭐⭐"]);
});

test("importing again adds only what's new, and edited or deleted ones don't come back", () => {
	const first = applyNotes(LOG, parseNote(EBOOK), "2026-11-20").text;
	// Fleshed out here: one highlight's note rewritten, another deleted.
	const edited = first.replace("Lovely. Come back to this.", "Lovely. This is the heart of the book: duality as wholeness.")
		.replace("> The only thing that makes life possible is permanent, intolerable uncertainty.\n\n", "");
	const again = applyNotes(edited, parseNote(EBOOK), "2026-11-21");
	assert.equal(again.added, 0);
	assert.ok(!again.text.includes("intolerable uncertainty"));
	assert.ok(again.text.includes("duality as wholeness"));
	assert.ok(!again.text.includes("Come back to this"));
	// A new highlight in Reader: added at the end, nothing else touched.
	const more = EBOOK.replace("> Truth is a matter of the imagination.\n", "> Truth is a matter of the imagination.\n\n---\n\n> To oppose something is to maintain it.\n\nNew one.\n");
	const third = applyNotes(again.text, parseNote(more), "2026-11-22");
	assert.equal(third.added, 1);
	assert.equal(third.text.replace("\n> To oppose something is to maintain it.\n\nNew one.\n", "").replace(/reader_synced: .*/, "").replace(/\n {2}- "h:[0-9a-f]{8}"(?=\n---)/, ""),
		again.text.replace(/reader_synced: .*/, ""));
	assert.equal(imported(third.text).size, 4);
});

test("bookmarks follow the highlights as list lines; a log with no ## Notes gets one", () => {
	const r = applyNotes("---\ntitle: Project Hail Mary\n---\n\nSome text.\n", parseNote(AUDIO), "2026-11-20");
	assert.equal(r.added, 4);
	assert.match(r.text, /Some text\.\n\n## Notes\n\n> Amaze, amaze, amaze\.\n\n- \*\*12:04\*\* · Chapter 1 — waking up\n- \*\*Clip 1:02:10–1:03:00\*\* · Chapter 9\n- \*\*3:15:42\*\* · Chapter 20 — Rocky!\n$/);
	// Only new bookmarks the next time.
	const more = AUDIO.replace("- **3:15:42**", "- **4:00:00** · Chapter 25\n- **3:15:42**");
	const again = applyNotes(r.text, parseNote(more), "2026-11-21");
	assert.equal(again.added, 1);
	assert.match(again.text, /Rocky!\n\n- \*\*4:00:00\*\* · Chapter 25\n$/);
});

test("appending skips code fences when finding the end of ## Notes", () => {
	const t = "## Notes\n\n```\n## not a heading\n```\n\n## Next\n";
	assert.equal(appendToNotes(t, ["- new"]), "## Notes\n\n```\n## not a heading\n```\n\n- new\n\n## Next\n");
	assert.equal(appendToNotes("## Notes\n", ["- new"]), "## Notes\n\n- new\n");
	assert.equal(appendToNotes("x\n", []), "x\n");
});

test("a new log is a book log with Reader's formats, series and the notes under ## Notes", () => {
	const b = parseNote(AUDIO);
	const r = newLog(bookNote(newLogBook(b, "2026-11-20"), "2026-11-20"), b, "2026-11-20");
	const fm = parseFrontmatter(r.text);
	assert.equal(fm.title, "Project Hail Mary");
	assert.deepEqual(fm.author, ["Andy Weir"]);
	assert.deepEqual(fm.format, ["📱Ebook", "🎧Audiobook"]);
	assert.deepEqual(fm.series, ["Standalone"]);
	assert.deepEqual(fm.shelf, ["Finished"]);
	assert.equal(String(fm.reader), "40");
	assert.equal(fm.reader_imported.length, 4);
	assert.match(r.text, /## Notes\n\n> Amaze, amaze, amaze\./);
	assert.deepEqual(logFormats(["cbz"]), ["💬Comic"]);
	assert.deepEqual(logFormats([]), ["📱Ebook"]);
});

// As Reader writes it now (its notesMarkdown, run on these items): a hidden
// id and date on each saved highlight and bookmark.
const TAGGED = `---
title: "Project Hail Mary"
author: "Andy Weir"
formats: [epub, audiobook]
status: finished
reader: https://reader.brandonj.ink/#/record/40
exported: 2026-11-20
tags: [book-notes]
---

# Project Hail Mary

*Andy Weir*

## Highlights

<!-- reader:h:7 2026-11-20T12:00:00.000Z -->
> Amaze, amaze, amaze.

ha

---

> pending one

## Bookmarks

- **12:04** · Chapter 1 — waking up <!-- reader:m:45 2026-11-20T10:00:00.000Z -->
- **3:15:42** · Chapter 20 — Rocky! <!-- reader:m:46 2026-11-20T13:00:00.000Z -->
`;

test("Reader's hidden ids are the keys, its dates the order, and the comments aren't copied", () => {
	const b = parseNote(TAGGED);
	assert.deepEqual(b.highlights.map((h) => h.key), ["h#7", b.highlights[1].textKey]);
	assert.equal(b.highlights[0].made, "2026-11-20T12:00:00.000Z");
	assert.deepEqual(b.highlights[0].lines, ["> Amaze, amaze, amaze.", "", "ha"]);
	assert.match(b.highlights[1].key, /^h:[0-9a-f]{8}$/); // not saved yet in Reader: no id
	assert.deepEqual(b.bookmarks.map((m) => [m.key, m.textKey]), [["m#45", "m:12:04"], ["m#46", "m:3:15:42"]]);
	assert.deepEqual(b.bookmarks[0].lines, ["- **12:04** · Chapter 1 — waking up"]);
	const r = applyNotes("---\ntitle: Project Hail Mary\n---\n\n## Notes\n", b, "2026-11-20");
	assert.ok(!r.text.includes("<!--"));
	// 10:00 bookmark, 12:00 highlight, 13:00 bookmark, then the undated one.
	assert.match(r.text, /## Notes\n\n- \*\*12:04\*\* · Chapter 1 — waking up\n\n> Amaze, amaze, amaze\.\n\nha\n\n- \*\*3:15:42\*\* · Chapter 20 — Rocky!\n\n> pending one\n$/);
	assert.deepEqual(parseFrontmatter(r.text).reader_imported, ["m#45", "h#7", "m#46", b.highlights[1].key]);
});

test("a log imported from an older export doesn't get the same items again once ids come", () => {
	const old = applyNotes("---\ntitle: Project Hail Mary\n---\n\n## Notes\n", parseNote(AUDIO), "2026-11-19");
	assert.equal(old.added, 4);
	const again = applyNotes(old.text, parseNote(TAGGED), "2026-11-20");
	// "Amaze", 12:04 and 3:15:42 were brought over before; only "pending one" is new.
	assert.equal(again.added, 1);
	assert.equal(again.text.match(/Amaze, amaze, amaze/g).length, 1);
	assert.match(again.text, /> pending one\n$/);
	// And from then on, by id.
	const later = TAGGED.replace("- **3:15:42**", "- **4:00:00** · Chapter 25 <!-- reader:m:47 2026-11-21T09:00:00.000Z -->\n- **3:15:42**");
	const third = applyNotes(again.text, parseNote(later), "2026-11-21");
	assert.equal(third.added, 1);
	assert.match(third.text, /- \*\*4:00:00\*\* · Chapter 25\n$/);
	assert.ok(imported(third.text).has("m#47"));
});

test("an item keyed by id stays out once brought over, whatever it's moved to in Reader", () => {
	const first = applyNotes("## Notes\n", parseNote(TAGGED), "2026-11-20");
	const moved = TAGGED.replace("- **12:04** · Chapter 1 — waking up", "- **12:09** · Chapter 1 — waking up, moved");
	assert.equal(applyNotes(first.text, parseNote(moved), "2026-11-21").added, 0);
});
