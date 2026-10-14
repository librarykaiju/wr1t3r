import test from "node:test";
import assert from "node:assert/strict";
import { readBlocks, writeBlocks } from "../src/frontbuilder.js";

const HOME = "---\ntitle: Home\n---\n# Welcome\n\nHello there.\nMore.\n\nSecond.\n\n![[pics/me.png]]\n\n```posts\nfolder: microblog\ncount: 3\n```\n\n- [Ko-fi](https://ko-fi.com/x)\n- [Mail](mailto:a@b.c)\n\n---\n\n> A quote\n";

test("a Home note reads as blocks", () => {
	const { front, blocks } = readBlocks(HOME);
	assert.equal(front, "---\ntitle: Home\n---\n");
	assert.deepEqual(blocks.map((b) => b.type), ["heading", "text", "picture", "posts", "links", "divider", "text"]);
	assert.deepEqual(blocks[0], { type: "heading", level: 1, text: "Welcome" });
	assert.equal(blocks[1].text, "Hello there.\nMore.\n\nSecond.");
	assert.deepEqual(blocks[3], { type: "posts", folder: "microblog", count: 3, show: "summary" });
	assert.deepEqual(blocks[4].links[1], { text: "Mail", url: "mailto:a@b.c" });
});

test("blocks write back as the same markdown, published", () => {
	const { front, blocks } = readBlocks(HOME);
	const out = writeBlocks(front, blocks);
	assert.match(out, /^---\ntitle: Home\npublish: true\n---\n# Welcome\n/);
	assert.ok(out.includes("```posts\nfolder: microblog\ncount: 3\nshow: summary\n```"));
	assert.deepEqual(readBlocks(out).blocks, blocks, "reads back the same");
	assert.equal(writeBlocks("", [{ type: "posts", folder: "", count: 4, show: "title" }, { type: "picture", path: "" }]), "---\npublish: true\n---\n```posts\ncount: 4\nshow: title\n```\n");
});
