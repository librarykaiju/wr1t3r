// Whether a note goes on the website (src/website.js): publish: true and not
// a draft. Templates (which can hold publish: true for the notes made from
// them) and wr1t3r's own files never go. Its own module so the toolbar can
// show it without loading the site builder.

import { parseFrontmatter } from "./dvpage.js";
import { pagesUrl, parseRepo } from "./githubpublish.js";

// src/templates.js isTemplatePath and src/home.js isAppFile, without loading either.
const isTemplatePath = (path) => /(^|\/)_templates\//i.test(path);
const isAppFile = (path) => /(^|\/)_wr1t3r\//i.test(path);

const first = (v) => (Array.isArray(v) ? v.find((x) => x != null && String(x).trim() !== "") : v);
const yes = (v) => v === true || /^(true|yes)$/i.test(String(first(v) ?? "").trim());

export function isPublished(path, text) {
	if (!path || isTemplatePath(path) || isAppFile(path)) return false;
	const p = parseFrontmatter(text || "");
	return yes(p.publish) && !yes(p.draft);
}

// Why a note with publish: true still isn't on the site, or "".
export function notPublishedWhy(path, text) {
	if (!path) return "";
	if (isTemplatePath(path)) return "Templates are never published.";
	if (isAppFile(path)) return "wr1t3r's own files are never published.";
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
// given, else the Neocities site wr1t3r last published to, else GitHub Pages'
// for a site published there (not when GitHub sends it on to Neocities, whose
// address wr1t3r doesn't know then). "" when unknown.
export const siteOf = (s = {}) => siteAddress(s.address) || siteAddress(s.neoSite) || (!s.ghNeocities && parseRepo(s.ghRepo) ? pagesUrl(parseRepo(s.ghRepo)) : "") || "";
