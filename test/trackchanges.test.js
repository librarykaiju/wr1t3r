import { test } from "node:test";
import assert from "node:assert/strict";
import { changesIn, resolveChange, resolveAll, trackEdit, changeAt, commentEdit } from "../src/trackchanges.js";

// Applies a tracked edit and shows the cursor as |.
function edit(doc, e) {
	const r = trackEdit(doc, { backward: false, cursor: null, insert: "", ...e });
	if (!r) return null;
	const out = doc.slice(0, r.from) + r.insert + doc.slice(r.to);
	return out.slice(0, r.cursor) + "|" + out.slice(r.cursor);
}

test("CriticMarkup is read, skipping code", () => {
	const c = changesIn("a {++b++} {--c--} {~~d~>e~~} {==f==}{>>note<<}\n```\n{++no++}\n```\n");
	assert.deepEqual(c.map((x) => x.type), ["ins", "del", "sub", "mark", "comment"]);
	assert.equal(c[2].old, "d");
	assert.equal(c[2].new, "e");
});

test("accepting and rejecting", () => {
	const t = "a {++b++} {--c--} {~~d~>e~~}";
	const [ins, del, sub] = changesIn(t);
	assert.equal(resolveChange(ins, true).insert, "b");
	assert.equal(resolveChange(ins, false).insert, "");
	assert.equal(resolveChange(del, true).insert, "");
	assert.equal(resolveChange(del, false).insert, "c");
	assert.equal(resolveChange(sub, true).insert, "e");
	assert.equal(resolveAll(t, true).count, 3);
	assert.equal(changeAt(t, 4).type, "ins");
});

test("typing goes in as an insertion, and keeps extending it", () => {
	assert.equal(edit("the cat", { from: 4, to: 4, insert: "big " }), "the {++big |++}cat");
	assert.equal(edit("the {++big++}cat", { from: 10, to: 10, insert: " " }), "the {++big |++}cat");
	// Right after the closing marker counts as the end of the insertion.
	assert.equal(edit("the {++big++}cat", { from: 13, to: 13, insert: "!" }), "the {++big!|++}cat");
	// The original cursor inside the typed text (a closing bracket) is kept.
	assert.equal(edit("x", { from: 1, to: 1, insert: "()", cursor: 1 }), "x{++(|)++}");
});

test("deleting strikes text out; backspacing again extends the strike", () => {
	assert.equal(edit("the cat", { from: 6, to: 7, backward: true }), "the ca|{--t--}");
	assert.equal(edit("the ca{--t--}", { from: 5, to: 6, backward: true }), "the c|{--at--}");
	// Forward delete puts the cursor after the strike.
	assert.equal(edit("the cat", { from: 4, to: 5 }), "the {--c--}|at");
	// Backspacing over struck text only moves the cursor.
	const r = trackEdit("ab{--c--}", { from: 8, to: 9, insert: "", backward: true });
	assert.equal(r.noop, true);
	assert.equal(r.cursor, 2);
});

test("deleting your own insertion removes it", () => {
	assert.equal(edit("the {++big++}cat", { from: 9, to: 10, backward: true }), "the {++bi|++}cat");
	assert.equal(edit("the {++b++}cat", { from: 7, to: 8, backward: true }), "the |cat");
});

test("typing over a selection: the old text struck, the new inserted after it", () => {
	assert.equal(edit("the cat sat", { from: 4, to: 7, insert: "dog" }), "the {--cat--}{++dog|++} sat");
	assert.equal(edit("a {~~old~>new~~} b", { from: 14, to: 14, insert: "s" }), "a {--old--}{++news|++} b");
});

test("comments and code blocks aren't tracked", () => {
	assert.equal(trackEdit("x {>>note<<}", { from: 6, to: 6, insert: "a" }), null);
	assert.equal(trackEdit("```\ncode\n```", { from: 5, to: 5, insert: "a" }), null);
	const c = commentEdit("hello world", 0, 5);
	assert.equal(c.insert, "{==hello==}{>><<}");
	assert.equal(c.cursor, 14);
});

test("a delete that only catches hidden markup takes the next character", () => {
	// Backspace after "++}" (the marker is atomic on screen): the c goes.
	assert.equal(edit("ab{++c++}", { from: 6, to: 9, backward: true }), "ab|");
	// Forward delete before "{--": the struck c is stepped over.
	const r = trackEdit("ab{--c--}d", { from: 2, to: 5, insert: "", backward: false });
	assert.equal(r.noop, true);
	assert.equal(r.cursor, 9);
});

test("exports read the final text", async () => {
	const { finalText } = await import("../src/trackchanges.js");
	assert.equal(finalText("a {++b++}{--c--} {~~d~>e~~} {==f==}{>>why<<}g"), "a b e fg");
	const { cleanNote } = await import("../src/compile.js");
	assert.equal(cleanNote("---\nx: 1\n---\nIt {--was--}{++is++} done."), "It is done.");
});
