// Import from WordPress: the export file from Tools > Export (WXR, an .xml
// file). Posts and pages become notes with their title, date, tags,
// categories and address as properties. Pictures stay linked to the site,
// since most sites won't let another page download them.

import { frontmatter, uniquePath, fileName, xmlAll, xmlOne, xmlText, plural } from "./imports.js";

// WordPress keeps classic posts without <p>s: blank lines are paragraphs and
// single line breaks are <br>s (its wpautop). Block posts have them already.
export function autop(html) {
	if (/<p[\s>]/i.test(html) || !html.includes("\n")) return html;
	return html.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
		.map((p) => (/^<(h\d|ul|ol|blockquote|pre|table|div|figure|hr|!--)/i.test(p) ? p : `<p>${p.replace(/\n/g, "<br>\n")}</p>`)).join("\n");
}

// Shortcodes: [caption] keeps what's inside; the rest stay as text, and are reported.
export function shortcodes(html) {
	const left = new Set();
	const out = html.replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi, "$1").replace(/\[\/?([a-z][\w-]*)[^\]\n]*\]/gi, (all, name) => {
		if (/^(https?|mailto)$/i.test(name)) return all;
		left.add(name.toLowerCase());
		return all;
	});
	return { html: out, left: [...left] };
}

const KINDS = { post: "Posts/", page: "Pages/" };

// xml: the export's text. toMarkdown(html) -> markdown (src/convert.js in the page).
// -> { name, notes: [{ path, text }], skipped, plugins, remarks }
export function readWordPress(xml, toMarkdown) {
	const channel = xmlAll(xml, "channel")[0]?.inner;
	if (!channel || !/<wp:wxr_version>/i.test(xml)) throw new Error("That isn't a WordPress export. In WordPress, use Tools > Export and pick All content.");
	const name = xmlOne(channel.replace(/<item[\s>][\s\S]*$/i, ""), "title") || "WordPress";
	const notes = [], skipped = [], plugins = [];
	const taken = new Set();
	let attachments = 0, other = 0, comments = 0;
	for (const { inner } of xmlAll(channel, "item")) {
		const type = xmlOne(inner, "wp:post_type");
		if (type === "attachment") { attachments++; continue; }
		const folder = KINDS[type];
		const status = xmlOne(inner, "wp:status");
		if (!folder || status === "trash" || status === "auto-draft" || status === "inherit") { other++; continue; }
		comments += xmlAll(inner, "wp:comment").length;
		const title = xmlOne(inner, "title");
		const date = (xmlOne(inner, "wp:post_date") || xmlOne(inner, "pubDate")).slice(0, 10);
		const cats = xmlAll(inner, "category");
		const of = (domain) => [...new Set(cats.filter((c) => c.attrs.domain === domain).map((c) => xmlText(c.inner)))];
		const sc = shortcodes(autop(xmlText(xmlAll(inner, "content:encoded")[0]?.inner || "")));
		const body = sc.html.trim() ? toMarkdown(sc.html).trim() : "";
		const excerpt = xmlText(xmlAll(inner, "excerpt:encoded")[0]?.inner || "").replace(/<[^>]+>/g, "").trim();
		const path = uniquePath(taken, folder + fileName(title || xmlOne(inner, "wp:post_name"), "Untitled") + ".md");
		const text = frontmatter([
			["title", title],
			["date", /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== "0000-00-00" ? date : ""],
			["author", xmlOne(inner, "dc:creator")],
			["tags", of("post_tag")],
			["categories", of("category").filter((c) => c !== "Uncategorized")],
			["summary", excerpt],
			["url", status === "publish" ? xmlOne(inner, "link") : ""],
			["publish", status === "publish"],
		]) + (title ? `# ${title}\n\n` : "") + (body ? body + "\n" : "");
		notes.push({ path, text });
		if (sc.left.length) plugins.push({ path, features: sc.left.map((s) => `[${s}] shortcode`) });
	}
	if (!notes.length) throw new Error("That export has no posts or pages in it.");
	const remarks = [
		"Pictures in posts are still linked to where they are on the site, so they show while the site is up. Published posts and pages have `publish: true`; drafts and private ones have `publish: false`.",
		attachments && `The media library's ${plural(attachments, "file")} stayed on the site.`,
		comments && `${plural(comments, "comment")} ${comments === 1 ? "wasn't" : "weren't"} imported.`,
		other && `${plural(other, "other item")} (menus, reusable blocks, trashed posts and the like) ${other === 1 ? "wasn't" : "weren't"} imported.`,
	].filter(Boolean);
	return { name, notes, skipped, plugins, remarks };
}
