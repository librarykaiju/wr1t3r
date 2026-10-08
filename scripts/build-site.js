// Builds the wr1t3r.app pages (site/public/*.html) from the Markdown files in
// site/pages/, so the words on the site can be changed without touching HTML.
// `npm run build:site` runs it; `npm run deploy:site` runs it before deploying.
// site/pages/README.md explains the few rules the pages follow.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = join(root, "site/pages");
const PUBLIC = join(root, "site/public");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Width and height of a WebP or PNG in site/public, so pictures don't make the
// page jump as they load. Null for anything else or a missing file.
export function imageSize(src) {
	const file = join(PUBLIC, src.replace(/^\//, ""));
	if (!src.startsWith("/") || !existsSync(file)) return null;
	const b = readFileSync(file);
	if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
		const kind = b.toString("ascii", 12, 16);
		if (kind === "VP8X") return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
		if (kind === "VP8L") {
			const bits = b.readUInt32LE(21);
			return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
		}
		if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
	}
	if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
	return null;
}

// `key: value` lines between --- lines at the top of the file.
export function splitFrontmatter(text) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
	if (!m) return { meta: {}, body: text };
	const meta = {};
	for (const line of m[1].split(/\r?\n/)) {
		const kv = /^([\w-]+):\s*(.*)$/.exec(line);
		if (kv) meta[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
	}
	return { meta, body: text.slice(m[0].length) };
}

// A line of three or more dashes starts a section; a word after it is its name.
export function splitSections(body) {
	const sections = [{ name: "", lines: [] }];
	for (const line of body.split(/\r?\n/)) {
		const m = /^-{3,}[ \t]*([\w-]*)[ \t]*$/.exec(line);
		if (m) sections.push({ name: m[1], lines: [] });
		else sections.at(-1).lines.push(line);
	}
	return sections.map((s) => ({ name: s.name, text: s.lines.join("\n") })).filter((s) => s.name || s.text.trim());
}

export function renderPage(text, { size = imageSize } = {}) {
	const { meta, body } = splitFrontmatter(text);
	const home = !meta.page;
	const md = new MarkdownIt({ html: true });
	let images = 0;
	const img = (src, alt, cls = "shot") => {
		const d = size(src);
		const lazy = images++ ? ' loading="lazy"' : "";
		const c = cls ? ` class="${cls}${/phone/.test(src) ? " phone" : ""}"` : "";
		return `<img${c} src="${esc(src)}"${d ? ` width="${d.w}" height="${d.h}"` : ""} alt="${esc(alt)}"${lazy}>`;
	};
	md.renderer.rules.image = (tokens, i) => img(tokens[i].attrGet("src"), tokens[i].content);
	const buy = (a) => {
		if (a.attrGet("href") !== "buy") return false;
		a.attrSet("href", meta.buy || "#pricing");
		return true;
	};

	// The top-level pieces of a section: headings, paragraphs, lists and so on.
	const blocks = (src) => {
		const tokens = md.parse(src, {});
		const out = [];
		for (let i = 0; i < tokens.length; ) {
			let j = i;
			if (tokens[i].nesting === 1) {
				let depth = 0;
				do depth += tokens[j++].nesting; while (depth > 0);
			} else j++;
			out.push(describe(tokens.slice(i, j)));
			i = j;
		}
		return out;
	};
	const blank = (t) => (t.type === "text" && !t.content.trim()) || t.type === "softbreak";
	const describe = (tokens) => {
		const first = tokens[0];
		const b = { tokens, html: () => md.renderer.render(tokens, md.options, {}) };
		if (first.type === "heading_open") return { ...b, kind: "heading", level: +first.tag[1], inline: tokens[1] };
		if (first.type === "paragraph_open") {
			const kids = tokens[1].children.filter((t) => !blank(t));
			if (kids.length && kids.every((t) => t.type === "image")) return { ...b, kind: "images", images: kids };
			if (home && kids.length && kids[0].type === "link_open" && linksOnly(kids)) return { ...b, kind: "buttons", links: links(kids) };
			if (kids[0]?.type === "em_open" && kids.at(-1).type === "em_close") return { ...b, kind: "small", inner: tokens[1].children.slice(1, -1) };
			if (kids[0]?.type === "strong_open") return { ...b, kind: "lead-bold", kids };
			return { ...b, kind: "paragraph" };
		}
		if (first.type === "bullet_list_open") {
			const items = [];
			for (let k = 0; k < tokens.length; k++) if (tokens[k].type === "inline" && tokens[k].level === 3) items.push(tokens[k].children);
			if (items.length && items.every((c) => c[0]?.type === "image")) return { ...b, kind: "gallery", items };
		}
		return { ...b, kind: "other" };
	};
	const linksOnly = (kids) => {
		let depth = 0;
		for (const t of kids) {
			if (t.type === "link_open") depth++;
			else if (t.type === "link_close") depth--;
			else if (!depth) return false;
		}
		return true;
	};
	const links = (kids) => {
		const out = [];
		for (let k = 0; k < kids.length; k++) {
			if (kids[k].type !== "link_open") continue;
			const end = kids.findIndex((t, n) => n > k && t.type === "link_close");
			out.push({ open: kids[k], inner: kids.slice(k + 1, end) });
		}
		return out;
	};
	const inline = (children) => md.renderer.renderInline(children, md.options, {});
	const buttons = (b, wrap) => {
		const html = b.links.map(({ open, inner }, n) => {
			const isBuy = buy(open);
			const cls = ["button", n === 0 && "primary", isBuy && "buy"].filter(Boolean).join(" ");
			return `<a class="${cls}" href="${esc(open.attrGet("href"))}">${inline(inner)}</a>`;
		}).join("\n");
		return wrap ? `<p class="cta">\n${html}\n</p>\n` : html + "\n";
	};
	const media = (list) => {
		const tags = list.map((t) => img(t.attrGet("src"), t.content));
		if (tags.length === 1) return tags[0];
		const phones = list.every((t) => /phone/.test(t.attrGet("src")));
		return `<div class="${phones ? "phones" : "pair"}">\n${tags.join("\n")}\n</div>`;
	};
	const plain = (b, { lede = false, wide = false } = {}) => {
		if (b.kind === "heading" && home && b.level === 1) return `<h1>${inline(b.inline.children)}</h1>\n`;
		if (b.kind === "images") return b.images.map((t) => img(t.attrGet("src"), t.content, wide ? "shot wide" : "shot")).join("\n") + "\n";
		if (b.kind === "buttons") return buttons(b, true);
		if (b.kind === "small") return `<p class="small">${inline(b.inner)}</p>\n`;
		if (b.kind === "gallery") {
			const figs = b.items.map((c) => `<figure>${img(c[0].attrGet("src"), c[0].content, "")}<figcaption>${inline(c.slice(1)).trim()}</figcaption></figure>`);
			return `<div class="theme-grid">\n${figs.join("\n")}\n</div>\n`;
		}
		if (lede && (b.kind === "paragraph" || b.kind === "lead-bold")) return b.html().replace(/^<p>/, '<p class="lede">');
		return b.html();
	};

	const section = (s) => {
		const list = blocks(s.text);
		let out = "";
		for (let i = 0; i < list.length; i++) {
			const b = list[i];
			// A heading ending in "?" folds its answer away.
			if (b.kind === "heading" && b.level >= 3 && /\?\s*$/.test(b.inline.content)) {
				let j = i + 1;
				while (j < list.length && list[j].kind !== "heading") j++;
				out += `<details>\n<summary>${inline(b.inline.children)}</summary>\n${list.slice(i + 1, j).map((x) => plain(x)).join("")}</details>\n`;
				i = j - 1;
				continue;
			}
			// On the home page, a heading whose text ends with pictures puts them beside it.
			if (home && b.kind === "heading" && b.level >= 2) {
				let j = i + 1;
				while (j < list.length && list[j].kind !== "heading") j++;
				const part = list.slice(i + 1, j);
				let k = part.length;
				while (k > 0 && part[k - 1].kind === "images") k--;
				if (k < part.length) {
					const text = [b, ...part.slice(0, k)].map((x) => plain(x)).join("");
					out += `<div class="feature">\n<div>\n${text}</div>\n${media(part.slice(k).flatMap((x) => x.images))}\n</div>\n`;
					i = j - 1;
					continue;
				}
			}
			// A paragraph starting with a bold price ("**$20** once") makes the price card.
			if (b.kind === "lead-bold" && /^\s*[$€£]?\d/.test(b.kids[1]?.content || "")) {
				const kids = b.kids;
				const close = kids.findIndex((t) => t.type === "strong_close");
				let card = `<p class="price">${inline(kids.slice(1, close))} <span>${inline(kids.slice(close + 1)).trim()}</span></p>\n`;
				for (const x of list.slice(i + 1)) card += x.kind === "buttons" ? buttons(x, false) : plain(x);
				out += `<div class="price-card">\n${card}</div>\n`;
				break;
			}
			const afterTop = home && i > 0 && list[i - 1].kind === "heading" && list[i - 1].level <= 2 && i === 1;
			out += plain(b, { lede: afterTop, wide: home });
		}
		return out;
	};

	const named = (n) => splitSections(body).find((s) => s.name === n);
	const nav = named("menu");
	const navLinks = nav ? [...md.render(nav.text).matchAll(/<a [^>]*>.*?<\/a>/g)].map((m) => m[0]) : [];
	for (const n in navLinks) navLinks[n] = navLinks[n].replace('href="buy"', `href="${esc(meta.buy || "#pricing")}"`);
	const foot = named("footer");
	const main = splitSections(body)
		.filter((s) => s.name !== "menu" && s.name !== "footer")
		.map((s) => `<section${s.name ? ` id="${esc(s.name)}"` : ""}>\n${section(s)}</section>`)
		.join("\n\n");

	return `<!doctype html>
<!-- Made from site/pages by scripts/build-site.js. Edit the .md file, not this one. -->
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${esc(meta.title || "wr1t3r")}</title>
${meta.description ? `	<meta name="description" content="${esc(meta.description)}">\n` : ""}	<link rel="icon" href="/icon.svg">
	<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="top">
<a class="brand" href="/"><img src="/icon.svg" alt="" width="28" height="28"> wr1t3r</a>
${navLinks.length ? `<nav>\n${navLinks.join("\n")}\n</nav>\n` : ""}</header>

<main${meta.page ? ` class="${esc(meta.page)}"` : ""}>
${main}
</main>

${foot ? `<footer>\n${md.render(foot.text)}</footer>\n` : ""}</body>
</html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	for (const f of readdirSync(PAGES).filter((f) => f.endsWith(".md") && f !== "README.md")) {
		const out = f.replace(/\.md$/, ".html");
		writeFileSync(join(PUBLIC, out), renderPage(readFileSync(join(PAGES, f), "utf8")));
		console.log(`site/public/${out}`);
	}
}
