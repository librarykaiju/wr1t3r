import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSite, isPublished, pageFiles, relativeURL, slug, supportLinks, themeCss } from "../src/website.js";

const note = (props, body) => `---\n${props}\n---\n${body}`;

test("only notes marked publish: true, outside _ folders and not drafts", () => {
	assert.equal(isPublished("a.md", note("publish: true", "x")), true);
	assert.equal(isPublished("a.md", note("publish: false", "x")), false);
	assert.equal(isPublished("a.md", "no properties"), false);
	assert.equal(isPublished("_daily/a.md", note("publish: true", "x")), false);
	assert.equal(isPublished("a.md", note("publish: true\ndraft: true", "x")), false);
});

test("page names are safe and unique, links between them relative", () => {
	assert.equal(slug("Café Notes! (2)"), "cafe-notes-2");
	const f = pageFiles(["content/Essays/On Walking.md", "Essays/on walking.md", "index.md"]);
	assert.equal(f.get("Essays/on walking.md"), "essays/on-walking.html");
	assert.equal(f.get("content/Essays/On Walking.md"), "essays/on-walking-2.html");
	assert.equal(f.get("index.md"), "index-2.html");
	assert.equal(relativeURL("essays/a.html", "essays/b.html"), "b.html");
	assert.equal(relativeURL("essays/a.html", "files/p.png"), "../files/p.png");
	assert.equal(relativeURL("index.html", "essays/b.html"), "essays/b.html");
});

test("the site: pages, links, pictures, front page, and what stays private", () => {
	const notes = [
		{ path: "Home.md", text: note("publish: true\ntitle: Welcome", "Hello. See [[Walking]].") },
		{ path: "Essays/Walking.md", text: note("publish: true\ndate: 2026-03-04\ntags: [outdoors]\ncoverImage: \"[[trail.jpg]]\"", "# Walking\n\nA walk with [[Secret plans]] and [[Home|home]].\n\n![[trail.jpg]]\n\n![[song.mp3]]\n\n%% private %%\n\n> [!tip] Bring water\n> Lots of it.\n\n- [x] done\n\n```dataview\nLIST\n```\n\n## Map\n\n[link](Secret%20plans.md) and [[#Map]]") },
		{ path: "Secret plans.md", text: note("publish: false", "hidden") },
	];
	const site = buildSite(notes, ["pics/trail.jpg", "song.mp3"], { title: "Brandon's notes", support: { kofi: "brandon" } });
	const walk = site.files.get("essays/walking.html");
	assert.ok(walk.includes("<h1>Walking</h1>"));
	assert.ok(!walk.includes("<h1>Walking</h1>\n<p class=\"meta\"><time datetime=\"2026-03-04\">March 4, 2026</time><span class=\"tag\">#outdoors</span></p>\n<img class=\"cover\" src=\"../files/trail.jpg\" alt=\"\">\n<h1>"), "the note's own title heading goes");
	assert.ok(walk.includes('src="../files/trail.jpg"'));
	assert.ok(walk.includes("Secret plans") && !walk.includes("secret-plans"), "unpublished notes are words, not links");
	assert.ok(walk.includes('<a href="../index.html">home</a>'));
	assert.ok(!walk.includes("private") && !walk.includes("LIST") && !walk.includes("song.mp3"));
	assert.ok(walk.includes('class="callout callout-tip"') && walk.includes('<p class="callout-title">Bring water</p>') && walk.includes("Lots of it."));
	assert.ok(walk.includes('<input type="checkbox" disabled checked>'));
	assert.ok(walk.includes('<h2 id="map">Map</h2>') && walk.includes('href="#map"'));
	assert.ok(walk.includes('href="https://ko-fi.com/brandon"'));
	assert.deepEqual(site.skipped, ["song.mp3"]);
	assert.deepEqual(site.files.get("files/trail.jpg"), { attachment: "pics/trail.jpg" });
	const index = site.files.get("index.html");
	assert.ok(index.includes("<h1>Welcome</h1>") && index.includes('href="essays/walking.html"') && index.includes("Essays"));
	assert.ok(site.files.has("not_found.html") && site.files.has("style.css"));
	assert.ok(!site.files.has("secret-plans.html"));
	const withMedia = buildSite(notes, ["pics/trail.jpg", "song.mp3"], { media: true });
	assert.ok(withMedia.files.get("essays/walking.html").includes('<audio controls preload="none" src="../files/song.mp3">'));
});

test("support links take names or addresses, and only https links", () => {
	assert.deepEqual(supportLinks({ kofi: "@me", patreon: "https://www.patreon.com/me?x=1" }).map((l) => l.url), ["https://ko-fi.com/me", "https://patreon.com/me"]);
	assert.deepEqual(supportLinks({ url: "javascript:alert(1)" }), []);
	assert.deepEqual(supportLinks({ kofi: "not a name!" }), []);
});

test("theme colors come from the app's stylesheet", () => {
	const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
	const t = themeCss(css, { light: "catppuccin-latte", dark: "catppuccin", font: "Georgia, serif" });
	assert.ok(t.includes("--bg: #eff1f5") && t.includes("@media (prefers-color-scheme: dark)") && t.includes("--bg: #1e1e2e") && t.includes("--editor-font: Georgia, serif"));
	const plain = themeCss(css, { light: null, dark: "dark" });
	assert.ok(plain.includes("--bg: #fbfaf7") && plain.includes("--bg: #141414"));
});
