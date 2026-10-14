// Reading other sites' feeds: a small XML reader, then Atom, RSS (0.9x, 1.0
// and 2.0) and JSON Feed as { title, site, items: [{ title, url, date,
// summary }] }, only what the Neighbors view shows. Summaries are plain text,
// a line or two; a post's full text never leaves its site. An item that
// answers another post (thr:in-reply-to) carries its address as inReplyTo. No DOM and no
// imports, so the Worker's feed relay (worker/feed.js) uses it as is.

export const SUMMARY_MAX = 280;

// ---- A small XML reader ------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s) {
	return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
		if (e[0] === "#") {
			const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			try { return Number.isFinite(n) ? String.fromCodePoint(n) : m; } catch { return m; }
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

// The XML as a tree of { name, attrs, children } (names without their
// namespace prefix, lowercased; text children as strings). Forgiving: a
// stray close tag is skipped, an unclosed one closes at the end.
export function parseXml(text) {
	const root = { name: "#root", attrs: {}, children: [] };
	const stack = [root];
	const src = String(text || "");
	const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/gi;
	let at = 0, m;
	const top = () => stack[stack.length - 1];
	const local = (n) => n.toLowerCase().replace(/^[^:]*:/, "");
	while ((m = re.exec(src))) {
		if (m.index > at) top().children.push(decodeEntities(src.slice(at, m.index)));
		at = re.lastIndex;
		if (m[1] != null) top().children.push(m[1]);
		else if (m[2]) {
			const name = local(m[2]);
			const i = stack.map((n) => n.name).lastIndexOf(name);
			if (i > 0) stack.length = i;
		} else if (m[3]) {
			const attrs = {};
			for (const a of (m[4] || "").matchAll(/([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[local(a[1])] = decodeEntities(a[3] ?? a[4] ?? a[5] ?? "");
			const node = { name: local(m[3]), attrs, children: [] };
			top().children.push(node);
			if (!m[5]) stack.push(node);
		}
	}
	if (at < src.length) top().children.push(decodeEntities(src.slice(at)));
	return root;
}

const kids = (node, name) => (node?.children || []).filter((c) => typeof c === "object" && (!name || c.name === name));
const kid = (node, name) => kids(node, name)[0] || null;
const textOf = (node) => (node ? node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("") : "");
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// Plain text from a bit of HTML: tags out, entities decoded, spaces squeezed.
export function htmlText(html) {
	return clean(decodeEntities(String(html ?? "").replace(/<(script|style)[\s\S]*?<\/\1\s*>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|h\d|blockquote)>/gi, " ").replace(/<[^>]*>/g, "")));
}

// At most SUMMARY_MAX characters, cut at a word.
export function shorten(s, max = SUMMARY_MAX) {
	const t = clean(s);
	if (t.length <= max) return t;
	const cut = t.slice(0, max), sp = cut.lastIndexOf(" ");
	return cut.slice(0, sp > max * 0.7 ? sp : max).replace(/[\s,;:.]+$/, "") + "…";
}

const absolute = (u, base) => { if (!String(u || "").trim()) return ""; try { const x = new URL(String(u).trim(), base || undefined); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };
const isoDate = (s) => { const t = Date.parse(clean(s)); return Number.isFinite(t) ? new Date(t).toISOString() : ""; };

// ---- Feeds -------------------------------------------------------------------

// What kind of text this is: "atom", "rss", "json" (JSON Feed), "html" or null.
export function feedKind(text) {
	const t = String(text || "").replace(/^﻿/, "").trimStart();
	if (t.startsWith("{")) { try { return /jsonfeed\.org\/version/.test(JSON.parse(t).version || "") ? "json" : null; } catch { return null; } }
	const head = t.slice(0, 2000).replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g, "").trimStart();
	if (/^<(\w+:)?feed[\s>]/i.test(head)) return "atom";
	if (/^<(rss|(\w+:)?RDF)[\s>]/i.test(head)) return "rss";
	if (/^<!doctype html|^<html[\s>]|<head[\s>]|<body[\s>]/i.test(head)) return "html";
	return null;
}

// The feed in text (fetched from url) as { title, site, items }, newest
// first, or null when it isn't one. Items need a link; at most max of them.
export function parseFeed(text, url = "", { max = 20 } = {}) {
	const kind = feedKind(text);
	if (kind === "json") return jsonFeed(JSON.parse(String(text).replace(/^﻿/, "")), url, max);
	if (kind !== "atom" && kind !== "rss") return null;
	const doc = parseXml(text);
	const top = kid(doc, kind === "atom" ? "feed" : kids(doc).find((n) => n.name === "rss" || n.name === "rdf")?.name);
	if (!top) return null;
	return kind === "atom" ? atom(top, url, max) : rss(top, url, max);
}

function finish(title, site, items, max) {
	const out = items.filter((i) => i.url).map((i) => ({ title: i.title || i.summary.slice(0, 80) || i.url, url: i.url, date: i.date, summary: i.summary, ...(i.inReplyTo ? { inReplyTo: i.inReplyTo } : {}) }));
	// Newest first; undated ones keep the feed's order after the dated ones.
	out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
	return { title: clean(title), site, items: out.slice(0, max) };
}

// The post an entry answers (thr:in-reply-to), as an address, or "".
const replyOf = (node, base) => { const r = kid(node, "in-reply-to"); return r ? absolute(r.attrs.href || r.attrs.ref, base) : ""; };

function atom(feed, url, max) {
	const base = absolute(feed.attrs.base, url) || url;
	const linkOf = (node, b) => {
		const links = kids(node, "link");
		const l = links.find((x) => (x.attrs.rel || "alternate") === "alternate" && (!x.attrs.type || /html/i.test(x.attrs.type))) || links.find((x) => !x.attrs.rel || x.attrs.rel === "alternate");
		return l ? absolute(l.attrs.href, absolute(node.attrs.base, b) || b) : "";
	};
	const site = linkOf(feed, base);
	const items = kids(feed, "entry").map((e) => {
		const content = kid(e, "summary") || kid(e, "content");
		const raw = textOf(content);
		return {
			title: htmlText(textOf(kid(e, "title"))),
			url: linkOf(e, base),
			date: isoDate(textOf(kid(e, "published")) || textOf(kid(e, "updated"))),
			summary: shorten(content?.attrs.type === "text" ? raw : htmlText(raw)),
			inReplyTo: replyOf(e, base),
		};
	});
	return finish(htmlText(textOf(kid(feed, "title"))), site, items, max);
}

function rss(top, url, max) {
	const channel = kid(top, "channel");
	// RSS 1.0 keeps its items beside the channel, 2.0 inside it.
	const nodes = [...kids(channel, "item"), ...kids(top, "item")];
	const linkText = (n) => clean(textOf(kids(n, "link").find((l) => !l.attrs.href) || null)) || kids(n, "link").find((l) => l.attrs.rel === "alternate")?.attrs.href || "";
	const site = absolute(linkText(channel), url);
	const items = nodes.map((i) => {
		const guid = kid(i, "guid");
		const link = linkText(i) || (guid && guid.attrs.ispermalink !== "false" ? clean(textOf(guid)) : "");
		return {
			title: htmlText(textOf(kid(i, "title"))),
			url: absolute(link, site || url),
			date: isoDate(textOf(kid(i, "pubdate")) || textOf(kid(i, "date")) || textOf(kid(i, "published"))),
			summary: shorten(htmlText(textOf(kid(i, "description")) || textOf(kid(i, "encoded")))),
			inReplyTo: replyOf(i, site || url),
		};
	});
	return finish(htmlText(textOf(kid(channel, "title"))), site, items, max);
}

function jsonFeed(j, url, max) {
	const site = absolute(j.home_page_url, url);
	const items = (Array.isArray(j.items) ? j.items : []).map((i) => ({
		title: clean(i.title),
		url: absolute(i.url || i.external_url || (/^https?:/.test(String(i.id)) ? i.id : ""), url),
		date: isoDate(i.date_published || i.date_modified || ""),
		summary: shorten(i.summary || htmlText(i.content_html) || i.content_text || ""),
	}));
	return finish(j.title, site, items, max);
}

// The feeds a web page names in its <head>, as absolute addresses, best first
// (Atom, then RSS, then JSON Feed).
export function feedLinks(html, base) {
	const out = [];
	for (const m of String(html || "").matchAll(/<link\b[^>]*>/gi)) {
		const a = {};
		for (const x of m[0].matchAll(/([\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) a[x[1].toLowerCase()] = decodeEntities(x[3] ?? x[4] ?? x[5] ?? "");
		if (!/(^|\s)alternate(\s|$)/i.test(a.rel || "")) continue;
		const rank = { "application/atom+xml": 0, "application/rss+xml": 1, "application/feed+json": 2, "application/json": 3 }[String(a.type || "").toLowerCase()];
		const href = rank != null && absolute(a.href, base);
		if (href) out.push([rank, href]);
	}
	return [...new Set(out.sort((x, y) => x[0] - y[0]).map((x) => x[1]))];
}

// The lists of sites a page names as its blogroll (<link rel="blogroll">),
// as absolute addresses.
export function blogrollLinks(html, base) {
	const out = [];
	for (const m of String(html || "").matchAll(/<link\b[^>]*>/gi)) {
		const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(m[0])?.[1] || "";
		const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[0]);
		if (/(^|\s)blogroll(\s|$)/i.test(rel) && href) { const u = absolute(decodeEntities(href[2] ?? href[3] ?? href[4]), base); if (u) out.push(u); }
	}
	return [...new Set(out)];
}

// Links in a page's text that look like its feed (<a href="rss.xml">), on the
// same site, for pages that don't name one in their <head>.
export function feedAnchors(html, base) {
	const out = [];
	let host = "";
	try { host = new URL(base).host; } catch {}
	for (const m of String(html || "").matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
		const u = absolute(decodeEntities(m[2] ?? m[3] ?? m[4]), base);
		if (!u) continue;
		const x = new URL(u);
		if (x.host !== host) continue;
		if (/\.(rss|atom)$|\.xml$|(^|\/)(rss|atom|feed)\/?$/i.test(x.pathname) && !/sitemap/i.test(x.pathname)) out.push(u);
	}
	return [...new Set(out)];
}

// The text of a page's <title>, or "".
export const pageTitle = (html) => htmlText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ""))?.[1] || "");

// Where to look for a list of sites when a page names none.
export const LIST_GUESSES = ["neighbors.opml", "blogroll.opml"];

// Where to look for a feed when a site's page names none.
export const FEED_GUESSES = ["feed.xml", "atom.xml", "rss.xml", "index.xml", "feed"];

// A site address as typed ("someone.neocities.org") made whole, or "".
export function siteUrl(text) {
	let t = String(text ?? "").trim();
	if (!t || /\s/.test(t)) return "";
	if (!/^[a-z][\w+.-]*:/i.test(t)) t = "https://" + t.replace(/^\/+/, "");
	try {
		const u = new URL(t);
		if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || u.username || u.password) return "";
		u.hash = "";
		return u.href;
	} catch { return ""; }
}

// Whether text is an OPML file.
export const isOpml = (text) => /^\s*(<\?[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*<opml[\s>]/i.test(String(text || "").replace(/^\uFEFF/, ""));

// An OPML file's title.
export const opmlTitle = (text) => clean(textOf(kid(kid(kid(parseXml(text), "opml"), "head"), "title")));

// The sites in an OPML file (another reader's export): [{ url, feed, name }].
export function parseOpml(text) {
	const out = [];
	const walk = (node) => {
		for (const o of kids(node, "outline")) {
			const feed = absolute(o.attrs.xmlurl);
			if (feed) out.push({ url: absolute(o.attrs.htmlurl) || new URL(feed).origin + "/", feed, name: clean(o.attrs.title || o.attrs.text) });
			walk(o);
		}
	};
	walk(kid(kid(parseXml(text), "opml"), "body"));
	return out;
}
