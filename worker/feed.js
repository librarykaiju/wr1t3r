// The feed relay for Neighbors. The browser can't read most sites' feeds
// directly (CORS), so it asks the Worker:
//
//   GET /api/feed?url=   a site or its feed -> { feed, title, site, items:
//                        [{ title, url, date, summary }] } (src/feedparse.js)
//
// Given a web page, it follows the feed the page names in its <head>, else
// tries the usual feed names (feed.xml, atom.xml...). It answers only with a
// feed's titles, links, dates and a line or two of each post, never a page or
// a post's full text, so it can't be used to fetch anything else. Fetching
// goes through proxyFetch (worker/fetch.js): public addresses only, a few
// redirects, 15s and 5 MB at most. Nothing is kept, logged or cached: no
// record of who reads which feed.

import { HttpError } from "./util.js";
import { proxyFetch } from "./fetch.js";
import { parseFeed, feedLinks, feedKind, FEED_GUESSES } from "../src/feedparse.js";

const MAX_TRIES = 4; // the page, its feed, and a couple of guesses

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
	if (feedKind(first.text) === "html") {
		const named = feedLinks(first.text, first.url);
		const guesses = FEED_GUESSES.map((g) => new URL(g, first.url).href);
		for (const u of [...named, ...guesses.filter((g) => !named.includes(g))]) {
			found = asFeed(await attempt(u));
			if (found) return { ...found, site: found.site || first.url };
			if (tries >= MAX_TRIES) break;
		}
	}
	throw new HttpError(404, "No feed found there");
}

export async function feedApi(request, env, url) {
	if (url.pathname !== "/api/feed") return null;
	if (request.method !== "GET") throw new HttpError(405, "GET only");
	return fetchFeed(url.searchParams.get("url"), env);
}
