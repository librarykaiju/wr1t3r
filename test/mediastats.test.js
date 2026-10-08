import { test } from "node:test";
import assert from "node:assert/strict";
import { stateOf, ratingOf, valuesOf, readLog, kindOf, looksLikeLogs, yearsOf, stats, stampFinished, glance } from "../src/mediastats.js";

const book = (title, { shelf = "Finished", rating = "⭐⭐⭐⭐", date = "2026-03-04", finished = null, pages = null, genre = ["Fantasy"], format = "📘 Book" } = {}) =>
	["---", `title: ${title}`, ...(pages ? [`pages: ${pages}`] : []), "author:", "  - Someone", `format: ${format}`, "genre:", ...genre.map((g) => `  - ${g}`), "shelf:", `  - ${shelf}`, "rating:", ...(rating ? [`  - ${rating}`] : []), ...(finished ? [`finished: ${finished}`] : []), `date: ${date}`, "---", "", "## Notes", ""].join("\n");

test("shelf and status values", () => {
	assert.equal(stateOf({ shelf: ["Finished"] }), "done");
	assert.equal(stateOf({ shelf: "Finished " }), "done");
	assert.equal(stateOf({ status: "finished" }), "done");
	assert.equal(stateOf({ shelf: ["Currently Reading"] }), "current");
	assert.equal(stateOf({ shelf: ["Currently Listening"] }), "current");
	assert.equal(stateOf({ status: "playing" }), "current");
	assert.equal(stateOf({ shelf: ["TBR"] }), "planned");
	assert.equal(stateOf({ shelf: ["to-read"] }), "planned");
	assert.equal(stateOf({ shelf: ["DNF"] }), "dropped");
	assert.equal(stateOf({ status: "paused" }), "paused");
	assert.equal(stateOf({ shelf: null }), null);
	assert.equal(stateOf({}), null);
});

test("ratings out of 5", () => {
	assert.equal(ratingOf(["⭐⭐⭐⭐"]), 4);
	assert.equal(ratingOf("★★★½"), 3.5);
	assert.equal(ratingOf(4.25), 4.5);
	assert.equal(ratingOf("4/5"), 4);
	assert.equal(ratingOf(9.3), 4.5);
	assert.equal(ratingOf("8/10"), 4);
	assert.equal(ratingOf(null), null);
	assert.equal(ratingOf("great"), null);
});

test("values lose their emoji and link brackets", () => {
	assert.deepEqual(valuesOf("📘 Book"), ["Book"]);
	assert.deepEqual(valuesOf(["🔉 Audio", "", null]), ["Audio"]);
	assert.deepEqual(valuesOf(["[[Becky Chambers]]"]), ["Becky Chambers"]);
	assert.deepEqual(valuesOf(null), []);
});

test("a log: finished, else date; no shelf counts as done", () => {
	const l = readLog("logs/books/A.md", book("A", { finished: "2026-02-10", pages: 300 }));
	assert.equal(l.finished, "2026-02-10");
	assert.equal(l.pages, 300);
	assert.equal(l.rating, 4);
	assert.equal(readLog("x.md", book("B")).finished, "2026-03-04");
	assert.equal(readLog("x.md", "---\ntitle: Album\nartist: X\nrating:\n  - ⭐⭐⭐\n---\n").state, "done");
});

test("the kind from the logs' properties", () => {
	assert.equal(kindOf([readLog("a.md", book("A"))]), "book");
	assert.equal(kindOf([readLog("a.md", "---\nplatform:\n  - Steam\nstatus: playing\n---\n")]), "game");
	assert.equal(kindOf([readLog("a.md", "---\ndirector: X\nshelf:\n---\n")]), "movie");
	assert.equal(kindOf([readLog("a.md", "---\nartist: X\n---\n")]), "music");
	assert.equal(kindOf([readLog("a.md", "---\ntitle: X\n---\n")]), "other");
	assert.ok(looksLikeLogs([readLog("a.md", book("A"))]));
	assert.ok(!looksLikeLogs([readLog("a.md", "---\nsynopsis: x\nstatus: draft\n---\n"), readLog("b.md", "# Scene\n"), readLog("c.md", "# Scene\n")]));
});

test("stats for a year and for all time", () => {
	const logs = [
		book("A", { finished: "2026-01-05", pages: 100, rating: "⭐⭐⭐⭐⭐", genre: ["Fantasy", "Horror"] }),
		book("B", { finished: "2026-01-20", pages: 200, rating: "⭐⭐⭐", format: "🔉 Audio" }),
		book("C", { date: "2025-06-01", pages: 50, genre: ["Science Fiction"] }),
		book("D", { shelf: "Currently Reading", rating: null }),
		book("E", { shelf: "TBR", rating: null }),
		book("F", { shelf: "DNF", rating: null, date: "2026-02-01" }),
	].map((t, i) => readLog(`logs/books/${i}.md`, t));
	assert.deepEqual(yearsOf(logs), ["2026", "2025"]);
	const y = stats(logs, "book", "2026");
	assert.equal(y.done, 2);
	assert.equal(y.amount, 300);
	assert.equal(y.average, 4);
	assert.equal(y.timeline.length, 12);
	assert.deepEqual(y.timeline[0], { label: "Jan", count: 2, amount: 300 });
	assert.deepEqual(y.ratings.map((r) => r.count), [0, 0, 1, 0, 1]);
	assert.deepEqual(y.fields.find((f) => f.key === "genre").top, [{ value: "Fantasy", count: 2 }, { value: "Horror", count: 1 }]);
	assert.deepEqual(y.fields.find((f) => f.key === "format").top, [{ value: "Audio", count: 1 }, { value: "Book", count: 1 }]);
	assert.equal(y.current.length, 1);
	assert.equal(y.planned, 1);
	assert.equal(y.dropped, 1);
	assert.equal(y.best.length, 1);
	const all = stats(logs, "book", "all");
	assert.equal(all.done, 3);
	assert.deepEqual(all.timeline.map((t) => [t.label, t.count]), [["2025", 1], ["2026", 2]]);
	assert.ok(!all.fields.some((f) => f.key === "vibesAndThemes"), "a field nobody filled in is left out");
	const moods = stats([readLog("a.md", "---\nauthor: X\nvibesAndThemes:\n  - Fast-paced\n  - Cozy\n---\n")], "book").fields;
	assert.deepEqual(moods.filter((f) => f.key === "vibesAndThemes").map((f) => [f.label, f.top[0].value]), [["Moods", "Cozy"], ["Pace", "Fast-paced"]]);
});

test("a stats tile's numbers at a glance", () => {
	const logs = [
		book("A", { finished: "2026-01-05", pages: 100, rating: "⭐⭐⭐⭐⭐" }),
		book("B", { finished: "2026-03-20", pages: 200, rating: "⭐⭐⭐" }),
		book("C", { date: "2025-06-01", pages: 50 }),
		book("D", { shelf: "Currently Reading", rating: null }),
	].map((t, i) => readLog(`logs/books/${i}.md`, t));
	const g = glance(logs, "2026-04-02");
	assert.equal(g.done, 2);
	assert.equal(g.label, "books read in 2026");
	assert.deepEqual(g.extras.map((x) => [x.n, x.label]), [[300, "pages"], ["4.0★", ""]]);
	assert.deepEqual(g.bars.map((b) => b.count), [1, 0, 1, 0], "January to this month");
	const old = glance(logs.slice(2), "2027-02-01");
	assert.equal(old.label, "book read all time", "nothing this year: all time");
	assert.deepEqual(old.extras.map((x) => x.label), ["pages", ""], "two at most");
	assert.equal(glance([], "2026-01-01"), null);
});

test("finished: is stamped when a log moves to a done shelf", () => {
	const before = book("A", { shelf: "Currently Reading" });
	const after = before.replace("Currently Reading", "Finished");
	const out = stampFinished(before, after, "2026-10-07");
	assert.match(out, /\nfinished: 2026-10-07\n---/);
	assert.equal(stampFinished(after, after.replace("## Notes", "## Notes!"), "2026-10-07"), null, "already done");
	assert.equal(stampFinished(before, book("A", { finished: "2026-01-01" }), "2026-10-07"), null, "has a finished date");
	const scene = "---\nsynopsis: x\nstatus: draft\n---\n";
	assert.equal(stampFinished(scene, scene.replace("draft", "done"), "2026-10-07"), null, "not a log");
});
