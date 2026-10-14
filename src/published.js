// Whether a note goes on the website (src/website.js): publish: true, not a
// draft, and not in one of wr1t3r's own "_" folders. Its own module so the
// toolbar can show it without loading the site builder.

import { parseFrontmatter } from "./dvpage.js";
import { pagesUrl, parseRepo } from "./githubpublish.js";

const first = (v) => (Array.isArray(v) ? v.find((x) => x != null && String(x).trim() !== "") : v);
const yes = (v) => v === true || /^(true|yes)$/i.test(String(first(v) ?? "").trim());

export function isPublished(path, text) {
	if (!path || path.split("/").some((seg) => seg.startsWith("_"))) return false;
	const p = parseFrontmatter(text || "");
	return yes(p.publish) && !yes(p.draft);
}

// Why a note with publish: true still isn't on the site, or "".
export function notPublishedWhy(path, text) {
	if (!path) return "";
	if (path.split("/").some((seg) => seg.startsWith("_"))) return "Notes in folders starting with _ are never published.";
	return yes(parseFrontmatter(text || "").draft) ? "It has draft: true, so it stays off the site." : "";
}

// An http(s) address as given, or "".
export function webAddress(v) {
	const t = String(v ?? "").trim();
	if (!/^https?:\/\/[^\s"'<>]+$/i.test(t)) return "";
	try { return new URL(t).href; } catch { return ""; }
}

// The site's own address as "https://host/path/", or null: "you.neocities.org"
// gets https:// and a closing slash. Only web addresses, nothing with spaces.
export function siteAddress(v) {
	let t = String(v ?? "").trim();
	if (!t || /[\s"'<>]/.test(t)) return null;
	if (!/^[a-z][\w+.-]*:/i.test(t)) t = "https://" + t.replace(/^\/+/, "");
	try {
		const u = new URL(t);
		if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
		u.search = u.hash = "";
		return u.href.replace(/\/?$/, "/");
	} catch { return null; }
}

// Where the website lives, from the Export as website settings: the address
// given, else GitHub Pages' for a site published there (not when it goes on
// to Neocities, whose address wr1t3r doesn't know). "" when unknown.
export const siteOf = (s = {}) => siteAddress(s.address) || (!s.ghNeocities && parseRepo(s.ghRepo) ? pagesUrl(parseRepo(s.ghRepo)) : "") || "";
