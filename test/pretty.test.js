import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { readProperties, imageRef, prettyOf, bannerPositionChange, draggedPosition } from "../src/pretty.js";

const doc = (s) => Text.of(s.split("\n"));

test("image values in every form Pretty Properties takes", () => {
	assert.deepEqual(imageRef("https://a.com/x.jpg?t=1"), { url: "https://a.com/x.jpg?t=1" });
	assert.deepEqual(imageRef("[[web/_site/img/banners/movies-tv.jpg]]"), { name: "web/_site/img/banners/movies-tv.jpg" });
	assert.deepEqual(imageRef("![[shot.png|300]]"), { name: "shot.png" });
	assert.deepEqual(imageRef("[clay-banks](web/_site/img/banners/books.jpg)"), { name: "web/_site/img/banners/books.jpg" });
	assert.deepEqual(imageRef("![](My%20cover.png)"), { name: "My cover.png" });
	assert.deepEqual(imageRef("![x](https://b.com/y.png)"), { url: "https://b.com/y.png" });
	assert.deepEqual(imageRef("00 Content/Media/Banners/ARTO-OKC-Library-04.jpeg"), { name: "00 Content/Media/Banners/ARTO-OKC-Library-04.jpeg" });
	assert.deepEqual(imageRef("https://www.youtube.com/watch?v=abc_1"), { url: "https://img.youtube.com/vi/abc_1/maxresdefault.jpg" });
	assert.deepEqual(imageRef("data:image/png;base64,AAA"), { url: "data:image/png;base64,AAA" });
	for (const v of ["", "{{ image }}", "http://a.com/x.jpg", "file:///x.png", "notes/readme.md", "just words", null]) assert.equal(imageRef(v), null, String(v));
});

test("properties are read as written: quotes off, a list's first item", () => {
	const d = doc('---\nbanner: "[[a.png]]"\nbanner_position: 30\ncover:\n  - https://c.com/c.jpg\ntitle: A: B\n---\nbody');
	assert.deepEqual(readProperties(d, ["banner", "banner_position", "cover", "title"]), { banner: "[[a.png]]", banner_position: "30", cover: "https://c.com/c.jpg", title: "A: B" });
	assert.deepEqual(readProperties(doc("no: frontmatter"), ["no"]), {});
});

test("banner and cover with Pretty Properties' keys and defaults", () => {
	const d = doc("---\nbanner: https://s.com/header.jpg\nbanner_position: 120\ncoverImage: https://i.com/box.jpg\ncover_shape: circle\ncover_position: right\n---\n");
	assert.deepEqual(prettyOf(d), {
		banner: { ref: { url: "https://s.com/header.jpg" }, position: 100 },
		cover: { ref: { url: "https://i.com/box.jpg" }, shape: "circle", position: "right" },
	});
	// cover wins over coverImage and image; an empty one is skipped; unknown shape/position fall back.
	const e = doc('---\ncover: ""\ncoverImage: "{{ image }}"\nimage: https://m.com/p.jpg\ncover_shape: blob\ncover_position: middle\n---\n');
	assert.deepEqual(prettyOf(e), { banner: null, cover: { ref: { url: "https://m.com/p.jpg" }, shape: "initial", position: "left" } });
	assert.deepEqual(prettyOf(doc("---\nthumbnail: https://t.com/t.jpg\n---\n")).cover.ref, { url: "https://t.com/t.jpg" });
	assert.equal(prettyOf(doc("---\nbanner:\n---\n")).banner, null);
	assert.equal(prettyOf(doc("---\nbanner: a.png\n---\n")).banner.position, 50);
});

test("Reposition writes banner_position", () => {

	const apply = (s, ch) => s.slice(0, ch.from) + ch.insert + s.slice(ch.to ?? ch.from);
	const a = "---\nbanner: \"[[x.png]]\"\ntitle: T\n---\nBody";
	assert.equal(apply(a, bannerPositionChange(doc(a), 23.6)), "---\nbanner: \"[[x.png]]\"\nbanner_position: 24\ntitle: T\n---\nBody");
	const b = "---\nbanner_position: 50 # middle\nbanner: x.png\n---\n";
	assert.equal(apply(b, bannerPositionChange(doc(b), 140)), "---\nbanner_position: 100 # middle\nbanner: x.png\n---\n");
	assert.equal(bannerPositionChange(doc("---\ntitle: T\n---\n"), 10), null);
	assert.equal(draggedPosition(50, 50, 100), 0); // dragged down half the hidden height: the top shows
	assert.equal(draggedPosition(50, -25, 100), 75);
	assert.equal(draggedPosition(50, 10, 0), 50); // nothing cut off, nothing to move
});
