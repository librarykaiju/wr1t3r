import { test } from "node:test";
import assert from "node:assert/strict";
import { pictureFolder, pictureName, freePath, pictureLink } from "../src/pictures.js";
import { listEdit } from "../src/toolbar.js";
import { worthConverting } from "../src/paste.js";
import { EditorState } from "@codemirror/state";

test("pictures go where Obsidian's attachment setting says", () => {
	assert.equal(pictureFolder(undefined, "content/a/Note.md"), "");
	assert.equal(pictureFolder("/", "content/a/Note.md"), "");
	assert.equal(pictureFolder("./", "content/a/Note.md"), "content/a/");
	assert.equal(pictureFolder("./assets", "content/a/Note.md"), "content/a/assets/");
	assert.equal(pictureFolder("content/img", "content/a/Note.md"), "content/img/");
	assert.equal(pictureFolder("../../x", "Note.md"), "x/", "never climbs out of the vault");
});

test("names and free names", () => {
	const d = new Date(2026, 8, 30, 14, 5, 1);
	assert.equal(pictureName({ type: "image/png", name: "image.png" }, d), "Pasted image 20260930140501.png");
	assert.equal(pictureName({ type: "image/jpeg", name: "Beach day.jpg" }, d), "Beach day.jpg");
	assert.equal(freePath("a/x.png", ["a/X.png", "a/x 1.png"]), "a/x 2.png");
});

test("links follow the link settings", () => {
	assert.equal(pictureLink("content/img/p q.png", "content/a/N.md"), "![[p q.png]]");
	assert.equal(pictureLink("content/img/p.png", "content/a/N.md", {}, ["other/p.png"]), "![[content/img/p.png]]");
	assert.equal(pictureLink("content/img/p q.png", "content/a/N.md", { useMarkdownLinks: true, newLinkFormat: "relative" }), "![](../img/p%20q.png)");
	assert.equal(pictureLink("content/a/p.png", "content/a/N.md", { newLinkFormat: "absolute" }), "![[content/a/p.png]]");
});

test("toolbar lists toggle and swap markers", () => {
	const run = (doc, kind, from = 0, to = doc.length) => {
		const s = EditorState.create({ doc, selection: { anchor: from, head: to } });
		return s.update(listEdit(s, kind)).state.sliceDoc();
	};
	assert.equal(run("a\nb", "bullet"), "- a\n- b");
	assert.equal(run("- a\n- b", "bullet"), "a\nb");
	assert.equal(run("- a\n- b", "number"), "1. a\n2. b");
	assert.equal(run("- [ ] a", "bullet"), "- a");
	assert.equal(run("  a", "quote"), "  > a");
});

test("only formatted text is converted on paste", () => {
	assert.equal(worthConverting("<span>plain</span>", "plain"), false);
	assert.equal(worthConverting("<p>a <strong>b</strong></p>", "a b"), true);
	assert.equal(worthConverting('<meta charset="utf-8"><div class="monaco-editor"><b>x</b></div>', "x"), false);
});
