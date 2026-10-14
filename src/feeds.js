// Following other people's sites: the list of who you follow, kept as a note,
// when to read their feeds again, and what Neighbors shows. The feeds
// themselves are read by src/feedparse.js.
//
// The follow list is _wr1t3r/Following.md, its frontmatter a YAML list in the
// order sites were added:
//
//   ---
//   following:
//     - url: "https://someone.neocities.org/"    the site
//       feed: "https://someone.neocities.org/feed.xml"   its feed, once found
//       name: "Someone"                            what to call it
//       private: true                              (left off the neighbors page later)
//   ---
//
// Keys this file doesn't know are kept. Nothing else in the note is touched.

import { parseYaml } from "./bases.js";
import { siteUrl } from "./feedparse.js";

export { parseFeed, parseOpml, siteUrl, feedLinks } from "./feedparse.js";

export const FOLLOWING_FOLDER = "_wr1t3r/";
export const FOLLOWING_NAME = "Following.md";
export const FOLLOWING_BODY = "The sites you follow, for wr1t3r's Neighbors. Follow and unfollow from Neighbors, or edit the list above.\n";

// ---- The follow list ---------------------------------------------------------

// Where Following.md is: an existing _wr1t3r/Following.md anywhere, else one
// in the notes' folder (root: "content/" or "").
export function followingPath(paths, root) {
	const want = (FOLLOWING_FOLDER + FOLLOWING_NAME).toLowerCase();
	const found = paths.filter((p) => p.toLowerCase() === want || p.toLowerCase().endsWith("/" + want));
	return found.sort((a, b) => a.length - b.length)[0] || root + FOLLOWING_FOLDER + FOLLOWING_NAME;
}

function fence(lines) {
	if (!/^---\s*$/.test(lines[0] ?? "")) return null;
	for (let i = 1; i < lines.length; i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) return [0, i];
	return null;
}

// The follows in Following.md's text: [{ url, feed?, name?, private?, ... }].
export function readFollowing(text) {
	const lines = String(text || "").split("\n");
	const f = fence(lines);
	if (!f) return [];
	let y;
	try { y = parseYaml(lines.slice(f[0] + 1, f[1]).join("\n")); } catch { return []; }
	if (!y || !Array.isArray(y.following)) return [];
	return y.following
		.map((s) => (typeof s === "string" ? { url: s } : s))
		.filter((s) => s && typeof s === "object" && !Array.isArray(s) && siteUrl(s.url))
		.map((s) => ({ ...s, url: siteUrl(s.url) }));
}

const ORDER = ["url", "feed", "name", "private"];
const yamlValue = (v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));

// text with its following list replaced by list. The rest of the frontmatter
// and the body stay; a note without frontmatter gets some.
export function writeFollowing(text, list) {
	const block = list.length ? ["following:"] : ["following: []"];
	for (const s of list) {
		const keys = [...ORDER.filter((k) => k in s), ...Object.keys(s).filter((k) => !ORDER.includes(k))].filter((k) => s[k] != null && s[k] !== "" && s[k] !== false);
		keys.forEach((k, i) => block.push(`${i ? "    " : "  - "}${/^[\w-]+$/.test(k) ? k : JSON.stringify(k)}: ${yamlValue(s[k])}`));
	}
	const lines = String(text || "").split("\n");
	const f = fence(lines);
	if (!f) return ["---", ...block, "---", ...(text ? lines : [FOLLOWING_BODY])].join("\n");
	let at = -1;
	for (let i = f[0] + 1; i < f[1]; i++) if (/^following\s*:/.test(lines[i])) { at = i; break; }
	if (at < 0) { lines.splice(f[1], 0, ...block); return lines.join("\n"); }
	let end = at + 1;
	while (end < f[1] && (/^[ \t]/.test(lines[end]) || /^-(\s|$)/.test(lines[end]) || (!lines[end].trim() && end + 1 < f[1] && /^[ \t-]/.test(lines[end + 1])))) end++;
	lines.splice(at, end - at, ...block);
	return lines.join("\n");
}

// Whether two addresses are the same site: scheme, "www." and a closing
// slash don't count.
export const sameSite = (a, b) => {
	const k = (u) => String(u || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
	return !!a && !!b && k(a) === k(b);
};

// list with site added at the end, or list unchanged when it's there already
// (by its address or its feed's).
export function addFollow(list, site) {
	const url = siteUrl(site.url);
	if (!url) return list;
	if (list.some((s) => sameSite(s.url, url) || (site.feed && sameSite(s.feed, site.feed)))) return list;
	const out = { url };
	if (site.feed) out.feed = site.feed;
	if (site.name) out.name = String(site.name).trim();
	return [...list, out];
}

// ---- When to read the feeds again ---------------------------------------------

// The refresh times, as hours of the day: morning and evening.
export const REFRESH_HOURS = [7, 19];

// The latest refresh time at or before now (a Date, in local time).
export function lastSlot(now, hours = REFRESH_HOURS) {
	const hs = [...hours].sort((a, b) => a - b);
	const d = new Date(now);
	for (let i = hs.length - 1; i >= 0; i--) {
		const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hs[i]);
		if (s <= d) return s;
	}
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, hs[hs.length - 1]);
}

// Whether the feeds are due a read: never read, or last read before the most
// recent morning or evening time. last: ms since 1970, or null.
export const refreshDue = (last, now = new Date(), hours = REFRESH_HOURS) => !Number.isFinite(last) || last < lastSlot(now, hours).getTime();

// ---- What Neighbors shows -------------------------------------------------------

// Every followed site's posts in one list, newest first: [{ ...item, site,
// name }]. feeds: { [site url]: { title, items } } from the last read.
export function neighborsList(list, feeds, { max = 100 } = {}) {
	const out = [];
	for (const s of list) {
		const f = feeds[s.url];
		if (!f?.items) continue;
		for (const i of f.items) out.push({ ...i, site: s.url, name: s.name || f.title || hostOf(s.url) });
	}
	return out.sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, max);
}

export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return String(u || ""); } };

// Reads every followed site's feed, a few at a time, through fetchFeed(address)
// -> { feed, title, site, items } (the relay's answer), and with fetchSites,
// who each site reads (its blogroll: -> { sites }). Returns { feeds, list }:
// feeds as neighborsList takes them, with { error } for a site that couldn't
// be read (its last good posts kept from old) and reads: [{ url, feed, name }],
// and list with any newly found feed addresses filled in (the same list when
// none were).
export async function readFeeds(list, fetchFeed, { old = {}, at = Date.now(), together = 4, fetchSites = null } = {}) {
	const feeds = {};
	let next = list;
	const queue = [...list];
	const one = async () => {
		for (let s = queue.shift(); s; s = queue.shift()) {
			try {
				const f = await fetchFeed(s.feed || s.url);
				feeds[s.url] = { title: f.title || "", items: Array.isArray(f.items) ? f.items : [], at };
				if (f.feed && f.feed !== s.feed) next = next.map((x) => (x.url === s.url ? { ...x, feed: f.feed } : x));
			} catch (e) {
				feeds[s.url] = { ...(old[s.url] || { title: "", items: [] }), error: String(e?.message || e) };
			}
			if (!fetchSites) continue;
			try {
				const r = await fetchSites(s.url);
				feeds[s.url].reads = (r.sites || []).slice(0, 200).map((x) => ({ url: x.url, ...(x.feed ? { feed: x.feed } : {}), ...(x.name ? { name: x.name } : {}) }));
			} catch {
				if (old[s.url]?.reads) feeds[s.url].reads = old[s.url].reads;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(together, list.length) }, one));
	return { feeds, list: next };
}

// How many posts are newer than seen (ms since 1970).
export const newSince = (posts, seen) => posts.filter((p) => p.date && Date.parse(p.date) > (seen || 0)).length;

// "People your neighbors read": sites the sites you follow list as theirs,
// that you don't follow yet (nor your own), most-listed first:
// [{ url, feed, name, via: [names] }].
export function suggestions(list, feeds, { me = "", max = 12 } = {}) {
	const found = new Map();
	for (const s of list) {
		const f = feeds[s.url];
		const by = s.name || f?.title || hostOf(s.url);
		for (const r of f?.reads || []) {
			const url = siteUrl(r.url);
			if (!url || sameSite(url, me) || list.some((x) => sameSite(x.url, url) || (r.feed && sameSite(x.feed, r.feed)))) continue;
			const key = url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
			const had = found.get(key) || { url, feed: r.feed || "", name: r.name || "", via: [] };
			if (!had.via.includes(by)) had.via.push(by);
			if (!had.name && r.name) had.name = r.name;
			found.set(key, had);
		}
	}
	return [...found.values()].sort((a, b) => b.via.length - a.via.length || (a.name || a.url).localeCompare(b.name || b.url)).slice(0, max);
}

// Whether address is a page on the site at me ("https://you.neocities.org/").
export function onSite(address, me) {
	const k = (u) => String(u || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "");
	const root = k(me).replace(/\/*$/, "/");
	return !!me && (k(address) + "/").startsWith(root);
}

// Posts by the sites you follow that answer one of yours: neighborsList's
// posts with an inReplyTo on your site, newest first.
export const repliesTo = (posts, me) => posts.filter((p) => p.inReplyTo && onSite(p.inReplyTo, me));
