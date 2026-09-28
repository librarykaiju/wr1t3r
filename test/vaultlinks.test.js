import { test } from "node:test";
import assert from "node:assert/strict";
import { noteLinks, backlinksTo, renameEdits, applyChanges, headingsOf } from "../src/vaultlinks.js";
import { linkText } from "../src/linkcomplete.js";

const paths = ["content/Ideas.md", "content/drafts/Chapter One.md", "content/drafts/Plan.md", "content/_daily/2026-09-28.md", "content/other/Plan.md"];

test("reads wiki and markdown links, not ones in code", () => {
	const t = "[[Chapter One#Start|the start]] and ![[pic.png]] and [x](drafts/Plan.md#Top) `[[Nope]]`\n```\n[[Nope]]\n```\n[w](https://e.com)";
	assert.deepEqual(noteLinks(t).map((l) => [l.kind, l.note, l.heading]), [["wiki", "Chapter One", "Start"], ["wiki", "pic.png", ""], ["md", "drafts/Plan.md", "Top"]]);
});

test("backlinks", () => {
	const notes = [
		{ path: "content/Ideas.md", text: "See [[Chapter One]].\n- also [[Chapter One#End]]" },
		{ path: "content/drafts/Plan.md", text: "[ch](Chapter%20One.md)" },
		{ path: "content/drafts/Chapter One.md", text: "[[Chapter One]] self" },
		{ path: "content/other/Plan.md", text: "[[Ideas]]" },
	];
	assert.deepEqual(backlinksTo("content/drafts/Chapter One.md", notes, paths), [
		{ path: "content/drafts/Plan.md", count: 1, snippet: "[ch](Chapter%20One.md)" },
		{ path: "content/Ideas.md", count: 2, snippet: "See [[Chapter One]]." },
	]);
});

test("rename rewrites only the note part, keeping each link's style", () => {
	const t = "[[Chapter One]] [[Chapter One#Start|go]] [[drafts/Chapter One]] [c](Chapter%20One.md#x) [d](<Chapter One.md>) [[Plan]]";
	const ch = renameEdits(t, "content/drafts/Plan.md", "content/drafts/Chapter One.md", "content/drafts/Chapter 1.md", paths);
	assert.equal(applyChanges(t, ch), "[[Chapter 1]] [[Chapter 1#Start|go]] [[content/drafts/Chapter 1]] [c](Chapter%201.md#x) [d](<Chapter 1.md>) [[Plan]]");
});

test("rename into another folder: relative markdown links follow, ambiguous names get a path", () => {
	const t = "[p](../drafts/Plan.md) and [[Plan]]";
	const ch = renameEdits(t, "content/other/Plan.md", "content/drafts/Plan.md", "content/archive/Plan.md", paths);
	// [[Plan]] from content/other/ resolves to its own folder's Plan, so it's left alone.
	assert.equal(applyChanges(t, ch), "[p](../archive/Plan.md) and [[Plan]]");
	const t2 = "[[Ideas]]";
	assert.equal(applyChanges(t2, renameEdits(t2, "content/drafts/Plan.md", "content/Ideas.md", "content/drafts/Plan 2.md", paths)), "[[Plan 2]]");
	assert.equal(applyChanges(t2, renameEdits(t2, "content/drafts/Plan.md", "content/Ideas.md", "content/x/Plan.md", paths)), "[[content/x/Plan]]");
});

test("completion writes the shortest name that finds the note", () => {
	assert.equal(linkText("content/drafts/Chapter One.md", "content/Ideas.md", paths), "Chapter One");
	assert.equal(linkText("content/drafts/Plan.md", "content/drafts/Chapter One.md", paths), "Plan");
	assert.equal(linkText("content/other/Plan.md", "content/drafts/Chapter One.md", paths), "content/other/Plan");
});

test("headings", () => {
	assert.deepEqual(headingsOf("# One\ntext\n## Two ##\n```\n# not\n```\n"), ["One", "Two"]);
});
