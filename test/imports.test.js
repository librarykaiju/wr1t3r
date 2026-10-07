import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { frontmatter, uniquePath, xmlAll, xmlText, isoDate } from "../src/imports.js";
import { cleanSegment, renamePaths, readNotion, notionDate, relative } from "../src/notionimport.js";
import { readWordPress, autop } from "../src/wordpressimport.js";
import { readEnex, md5 } from "../src/evernoteimport.js";
import { readDayOne, unescapeDayOne } from "../src/dayoneimport.js";

// Enough of an HTML -> Markdown converter to see what the importers hand it.
const md = (html) => html.replace(/<br\s*\/?>\n?/g, "\n").replace(/<\/(p|div|li)>/g, "\n").replace(/<li>/g, "- ").replace(/<img src="([^"]+)"[^>]*>/g, "![]($1)").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n");

test("frontmatter quotes only what needs it", () => {
	assert.equal(frontmatter([["title", "Trip: Day 1"], ["date", "2026-10-07"], ["n", "007"], ["ok", true], ["tags", ["a", "b c"]], ["empty", ""]]),
		'---\ntitle: "Trip: Day 1"\ndate: 2026-10-07\nn: "007"\nok: true\ntags: [a, b c]\n---\n');
});

test("unique paths number the copies", () => {
	const t = new Set();
	assert.deepEqual([uniquePath(t, "A/x.md"), uniquePath(t, "a/X.md"), uniquePath(t, "A/x.md")], ["A/x.md", "a/X 2.md", "A/x 3.md"]);
});

test("XML text: CDATA kept, entities decoded", () => {
	const [item] = xmlAll("<item><title>A &amp; B</title><c><![CDATA[<p>x]]]]><![CDATA[>y</p>]]></c></item>", "item");
	assert.equal(xmlText(xmlAll(item.inner, "title")[0].inner), "A & B");
	assert.equal(xmlText(xmlAll(item.inner, "c")[0].inner), "<p>x]]>y</p>");
});

test("dates in a time zone", () => {
	assert.equal(isoDate("2026-10-07T03:30:00Z", { timeZone: "America/Chicago", withTime: true }), "2026-10-06 22:30");
});

// ---- Notion ----

const N = "0123456789abcdef0123456789abcdef", M = "fedcba9876543210fedcba9876543210";

test("Notion names lose their IDs", () => {
	assert.equal(cleanSegment(`Trip ${N}.md`), "Trip.md");
	assert.equal(cleanSegment(`Books ${N}_all.csv`), "Books_all.csv");
	assert.equal(cleanSegment("plain.png"), "plain.png");
	const names = renamePaths([`Trip ${N}.md`, `Trip ${M}.md`, `Trip ${M}/Day ${N}.md`, `Trip ${N}/Map.png`]);
	assert.equal(names.get(`Trip ${N}.md`), "Trip.md");
	assert.equal(names.get(`Trip ${M}.md`), "Trip 2.md");
	assert.equal(names.get(`Trip ${M}/Day ${N}.md`), "Trip 2/Day.md");
	assert.equal(names.get(`Trip ${N}/Map.png`), "Trip/Map.png");
	assert.equal(relative("Trip 2/Day.md", "Trip/Map.png"), "../Trip/Map.png");
});

test("Notion dates", () => {
	assert.equal(notionDate("October 7, 2026"), "2026-10-07");
	assert.equal(notionDate("October 7, 2026 3:05 PM"), "2026-10-07 15:05");
	assert.equal(notionDate("October 7, 2026 12:05 AM → October 9, 2026"), "2026-10-07 00:05");
	assert.equal(notionDate("Soon"), null);
});

test("a Notion export: links follow pages, rows get properties, databases become boards", () => {
	const paths = [`Home ${N}.md`, `Home ${N}/Books ${M}.csv`, `Home ${N}/Books ${M}_all.csv`, `Home ${N}/Books ${M}/Dune ${N}.md`, `Home ${N}/pic.png`, `Home ${N}/notes.html`];
	const texts = new Map([
		[`Home ${N}.md`, `# Home\n\nSee [Dune](Home%20${N}/Books%20${M}/Dune%20${N}.md) and ![](Home%20${N}/pic.png) and [web](https://x.org).\n`],
		[`Home ${N}/Books ${M}/Dune ${N}.md`, `# Dune\n\nAuthor: Frank Herbert\nRead: Yes\nFinished: March 3, 2024\nTags: sci-fi, classic\nSeries: Dune (../Books%20${M}/Dune%20${N}.md)\n\nGreat book.\n`],
	]);
	const r = readNotion(paths, texts);
	const byPath = new Map(r.notes.map((n) => [n.path, n]));
	assert.equal(byPath.get("Home.md").text, "# Home\n\nSee [Dune](<Home/Books/Dune.md>) and ![](<Home/pic.png>) and [web](https://x.org).\n");
	assert.equal(byPath.get("Home/Books/Dune.md").text, "---\nAuthor: Frank Herbert\nRead: true\nFinished: 2024-03-03\nTags: [sci-fi, classic]\nSeries: [\"[[Home/Books/Dune]]\"]\n---\n# Dune\n\nGreat book.\n");
	assert.deepEqual(byPath.get("Home/Books.board"), { path: "Home/Books.board", board: "Home/Books/" });
	assert.deepEqual(r.files, [{ from: `Home ${N}/pic.png`, path: "Home/pic.png" }]);
	assert.deepEqual(r.skipped.map((s) => s.path), [`Home ${N}/notes.html`]);
	assert.throws(() => readNotion(["a.html"], new Map()), /HTML export/);
});

// ---- WordPress ----

const WXR = `<?xml version="1.0"?><rss><channel><title>My Blog</title><wp:wxr_version>1.2</wp:wxr_version>
<wp:category><wp:cat_name><![CDATA[News]]></wp:cat_name></wp:category>
<item><title>Hello &amp; welcome</title><link>https://blog.example/hello/</link><dc:creator><![CDATA[sam]]></dc:creator>
<content:encoded><![CDATA[First line
second line

[caption id="1"]<img src="https://blog.example/a.jpg">A cat[/caption]

[gallery ids="1,2"]]]></content:encoded><excerpt:encoded><![CDATA[]]></excerpt:encoded>
<wp:post_date>2024-05-01 10:00:00</wp:post_date><wp:post_name>hello</wp:post_name><wp:status>publish</wp:status><wp:post_type>post</wp:post_type>
<category domain="category" nicename="news"><![CDATA[News]]></category><category domain="post_tag" nicename="cats"><![CDATA[cats]]></category>
<wp:comment><wp:comment_content>Nice</wp:comment_content></wp:comment></item>
<item><title>About</title><content:encoded><![CDATA[<!-- wp:paragraph --><p>Me.</p><!-- /wp:paragraph -->]]></content:encoded>
<wp:post_date>2024-01-01 00:00:00</wp:post_date><wp:status>draft</wp:status><wp:post_type>page</wp:post_type></item>
<item><title>a.jpg</title><wp:post_type>attachment</wp:post_type><wp:status>inherit</wp:status></item>
</channel></rss>`;

test("classic WordPress posts get paragraphs", () => {
	assert.equal(autop("a\nb\n\nc"), "<p>a<br>\nb</p>\n<p>c</p>");
	assert.equal(autop("<p>x</p>\n\n<p>y</p>"), "<p>x</p>\n\n<p>y</p>");
});

test("a WordPress export", () => {
	const r = readWordPress(WXR, md);
	assert.equal(r.name, "My Blog");
	assert.equal(r.notes.length, 2);
	assert.equal(r.notes[0].path, "Posts/Hello & welcome.md");
	assert.equal(r.notes[0].text, '---\ntitle: Hello & welcome\ndate: 2024-05-01\nauthor: sam\ntags: [cats]\ncategories: [News]\nurl: https://blog.example/hello/\npublish: true\n---\n# Hello & welcome\n\nFirst line\nsecond line\n\n![](https://blog.example/a.jpg)A cat\n\n[gallery ids="1,2"]\n');
	assert.equal(r.notes[1].text, "---\ntitle: About\ndate: 2024-01-01\ntags: []\ncategories: []\npublish: false\n---\n# About\n\nMe.\n");
	assert.deepEqual(r.plugins, [{ path: "Posts/Hello & welcome.md", features: ["[gallery] shortcode"] }]);
	assert.ok(r.remarks.some((x) => /1 comment wasn't/.test(x)));
	assert.ok(r.remarks.some((x) => /1 file stayed on the site/.test(x)));
	assert.throws(() => readWordPress("<rss></rss>", md), /isn't a WordPress export/);
});

// ---- Evernote ----

test("MD5 matches", () => {
	for (const b of [new Uint8Array(0), new TextEncoder().encode("abc"), randomBytes(55), randomBytes(56), randomBytes(64), randomBytes(1000)]) {
		assert.equal(md5(new Uint8Array(b)), createHash("md5").update(b).digest("hex"));
	}
});

test("an Evernote notebook: attachments by hash, checkboxes as tasks", () => {
	const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
	const hash = createHash("md5").update(png).digest("hex");
	const enex = `<?xml version="1.0"?><en-export><note><title>Groceries</title><content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "x"><en-note><div><en-todo checked="true"/>Milk</div><div><en-todo/>Eggs</div><div><en-media hash="${hash}" type="image/png"/></div><en-crypt>xyz</en-crypt></en-note>]]></content>
<created>20240102T030405Z</created><updated>20240105T000000Z</updated><tag>home</tag><tag>food</tag><note-attributes><source-url>https://x.org</source-url></note-attributes>
<resource><data encoding="base64">${Buffer.from(png).toString("base64")}</data><mime>image/png</mime><resource-attributes><file-name>list photo.png</file-name></resource-attributes></resource></note>
<note><title>Groceries</title><content><![CDATA[<en-note>again</en-note>]]></content></note></en-export>`;
	const r = readEnex(enex, "Home", md);
	assert.deepEqual(r.notes.map((n) => n.path), ["Home/Groceries.md", "Home/Groceries 2.md"]);
	assert.equal(r.notes[0].text, "---\ntitle: Groceries\ndate: 2024-01-02\nupdated: 2024-01-05\nsource: https://x.org\ntags: [home, food]\n---\n# Groceries\n\n- [x] Milk\n- [ ] Eggs\n![list photo.png](<attachments/list photo.png>)\n(encrypted text left out)\n");
	assert.deepEqual(r.files.map((f) => [f.path, [...f.bytes]]), [["Home/attachments/list photo.png", [...png]]]);
	assert.deepEqual(r.plugins[0].features, ["encrypted text (left out)"]);
	assert.throws(() => readEnex("<x/>", "Bad", md), /isn't an Evernote export/);
});

// ---- Day One ----

test("Day One's escapes come off where they change nothing", () => {
	assert.equal(unescapeDayOne("Done\\! It was 3\\.5 km \\(far\\)\n1\\. not a list\n\\- nor this"), "Done! It was 3.5 km (far)\n1\\. not a list\n\\- nor this");
});

test("a Day One journal", () => {
	const json = { entries: [
		{ creationDate: "2024-03-01T02:00:00Z", timeZone: "America/Chicago", text: "# Snow day\n\nIt snowed\\!\n\n![](dayone-moment://P1)", tags: ["weather"], starred: true,
			location: { placeName: "Home", localityName: "Tulsa", country: "United States" }, weather: { conditionsDescription: "Snow", temperatureCelsius: -2.4 },
			photos: [{ identifier: "P1", md5: "abcdef0123456789", type: "jpeg" }] },
		{ creationDate: "2024-03-02T15:00:00Z", text: "Quick note", photos: [{ identifier: "P2", md5: "ffff", type: "jpeg" }] },
	] };
	const r = readDayOne(json, "Journal", (p) => p === "photos/abcdef0123456789.jpeg");
	assert.equal(r.notes[0].path, "2024-02-29 Snow day.md");
	assert.equal(r.notes[0].text, "---\ntitle: Snow day\ndate: 2024-02-29 20:00\ntags: [weather]\nlocation: Home, Tulsa, United States\nweather: Snow, -2°C\nstarred: true\n---\n# Snow day\n\nIt snowed!\n\n![](<attachments/2024-02-29 abcdef01.jpeg>)\n");
	assert.deepEqual(r.files, [{ from: "photos/abcdef0123456789.jpeg", path: "attachments/2024-02-29 abcdef01.jpeg" }]);
	assert.equal(r.skipped.length, 1);
	assert.match(r.notes[1].path, /^2024-03-02\.md$/);
	const two = readDayOne(json, "Travel", () => true, { base: "Travel/" });
	assert.match(two.notes[0].text, /\]\(<\.\.\/attachments\/2024-02-29 abcdef01\.jpeg>\)/);
});
