import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, feedLinks, parseOpml, siteUrl, htmlText, shorten, feedKind } from "../src/feedparse.js";
import { readFollowing, writeFollowing, addFollow, followingPath, lastSlot, refreshDue, readFeeds, neighborsList, newSince, sameSite } from "../src/feeds.js";
import { buildSite } from "../src/website.js";
import { pinKind, pinTitle } from "../src/home.js";

const { fetchFeed } = await import("../worker/feed.js");
const product = (await import("../worker/product.js")).default;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://a.example/">
<title type="text">Ann &amp; Co</title>
<link rel="self" href="https://a.example/feed.xml"/>
<link href="https://a.example/"/>
<entry><title>Older</title><link href="posts/old.html"/><published>2026-01-02T00:00:00Z</published><summary>Plain old.</summary></entry>
<entry><title type="html">&lt;i&gt;Newer&lt;/i&gt;</title><link rel="alternate" type="text/html" href="posts/new.html"/><link rel="enclosure" href="x.mp3"/><updated>2026-03-04T10:00:00Z</updated>
<content type="html">&lt;p&gt;Hello &lt;b&gt;there&lt;/b&gt; &amp;amp; welcome.&lt;/p&gt;&lt;script&gt;bad()&lt;/script&gt;</content></entry>
<entry><title>No link</title></entry>
</feed>`;

const RSS2 = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Bob's</title><link>https://b.example</link>
<item><title>First</title><link>https://b.example/1</link><pubDate>Tue, 10 Jun 2025 04:00:00 GMT</pubDate>
<description><![CDATA[<p>Some <em>words</em> here</p>]]></description></item>
<item><guid>https://b.example/2</guid><dc:date>2025-07-01T00:00:00Z</dc:date><content:encoded><![CDATA[Only content]]></content:encoded></item>
<item><guid isPermaLink="false">abc</guid><title>Not a link</title></item>
</channel></rss>`;

const RSS1 = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://c.example/"><title>Cee</title><link>https://c.example/</link></channel>
<item rdf:about="https://c.example/p"><title>P</title><link>https://c.example/p</link><dc:date>2024-05-05</dc:date></item>
</rdf:RDF>`;

const JSONFEED = JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "Dee", home_page_url: "https://d.example/", items: [{ id: "1", url: "https://d.example/one", title: "One", content_html: "<p>Hi</p>", date_published: "2026-02-02T00:00:00Z" }] });

test("feeds: Atom, RSS 2.0, RSS 1.0 and JSON Feed, newest first, as plain text", () => {
	const a = parseFeed(ATOM, "https://a.example/feed.xml");
	assert.equal(a.title, "Ann & Co");
	assert.equal(a.site, "https://a.example/");
	assert.deepEqual(a.items.map((i) => [i.title, i.url, i.date]), [
		["Newer", "https://a.example/posts/new.html", "2026-03-04T10:00:00.000Z"],
		["Older", "https://a.example/posts/old.html", "2026-01-02T00:00:00.000Z"],
	]);
	assert.equal(a.items[0].summary, "Hello there & welcome.", "tags and scripts out, entities decoded");
	const b = parseFeed(RSS2, "https://b.example/rss");
	assert.equal(b.title, "Bob's");
	assert.deepEqual(b.items.map((i) => [i.url, i.summary]), [["https://b.example/2", "Only content"], ["https://b.example/1", "Some words here"]]);
	assert.equal(b.items[0].title, "Only content", "a post without a title takes its first words");
	const c = parseFeed(RSS1, "https://c.example/index.rdf");
	assert.deepEqual(c.items.map((i) => [i.title, i.url]), [["P", "https://c.example/p"]]);
	const d = parseFeed(JSONFEED, "https://d.example/feed.json");
	assert.deepEqual(d.items.map((i) => [i.title, i.summary]), [["One", "Hi"]]);
	assert.equal(parseFeed("<!doctype html><html><head></head></html>", "https://x.example/"), null);
	assert.equal(parseFeed("nonsense", ""), null);
	assert.equal(feedKind("<!doctype html><html>"), "html");
});

test("a wr1t3r site's own feed reads back", () => {
	const note = (p, b) => `---\n${p}\n---\n${b}`;
	const site = buildSite([{ path: "Essays/Walk.md", text: note("publish: true\ndate: 2026-04-01", "Out for a *walk* & back.") }], [], { title: "Mine", address: "me.neocities.org" });
	const f = parseFeed(site.files.get("feed.xml"), "https://me.neocities.org/feed.xml");
	assert.equal(f.title, "Mine");
	assert.deepEqual(f.items, [{ title: "Walk", url: "https://me.neocities.org/essays/walk.html", date: "2026-04-01T00:00:00.000Z", summary: "Out for a walk & back." }]);
	// Its pages offer the feed, and following in wr1t3r.
	const page = site.files.get("essays/walk.html");
	assert.match(page, /<p class="follow">Follow this site: <a href="..\/feed.xml" type="application\/atom\+xml">its feed<\/a> or <a href="https:\/\/my.wr1t3r.app\/#follow=https%3A%2F%2Fme.neocities.org%2F">in wr1t3r<\/a><\/p>/);
	const noAddress = buildSite([{ path: "W.md", text: note("publish: true\ndate: 2026-04-01", "x") }], [], { title: "M" }).files.get("w.html");
	assert.ok(noAddress.includes("its feed</a></p>") && !noAddress.includes("#follow="));
});

test("feed links in a page's head, best first; summaries cut at a word", () => {
	const html = `<head><link rel="stylesheet" href="s.css"><link rel="alternate" type="application/rss+xml" href="/rss.xml"><link rel="alternate" type="application/atom+xml" href="feed.xml" title="x"><link rel="alternate" hreflang="fr" href="/fr/"></head>`;
	assert.deepEqual(feedLinks(html, "https://e.example/blog/"), ["https://e.example/blog/feed.xml", "https://e.example/rss.xml"]);
	assert.equal(htmlText("<p>a</p><p>b&nbsp;c</p>"), "a b c");
	const s = shorten("word ".repeat(100));
	assert.ok(s.length <= 281 && s.endsWith("word…"));
});

test("the follow list: read, written back, nothing else touched", () => {
	const text = `---\ntitle: mine\nfollowing:\n  - url: "https://a.example/"\n    feed: "https://a.example/feed.xml"\n    name: "Ann"\n    color: 3\n  - b.example\n  - url: "not a site"\n---\nMy notes.\n`;
	const list = readFollowing(text);
	assert.deepEqual(list, [{ url: "https://a.example/", feed: "https://a.example/feed.xml", name: "Ann", color: 3 }, { url: "https://b.example/" }]);
	const next = addFollow(list, { url: "c.example", feed: "https://c.example/atom.xml", name: "Cee" });
	const out = writeFollowing(text, next);
	assert.ok(out.startsWith("---\ntitle: mine\nfollowing:\n") && out.endsWith("---\nMy notes.\n"));
	assert.deepEqual(readFollowing(out), next);
	assert.equal(addFollow(next, { url: "http://www.c.example" }), next, "the same site isn't added twice");
	assert.equal(addFollow(next, { url: "https://other.example/", feed: "https://a.example/feed.xml" }), next, "nor the same feed");
	assert.equal(addFollow(next, { url: "nope" }), next);
	const fresh = writeFollowing("", [{ url: "https://a.example/", private: true }]);
	assert.match(fresh, /^---\nfollowing:\n  - url: "https:\/\/a.example\/"\n    private: true\n---\nThe sites you follow/);
	assert.deepEqual(readFollowing(writeFollowing(fresh, [])), []);
	assert.equal(followingPath(["content/_wr1t3r/Home.md"], "content/"), "content/_wr1t3r/Following.md");
	assert.equal(followingPath(["notes/_wr1t3r/following.md"], "content/"), "notes/_wr1t3r/following.md");
	assert.equal(siteUrl("someone.neocities.org"), "https://someone.neocities.org/");
	assert.equal(siteUrl("https://user:pw@x.example/"), "");
	assert.ok(sameSite("https://www.a.example/", "http://a.example"));
});

test("OPML from another reader", () => {
	const opml = `<?xml version="1.0"?><opml version="2.0"><head><title>Subs</title></head><body>
<outline text="Blogs"><outline type="rss" text="Ann" xmlUrl="https://a.example/feed.xml" htmlUrl="https://a.example/"/>
<outline type="rss" title="Bob" xmlUrl="https://b.example/rss"/></outline></body></opml>`;
	assert.deepEqual(parseOpml(opml), [
		{ url: "https://a.example/", feed: "https://a.example/feed.xml", name: "Ann" },
		{ url: "https://b.example/", feed: "https://b.example/rss", name: "Bob" },
	]);
});

test("feeds are read again after the morning or evening time passes", () => {
	const at = (h, m = 0, day = 14) => new Date(2026, 9, day, h, m);
	assert.equal(lastSlot(at(8)).getTime(), at(7).getTime());
	assert.equal(lastSlot(at(20)).getTime(), at(19).getTime());
	assert.equal(lastSlot(at(3)).getTime(), at(19, 0, 13).getTime(), "before 7am, yesterday evening's");
	assert.equal(refreshDue(null, at(8)), true);
	assert.equal(refreshDue(at(7, 30).getTime(), at(18)), false, "read this morning, not due till evening");
	assert.equal(refreshDue(at(7, 30).getTime(), at(19, 5)), true);
	assert.equal(refreshDue(at(20).getTime(), at(6, 0, 15)), false, "read last evening, not due till morning");
});

test("reading every feed: errors keep the last posts, found feeds fill in", async () => {
	const list = [{ url: "https://a.example/" }, { url: "https://b.example/", feed: "https://b.example/rss" }];
	const fetchFeed = async (u) => {
		if (u === "https://a.example/") return { feed: "https://a.example/feed.xml", title: "Ann", items: [{ title: "A1", url: "https://a.example/1", date: "2026-03-01T00:00:00.000Z", summary: "" }] };
		throw new Error("The site answered 500");
	};
	const old = { "https://b.example/": { title: "Bob", items: [{ title: "B1", url: "https://b.example/1", date: "2026-04-01T00:00:00.000Z", summary: "" }] } };
	const { feeds, list: next } = await readFeeds(list, fetchFeed, { old, at: 5 });
	assert.deepEqual(next, [{ url: "https://a.example/", feed: "https://a.example/feed.xml" }, list[1]]);
	assert.equal(feeds["https://b.example/"].error, "The site answered 500");
	const posts = neighborsList(next, feeds);
	assert.deepEqual(posts.map((p) => [p.title, p.name]), [["B1", "Bob"], ["A1", "Ann"]]);
	assert.equal(newSince(posts, Date.parse("2026-03-15")), 1);
	const same = await readFeeds([list[1]], async () => ({ feed: "https://b.example/rss", items: [] }));
	assert.equal(same.list.length, 1);
});

test("Home's Neighbors tile", () => {
	assert.deepEqual(pinKind("neighbors:"), { kind: "neighbors" });
	assert.equal(pinTitle({ link: "neighbors:" }), "Neighbors");
});

// The relay, with the web faked.
function fakeWeb(pages) {
	const real = globalThis.fetch;
	const seen = [];
	globalThis.fetch = async (url) => {
		seen.push(String(url));
		const p = pages[String(url)];
		if (!p) return new Response("gone", { status: 404 });
		if (p.redirect) return new Response(null, { status: 301, headers: { Location: p.redirect } });
		return new Response(p.body, { headers: { "Content-Type": p.type } });
	};
	return { seen, restore: () => (globalThis.fetch = real) };
}

test("the relay finds a site's feed and answers with posts only", async () => {
	const web = fakeWeb({
		"https://a.example/": { body: `<html><head><link rel="alternate" type="application/atom+xml" href="/feed.xml"></head><body>secret page</body></html>`, type: "text/html" },
		"https://a.example/feed.xml": { body: ATOM, type: "application/atom+xml; charset=utf-8" },
		"https://b.example/": { body: "<html><head></head><body>no feed named</body></html>", type: "text/html" },
		"https://b.example/rss.xml": { body: RSS2, type: "application/rss+xml" },
		"https://n.example/": { body: "<html><body>nothing</body></html>", type: "text/html" },
		"https://moved.example/feed": { redirect: "https://a.example/feed.xml" },
	});
	try {
		const a = await fetchFeed("https://a.example/", {});
		assert.equal(a.feed, "https://a.example/feed.xml");
		assert.equal(a.items.length, 2);
		assert.ok(!JSON.stringify(a).includes("secret"), "never the page itself");
		assert.ok(!JSON.stringify(a).includes("<b>"), "never a post's markup");
		const b = await fetchFeed("https://b.example/", {});
		assert.equal(b.feed, "https://b.example/rss.xml", "found by its usual name");
		assert.equal((await fetchFeed("https://moved.example/feed", {})).feed, "https://a.example/feed.xml");
		await assert.rejects(fetchFeed("https://n.example/", {}), (e) => e.status === 404);
		await assert.rejects(fetchFeed("http://127.0.0.1/feed", {}), (e) => e.status === 403);
		await assert.rejects(fetchFeed("", {}), (e) => e.status === 400);
		assert.ok(web.seen.filter((u) => u.startsWith("https://n.example/")).length <= 4, "a few tries at most");
	} finally { web.restore(); }
});

test("the product Worker's relay answers only its own page", async () => {
	const web = fakeWeb({ "https://a.example/feed.xml": { body: ATOM, type: "application/atom+xml" } });
	try {
		const env = { ASSETS: { fetch: async () => new Response("page") } };
		const ask = (headers) => product.fetch(new Request("https://my.wr1t3r.app/api/feed?url=" + encodeURIComponent("https://a.example/feed.xml"), { headers }), env);
		const ok = await ask({ "Sec-Fetch-Site": "same-origin" });
		assert.equal(ok.status, 200);
		assert.equal(ok.headers.get("Cache-Control"), "no-store");
		assert.equal((await ok.json()).title, "Ann & Co");
		assert.equal((await ask({})).status, 403);
		assert.equal((await ask({ "Sec-Fetch-Site": "cross-site" })).status, 403);
		assert.equal((await ask({ Origin: "https://evil.example" })).status, 403);
	} finally { web.restore(); }
});
