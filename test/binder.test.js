import { test } from "node:test";
import assert from "node:assert/strict";
import { readBinder, binderOrder, writeBinder, renameFolderEntry, childrenOf, cardInfo, plainText, isBinder, BINDER_INTRO } from "../src/binder.js";
import { reorder } from "../src/drag.js";

const F = "content/Novel/";
const paths = [
	"content/Novel/Opening.md", "content/Novel/The Road North.md", "content/Novel/Epilogue.md", "content/Novel/_Binder.md",
	"content/Novel/Part Two/Arrival.md", "content/Novel/Part Two/Siege.md",
	"content/Other/Opening.md", "content/Idea.md",
];

test("the binder's list is the order; unlisted things follow, folders first", () => {
	const text = ["---", "compile:", "  title: The Long Winter", "  separator: page", "---", BINDER_INTRO, "", "1. [[Epilogue]]", "2. [Part Two](Part%20Two/)", "3. [[content/Novel/Opening|Start]]", ""].join("\n");
	const b = readBinder(text);
	assert.deepEqual(b.entries, [{ note: "Epilogue" }, { folder: "Part Two" }, { note: "content/Novel/Opening" }]);
	assert.equal(b.compile.title, "The Long Winter");
	const order = binderOrder(F, paths, text);
	assert.deepEqual(order.map((i) => [i.kind, i.path, i.listed]), [
		["note", "content/Novel/Epilogue.md", true],
		["folder", "content/Novel/Part Two/", true],
		["note", "content/Novel/Opening.md", true],
		["note", "content/Novel/The Road North.md", false],
	]);
});

test("links to notes outside the folder, and missing notes, are skipped", () => {
	const text = "1. [[Idea]]\n2. [[Gone]]\n3. [[Opening]]\n";
	assert.deepEqual(binderOrder(F, paths, text).map((i) => i.path), [
		"content/Novel/Opening.md", "content/Novel/Part Two/", "content/Novel/Epilogue.md", "content/Novel/The Road North.md",
	]);
});

test("without a binder: folders, then notes, A to Z; the binder never lists itself", () => {
	assert.deepEqual(binderOrder(F, paths, null).map((i) => i.path), [
		"content/Novel/Part Two/", "content/Novel/Epilogue.md", "content/Novel/Opening.md", "content/Novel/The Road North.md",
	]);
	assert.deepEqual(childrenOf(F, paths).notes.includes("content/Novel/_Binder.md"), false);
	assert.ok(isBinder("content/Novel/_binder.md"));
});

test("writing keeps the frontmatter and the text around the list, byte for byte", () => {
	const text = ["---", "compile:", "  title: X", "---", "Intro line.", "", "1. [[Opening]]", "2. [[Epilogue]]", "", "Notes after.", ""].join("\n");
	const items = binderOrder(F, paths, text);
	const out = writeBinder(text, reorder(items, 0, 1), paths);
	assert.equal(out, ["---", "compile:", "  title: X", "---", "Intro line.", "", "1. [[Epilogue]]", "2. [[content/Novel/Opening]]", "3. [Part Two](Part%20Two/)", "4. [[The Road North]]", "", "Notes after.", ""].join("\n"));
	// Round trip: the written order reads back the same.
	assert.deepEqual(binderOrder(F, paths, out).map((i) => i.path), reorder(items, 0, 1).map((i) => i.path));
});

test("a new binder starts with a line saying what it is; CRLF files stay CRLF", () => {
	const out = writeBinder("", binderOrder(F, paths, null), paths);
	assert.ok(out.startsWith(BINDER_INTRO + "\n\n1. [Part Two](Part%20Two/)\n"));
	const crlf = writeBinder("x\r\n\r\n1. [[Opening]]\r\n", binderOrder(F, paths, null).slice(1, 2), paths);
	assert.equal(crlf, "x\r\n\r\n1. [[Epilogue]]\r\n");
});

test("a renamed subfolder keeps its place", () => {
	assert.equal(renameFolderEntry("1. [Part Two](Part%20Two/)\n2. [[Opening]]\n", "Part Two", "Book (2)"), "1. [Book (2)](Book%20%282%29/)\n2. [[Opening]]\n");
	assert.deepEqual(readBinder("1. [Book (2)](Book%20%282%29/)").entries, [{ folder: "Book (2)" }]);
});

test("a card: h1 title, synopsis property or the start of the text, label, status, words", () => {
	const t = ["---", "title: Chapter One", "synopsis: \"She leaves: at dawn.\"", "label: 3", "status: draft", "---", "# The Opening", "", "It was **cold**. [[Road|The road]] ran north.^[aside]", ""].join("\n");
	const c = cardInfo("content/Novel/Opening.md", t);
	assert.deepEqual(c, { title: "The Opening", synopsis: "She leaves: at dawn.", written: true, label: 3, status: "draft", words: 11 });
	const bare = cardInfo("content/Novel/Epilogue.md", "Some *words* here %%hidden%% and [a link](x.md).\n");
	assert.equal(bare.title, "Epilogue");
	assert.equal(bare.synopsis, "Some words here and a link.");
	assert.equal(bare.written, false);
	assert.equal(bare.label, null);
});

test("plain text drops headings, tables, images and marks", () => {
	assert.equal(plainText("# H\n\n> [!note] Tip\n> said\n\n- [ ] task one\n\n| a | b |\n|---|---|\n\n![[pic.png]] ==bright== `code`"), "Tip said task one bright code");
});
