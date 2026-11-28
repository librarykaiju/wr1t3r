import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { shortcodeArgs, tapeQuery, mixtapesIn } from "../src/mixtape.js";

test("shortcode arguments", () => {
	assert.deepEqual(shortcodeArgs(`"https://youtu.be/x", "Say \\"hi\\"", 'Me'`), ["https://youtu.be/x", 'Say "hi"', "Me"]);
	assert.deepEqual(shortcodeArgs(`"only"`), ["only"]);
});

test("links become the deck's query", () => {
	assert.equal(tapeQuery("https://youtu.be/dQw4w9WgXcQ?si=1"), "v=dQw4w9WgXcQ");
	assert.equal(tapeQuery("https://music.youtube.com/playlist?list=PLxw1Khe1c6AcAXl0sApHRiU8tgDBJf_gZ"), "yt=PLxw1Khe1c6AcAXl0sApHRiU8tgDBJf_gZ");
	assert.equal(tapeQuery("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ"), "v=dQw4w9WgXcQ");
	assert.equal(tapeQuery("https://soundcloud.com/a/b/"), "sc=https%3A%2F%2Fsoundcloud.com%2Fa%2Fb");
	assert.equal(tapeQuery("https://vimeo.com/76979871"), "vm=76979871");
	assert.equal(tapeQuery("https://x.com/a.mp3", { title: "T", artist: "A" }), "src=https%3A%2F%2Fx.com%2Fa.mp3&title=T&artist=A");
	assert.equal(tapeQuery("/files/b.mp4"), "src=%2Ffiles%2Fb.mp4");
	assert.equal(tapeQuery("https://brandonj.ink/mixtape/?t=42-8e0424fa192613d3ee8e0a66"), "t=42-8e0424fa192613d3ee8e0a66");
	assert.equal(tapeQuery("https://example.com/page"), null);
	assert.equal(tapeQuery("javascript:alert(1)"), null);
	assert.equal(tapeQuery("https://app.plex.tv/desktop/#!/server/x/playlist?key=%2Fplaylists%2F42"), null);
});

test("only lines holding just the shortcode", () => {
	const doc = `intro\n{% mixtape "https://vimeo.com/76979871" %}\nsay {% mixtape "https://vimeo.com/1" %} inline\n  {%- mixtape "https://youtu.be/dQw4w9WgXcQ", "T" -%}  `;
	const found = mixtapesIn(EditorState.create({ doc }));
	assert.deepEqual(found.map((f) => f.query), ["vm=76979871", "v=dQw4w9WgXcQ"]);
});
