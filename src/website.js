// Export as website: the notes marked `publish: true` as a static website,
// one .html page per note with relative links, so the folder works wherever
// it's put: dragged into Neocities, Netlify Drop or Cloudflare Pages, or
// opened from disk. Pages look like the notebook (its theme and font), read
// only. Nothing is fetched here: buildSite() plans the files and
// src/websiteview.js reads the attachments and zips them.
//
// What a page leaves out: properties, %% comments %%, block ids, tracked
// changes' comments, and dataview/base/query blocks. [[Links]] to published
// notes become links; links to anything else become plain words, so nothing
// private is named by its path. Pictures and PDFs it uses are copied into
// files/; audio and video only when asked (a free Neocities site won't take
// them). A published note named Home or Index (at the top of the notebook)
// becomes the front page's text, above the list of pages. A menu at the top
// links each top-level folder's own list of pages (folder/index.html), and
// each page ends with links to the pages before and after it in its folder.
//
// The sidebar (beside the text on wide screens, under it on phones) can hold
// a calendar of what was posted when, with a page per month under archive/,
// and support buttons (Ko-fi, Patreon, one link of the user's own). They're plain
// links in the site's colors: no embed scripts, so nothing third-party loads.

import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import { parseFrontmatter } from "./dvpage.js";
import { cleanNote } from "./compile.js";
import { resolveNote } from "./links.js";
import { resolveAttachment, attachmentKind } from "./attachments.js";

export const SITE_FILES = { style: "style.css", index: "index.html", missing: "not_found.html", archive: "archive/index.html" };

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const first = (v) => (Array.isArray(v) ? v.find((x) => x != null && String(x).trim() !== "") : v);
const yes = (v) => v === true || /^(true|yes)$/i.test(String(first(v) ?? "").trim());

// Whether a note goes on the website: publish: true, not a draft, and not in
// one of wr1t3r's own "_" folders.
export function isPublished(path, text) {
	if (path.split("/").some((seg) => seg.startsWith("_"))) return false;
	const p = parseFrontmatter(text);
	return yes(p.publish) && !yes(p.draft);
}

// "Café Notes!" -> "cafe-notes": safe in any host's file names and URLs.
export function slug(s, fallback = "page") {
	const out = String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
		.replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
	return out || fallback;
}

// The vault path without the notes' folder ("content/") and the extension.
const sitePath = (path) => path.replace(/^content\//, "").replace(/\.(md|board|base)$/i, "");

// Each note's page file: "Essays/On Walking.md" -> "essays/on-walking.html".
// Two notes that come out the same get -2, -3...; nothing takes the front
// page's or the 404 page's name.
export function pageFiles(paths) {
	const taken = new Set([SITE_FILES.index, SITE_FILES.missing]);
	const out = new Map();
	for (const path of [...paths].sort()) {
		const parts = sitePath(path).split("/");
		const base = parts.map((p, i) => slug(p, i < parts.length - 1 ? "folder" : "page")).join("/");
		let name = base + ".html", n = 1;
		// index.html in a folder is that folder's list of pages.
		while (taken.has(name) || /(^|\/)index\.html$/.test(name)) name = `${base}-${++n}.html`;
		taken.add(name);
		out.set(path, name);
	}
	return out;
}

// The URL from page `from` to file `to`, both site paths ("a/b.html").
export function relativeURL(from, to) {
	const a = from.split("/").slice(0, -1), b = to.split("/");
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
	return [...a.slice(i).map(() => ".."), ...b.slice(i)].map(encodeURIComponent).join("/");
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;
const SKIP_FENCE = /^(dataview|dataviewjs|base|bases|query|tasks|board)$/i;

// A heading's id: its words, lowercased and joined with "-".
export const headingId = (text) => slug(text, "section");

function parser(ctx) {
	const md = new MarkdownIt({ html: true, linkify: true, typographer: true }).use(footnote);
	// Links and pictures in markdown form: to notes and vault files, made relative.
	const link = md.renderer.rules.link_open || ((t, i, o, e, self) => self.renderToken(t, i, o));
	md.renderer.rules.link_open = (tokens, i, options, env, self) => {
		const t = tokens[i];
		const href = t.attrGet("href") || "";
		if (href.startsWith(DONE)) t.attrSet("href", href.slice(DONE.length) || "#");
		else if (/^[a-z][\w+.-]*:/i.test(href) || href.startsWith("//")) {
			if (/^https?:/i.test(href)) { t.attrSet("rel", "noopener"); }
		} else if (!href.startsWith("#")) {
			const url = ctx.hrefFor(href);
			if (url == null) { t.meta = { dropped: true }; return ""; }
			t.attrSet("href", url);
		}
		return link(tokens, i, options, env, self);
	};
	const linkClose = md.renderer.rules.link_close || ((t, i, o, e, self) => self.renderToken(t, i, o));
	md.renderer.rules.link_close = (tokens, i, options, env, self) => {
		// Close only what was opened: find this close's open.
		let depth = 0;
		for (let j = i - 1; j >= 0; j--) {
			if (tokens[j].type === "link_close") depth++;
			else if (tokens[j].type === "link_open") { if (depth-- === 0) return tokens[j].meta?.dropped ? "" : linkClose(tokens, i, options, env, self); }
		}
		return linkClose(tokens, i, options, env, self);
	};
	const image = md.renderer.rules.image;
	md.renderer.rules.image = (tokens, i, options, env, self) => {
		const t = tokens[i];
		const src = t.attrGet("src") || "";
		if (src.startsWith(DONE)) t.attrSet("src", src.slice(DONE.length));
		else if (!/^([a-z][\w+.-]*:|\/\/)/i.test(src)) {
			const url = ctx.fileFor(src);
			if (url == null) return "";
			t.attrSet("src", url);
		} else if (!/^(https?|data):/i.test(src)) return "";
		t.attrSet("loading", "lazy");
		return image(tokens, i, options, env, self);
	};
	// Heading ids, so [[Note#Heading]] lands on it.
	md.core.ruler.push("heading_ids", (state) => {
		const seen = new Map();
		for (let i = 0; i < state.tokens.length; i++) {
			const t = state.tokens[i];
			if (t.type !== "heading_open") continue;
			const id = headingId(state.tokens[i + 1].content);
			const n = (seen.get(id) || 0) + 1;
			seen.set(id, n);
			t.attrSet("id", n > 1 ? `${id}-${n}` : id);
		}
	});
	// Callouts: > [!note] Title becomes a box with its title.
	md.core.ruler.push("callouts", (state) => {
		const tokens = state.tokens;
		for (let i = 0; i < tokens.length; i++) {
			if (tokens[i].type !== "blockquote_open" || tokens[i + 1]?.type !== "paragraph_open") continue;
			const inline = tokens[i + 2];
			const m = /^\[!([\w-]+)\][+-]?[ \t]*([^\n]*)/.exec(inline.content);
			if (!m) continue;
			const type = m[1].toLowerCase();
			const open = tokens[i], title = (m[2] || type[0].toUpperCase() + type.slice(1)).trim();
			open.tag = "div";
			open.attrSet("class", `callout callout-${slug(type, "note")}`);
			for (let d = 0, j = i + 1; j < tokens.length; j++) {
				if (tokens[j].type === "blockquote_open") d++;
				else if (tokens[j].type === "blockquote_close") { if (d-- === 0) { tokens[j].tag = "div"; break; } }
			}
			// The title line comes out of the first paragraph.
			const cut = inline.children.findIndex((c) => c.type === "softbreak" || c.type === "hardbreak");
			const head = new state.Token("html_block", "", 0);
			head.content = `<p class="callout-title">${esc(title)}</p>\n`;
			if (cut < 0) {
				tokens.splice(i + 1, 3, head); // the paragraph was only the title
			} else {
				inline.children = inline.children.slice(cut + 1);
				inline.content = inline.content.slice(inline.content.indexOf("\n") + 1);
				tokens.splice(i + 1, 0, head);
			}
		}
	});
	return md;
}

// The note's text as page markdown: [[links]], ![[embeds]], highlights and
// task boxes in their web form, and the blocks only wr1t3r can draw gone.
// ctx: { pageFor(name, wiki) -> url|null, fileFor(name) -> url|null, kindOf(name) }
export function webMarkdown(text, ctx) {
	const out = [];
	let fence = null, skip = false;
	for (const line of cleanNote(text).split("\n")) {
		const f = line.match(/^\s*(`{3,}|~{3,})\s*([\w-]*)/);
		if (f && (!fence || (f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length).trim()))) {
			if (!fence) { fence = f[1]; skip = SKIP_FENCE.test(f[2]); if (!skip) out.push(line); }
			else { if (!skip) out.push(line); fence = null; skip = false; }
			continue;
		}
		if (fence) { if (!skip) out.push(line); continue; }
		out.push(webLine(line, ctx));
	}
	return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// Links webLine has already resolved carry this mark, so the renderer leaves them be.
const DONE = "wr1t3r-site:";
const mdURL = (url) => `<${DONE}${url.replace(/[<>]/g, encodeURIComponent)}>`;
const mdText = (s) => s.replace(/([\\[\]*_`])/g, "\\$1");

function webLine(line, ctx) {
	// Keep `inline code` as is: swap it out first.
	const codes = [];
	let t = line.replace(/(`+)[^`]+?\1/g, (m) => `\u0000${codes.push(m) - 1}\u0000`);
	t = t.replace(/!\[\[([^\]]+)\]\]/g, (_, inner) => {
		const [target, alias = ""] = inner.split("|");
		const name = target.split("#")[0].trim();
		const kind = ctx.kindOf(name);
		if (kind) {
			const url = ctx.fileFor(name);
			if (url == null) return "";
			const label = esc(/^\d+(x\d+)?$/.test(alias.trim()) ? "" : alias.trim());
			if (kind === "image") {
				const w = /^(\d+)(?:x(\d+))?$/.exec(alias.trim());
				return w ? `<img src="${esc(url)}" alt="" width="${w[1]}" loading="lazy">` : `![${mdText(alias.trim())}](${mdURL(url)})`;
			}
			if (kind === "audio") return `<audio controls preload="none" src="${esc(url)}"></audio>`;
			if (kind === "video") return `<video controls preload="none" src="${esc(url)}"></video>`;
			return `[${mdText(label || name.split("/").pop())}](${mdURL(url)})`;
		}
		// An embedded note: a link to its page, when it has one.
		const url = ctx.pageFor(target.trim(), true);
		const word = alias.trim() || name.split("/").pop();
		return url == null ? "" : `[${mdText(word)}](${mdURL(url)})`;
	});
	t = t.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
		const [target, alias] = inner.split("|");
		const [note, heading = ""] = target.split("#");
		const word = (alias ?? "").trim() || note.trim().split("/").pop().replace(/\.md$/i, "") || heading.replace(/^\^/, "").trim();
		const url = ctx.pageFor(target.trim(), true);
		return url == null ? mdText(word) : `[${mdText(word)}](${mdURL(url)})`;
	});
	t = t
		.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]\s/, (_, lead, x) => `${lead}<input type="checkbox" disabled${x === " " ? "" : " checked"}> `)
		.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
	return t.replace(/\u0000(\d+)\u0000/g, (_, n) => codes[n]);
}

// What one page shows: { title, date, tags, cover, banner, description }.
export function pageInfo(path, text) {
	const p = parseFrontmatter(text);
	const s = (v) => { const x = first(v); return x == null ? "" : String(x).trim(); };
	const date = /^(\d{4}-\d{2}-\d{2})/.exec(s(p.date) || s(p.created) || s(p.finished))?.[1] || "";
	const tags = (Array.isArray(p.tags) ? p.tags : s(p.tags) ? s(p.tags).split(/[,\s]+/) : []).map((x) => String(x ?? "").replace(/^#/, "").trim()).filter(Boolean);
	return {
		title: s(p.title) || sitePath(path).split("/").pop(),
		date,
		tags,
		cover: s(p.cover) || s(p.coverImage) || s(p.image) || s(p.thumbnail),
		banner: s(p.banner),
		description: s(p.description) || s(p.summary),
	};
}

const IMG_REF = /^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$|^!?\[[^\]]*\]\(<?([^)>]+)>?\)$/;

// A property's picture: a web address, or a vault file the site copies.
function pictureURL(value, ctx) {
	const v = String(value || "").trim();
	if (!v) return null;
	if (/^https?:\/\//i.test(v)) return v;
	const m = IMG_REF.exec(v);
	const name = m ? (m[1] || m[2]).trim() : v;
	return ctx.kindOf(name) === "image" ? ctx.fileFor(name) : null;
}

// Each kind of file the site may carry; audio and video only when asked.
export function allowedKind(kind, { media = false } = {}) {
	return kind === "image" || kind === "pdf" || (media && (kind === "audio" || kind === "video"));
}

// The whole site as a plan: { files: Map(sitePath -> string | { attachment:
// vaultPath }), pages: [{ path, file, title }], skipped: [vaultPath] }.
// notes: [{ path, text }] (every note; only published ones get pages),
// attachments: every vault file's path. opts: { title, css, footer, media }.
export function buildSite(notes, attachments, opts = {}) {
	const title = String(opts.title || "").trim() || "My notebook";
	const allPaths = notes.map((n) => n.path);
	const published = notes.filter((n) => isPublished(n.path, n.text));
	const files = pageFiles(published.map((n) => n.path));
	const front = published.find((n) => /^(content\/)?(home|index)\.md$/i.test(n.path));
	const copies = new Map(); // vault path -> site path
	const used = new Set();
	const skipped = new Set();
	const fileOf = (vaultPath) => {
		if (!copies.has(vaultPath)) {
			const name = vaultPath.split("/").pop();
			const dot = name.lastIndexOf(".");
			const base = slug(dot > 0 ? name.slice(0, dot) : name, "file"), ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
			let out = `files/${base}.${ext}`, n = 1;
			while (used.has(out)) out = `files/${base}-${++n}.${ext}`;
			used.add(out);
			copies.set(vaultPath, out);
		}
		return copies.get(vaultPath);
	};

	const out = new Map();
	const pages = [];
	const support = supportBox(opts.support);
	// Pages are written last, once every page's date is known for the calendar.
	const pending = [];
	const page = (site, from, info, body) => pending.push({ site, info, body });
	const ctxFor = (from, site) => ({
		kindOf: (name) => (IMAGE.test(name) || /\.(pdf|mp3|m4a|wav|ogg|flac|mp4|webm|mov)$/i.test(name) ? attachmentKind(name) || (IMAGE.test(name) ? "image" : null) : null),
		fileFor(name) {
			let n = String(name || "");
			try { n = decodeURIComponent(n); } catch {}
			const p = resolveAttachment(n, from, attachments);
			if (!p) return null;
			if (!allowedKind(attachmentKind(p), opts)) { skipped.add(p); return null; }
			return relativeURL(site, fileOf(p));
		},
		pageFor(target, wiki) {
			const [note, heading = ""] = target.split("#");
			const p = note.trim() ? resolveNote({ note: note.trim(), wiki }, from, allPaths) : from;
			const file = p && (p === front?.path ? SITE_FILES.index : files.get(p));
			if (!file) return null;
			return (file === site ? "" : relativeURL(site, file)) + (heading ? "#" + (heading.startsWith("^") ? "" : headingId(heading)) : "") || "#";
		},
		hrefFor(href) {
			let h = href;
			try { h = decodeURIComponent(h); } catch {}
			const [note, heading = ""] = h.split("#");
			if (/\.(md|board|base)$/i.test(note) || !/\.[a-z0-9]{2,5}$/i.test(note)) return this.pageFor(note + (heading ? "#" + heading : ""), false);
			return this.fileFor(note);
		},
	});
	const render = (n, site) => {
		const ctx = ctxFor(n.path, site);
		const info = pageInfo(n.path, n.text);
		let md = webMarkdown(n.text, ctx);
		// The note's own # title would repeat the page's.
		const h1 = md.match(/^#[ \t]+(.+?)[ \t#]*$/m);
		if (h1 && h1[1].trim() === info.title && !md.slice(0, h1.index).trim()) md = md.slice(h1.index + h1[0].length).replace(/^\n+/, "");
		return { info: { ...info, cover: pictureURL(info.cover, ctx), banner: pictureURL(info.banner, ctx) }, body: parser(ctx).render(md) };
	};

	for (const n of published) {
		if (n === front) continue;
		const site = files.get(n.path);
		const r = render(n, site);
		page(site, n.path, r.info, r.body);
		pages.push({ path: n.path, file: site, title: r.info.title, date: r.info.date, folder: sitePath(n.path).split("/").slice(0, -1).join("/") });
	}

	// The front page: Home's text, then every page by folder, newest first.
	const lead = front ? render(front, SITE_FILES.index) : null;
	const newest = (a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title);
	// Pages grouped by folder (under `under`, whose name is left off), newest first.
	const listOf = (site, ps, under = "") => {
		const groups = new Map();
		for (const p of [...ps].sort(newest)) {
			const f = under ? p.folder.slice(under.length).replace(/^\//, "") : p.folder;
			if (!groups.has(f)) groups.set(f, []);
			groups.get(f).push(p);
		}
		return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([folder, ps]) => [
			folder ? `<h2 class="folder">${esc(folder.split("/").join(" / "))}</h2>` : "",
			`<ul class="pages">`,
			...ps.map((p) => `<li><a href="${esc(relativeURL(site, p.file))}">${esc(p.title)}</a>${p.date ? ` <time datetime="${p.date}">${esc(longDate(p.date))}</time>` : ""}</li>`),
			`</ul>`,
		].filter(Boolean).join("\n")).join("\n");
	};
	const list = listOf(SITE_FILES.index, pages);
	// Each top-level folder's list of pages.
	const tops = [...new Set(pages.map((p) => p.folder.split("/")[0]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
	// (archive/ and files/ are the site's own, so folders by those names list elsewhere)
	const topFile = (f) => { const d = slug(f, "folder"); return `${/^(archive|files)$/.test(d) ? d + "-2" : d}/index.html`; };
	for (const f of tops) page(topFile(f), "", { title: f, tags: [], date: "" }, `<nav class="contents">\n${listOf(topFile(f), pages.filter((p) => p.folder === f || p.folder.startsWith(f + "/")), f)}\n</nav>`);
	// Previous and next within a folder, in the lists' order.
	const pagerOf = new Map();
	for (const f of new Set(pages.map((p) => p.folder))) {
		const ps = pages.filter((p) => p.folder === f).sort(newest);
		ps.forEach((p, i) => pagerOf.set(p.file, { prev: ps[i - 1], next: ps[i + 1] }));
	}
	page(SITE_FILES.index, front?.path ?? "", { title: lead?.info.title || title, tags: [], date: "", cover: lead?.info.cover, banner: lead?.info.banner, description: lead?.info.description }, (lead?.body || "") + (pages.length ? `<nav class="contents" aria-label="Pages">\n${list}\n</nav>` : `<p class="empty">Nothing published yet.</p>`));
	if (front) pages.unshift({ path: front.path, file: SITE_FILES.index, title: lead.info.title, date: lead.info.date, folder: "" });
	page(SITE_FILES.missing, "", { title: "Page not found", tags: [], date: "" }, `<p>There's no page here. It may have been moved or taken down.</p>\n<p><a href="/">Go to the front page</a></p>`);

	// The calendar: a page per month with something posted, and an index of months.
	const byMonth = new Map();
	if (opts.calendar) {
		for (const p of pages) if (p.date && p.file !== SITE_FILES.index) {
			const m = p.date.slice(0, 7);
			if (!byMonth.has(m)) byMonth.set(m, []);
			byMonth.get(m).push(p);
		}
	}
	const months = [...byMonth.keys()].sort();
	const monthFile = (m) => `archive/${m}.html`;
	for (const m of months) {
		const site = monthFile(m);
		const days = new Map();
		for (const p of byMonth.get(m).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))) {
			if (!days.has(p.date)) days.set(p.date, []);
			days.get(p.date).push(p);
		}
		const body = [...days].map(([d, ps]) => `<h2 id="d-${d.slice(8)}">${esc(longDate(d))}</h2>\n<ul class="pages">\n${ps.map((p) => `<li><a href="${esc(relativeURL(site, p.file))}">${esc(p.title)}</a></li>`).join("\n")}\n</ul>`).join("\n");
		page(site, "", { title: monthName(m), tags: [], date: "" }, `<nav class="contents archive">\n${body}\n</nav>`);
	}
	if (months.length) {
		const site = SITE_FILES.archive;
		const years = [...new Set(months.map((m) => m.slice(0, 4)))].sort().reverse();
		const body = years.map((y) => `<h2 class="folder">${y}</h2>\n<ul class="pages">\n${months.filter((m) => m.startsWith(y)).reverse().map((m) => `<li><a href="${esc(relativeURL(site, monthFile(m)))}">${esc(monthName(m))}</a> <span class="count">${byMonth.get(m).length}</span></li>`).join("\n")}\n</ul>`).join("\n");
		page(site, "", { title: "Archive", tags: [], date: "" }, `<nav class="contents">\n${body}\n</nav>`);
	}
	// Each page's calendar shows its own month (or the month it lists), else the latest.
	const calendarFor = (site, info) => {
		if (!months.length) return "";
		const own = /^archive\/(\d{4}-\d{2})\.html$/.exec(site)?.[1] || info.date?.slice(0, 7);
		const m = months.includes(own) ? own : months[months.length - 1];
		return calendarBox(site, m, byMonth.get(m), months, monthFile);
	};
	// The logo: a picture from the notebook, beside (or instead of) the title.
	const logo = opts.logo && attachments.includes(opts.logo) && attachmentKind(opts.logo) === "image" ? fileOf(opts.logo) : null;
	const menuItems = [...tops.map((f) => ({ file: topFile(f), label: f })), ...(months.length ? [{ file: SITE_FILES.archive, label: "Archive" }] : [])];
	const menuFor = (site) => (menuItems.length < 1 ? "" : `<nav class="menu" aria-label="Sections">${menuItems.map((m) => `<a href="${esc(relativeURL(site, m.file))}"${site === m.file || (m.file !== SITE_FILES.archive && site.startsWith(m.file.slice(0, -"index.html".length))) || (m.file === SITE_FILES.archive && site.startsWith("archive/")) ? ' aria-current="page"' : ""}>${esc(m.label)}</a>`).join("")}</nav>`);
	const pagerFor = (site) => {
		const pn = pagerOf.get(site);
		if (!pn || (!pn.prev && !pn.next)) return "";
		const a = (p, cls, word) => (p ? `<a class="${cls}" href="${esc(relativeURL(site, p.file))}"><span>${word}</span>${esc(p.title)}</a>` : `<span class="${cls}"></span>`);
		return `<nav class="pager" aria-label="More in this folder">${a(pn.prev, "prev", "Previous")}${a(pn.next, "next", "Next")}</nav>\n`;
	};
	for (const { site, info, body } of pending) {
		const side = calendarFor(site, info) + support;
		out.set(site, html({ ...info, body: body + pagerFor(site), menu: menuFor(site), siteTitle: title, home: relativeURL(site, SITE_FILES.index), css: relativeURL(site, SITE_FILES.style), footer: opts.footer, side, logo: logo && relativeURL(site, logo), logoOnly: !!(logo && opts.logoOnly), isIndex: site === SITE_FILES.index }));
	}
	out.set(SITE_FILES.style, (opts.css || "") + SITE_CSS);
	for (const [vault, site] of copies) out.set(site, { attachment: vault });
	return { files: out, pages, skipped: [...skipped].sort(), title };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const longDate = (d) => { const [y, m, day] = d.split("-").map(Number); return `${MONTHS[m - 1]} ${day}, ${y}`; };

// The support box's links, from { kofi, patreon, label, url }: a Ko-fi or
// Patreon name or address, and any https link with its words. "" for none.
export function supportLinks(s = {}) {
	const name = (v, host) => {
		const x = String(v || "").trim().replace(/^@/, "");
		if (!x) return null;
		const m = new RegExp(`^(?:https?://)?(?:www\\.)?${host.replace(".", "\\.")}/([\\w.-]+)`, "i").exec(x);
		const n = m ? m[1] : /^[\w.-]+$/.test(x) ? x : null;
		return n && `https://${host}/${n}`;
	};
	const out = [];
	const kofi = name(s.kofi, "ko-fi.com");
	if (kofi) out.push({ kind: "kofi", url: kofi, text: "Buy me a coffee on Ko-fi" });
	const patreon = name(s.patreon, "patreon.com");
	if (patreon) out.push({ kind: "patreon", url: patreon, text: "Become a patron on Patreon" });
	const url = String(s.url || "").trim();
	if (/^https:\/\/[^\s"<>]+$/i.test(url)) out.push({ kind: "link", url, text: String(s.label || "").trim() || "Support my work" });
	return out;
}

// A month's calendar: each day with a post links to it (to the month's page
// when there are several), with the months before and after a click away.
function calendarBox(site, month, posts, months, monthFile) {
	const [y, m] = month.split("-").map(Number);
	const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
	const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
	const onDay = new Map();
	for (const p of posts) { const d = Number(p.date.slice(8)); onDay.set(d, [...(onDay.get(d) || []), p]); }
	const i = months.indexOf(month);
	const link = (mm, label, cls) => (mm ? `<a class="${cls}" href="${esc(relativeURL(site, monthFile(mm)))}" aria-label="${esc(monthName(mm))}">${label}</a>` : `<span class="${cls}"></span>`);
	const cells = [...Array(first).fill("<td></td>")];
	for (let d = 1; d <= length; d++) {
		const ps = onDay.get(d);
		const href = ps && (ps.length === 1 ? relativeURL(site, ps[0].file) : relativeURL(site, monthFile(month)) + `#d-${String(d).padStart(2, "0")}`);
		cells.push(ps ? `<td class="on"><a href="${esc(href)}" title="${esc(ps.map((p) => p.title).join(", "))}">${d}</a></td>` : `<td>${d}</td>`);
	}
	while (cells.length % 7) cells.push("<td></td>");
	const rows = [];
	for (let r = 0; r < cells.length; r += 7) rows.push(`<tr>${cells.slice(r, r + 7).join("")}</tr>`);
	return `<section class="cal" aria-label="Calendar">
<div class="cal-head">${link(months[i - 1], "‹", "cal-prev")}<a class="cal-month" href="${esc(relativeURL(site, monthFile(month)))}">${esc(monthName(month))}</a>${link(months[i + 1], "›", "cal-next")}</div>
<table><thead><tr>${["S", "M", "T", "W", "T", "F", "S"].map((d) => `<th>${d}</th>`).join("")}</tr></thead>
<tbody>${rows.join("")}</tbody></table>
<a class="cal-all" href="${esc(relativeURL(site, SITE_FILES.archive))}">All months</a>
</section>
`;
}

function supportBox(s) {
	const links = supportLinks(s);
	if (!links.length) return "";
	const heading = String(s?.heading || "").trim() || "Support my work";
	return `<section class="support" aria-label="${esc(heading)}">\n<h2>${esc(heading)}</h2>\n${String(s?.note || "").trim() ? `<p>${esc(s.note.trim())}</p>\n` : ""}${links.map((l) => `<a class="support-${l.kind}" href="${esc(l.url)}" rel="noopener">${esc(l.text)}</a>`).join("\n")}\n</section>\n`;
}

function html({ title, date, tags, cover, banner, description, body, siteTitle, home, css, footer, side, menu, logo, logoOnly, isIndex }) {
	const pageTitle = isIndex || title === siteTitle ? siteTitle : `${title} · ${siteTitle}`;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
${description ? `<meta name="description" content="${esc(description)}">\n` : ""}<meta property="og:title" content="${esc(title)}">
<link rel="stylesheet" href="${esc(css)}">
${logo ? `<link rel="icon" href="${esc(logo)}">\n` : ""}
</head>
<body>
<header class="site"><a class="home" href="${esc(home)}">${logo ? `<img class="logo" src="${esc(logo)}" alt="${logoOnly ? esc(siteTitle) : ""}">` : ""}${logoOnly ? "" : `<span>${esc(siteTitle)}</span>`}</a>${menu || ""}</header>
${banner ? `<div class="banner"><img src="${esc(banner)}" alt=""></div>\n` : ""}<main${side ? ' class="with-side"' : ""}>
<article>
<h1>${esc(title)}</h1>
${date || tags.length ? `<p class="meta">${date ? `<time datetime="${date}">${esc(longDate(date))}</time>` : ""}${tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</p>\n` : ""}${cover ? `<img class="cover" src="${esc(cover)}" alt="">\n` : ""}${body}
</article>
${side ? `<aside class="side">\n${side}</aside>\n` : ""}</main>
${footer ? `<footer class="site">Made with <a href="https://wr1t3r.app">wr1t3r</a></footer>\n` : ""}</body>
</html>
`;
}

// The site's own styles, on top of the theme's colors (--bg, --fg...).
export const SITE_CSS = `
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 19px/1.65 var(--editor-font, var(--serif)); }
a { color: var(--link, var(--accent)); }
header.site, footer.site { max-width: 42rem; margin: 0 auto; padding: 18px 20px; font: 600 15px/1.4 var(--sans); }
header.site { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 20px; }
header.site a { color: var(--fg); text-decoration: none; }
header.site .home { margin-right: auto; display: inline-flex; align-items: center; gap: 10px; }
header.site .logo { height: 36px; width: auto; max-width: 200px; object-fit: contain; display: block; }
.menu { display: flex; flex-wrap: wrap; gap: 4px 16px; font-weight: normal; }
.menu a { color: var(--muted); }
.menu a:hover, .menu a[aria-current] { color: var(--fg); }
.menu a[aria-current] { text-decoration: underline; text-underline-offset: 4px; }
.pager { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 3em 0 0; padding-top: 1.2em; border-top: 1px solid var(--line); font: 15px/1.4 var(--sans); }
.pager a { text-decoration: none; color: var(--fg); }
.pager a span { display: block; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
.pager .next { text-align: right; }
footer.site { font-weight: normal; color: var(--muted); border-top: 1px solid var(--line); margin-top: 3em; }
footer.site a { color: var(--muted); }
main { max-width: 42rem; margin: 0 auto; padding: 0 20px 4em; }
.banner img { display: block; width: 100%; max-height: 280px; object-fit: cover; }
h1, h2, h3, h4, h5, h6 { color: var(--heading, var(--fg)); line-height: 1.25; margin: 1.6em 0 0.6em; }
h1 { font-size: 2em; margin-top: 0.6em; }
.meta { color: var(--muted); font: 14px/1.5 var(--sans); display: flex; flex-wrap: wrap; gap: 6px 12px; margin: -0.4em 0 1.4em; }
.tag { color: var(--muted); }
img { max-width: 100%; height: auto; }
img.cover { display: block; max-width: min(240px, 60%); border-radius: 6px; margin: 0 0 1.4em; }
audio, video { display: block; width: 100%; margin: 1em 0; }
blockquote { margin: 1em 0; padding: 0 0 0 1em; border-left: 3px solid var(--line); color: var(--muted); }
mark { background: var(--hl); color: inherit; }
code { font: 0.85em var(--mono); background: var(--code-bg); border-radius: 3px; padding: 0.1em 0.3em; }
pre { background: var(--code-bg); padding: 0.8em 1em; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; }
hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
table { border-collapse: collapse; display: block; overflow-x: auto; margin: 1em 0; font-size: 0.9em; }
th, td { border: 1px solid var(--line); padding: 0.35em 0.7em; text-align: left; vertical-align: top; }
li:has(> input[type=checkbox]) { list-style: none; margin-left: -1.3em; }
li > input[type=checkbox] { margin: 0 0.5em 0 0; }
.callout { border: 1px solid var(--line); border-left: 4px solid var(--accent); background: var(--card); border-radius: 8px; padding: 0.6em 1em; margin: 1em 0; }
.callout > :last-child { margin-bottom: 0; }
.callout-title { font: 600 0.9em/1.4 var(--sans); margin: 0.2em 0 0.4em; }
.callout-warning, .callout-caution, .callout-attention { border-left-color: var(--f2); }
.callout-danger, .callout-error, .callout-bug, .callout-failure { border-left-color: var(--bad); }
.callout-tip, .callout-success, .callout-check, .callout-done { border-left-color: var(--f4); }
.callout-quote, .callout-cite { border-left-color: var(--muted); }
.footnotes { font-size: 0.85em; color: var(--muted); }
.footnotes-sep { border: 0; border-top: 1px solid var(--line); width: 30%; margin: 3em 0 1em; }
.contents h2.folder, .contents.archive h2 { font: 600 13px/1.4 var(--sans); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 2em 0 0.4em; }
.contents ul.pages { list-style: none; padding: 0; margin: 0; }
.contents li { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--line); }
.contents li time { flex: none; color: var(--muted); font: 13px var(--sans); }
.empty { color: var(--muted); }
.side { margin: 3em 0 0; display: flex; flex-direction: column; gap: 16px; }
.side > section { font: 15px/1.5 var(--sans); background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.cal-head a { text-decoration: none; }
.cal-month { font-weight: 600; color: var(--fg); }
.cal-prev, .cal-next { width: 1.6em; text-align: center; font-size: 1.2em; line-height: 1; color: var(--muted); }
.cal table { width: 100%; table-layout: fixed; border-collapse: collapse; display: table; margin: 0; font-size: 13px; }
.cal th, .cal td { border: 0; padding: 1px 0; text-align: center; vertical-align: middle; height: 2em; line-height: 1.8em; }
.cal th { color: var(--muted); font-weight: 500; }
.cal td { color: var(--muted); }
.cal td.on a { display: block; width: 1.8em; height: 1.8em; line-height: 1.8em; margin: 0 auto; border-radius: 50%; background: var(--accent); color: var(--bg); text-decoration: none; font-weight: 600; }
.cal-all { display: block; margin-top: 8px; font-size: 13px; }
.contents .count { color: var(--muted); font: 13px var(--sans); }
.support h2 { font: 600 15px/1.4 var(--sans); margin: 0 0 6px; }
.support p { margin: 0 0 10px; color: var(--muted); }
.support a { display: block; text-align: center; text-decoration: none; font-weight: 600; padding: 9px 12px; border-radius: 999px; margin-top: 8px; color: var(--bg); background: var(--accent); }
.support a.support-kofi { background: #13c3ff; color: #102a35; }
.support a.support-patreon { background: #f96854; color: #fff; }
@media (min-width: 1000px) {
	main.with-side { max-width: calc(60rem + 40px); display: grid; grid-template-columns: minmax(0, 1fr) 15rem; gap: 0 3rem; }
	main.with-side .side { margin-top: 4.2em; position: sticky; top: 20px; align-self: start; }
	header.site:has(+ main.with-side), header.site:has(+ .banner + main.with-side), body:has(main.with-side) footer.site { max-width: calc(60rem + 40px); }
}
@media (max-width: 600px) { body { font-size: 17px; } h1 { font-size: 1.6em; } }
`;

// The theme's colors as plain CSS for the site: the chosen variant's :root
// variables from the app's stylesheet, and for Auto, the dark variant under
// prefers-color-scheme. appCss: src/style.css's text; font: the editor font.
export function themeCss(appCss, { light, dark = null, font = "" } = {}) {
	const block = (variant) => {
		const sel = variant ? `:root[data-theme=${variant}]` : ":root";
		const at = appCss.indexOf(sel + " {");
		if (at < 0) return null;
		return appCss.slice(at + sel.length + 2, appCss.indexOf("}", at)).trim();
	};
	const base = block(null) || "";
	const lightVars = light ? block(light) : null;
	let css = `:root {\n\t${base}\n${lightVars ? `\t${lightVars}\n` : ""}${font ? `\t--editor-font: ${font};\n` : ""}}\n`;
	const darkVars = dark ? block(dark) : null;
	if (darkVars) css += `@media (prefers-color-scheme: dark) {\n\t:root {\n\t\t${darkVars}\n\t}\n}\n`;
	return css;
}
