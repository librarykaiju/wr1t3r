import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, readExport, titleKey, bookNote, mergeBook, planImport } from "../src/storygraph.js";
import { parseFrontmatter } from "../src/dvpage.js";
import { readLog } from "../src/mediastats.js";

const CSV = [
	"Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?",
	'A Psalm for the Wild-Built,Becky Chambers,,9781250236210,hardcover,read,2025/01/02,2025/01/09,2025/01/05-2025/01/09,1,"hopeful, reflective",slow,Character,Yes,Yes,Yes,No,4.75,"Lovely.\nMade me want tea, ""badly"".",,,"cozy, solarpunk",No',
	"Carl's Doomsday Scenario,\"Matt Dinniman\",,B0,audio,currently-reading,2026/09/01,,,0,,fast,Plot,,,,,,,,,,",
	"Onyx Storm: Empyrean 3,Rebecca Yarros,,X,digital,to-read,2026/02/03,,,0,,,,,,,,,,,,,",
].join("\r\n");

test("CSV with quotes, commas and line breaks", () => {
	const rows = parseCsv('a,"b, c","d ""e""\nf"\r\n\r\n1,2,3\n');
	assert.deepEqual(rows, [["a", "b, c", 'd "e"\nf'], ["1", "2", "3"]]);
});

test("a StoryGraph export as books", () => {
	const [a, b, c] = readExport(CSV);
	assert.equal(a.title, "A Psalm for the Wild-Built");
	assert.deepEqual(a.authors, ["Becky Chambers"]);
	assert.equal(a.format, "📖Book");
	assert.equal(a.shelf, "Finished");
	assert.equal(a.added, "2025-01-02");
	assert.equal(a.finished, "2025-01-09");
	assert.equal(a.rating, "⭐⭐⭐⭐⭐");
	assert.deepEqual(a.vibes, ["Hopeful", "Reflective", "Slow-paced", "Character-driven"]);
	assert.deepEqual(a.tags, ["cozy", "solarpunk"]);
	assert.equal(a.review, 'Lovely.\nMade me want tea, "badly".');
	assert.equal(b.shelf, "Currently Reading");
	assert.equal(b.format, "🎧Audiobook");
	assert.equal(b.rating, null);
	assert.deepEqual(b.vibes, ["Fast-paced", "Plot-driven"]);
	assert.equal(c.shelf, "TBR");
	assert.equal(c.format, "📖Book", "an ebook is a book");
	assert.throws(() => readExport("Name,Value\nx,1\n"), /StoryGraph/);
});

test("a new log reads back as a finished, rated book", () => {
	const [a] = readExport(CSV);
	const text = bookNote(a, "2026-10-07");
	const p = parseFrontmatter(text);
	assert.equal(p.title, "A Psalm for the Wild-Built");
	assert.deepEqual(p.shelf, ["Finished"]);
	assert.equal(p.finished, "2025-01-09");
	assert.equal(p.date, "2025-01-02");
	assert.match(text, /## Notes\n\nLovely\.\nMade me want tea/);
	const log = readLog("logs/books/x.md", text);
	assert.equal(log.state, "done");
	assert.equal(log.rating, 5);
	assert.equal(log.finished, "2025-01-09");
});

test("matching titles, and filling in only what a log lacks", () => {
	assert.equal(titleKey("Onyx Storm: Empyrean 3"), "onyx storm");
	assert.equal(titleKey("Onyx Storm (2025)"), "onyx storm");
	const books = readExport(CSV);
	const logs = [{ path: "logs/books/Onyx Storm (2025).md", text: "---\ntitle: Onyx Storm\nshelf:\n  - Finished\nrating:\nvibesAndThemes:\n  - Epic\n---\n\nMine.\n" }];
	const plan = planImport(books, logs);
	assert.equal(plan.add.length, 2);
	assert.deepEqual(plan.update.map((u) => u.path), ["logs/books/Onyx Storm (2025).md"]);
	const merged = mergeBook(logs[0].text, { ...plan.update[0].book, vibes: ["epic", "Dark"], rating: "⭐⭐⭐⭐", finished: "2026-02-10" });
	const p = parseFrontmatter(merged);
	assert.deepEqual(p.shelf, ["Finished"], "an existing shelf stays");
	assert.deepEqual(p.rating, ["⭐⭐⭐⭐"], "an empty rating is filled");
	assert.deepEqual(p.vibesAndThemes, ["Epic", "Dark"]);
	assert.equal(p.finished, "2026-02-10");
	assert.match(merged, /\n\nMine\.\n$/);
});

test("covers and summaries from Open Library fill only empty properties", async () => {
	const { lookUpBook, fillBook, needsLookup, genresFromLog } = await import("../src/storygraph.js");
	const calls = [];
	const fake = async (url) => {
		calls.push(url);
		if (url.includes("search.json")) return { ok: true, json: async () => ({ docs: [{ key: "/works/OL1W", cover_i: 42, number_of_pages_median: 160, subject: ["Robots", "Tea", "Fiction, science fiction, general", "Robots"] }] }) };
		return { ok: true, json: async () => ({ description: { value: "A monk and a robot.\r\n\r\n----------\r\nSee also" } }) };
	};
	const found = await lookUpBook({ title: "A Psalm for the Wild-Built: Monk and Robot", authors: ["Becky Chambers"] }, fake);
	assert.match(calls[0], /title=A\+Psalm\+for\+the\+Wild-Built&/);
	assert.match(calls[0], /author=Becky\+Chambers/);
	assert.deepEqual(found, { coverImage: "https://covers.openlibrary.org/b/id/42-M.jpg", pages: 160, subjects: ["Robots", "Tea"], genre: ["Science Fiction"], summary: "A monk and a robot." });
	const [a] = readExport(CSV);
	const filled = parseFrontmatter(fillBook(bookNote(a, "2026-10-07"), found));
	assert.equal(filled.pages, 160);
	assert.equal(filled.summary, "A monk and a robot.");
	assert.deepEqual(filled.subjects, ["Robots", "Tea"]);
	assert.deepEqual(filled.genre, ["Science Fiction"], "genres go in genre, the other subjects stay in subjects");
	assert.equal(parseFrontmatter(fillBook("---\npages: 99\n---\n", found)).pages, 99);
	assert.equal(parseFrontmatter(fillBook("---\ngenre:\n  - Horror\n---\n", found)).genre[0], "Horror", "genres already written are kept");
	assert.equal(needsLookup(bookNote(a, "2026-10-07")), true);
	const log = "---\ntitle: Psalm\nsubjects:\n  - Robots -- Fiction\n  - Tea\ngenre: []\n---\n\n## Notes\n";
	const withGenre = parseFrontmatter(genresFromLog(log));
	assert.deepEqual(withGenre.genre, ["Science Fiction"], "genres from a log's own subjects");
	assert.deepEqual(withGenre.subjects, ["Robots -- Fiction", "Tea"]);
	assert.equal(genresFromLog(genresFromLog(log)), null, "genres already there are left alone");
	assert.equal(genresFromLog("---\nsubjects:\n  - Tea\ngenre: []\n---\n"), null, "nothing to fill");
	assert.equal(genresFromLog("---\ntitle: Not a book\nsubjects:\n  - Fantasy fiction\n---\n"), null, "only notes with a genre property");
	assert.equal(needsLookup(fillBook(bookNote(a, "2026-10-07"), { ...found, coverImage: "x" })), false);
});
