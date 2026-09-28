import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAttachment, attachmentKind } from "../src/attachments.js";

const paths = ["content/attachments/cat.png", "content/notes/cat.png", "content/notes/sub/Doc.pdf", "content/song.mp3"];

test("attachments resolve like Obsidian: relative, root, then by name", () => {
	assert.equal(resolveAttachment("cat.png", "content/notes/n.md", paths), "content/notes/cat.png");
	assert.equal(resolveAttachment("content/attachments/cat.png", "content/notes/n.md", paths), "content/attachments/cat.png");
	assert.equal(resolveAttachment("doc.pdf", "content/x.md", paths), "content/notes/sub/Doc.pdf");
	assert.equal(resolveAttachment("../song.mp3", "content/notes/n.md", paths), "content/song.mp3");
	assert.equal(resolveAttachment("song%20x.mp3", "content/n.md", paths), null);
	assert.equal(resolveAttachment("cat.png", "content/other/n.md", paths), "content/notes/cat.png"); // the shortest path wins
});

test("kinds", () => {
	assert.equal(attachmentKind("a/b.JPG"), "image");
	assert.equal(attachmentKind("x.pdf"), "pdf");
	assert.equal(attachmentKind("x.m4a"), "audio");
	assert.equal(attachmentKind("x.webm"), "video");
	assert.equal(attachmentKind("x.md"), null);
});
