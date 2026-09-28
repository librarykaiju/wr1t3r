import { test } from "node:test";
import assert from "node:assert/strict";
import { runQuery, show, parseQuery } from "../src/dql.js";
import { pageFrom } from "../src/dvpage.js";

const notes = {
	"content/books/Dune.md": "---\ntitle: Dune\nrating: 5\ntags: [book, scifi]\nfinished: 2026-03-01\n---\n- [ ] reread\n- [x] review\nSee [[Hyperion]]",
	"content/books/Hyperion.md": "---\nrating: 4\ntags: [book]\nfinished: 2026-05-10\n---\n",
	"content/books/Emma.md": "---\nrating: 3\ntags: book\n---\n",
	"content/journal/2026-09-01.md": "mood: fine\n- [ ] call mom",
};
const pages = Object.fromEntries(Object.entries(notes).map(([p, t]) => {
	const pg = pageFrom(p, t);
	pg.file.outlinks = p.endsWith("Dune.md") ? ["content/books/Hyperion.md"] : [];
	return [p, pg];
}));
const resolve = (n) => Object.keys(notes).find((p) => p.endsWith("/" + n + ".md")) || null;
const run = (q, cur = "content/index.md") => runQuery(q, pages, cur, resolve);

test("TABLE with FROM folder, WHERE, SORT", () => {
	const r = run('TABLE rating, finished FROM "content/books" WHERE rating >= 4 SORT rating DESC');
	assert.deepEqual(r.headers, ["File", "rating", "finished"]);
	assert.deepEqual(r.rows.map((x) => x[0].name), ["Dune", "Hyperion"]);
	assert.equal(show(r.rows[0][2]), "March 1, 2026");
});

test("FROM #tag and aliases, WITHOUT ID", () => {
	const r = run('TABLE WITHOUT ID file.name AS "Name" FROM #scifi');
	assert.deepEqual(r.headers, ["Name"]);
	assert.deepEqual(r.rows, [["Dune"]]);
});

test("LIST with an expression and LIMIT", () => {
	const r = run('LIST rating FROM "content/books" SORT file.name LIMIT 2');
	assert.deepEqual(r.items.map((i) => [i.link.name, i.value]), [["Dune", 5], ["Emma", 3]]);
});

test("TASK groups by note, WHERE !completed", () => {
	const r = run("TASK WHERE !completed");
	assert.deepEqual(r.groups.map((g) => [g.link.name, g.tasks.map((t) => t.text)]), [["Dune", ["reread"]], ["2026-09-01", ["call mom"]]]);
});

test("GROUP BY and functions", () => {
	const r = run('TABLE length(rows) AS n FROM #book GROUP BY rating > 3');
	assert.deepEqual(r.rows.map((x) => [x[0], x[1]]).sort(), [[false, 1], [true, 2]]);
	const c = run('LIST WHERE contains(file.outlinks, [[Hyperion]])');
	assert.deepEqual(c.items.map((i) => i.link.name), ["Dune"]);
});

test("dates compare with date() and durations", () => {
	const r = run('LIST FROM "content/books" WHERE finished > date(2026-04-01)');
	assert.deepEqual(r.items.map((i) => i.link.name), ["Hyperion"]);
	const d = run('TABLE WITHOUT ID finished + dur(1 day) FROM [[Dune]] OR "content/books/Dune"');
	assert.equal(show(d.rows[0][0]), "March 2, 2026");
});

test("bad queries throw readable errors", () => {
	assert.throws(() => parseQuery("SELECT *"), /TABLE, LIST or TASK/);
	assert.throws(() => run("LIST WHERE nope(1)"), /nope\(\) isn't supported/);
});
