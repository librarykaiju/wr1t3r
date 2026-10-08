import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blueskyPost, buildSite, isPublished, pageFiles, relativeURL, slug, socialLinks, supportLinks, tagHue, themeCss, webMarkdown } from "../src/website.js";

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
	assert.ok(walk.includes('class="callout callout-tip co-cyan"') && /<p class="callout-title"><svg [^>]*>.*<\/svg>Bring water<\/p>/.test(walk) && walk.includes("Lots of it."));
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

test("the calendar links days to posts, and each month gets a page", () => {
	const notes = [
		{ path: "a.md", text: note("publish: true\ndate: 2026-09-14", "A") },
		{ path: "b.md", text: note("publish: true\ndate: 2026-09-14", "B") },
		{ path: "c.md", text: note("publish: true\ndate: 2026-09-02", "C") },
		{ path: "d.md", text: note("publish: true\ndate: 2026-07-30", "D") },
		{ path: "e.md", text: note("publish: true", "undated") },
	];
	const site = buildSite(notes, [], { calendar: true });
	const c = site.files.get("c.html");
	assert.ok(c.includes('<td class="on"><a href="c.html" title="c">2</a></td>'), "one post: links to it");
	assert.ok(c.includes('href="archive/2026-09.html#d-14"'), "two posts: links to the day on the month's page");
	assert.ok(c.includes('class="cal-prev" href="archive/2026-07.html"') && c.includes('<span class="cal-next"></span>'));
	assert.ok(site.files.get("d.html").includes(">July 2026</a>"), "a page shows its own month");
	assert.ok(site.files.get("e.html").includes(">September 2026</a>"), "an undated page shows the latest month");
	const sept = site.files.get("archive/2026-09.html");
	assert.ok(sept.includes('<h2 id="d-14">September 14, 2026</h2>') && sept.includes('href="../a.html"') && sept.includes('href="../style.css"'));
	assert.ok(site.files.get("archive/index.html").includes('href="2026-07.html"'));
	assert.ok(!buildSite(notes, []).files.has("archive/index.html"), "off unless asked");
	// September 2026 starts on a Tuesday: two blank cells first.
	assert.ok(c.includes("<tbody><tr><td></td><td></td><td>1</td>"));
});

test("a menu of top folders, each with its list, and previous/next within a folder", () => {
	const notes = [
		{ path: "Essays/One.md", text: note("publish: true\ndate: 2026-01-01", "1") },
		{ path: "Essays/Two.md", text: note("publish: true\ndate: 2026-02-01", "2") },
		{ path: "Essays/Old/Three.md", text: note("publish: true\ndate: 2025-01-01", "3") },
		{ path: "Essays/index.md", text: note("publish: true", "named index") },
		{ path: "Recipes/Soup.md", text: note("publish: true", "soup") },
	];
	const site = buildSite(notes, []);
	const one = site.files.get("essays/one.html");
	assert.ok(one.includes('<nav class="menu" aria-label="Sections"><a href="index.html" style="--fc: var(--f1)" aria-current="page">Essays</a><a href="../recipes/index.html" style="--fc: var(--f2)">Recipes</a></nav>'));
	assert.ok(one.includes('class="prev" href="two.html"><span>Previous</span>Two</a>') && one.includes('<span class="next"></span>') === false);
	assert.ok(site.files.get("essays/two.html").includes('<span class="prev"></span>'));
	const list = site.files.get("essays/index.html");
	assert.ok(list.includes('href="old/three.html"') && list.includes('<h2 class="folder">Old</h2>') && list.includes('href="index-2.html"'));
	assert.ok(!site.files.get("recipes/soup.html").includes('class="pager"'), "alone in its folder: no pager");
});

test("a logo from the notebook beside the title, and as the tab icon", () => {
	const notes = [{ path: "Essays/A.md", text: note("publish: true", "a") }];
	const site = buildSite(notes, ["art/Logo.png"], { title: "Mine", logo: "art/Logo.png" });
	const a = site.files.get("essays/a.html");
	assert.ok(a.includes('<img class="logo" src="../files/logo.png" alt=""><span class="name"><span>Mine</span></span>') && a.includes('<link rel="icon" href="../files/logo.png">'));
	assert.deepEqual(site.files.get("files/logo.png"), { attachment: "art/Logo.png" });
	const only = buildSite(notes, ["art/Logo.png"], { title: "Mine", logo: "art/Logo.png", logoOnly: true }).files.get("index.html");
	assert.ok(only.includes('<img class="logo" src="files/logo.png" alt="Mine"></a>'));
	assert.ok(!buildSite(notes, [], { logo: "art/Logo.png" }).files.get("index.html").includes("logo"), "a missing picture is no logo");
});

test("the notebook layout: folders down the left, open on the way to the page", () => {
	const notes = [
		{ path: "Essays/One.md", text: note("publish: true", "1") },
		{ path: "Essays/Old/Two.md", text: note("publish: true", "2") },
		{ path: "Recipes/Soup.md", text: note("publish: true", "s") },
		{ path: "Loose.md", text: note("publish: true", "l") },
	];
	const site = buildSite(notes, [], { layout: "notebook", sidebar: false, support: { kofi: "me" } });
	const two = site.files.get("essays/old/two.html");
	assert.ok(two.includes('<body class="layout-notebook">') && !two.includes('class="menu"') && !two.includes("ko-fi"), "no top menu, and no sidebar when it's off");
	assert.ok(two.includes('<li class="top" style="--fc: var(--f1)"><details open><summary>Essays</summary><ul><li><details open><summary>Old</summary><ul><li><a href="two.html" aria-current="page">Two</a></li></ul></details></li><li><a href="../one.html">One</a></li></ul></details></li>'));
	assert.ok(two.includes('<li class="top" style="--fc: var(--f2)"><details><summary>Recipes</summary>') && two.includes('<a href="../../loose.html">Loose</a>') && two.includes('<a href="../../index.html">Home</a>'));
});

test("social links are named for their site", () => {
	assert.deepEqual(socialLinks("https://bsky.app/profile/me\n@me@mastodon.social\nhttps://www.instagram.com/me\nhttps://example.com/@me\nnot a link\njavascript:alert(1)").map((l) => l.name + " " + l.url), [
		"Bluesky https://bsky.app/profile/me", "Mastodon https://mastodon.social/@me", "Instagram https://www.instagram.com/me", "Mastodon https://example.com/@me",
	]);
	assert.deepEqual(socialLinks("me@example.com\nmailto:you@example.org"), [{ name: "Email", url: "mailto:me@example.com", email: true }, { name: "Email", url: "mailto:you@example.org", email: true }]);
	const mail = buildSite([{ path: "a.md", text: note("publish: true", "a") }], [], { social: "me@example.com" }).files.get("a.html");
	assert.ok(mail.includes('class="email" href="&#109;&#97;') && !mail.includes("me@example.com"), "the address is written as character codes");
	const site = buildSite([{ path: "a.md", text: note("publish: true", "a") }], [], { social: "https://bsky.app/profile/me" });
	assert.ok(site.files.get("a.html").includes('<a href="https://bsky.app/profile/me" rel="me noopener">Bluesky</a>'));
});

test("share buttons on posts only, unless turned off", () => {
	const notes = [{ path: "a.md", text: note("publish: true", "a") }];
	const site = buildSite(notes, []);
	assert.ok(site.files.get("a.html").includes('<div class="share" hidden>') && !site.files.get("index.html").includes('class="share"'));
	assert.ok(!buildSite(notes, [], { share: false }).files.get("a.html").includes('class="share"'));
});

test("a bluesky: post shows its likes and replies under the page", () => {
	assert.deepEqual(blueskyPost("https://bsky.app/profile/me.bsky.social/post/3abc123/"), { url: "https://bsky.app/profile/me.bsky.social/post/3abc123", actor: "me.bsky.social", rkey: "3abc123" });
	assert.equal(blueskyPost("https://example.com/post/1"), null);
	const site = buildSite([{ path: "a.md", text: note("publish: true\nbluesky: https://bsky.app/profile/me.bsky.social/post/3abc123", "a") }, { path: "b.md", text: note("publish: true", "b") }], []);
	const a = site.files.get("a.html");
	assert.ok(a.includes('<section class="bsky" data-actor="me.bsky.social" data-rkey="3abc123">') && a.includes('href="https://bsky.app/profile/me.bsky.social/post/3abc123"'));
	assert.ok(!site.files.get("b.html").includes('class="bsky"'));
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

test("the site carries Two-tone, One-tone and Mixtape colors", () => {
	const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
	const two = themeCss(css, { light: "dracula-light", dark: "dracula", tones: "two" });
	assert.ok(two.lastIndexOf("--f1: var(--accent)") > two.indexOf("@media (prefers-color-scheme: dark)"), "tones come after the dark colors");
	assert.ok(two.includes("--f4: var(--f2)") && !two.includes("--mx-second"));
	assert.ok(themeCss(css, { light: null, tones: "one" }).includes("--f7: var(--accent)"));
	assert.ok(!themeCss(css, { light: null }).includes("var(--accent);"), "rainbow adds nothing");
	const mx = { "--mx-bg": "#101820", "--mx-fg": "#f2aa4c", "--mx-accent": "#f2aa4c", "--mx-second": "#7fd6d9", "--mx-scheme": "dark" };
	const tape = themeCss(css, { light: "mixtape", tones: "two", mixtape: mx });
	assert.ok(tape.includes("--mx-bg: #101820;") && tape.includes("--bg: var(--mx-bg") && tape.includes("--f2: var(--mx-second"));
});

test("the toolbar's published check matches the site's, and says why not", async () => {
	const { isPublished: own, notPublishedWhy } = await import("../src/published.js");
	assert.equal(own("Posts/A.md", "---\npublish: true\n---\n"), true);
	assert.equal(own("Posts/A.md", "---\npublish: true\ndraft: true\n---\n"), false);
	assert.equal(own("_docs/A.md", "---\npublish: true\n---\n"), false);
	assert.equal(own(null, ""), false);
	assert.match(notPublishedWhy("_docs/A.md", ""), /folders starting with _/);
	assert.match(notPublishedWhy("A.md", "---\ndraft: yes\n---\n"), /draft/);
	assert.equal(notPublishedWhy("A.md", "---\npublish: true\n---\n"), "");
});

test("pages show their other properties, tags in the theme's colors, folders in theirs", async () => {
	const { tagHue: appHue } = await import("../src/frontmatter.js");
	const { tagHue } = await import("../src/website.js");
	for (const t of ["essays", "outdoors", "Craft", "a-b"]) assert.equal(tagHue(t), appHue(t));
	const notes = [
		{ path: "Essays/On Walking.md", text: "---\npublish: true\ntitle: On Walking\ndate: 2026-09-14\ntags: [essays]\nstatus: finished\nrating: 4\nread: true\nsource: https://example.com/walk\nwith:\n  - \"[[People/Sam|Sam]]\"\n  - Ana\ncssclasses: [wide]\nempty:\n---\n\nText.\n" },
		{ path: "Recipes/Soup.md", text: "---\npublish: true\n---\n\nSoup.\n" },
		{ path: "Archive/Old.md", text: "---\npublish: false\n---\n" },
	];
	const { files } = buildSite(notes, [], { title: "S", layout: "notebook" });
	const page = files.get("essays/on-walking.html");
	// Outside logs/, sketchbooks/ and catalog/ the box starts folded, as in the app.
	assert.match(page, /<details class="props">\n<summary>Properties<span class="count">&nbsp;· 5<\/span>/);
	assert.match(page, /<dt><span class="icon">Aa<\/span>status<\/dt><dd>finished<\/dd>/);
	assert.match(page, /<dt><span class="icon">12<\/span>rating<\/dt><dd>4<\/dd>/);
	assert.match(page, /<dt><span class="icon">☑<\/span>read<\/dt><dd><input type="checkbox" disabled checked/);
	assert.match(page, /<a href="https:\/\/example.com\/walk" rel="noopener">example.com\/walk<\/a>/);
	assert.match(page, new RegExp(`<span class="pill tag-${tagHue("Sam")}">Sam</span> <span class="pill tag-${tagHue("Ana")}">Ana</span>`));
	for (const k of ["publish", "title", "tags", "cssclasses", "empty", "date"]) assert.doesNotMatch(page, new RegExp(`</span>${k}</dt>`));
	assert.match(page, new RegExp(`class="tag tag-${tagHue("essays")}">#essays`));
	// Archive/ is unpublished but still counts, as in the app: Archive 1, Essays 2, Recipes 3.
	assert.match(page, /<li class="top" style="--fc: var\(--f2\)"><details open><summary>Essays/);
	assert.match(page, /<li class="top" style="--fc: var\(--f3\)"><details><summary>Recipes/);
	assert.doesNotMatch(files.get("recipes/soup.html"), /class="props"/);
	const top = buildSite(notes, [], { title: "S" }).files.get("essays/on-walking.html");
	assert.match(top, /<a href="index.html" style="--fc: var\(--f2\)" aria-current="page">Essays<\/a>/);
	assert.doesNotMatch(buildSite(notes, [], { title: "S", properties: false }).files.get("essays/on-walking.html"), /class="props"/);
});

test("a log's page looks as it does in the notebook: cover beside the properties, notes below", () => {
	const notes = [
		{ path: "content/logs/books/Dune.md", text: note("publish: true\ntitle: Dune\ncoverImage: \"[[dune.jpg]]\"\ncover_shape: vertical-cover\nbanner: https://example.com/b.jpg\nbanner_position: 30\ndate: 2026-09-01\ntags: [book, scifi]\nrating: [⭐⭐⭐⭐]\nauthor: Frank Herbert", "## Notes\n\nSpice. #reread\n\n- one\n  - two\n- [x] finished") },
	];
	const { files } = buildSite(notes, ["content/attachments/dune.jpg"], { title: "S" });
	const page = files.get("logs/books/dune.html");
	// The box is open, the cover inside it beside the rows, and the notes after the box.
	const box = page.indexOf('<details class="props" open>');
	const cover = page.indexOf('<span class="cover vertical-cover left"><img src="../../files/dune.jpg" alt=""></span>');
	const rows = page.indexOf("<dl>", box);
	const notesAt = page.indexOf('<div class="note">');
	assert.ok(box > 0 && cover > box && rows > cover && notesAt > rows, "box, cover, rows, then the notes");
	assert.match(page, /<div class="props-body cover-left" style="--cover-w: 200px">/);
	assert.doesNotMatch(page, /<img class="cover"/);
	// Date and tags sit in the box, as in the app, not on a line under the title.
	assert.doesNotMatch(page, /<p class="meta">/);
	assert.match(page, /<span class="icon">▦<\/span>date<\/dt><dd><time datetime="2026-09-01">September 1, 2026<\/time>/);
	assert.match(page, new RegExp(`<span class="icon">#</span>tags</dt><dd><span class="pill tag-${tagHue("book")}">book</span> <span class="pill tag-${tagHue("scifi")}">scifi</span>`));
	for (const k of ["coverImage", "banner", "banner_position", "cover_shape", "title"]) assert.doesNotMatch(page, new RegExp(`</span>${k}</dt>`));
	assert.match(page, /<div class="banner"><img src="https:\/\/example.com\/b.jpg" alt="" style="object-position: center 30%"><\/div>/);
	assert.match(page, new RegExp(`<span class="tag tag-${tagHue("reread")}">#reread</span>`));
	// Turning properties off brings back the date line and the plain cover.
	const plain = buildSite(notes, ["content/attachments/dune.jpg"], { title: "S", properties: false }).files.get("logs/books/dune.html");
	assert.match(plain, /<p class="meta"><time datetime="2026-09-01">/);
	assert.match(plain, /<img class="cover" src="..\/..\/files\/dune.jpg" alt="">/);
});

test("#tags become pills, but not headings, links or code", () => {
	const ctx = { kindOf: () => null, fileFor: () => null, pageFor: () => "a.html" };
	const md = webMarkdown("## Head\n\n#one and `#two` and [[A#Part]] and x#three", ctx);
	assert.match(md, /^## Head/m);
	assert.match(md, new RegExp(`<span class="tag tag-${tagHue("one")}">#one</span>`));
	assert.ok(md.includes("`#two`") && !md.includes("#three<") && !md.includes(">#Part"));
});

test("the notebook layout puts the site's title and logo atop the folders, with no header", () => {
	const notes = [{ path: "Essays/A.md", text: note("publish: true", "A") }];
	const att = ["logo.png"];
	const page = buildSite(notes, att, { title: "Garden", layout: "notebook", logo: "logo.png" }).files.get("essays/a.html");
	assert.doesNotMatch(page, /<header class="site">/);
	assert.match(page, /<nav class="tree" aria-label="Notes"><a class="home" href="..\/index.html"><img class="logo" src="..\/files\/logo.png" alt=""><span class="name"><span>Garden<\/span><\/span><\/a><ul class="tree-top">/);
	const top = buildSite(notes, att, { title: "Garden", logo: "logo.png" }).files.get("essays/a.html");
	assert.match(top, /<header class="site"><a class="home" href="..\/index.html"><img class="logo"/);
});

test("a tagline sits under the site's title, and describes the front page", () => {
	const notes = [{ path: "Essays/A.md", text: note("publish: true", "A") }];
	const site = buildSite(notes, [], { title: "Garden", tagline: "Notes & walks", layout: "notebook" });
	assert.match(site.files.get("essays/a.html"), /<span class="name"><span>Garden<\/span><span class="tagline">Notes &amp; walks<\/span><\/span>/);
	assert.match(site.files.get("index.html"), /<meta name="description" content="Notes &amp; walks">/);
	assert.doesNotMatch(buildSite(notes, [], { title: "Garden" }).files.get("essays/a.html"), /tagline/);
});

test("outside logs a cover is a wide picture under the properties, not inside the box", () => {
	const notes = [{ path: "Essays/A.md", text: note("publish: true\ncoverImage: \"[[pic.jpg]]\"\nstatus: draft", "A") }];
	const page = buildSite(notes, ["pic.jpg"], { title: "S" }).files.get("essays/a.html");
	assert.doesNotMatch(page, /<span class="cover /);
	assert.ok(page.indexOf('<img class="cover wide" src="../files/pic.jpg" alt="">') > page.indexOf('<details class="props">'));
	assert.match(buildSite(notes, ["pic.jpg"], { title: "S", properties: false }).files.get("essays/a.html"), /<img class="cover wide"/);
});
