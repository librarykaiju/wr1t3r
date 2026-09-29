import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYaml, readBase, runView, setProperty, parseInput, parseExpr, show, BLink } from "../src/bases.js";

const BOOKS = `views:
  - type: table
    name: Table
    filters:
      and:
        - file.folder == "content/logs/books"
    order:
      - coverImage
      - date
      - shelf
      - file.name
      - title
    sort:
      - property: genres
        direction: ASC
      - property: date
        direction: DESC
  - type: list
    name: View
    image: note.coverImage
`;

const note = (title, extra = "") => `---\ntitle: ${title}\n${extra}---\nBody #crit\n`;
const FILES = [
	{ path: "content/logs/books/A.md", text: note("A", "date: 2026-01-05\nshelf:\n  - Finished\ngenres: Fantasy\npages: 300\n") },
	{ path: "content/logs/books/B.md", text: note("B", "date: 2026-03-01\nshelf: [Reading]\ngenres: Fantasy\npages: 120\n") },
	{ path: "content/logs/books/C.md", text: note("C", "date: 2025-12-30\ngenres: Horror\npages: 90\n") },
	{ path: "content/other/D.md", text: note("D") },
	{ path: "content/Books.base", text: BOOKS },
];

test("YAML the way Obsidian writes .base files", () => {
	const y = parseYaml(BOOKS);
	assert.equal(y.views.length, 2);
	assert.deepEqual(y.views[0].filters, { and: ['file.folder == "content/logs/books"'] });
	assert.deepEqual(y.views[0].sort[1], { property: "date", direction: "DESC" });
	assert.equal(y.views[1].image, "note.coverImage");
	const z = parseYaml("formulas:\n  pace: 'pages / length'\n  label: if(done, \"yes\", \"no\")\nproperties:\n  note.pages: { displayName: Pages }\nx: [a, 'b, c', 3]\ntext: |\n  one\n  two\n");
	assert.deepEqual(z.formulas, { pace: "pages / length", label: 'if(done, "yes", "no")' });
	assert.deepEqual(z.properties, { "note.pages": { displayName: "Pages" } });
	assert.deepEqual(z.x, ["a", "b, c", 3]);
	assert.equal(z.text, "one\ntwo");
});

test("a view: filter, columns, sort", () => {
	const r = runView(readBase(BOOKS), 0, FILES);
	assert.equal(r.total, 3);
	const names = r.groups[0].rows.map((x) => x.file.name);
	assert.deepEqual(names, ["B", "A", "C"]); // genres ASC, then date DESC
	assert.deepEqual(r.names, ["coverImage", "date", "shelf", "file name", "title"]);
	const b = r.groups[0].rows[0].values;
	assert.equal(show(b[1]), "2026-03-01");
	assert.deepEqual(b[2], ["Reading"]);
	assert.ok(b[3] instanceof BLink);
});

test("expressions", () => {
	const base = (filters, extra = "") => readBase(`filters:\n  and:\n    - '${filters}'\n${extra}views:\n  - type: table\n    order: [file.name, formula.half]\n`);
	const names = (b) => runView(b, 0, FILES).groups[0].rows.map((x) => x.file.name).sort();
	assert.deepEqual(names(base('file.inFolder("content/logs")')), ["A", "B", "C"]);
	assert.deepEqual(names(base("pages > 100 && genres == \"Fantasy\"")), ["A", "B"]);
	assert.deepEqual(names(base('file.hasTag("crit") && !file.inFolder("content/logs")')), ["D"]);
	assert.deepEqual(names(base('file.tags.contains("crit") && title.lower().startsWith("d")')), ["D"]);
	assert.deepEqual(names(base('date > date("2026-01-01")')), ["A", "B"]);
	assert.deepEqual(names(base('date < date("2026-01-01") + "1 day"')), ["C"]);
	assert.deepEqual(names(base('shelf.contains("Finished")')), ["A"]);
	assert.deepEqual(names(base("shelf.isEmpty()")), ["C", "D"]);
	const f = runView(base("pages", "formulas:\n  half: pages / 2\n"), 0, FILES).groups[0].rows.find((x) => x.file.name === "A");
	assert.equal(f.values[1], 150);
	assert.throws(() => parseExpr("pages >"));
});

test("groupBy and limit", () => {
	const b = readBase("views:\n  - type: table\n    filters: 'pages'\n    groupBy:\n      property: genres\n      direction: DESC\n    sort:\n      - property: pages\n        direction: ASC\n");
	const r = runView(b, 0, FILES);
	assert.deepEqual(r.groups.map((g) => [g.key, g.rows.map((x) => x.file.name)]), [["Horror", ["C"]], ["Fantasy", ["B", "A"]]]);
});

test("setProperty changes only that property", () => {
	const t = "---\ntitle: X\nshelf:\n  - Reading\ntags: [a]\n---\nBody";
	assert.equal(setProperty(t, "shelf", ["Finished", "Owned"]), "---\ntitle: X\nshelf:\n  - Finished\n  - Owned\ntags: [a]\n---\nBody");
	assert.equal(setProperty(t, "tags", ["a", "b"]), "---\ntitle: X\nshelf:\n  - Reading\ntags: [a, b]\n---\nBody");
	assert.equal(setProperty(t, "pages", 42), "---\ntitle: X\nshelf:\n  - Reading\ntags: [a]\npages: 42\n---\nBody");
	assert.equal(setProperty(t, "title", "Y: the sequel"), "---\ntitle: \"Y: the sequel\"\nshelf:\n  - Reading\ntags: [a]\n---\nBody");
	assert.equal(setProperty(t, "title", null), "---\ntitle:\nshelf:\n  - Reading\ntags: [a]\n---\nBody");
	assert.equal(setProperty("Body", "done", true), "---\ndone: true\n---\nBody");
	assert.equal(setProperty("---\r\na: 1\r\n---\r\nB", "a", 2), "---\r\na: 2\r\n---\r\nB");
	assert.deepEqual(parseInput("Finished, Owned", ["x"]), ["Finished", "Owned"]);
	assert.equal(parseInput("12", 3), 12);
	assert.equal(parseInput("12", "old text"), "12");
	assert.equal(setProperty(t, "title", parseInput("2026", "X")), "---\ntitle: \"2026\"\nshelf:\n  - Reading\ntags: [a]\n---\nBody");
});
