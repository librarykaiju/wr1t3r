// Whether a note goes on the website (src/website.js): publish: true, not a
// draft, and not in one of wr1t3r's own "_" folders. Its own module so the
// toolbar can show it without loading the site builder.

import { parseFrontmatter } from "./dvpage.js";

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
