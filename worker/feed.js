// The feed relay for Neighbors. The browser can't read most sites' feeds
// directly (CORS), so it asks the Worker:
//
//   GET /api/feed?url=   a site or its feed -> { feed, title, site, items:
//                        [{ title, url, date, summary, inReplyTo? }] } (src/feedparse.js),
//                        or for a site with no feed, { feed: "", title, site,
//                        items: [], page: { hash, updated? } }: a fingerprint of
//                        its front page's words, so the page can tell when it
//                        changes, and for a Neocities site, when it last did
//   GET /api/sites?url=  a site or an OPML list -> { list, title, sites:
//                        [{ url, feed, name }] }: who a site reads (its
//                        blogroll), or a webring's members
//
// Given a web page, it follows the feed the page names in its <head>, else
// tries links on the page that look like feeds and the usual feed names
// (feed.xml, atom.xml...); for a list of sites, the
// blogroll the page names, else neighbors.opml. It answers only with a feed's
// titles, links, dates and a line or two of each post, or a list's sites,
// never a page or a post's full text, so it can't be used to fetch anything
// else. Fetching goes through proxyFetch (worker/fetch.js): public addresses
// only, a few redirects, 15s and 5 MB at most. Nothing is kept, logged or cached: no
// record of who reads which feed.

import { HttpError } from "./util.js";
import { proxyFetch } from "./fetch.js";
import { parseFeed, feedLinks, feedAnchors, pageTitle, htmlText, feedKind, FEED_GUESSES, blogrollLinks, LIST_GUESSES, isOpml, opmlTitle, parseOpml } from "../src/feedparse.js";

const MAX_TRIES = 6; // the page, its feed, and a few guesses

async function read(url, env) {
	const res = await proxyFetch(url, env);
	const type = res.headers.get("Content-Type") || "";
	const charset = /charset=["']?([\w-]+)/i.exec(type)?.[1] || "utf-8";
	const bytes = new Uint8Array(await res.arrayBuffer());
	let text;
	try { text = new TextDecoder(charset).decode(bytes); } catch { text = new TextDecoder().decode(bytes); }
	return { text, url: res.headers.get("X-Final-URL") || url };
}

export async function fetchFeed(raw, env) {
	if (!raw) throw new HttpError(400, "Which site?");
	let tries = 0;
	const attempt = async (url) => {
		if (tries++ >= MAX_TRIES) return null;
		try { return await read(url, env); } catch (e) { if (tries === 1) throw e; return null; }
	};
	const first = await attempt(raw);
	const asFeed = (r) => {
		const f = r && parseFeed(r.text, r.url);
		return f ? { feed: r.url, ...f } : null;
	};
	let found = asFeed(first);
	if (found) return found;
	// Any page that isn't a feed: plenty of hand-made pages have no doctype.
	if (feedKind(first.text) !== "json") {
		const named = [...feedLinks(first.text, first.url), ...feedAnchors(first.text, first.url)];
		const guesses = FEED_GUESSES.map((g) => new URL(g, first.url).href);
		for (const u of [...new Set([...named, ...guesses])]) {
			found = asFeed(await attempt(u));
			if (found) return { ...found, site: found.site || first.url };
			if (tries >= MAX_TRIES) break;
		}
		return { feed: "", title: pageTitle(first.text), site: first.url, items: [], page: await watch(first, env) };
	}
	throw new HttpError(404, "No feed found there");
}

// A site with no feed: a fingerprint of its front page's words, and for a
// Neocities site, when it was last updated (Neocities says, for anyone).
async function watch(page, env) {
	const words = new TextEncoder().encode(htmlText(page.text));
	const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", words))].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
	const out = { hash };
	const name = /^([a-z0-9-]+)\.neocities\.org$/i.exec(new URL(page.url).hostname)?.[1];
	if (name) {
		try {
			const info = JSON.parse((await read(`https://neocities.org/api/info?sitename=${encodeURIComponent(name)}`, env)).text).info || {};
			const t = Date.parse(info.last_updated || "");
			if (Number.isFinite(t)) out.updated = new Date(t).toISOString();
		} catch {}
	}
	return out;
}

export async function fetchSites(raw, env) {
	if (!raw) throw new HttpError(400, "Which site?");
	let tries = 0;
	const attempt = async (url) => {
		if (tries++ >= MAX_TRIES) return null;
		try { return await read(url, env); } catch (e) { if (tries === 1) throw e; return null; }
	};
	const asList = (r) => (r && isOpml(r.text) ? { list: r.url, title: opmlTitle(r.text), sites: parseOpml(r.text).slice(0, 500) } : null);
	const first = await attempt(raw);
	let found = asList(first);
	if (found) return found;
	if (feedKind(first.text) === "html") {
		const named = blogrollLinks(first.text, first.url);
		const guesses = LIST_GUESSES.map((g) => new URL(g, first.url).href);
		for (const u of [...named, ...guesses.filter((g) => !named.includes(g))]) {
			found = asList(await attempt(u));
			if (found) return found;
			if (tries >= MAX_TRIES) break;
		}
	}
	throw new HttpError(404, "No list of sites found there");
}

export async function feedApi(request, env, url) {
	if (url.pathname !== "/api/feed" && url.pathname !== "/api/sites") return null;
	if (request.method !== "GET") throw new HttpError(405, "GET only");
	return (url.pathname === "/api/feed" ? fetchFeed : fetchSites)(url.searchParams.get("url"), env);
}
