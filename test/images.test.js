import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { imagesIn, imageSize } from "../src/images.js";

test("only https images are drawn, with Obsidian's size syntax", () => {
	const doc = "![Cat|300](https://a.com/cat.png)\n![](http://b.com/x.png) ![[local.png]] ![x](pic.png)\n`![c](https://c.com/c.png)`\n![Dog](https://d.com/dog.jpg \"title\")";
	const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
	ensureSyntaxTree(s, doc.length, 5000);
	assert.deepEqual(imagesIn(s).map((i) => [i.url, i.alt, i.width]), [["https://a.com/cat.png", "Cat", 300], ["https://d.com/dog.jpg", "Dog", null]]);
	assert.deepEqual(imageSize("a|300x200"), { alt: "a", width: 300, height: 200 });
});
