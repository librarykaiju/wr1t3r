import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { imagesIn, imageSize } from "../src/images.js";

test("vault attachments: ![[file|size]] and relative ![](path), not notes or code", () => {
	const doc = "![[shots/a.png|240]] ![[Other note]] ![[song.mp3]]\n`![[b.png]]`\n![p](../files/doc.pdf) ![n](note.md)";
	const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
	ensureSyntaxTree(s, doc.length, 5000);
	assert.deepEqual(imagesIn(s).map((i) => [i.name, i.width]), [["shots/a.png", 240], ["song.mp3", null], ["../files/doc.pdf", null]]);
});

test("only https images are drawn, with Obsidian's size syntax", () => {
	const doc = "![Cat|300](https://a.com/cat.png)\n![](http://b.com/x.png) ![[local.png]] ![x](pic.png)\n`![c](https://c.com/c.png)`\n![Dog](https://d.com/dog.jpg \"title\")";
	const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
	ensureSyntaxTree(s, doc.length, 5000);
	assert.deepEqual(imagesIn(s).map((i) => [i.url ?? i.name, i.alt, i.width]), [["https://a.com/cat.png", "Cat", 300], ["local.png", "local.png", null], ["pic.png", "x", null], ["https://d.com/dog.jpg", "Dog", null]]);
	assert.deepEqual(imageSize("a|300x200"), { alt: "a", width: 300, height: 200 });
});
