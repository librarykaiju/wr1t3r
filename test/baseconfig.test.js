import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYaml, readBase, runView, parseExpr } from "../src/bases.js";
import { writeYaml, readFilters, writeFilters, rowExpr, parseRow, readSource, writeSource, prefill, moveValue, lanesFor, laneKeys, propRef, propType, freshName } from "../src/baseconfig.js";

const BOOKS = `views:
  - type: table
    name: Table
    filters:
      and:
        - file.folder == "content/logs/books"
    order:
      - coverImage
      - date
      - file.name
    sort:
      - property: genres
        direction: ASC
      - property: date
        direction: DESC
  - type: list
    name: View
    image: note.coverImage
`;

test("writeYaml writes a base back the way it was read", () => {
	assert.equal(writeYaml(parseYaml(BOOKS)), BOOKS);
	const cfg = parseYaml(BOOKS);
	assert.deepEqual(parseYaml(writeYaml(cfg)), cfg);
});

test("writeYaml quotes what YAML would misread and drops empty lists", () => {
	const text = writeYaml({ views: [{ type: "table", name: "2024", filters: { and: ['!done', 'x: y', "true"] }, order: [], wr1t3r: { lanes: ["", "Reading"] } }] });
	assert.equal(text, `views:
  - type: table
    name: "2024"
    filters:
      and:
        - "!done"
        - "x: y"
        - "true"
    wr1t3r:
      lanes:
        - ""
        - Reading
`);
	assert.deepEqual(parseYaml(text).views[0].filters.and, ["!done", "x: y", "true"]);
});

test("filter rows become expressions and back", () => {
	const rows = [
		{ prop: "shelf", op: "contains", value: "Reading" },
		{ prop: "pages", op: ">", value: "300" },
		{ prop: "Due date", op: "before", value: "2026-10-01" },
		{ prop: "done", op: "checked" },
		{ prop: "author", op: "is", value: 'Le "Guin"' },
		{ prop: "rating", op: "empty" },
		{ prop: "date", op: "last", value: "7" },
		{ prop: "tags", op: "lacks", value: "draft" },
	];
	const exprs = rows.map(rowExpr);
	assert.deepEqual(exprs.slice(0, 4), ['shelf.contains("Reading")', "pages > 300", 'note["Due date"] < date("2026-10-01")', "done == true"]);
	for (const [i, e] of exprs.entries()) {
		parseExpr(e); // Obsidian's language, so our own reader takes it too
		const back = parseRow(e);
		assert.equal(back.prop, rows[i].prop);
		assert.equal(back.op, rows[i].op);
		if (rows[i].value != null) assert.equal(String(back.value), String(rows[i].value));
	}
	assert.deepEqual(parseRow("file.hasLink(this.file)"), { raw: "file.hasLink(this.file)" });
});

test("filters keep hand-written parts and all/any", () => {
	const f = { or: ['shelf.contains("TBR")', { not: ["done"] }] };
	const read = readFilters(f);
	assert.equal(read.mode, "or");
	assert.equal(read.rows[0].op, "contains");
	assert.deepEqual(read.rows[1], { raw: { not: ["done"] } });
	assert.deepEqual(writeFilters(read), f);
	assert.equal(writeFilters({ mode: "and", rows: [] }), undefined);
});

test("source: folders and tags as base-wide filters", () => {
	const s = readSource({ and: ['file.inFolder("content/logs/books")', 'file.hasTag("book")', "rating > 3"] });
	assert.deepEqual(s.folders, ["content/logs/books"]);
	assert.deepEqual(s.tags, ["book"]);
	assert.equal(s.rest.length, 1);
	s.folders.push("content/x");
	assert.deepEqual(writeSource(s), { and: ['file.inFolder("content/logs/books")', 'file.inFolder("content/x")', 'file.hasTag("book")', "rating > 3"] });
	assert.deepEqual(readSource({ and: ['file.folder == "content/logs/books"'] }).folders, ["content/logs/books"]);
});

test("a new note gets what the filters ask for", () => {
	assert.deepEqual(prefill([{ and: ['shelf.contains("Reading")', 'status == "draft"', "done == true", "pages > 3"] }, { or: ['x == "y"'] }]), { shelf: ["Reading"], status: "draft", done: true });
});

test("kanban lanes and moves", () => {
	const note = (p, shelf) => ({ path: p, value: () => shelf });
	const rows = [note("a", "Reading"), note("b", "TBR"), note("c", null), note("d", ["TBR", "Owned"])];
	assert.deepEqual(lanesFor(rows, "shelf", ["TBR"]).map((l) => [l.key, l.count]), [["", 1], ["TBR", 2], ["Owned", 1], ["Reading", 1]]);
	assert.deepEqual(laneKeys(rows[3], "shelf"), ["TBR", "Owned"]);
	assert.deepEqual(moveValue(["TBR", "Owned"], "TBR", "Reading"), ["Owned", "Reading"]);
	assert.equal(moveValue("TBR", "TBR", "Reading"), "Reading");
	assert.equal(moveValue("TBR", "TBR", ""), null);
	assert.equal(moveValue(3, "3", "4"), 4);
});

test("property refs, types and names", () => {
	assert.equal(propRef("shelf"), "shelf");
	assert.equal(propRef("note.cover image"), 'note["cover image"]');
	assert.equal(propRef("file.name"), "file.name");
	assert.equal(propType([1, null, 2]), "number");
	assert.equal(propType([["a"], "b"]), "list");
	assert.equal(propType([true, false]), "checkbox");
	assert.equal(freshName([{ name: "Table" }, { name: "Table 2" }], "Table"), "Table 3");
});

test("menu-made filters work in a view", () => {
	const files = [
		{ path: "content/b/One.md", text: "---\nshelf: [Reading]\npages: 400\n---\n" },
		{ path: "content/b/Two.md", text: "---\nshelf: [TBR]\npages: 100\n---\n" },
		{ path: "content/c/Three.md", text: "---\nshelf: [Reading]\n---\n" },
	];
	const cfg = { filters: writeSource({ folders: ["content/b"], tags: [], rest: [], mode: "and" }), views: [{ type: "table", name: "T", filters: writeFilters({ mode: "and", rows: [{ prop: "shelf", op: "contains", value: "Reading" }] }) }] };
	const r = runView(readBase(writeYaml(cfg)), 0, files);
	assert.deepEqual(r.rows.map((x) => x.path), ["content/b/One.md"]);
});

test("binder order sorts by each folder's corkboard", () => {
	const files = ["content/n/A.md", "content/n/B.md", "content/n/C.md"].map((path) => ({ path, text: "" }));
	const base = readBase("views:\n  - type: table\n    name: T\n    wr1t3r:\n      sort: binder\n");
	const rank = { "content/n/C.md": 0, "content/n/A.md": 1, "content/n/B.md": 2 };
	assert.deepEqual(runView(base, 0, files, { rank: (p) => rank[p] }).rows.map((x) => x.path), ["content/n/C.md", "content/n/A.md", "content/n/B.md"]);
});
