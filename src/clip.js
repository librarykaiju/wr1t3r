// The web clipper: takes a page (fetched through the Worker's /api/fetch, or
// carried in by the bookmarklet, see clippayload.js), finds the article with
// Mozilla's Readability (what Firefox Reader View uses) and turns it into a
// note with frontmatter in the style of Obsidian's Web Clipper. Loaded only
// when someone clips.

import { Readability } from "@mozilla/readability";
import { htmlToMarkdown } from "./convert.js";
import { yamlString } from "./convert-text.js";
import { token, AuthError } from "./api.js";

export async function clip(url) {
	const res = await fetch("/api/fetch?url=" + encodeURIComponent(url), {
		headers: { Authorization: "Bearer " + token() },
		cache: "no-store",
	});
	if (res.status === 401) throw new AuthError("Wrong or missing token");
	if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
	const type = res.headers.get("Content-Type") || "";
	if (!/html|xml/i.test(type)) throw new Error("That isn't a web page");
	return clipHtml(decode(new Uint8Array(await res.arrayBuffer()), type), res.headers.get("X-Final-URL") || url);
}

// The note for a page's HTML from finalUrl. selection: the HTML is only the
// part someone selected (the page's <head> still there for its details), so
// it's kept whole rather than searched for an article.
export function clipHtml(html, finalUrl, { selection = false } = {}) {
	const doc = new DOMParser().parseFromString(html, "text/html");
	// Make links and images absolute against the page's own address. (A <base>
	// element can't do it: wr1t3r's CSP forbids changing the base URI.)
	let pageBase = finalUrl;
	try { pageBase = new URL(doc.querySelector("base[href]")?.getAttribute("href") || "", finalUrl).href; } catch {}
	for (const [sel, attr] of [["a[href]", "href"], ["img[src]", "src"]]) {
		for (const el of doc.querySelectorAll(sel)) {
			try { el.setAttribute(attr, new URL(el.getAttribute(attr), pageBase).href); } catch { el.removeAttribute(attr); }
		}
	}
	doc.querySelectorAll("base, img[srcset], source[srcset]").forEach((el) => (el.tagName === "BASE" ? el.remove() : el.removeAttribute("srcset")));

	const meta = (sel) => doc.querySelector(sel)?.getAttribute("content")?.trim() || "";
	const published = meta('meta[property="article:published_time"]') || meta('meta[name="date"]') || doc.querySelector("time[datetime]")?.getAttribute("datetime") || "";
	const article = selection
		? { content: doc.body?.innerHTML || "", title: doc.title, byline: meta('meta[name="author"]'), excerpt: meta('meta[name="description"]') || meta('meta[property="og:description"]') }
		: new Readability(doc, { keepClasses: false }).parse();
	if (!article?.content?.trim()) throw new Error(selection ? "Nothing in the selection to clip" : "Couldn't find an article on that page");

	const body = new DOMParser().parseFromString(`<body>${article.content}</body>`, "text/html").body;
	const notes = [];
	const markdown = htmlToMarkdown(body, { keepImages: true, notes });
	const title = (article.title || doc.title || new URL(finalUrl).hostname).trim();

	const lines = ["---", `title: ${yamlString(title)}`, `source: ${yamlString(finalUrl)}`];
	if (article.byline) lines.push(`author: ${yamlString(article.byline.trim())}`);
	if (published && !isNaN(Date.parse(published))) lines.push(`published: ${new Date(published).toLocaleDateString("en-CA")}`);
	lines.push(`created: ${new Date().toLocaleDateString("en-CA")}`);
	if (article.excerpt) lines.push(`description: ${yamlString(article.excerpt.replace(/\s+/g, " ").trim())}`);
	lines.push("tags:", "  - clippings", "---", "");
	return { title, text: lines.join("\n") + "\n" + markdown, notes };
}

// The page's own charset (header, then <meta>), falling back to UTF-8.
function decode(bytes, type) {
	let charset = type.match(/charset=["']?([\w-]+)/i)?.[1];
	if (!charset) {
		const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
		charset = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
	}
	try {
		return new TextDecoder(charset || "utf-8").decode(bytes);
	} catch {
		return new TextDecoder("utf-8").decode(bytes);
	}
}
