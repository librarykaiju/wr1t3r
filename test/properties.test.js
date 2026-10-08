import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { frontmatterLines } from "../src/frontmatter.js";
import { readRows, setEdit, convertEdit, removeEdit, renameEdit, addEdit, keyProblem, readTypes, writeTypes, scalarText, itemsOf } from "../src/properties.js";

const doc = (s) => Text.of(s.split("\n"));
const rows = (s, types) => { const d = doc(s); return readRows(d, frontmatterLines(d), types); };
const apply = (s, e) => s.slice(0, e.from) + e.insert + s.slice(e.to);
const row = (s, key, types) => rows(s, types).find((r) => r.key === key);

const NOTE = '---\ntitle: "A: b"\npublish: false\ntags:\n  - novel\n  - ""\ndate: "2026-09-28"\nat: 2026-09-28 14:05\nrating: 4\ncast: [Ann, "C, D"]\nmeta:\n  a: 1\nbody: |\n  long\n# a comment\ndue:\neyebrow:\n---\nBody';

test("reads each property with its type", () => {
	assert.deepEqual(rows(NOTE).map((r) => [r.key, r.type]), [
		["title", "text"], ["publish", "checkbox"], ["tags", "tags"], ["date", "date"], ["at", "datetime"], ["rating", "number"],
		["cast", "list"], ["meta", "yaml"], ["body", "yaml"], ["due", "date"], ["eyebrow", "text"],
	]);
	assert.equal(row(NOTE, "title").value, "A: b");
	assert.deepEqual(row(NOTE, "tags").items, ["novel"]);
	assert.deepEqual(row(NOTE, "cast").items, ["Ann", "C, D"]);
	assert.deepEqual([row(NOTE, "meta").first, row(NOTE, "meta").last], [11, 12]);
	assert.equal(rows("---\nx: <% tp.file.title %>\n---")[0].type, "yaml");
});

test("a chosen type wins when the value fits it", () => {
	assert.equal(row(NOTE, "eyebrow", { eyebrow: "list" }).type, "list");
	assert.equal(row(NOTE, "rating", { rating: "text" }).type, "text");
	const r = row(NOTE, "title", { title: "checkbox" });
	assert.deepEqual([r.type, r.mismatch], ["text", true]);
	assert.equal(row("---\nshelf:\n---", "shelf", { shelf: "list" }).type, "list");
	assert.equal(row("---\ndone:\n---", "done", { done: "checkbox" }).type, "checkbox");
});

test("setting values rewrites only that property, in its own style", () => {
	assert.equal(apply(NOTE, setEdit(row(NOTE, "title"), "New")), NOTE.replace('title: "A: b"', 'title: "New"'));
	assert.equal(apply(NOTE, setEdit(row(NOTE, "publish"), true)), NOTE.replace("publish: false", "publish: true"));
	assert.equal(apply(NOTE, setEdit(row(NOTE, "date"), "2026-10-02")), NOTE.replace('"2026-09-28"', '"2026-10-02"'));
	assert.equal(apply(NOTE, setEdit(row(NOTE, "at"), "2026-10-02T09:30")), NOTE.replace("2026-09-28 14:05", "2026-10-02 09:30"));
	assert.equal(apply(NOTE, setEdit(row(NOTE, "cast"), ["Ann", "C, D", "E"])), NOTE.replace('[Ann, "C, D"]', '[Ann, "C, D", E]'));
	assert.equal(apply(NOTE, setEdit(row(NOTE, "tags"), ["novel", "draft"])), NOTE.replace('  - novel\n  - ""', "  - novel\n  - draft"));
	const s = "---\nshelf:\n---";
	assert.equal(apply(s, setEdit(row(s, "shelf", { shelf: "list" }), ["read"])), "---\nshelf:\n  - read\n---");
	assert.equal(apply(s, setEdit(row(s, "shelf"), "true")), '---\nshelf: "true"\n---');
	assert.equal(apply(s, setEdit(row(s, "shelf"), "")), s);
	assert.equal(scalarText("plain words"), "plain words");
	assert.equal(scalarText("it's"), "it's");
	assert.equal(scalarText("#x"), '"#x"');
});

test("converting carries the value over", () => {
	const s = "---\ngenre: Sci-fi, Horror\nflag: yes\nn: 12\nwhen: 2026-09-28\nlist:\n  - a\n  - b\n---";
	assert.equal(apply(s, convertEdit(row(s, "genre"), "list")), s.replace("genre: Sci-fi, Horror", "genre:\n  - Sci-fi\n  - Horror"));
	assert.equal(apply(s, convertEdit(row(s, "list"), "text")), s.replace("list:\n  - a\n  - b", "list: a, b"));
	assert.equal(apply(s, convertEdit(row(s, "flag"), "checkbox")), s.replace("flag: yes", "flag: true"));
	assert.equal(apply(s, convertEdit(row(s, "genre"), "checkbox")), s.replace("genre: Sci-fi, Horror", "genre: false"));
	assert.equal(apply(s, convertEdit(row(s, "n"), "text")), s.replace("n: 12", 'n: "12"'));
	assert.equal(apply(s, convertEdit(row(s, "when"), "datetime")), s.replace("when: 2026-09-28", "when: 2026-09-28T00:00"));
	assert.equal(apply(s, convertEdit(row(s, "genre"), "number")), s.replace("genre: Sci-fi, Horror", "genre:"));
	assert.deepEqual(itemsOf(row(s, "when")), ["2026-09-28"]);
});

test("remove, rename and add", () => {
	const d = doc(NOTE);
	assert.equal(apply(NOTE, removeEdit(d, row(NOTE, "meta"))), NOTE.replace("meta:\n  a: 1\n", ""));
	assert.equal(apply(NOTE, removeEdit(d, row(NOTE, "tags"))), NOTE.replace('tags:\n  - novel\n  - ""\n', ""));
	assert.equal(apply(NOTE, renameEdit(d, row(NOTE, "rating"), "score")), NOTE.replace("rating: 4", "score: 4"));
	assert.equal(apply("---\na: 1\n---\nB", addEdit(doc("---\na: 1\n---\nB"), { open: 1, close: 3 }, "done", "checkbox")), "---\na: 1\ndone: false\n---\nB");
	assert.equal(apply("Body", addEdit(doc("Body"), null, "shelf", "list")), "---\nshelf:\n---\nBody");
	assert.equal(keyProblem("rating", rows(NOTE)), "This note already has “rating”");
	assert.equal(keyProblem("a: b", []), "Names can't have a colon or start with a space, # or -");
	assert.equal(keyProblem("rating", rows(NOTE), "rating"), null);
});

test("the types note round-trips", () => {
	const t = writeTypes(null, { shelf: "list", done: "checkbox" });
	assert.deepEqual(readTypes(t), { done: "checkbox", shelf: "list" });
	assert.deepEqual(readTypes(writeTypes(t, { a: "date" })), { a: "date" });
	assert.ok(writeTypes(t, { a: "date" }).startsWith("Property types"));
	assert.deepEqual(readTypes("```json\n{\"x\": \"bogus\"}\n```"), {});
});

test("ratings and book formats map to their set choices", async () => {
	const { starsFor, formatFor, choiceFor, choiceOptions, toChoices } = await import("../src/properties.js");
	assert.deepEqual(["4", 4, "4/5", "8/10", "★★", "⭐⭐⭐", "3.5", "⭐⭐½", "0", "6", "great"].map(starsFor), ["⭐⭐⭐⭐", "⭐⭐⭐⭐", "⭐⭐⭐⭐", "⭐⭐⭐⭐", "⭐⭐", "⭐⭐⭐", null, null, null, null, null]);
	assert.deepEqual(["📘 Book", "paperback", "📱 Ebook", "digital", "🔉 Audio", "Audiobook", "💬 Comic", "Graphic novel", "Zine"].map(formatFor),
		["📖Book", "📖Book", "📱Ebook", "📱Ebook", "🎧Audiobook", "🎧Audiobook", "💬Comic", "💬Comic", null]);
	assert.equal(choiceFor("rating", "5"), "⭐⭐⭐⭐⭐");
	assert.equal(choiceFor("title", "5"), null);
	assert.deepEqual(choiceOptions("rating", "2").map((o) => o.text), ["⭐⭐", "⭐", "⭐⭐⭐", "⭐⭐⭐⭐", "⭐⭐⭐⭐⭐"]);
	assert.deepEqual(choiceOptions("format", "", ["📖Book"]).map((o) => o.text), ["📱Ebook", "🎧Audiobook", "💬Comic"]);
	assert.equal(toChoices("---\ntitle: X\nrating: 4\nformat: 📘 Book\nshelf: []\n---\nBody"), "---\ntitle: X\nrating:\n  - ⭐⭐⭐⭐\nformat:\n  - 📖Book\nshelf: []\n---\nBody");
	assert.equal(toChoices("---\r\nrating: [\"★★★\"]\r\nformat:\r\n    - 🔉 Audio\r\n---\r\n"), "---\r\nrating:\r\n  - ⭐⭐⭐\r\nformat:\r\n    - 🎧Audiobook\r\n---\r\n");
	assert.equal(toChoices("---\nrating: 3.5\nformat: Zine\n---\n"), null, "half stars and unknown formats stay");
	assert.equal(toChoices("---\nrating:\n  - ⭐⭐⭐\nformat: []\n---\n"), null, "already done");
	assert.equal(toChoices("No frontmatter"), null);
});

test("a quoted string over several lines is one YAML row, not a property per line", () => {
	const s = '---\nsummary: "One.\n\nEveryone has an agenda: graduate or die."\nsticky: false\n---\n';
	assert.deepEqual(rows(s).map((r) => [r.key, r.type]), [["summary", "yaml"], ["sticky", "checkbox"]]);
	assert.equal(row(s, "summary").last, 4);
});
