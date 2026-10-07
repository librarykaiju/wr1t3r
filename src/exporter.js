// Compile's formats (loaded only when compiling): markdown to a book-like HTML
// page (also what's printed to PDF), and to a Word file. Both come from one
// markdown-it parse, so they agree on what the text is.

import { pageRule, pageTwips, pageSetup, marginParts } from "./pagelayout.js";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import { scriptKinds } from "./script.js";

const IMG = "wr1t3r-image:";

function parser() {
	return new MarkdownIt({ html: true, linkify: true, typographer: true }).use(footnote);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export const BOOK_CSS = `
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: #1b1b1b; }
main { max-width: 34em; margin: 3em auto 6em; padding: 0 1.2em; font: 12pt/1.65 Georgia, "Times New Roman", serif; }
h1, h2, h3, h4, h5, h6 { font-weight: normal; line-height: 1.25; margin: 2.2em 0 0.9em; break-after: avoid; }
h1 { font-size: 1.9em; text-align: center; }
h2 { font-size: 1.45em; text-align: center; }
h3 { font-size: 1.2em; }
h4, h5, h6 { font-size: 1em; font-style: italic; }
p { margin: 0 0 0.9em; }
hr { border: 0; margin: 1.6em 0; text-align: center; }
hr::after { content: "* * *"; letter-spacing: 0.4em; color: #555; }
blockquote { margin: 1em 0 1em 1.4em; padding-left: 1em; border-left: 2px solid #ccc; color: #3a3a3a; }
mark { background: #fff1a6; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
code { font: 0.9em/1.4 ui-monospace, Menlo, Consolas, monospace; }
pre { white-space: pre-wrap; background: #f5f5f3; padding: 0.8em 1em; border-radius: 6px; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid #bbb; padding: 0.3em 0.6em; text-align: left; vertical-align: top; }
ul, ol { padding-left: 1.6em; }
.title-page { text-align: center; padding-top: 28vh; }
.title-page h1 { margin-bottom: 0.4em; }
.pagebreak { break-after: page; height: 0; }
.footnotes { font-size: 0.9em; margin-top: 3em; }
.footnotes-sep { margin-top: 3em; }
.footnotes-sep::after { content: none; }
.footnotes-sep { border-top: 1px solid #ccc; width: 30%; margin-left: 0; }
main.manuscript { max-width: 6.5in; font: 12pt/2 "Times New Roman", Times, serif; }
main.manuscript p { margin: 0; text-indent: 0.5in; }
main.manuscript :is(blockquote, li, .footnotes, .title-page) p { text-indent: 0; }
main.manuscript :is(blockquote, li, .footnotes) { line-height: 1.65; }
main.manuscript hr { margin: 1em 0; }
main.script { max-width: 6in; font: 12pt/1.2 "Courier Prime", "Courier New", Courier, monospace; }
main.script :is(h1, h2, h3, h4, h5, h6) { font: inherit; font-weight: 700; text-transform: uppercase; text-decoration: underline; margin: 2em 0 1em; }
main.script .title-page h1 { text-decoration: none; }
main.script .sp { margin: 0 0 1.2em; }
main.script .sp p { margin: 0; }
main.script .sp-scene { font-weight: 700; text-transform: uppercase; margin-top: 2.4em !important; break-after: avoid; }
main.script .sp-character { margin-left: 2.2in !important; text-transform: uppercase; break-after: avoid; }
main.script .sp-paren { margin: 0 2in 0 1.5in !important; }
main.script .sp-dialogue { margin: 0 1.5in 0 1in !important; }
main.script .sp-transition { text-align: right; text-transform: uppercase; }
@page { margin: 1in; }
@media print { main { margin: 0 auto; max-width: none; padding: 0; } .title-page { padding-top: 35%; } }
`;

// The pictures the text uses (![[name]] from the vault): each fetched once.
// resolve(name) -> Promise<Blob|null>. -> Map(src -> { dataURL, bytes, type, width, height })
export async function prepareImages(markdown, resolve) {
	const out = new Map();
	const names = new Set();
	for (const m of markdown.matchAll(/\]\((wr1t3r-image:[^)\s]+)\)/g)) names.add(m[1]);
	for (const src of names) {
		let name = src.slice(IMG.length);
		try { name = decodeURIComponent(name); } catch {}
		try {
			const blob = await resolve(name);
			if (!blob) continue;
			const bytes = new Uint8Array(await blob.arrayBuffer());
			const dataURL = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(blob); });
			let width = 0, height = 0;
			try { const bm = await createImageBitmap(blob); width = bm.width; height = bm.height; bm.close?.(); } catch {}
			const type = (blob.type.split("/")[1] || name.split(".").pop()).toLowerCase().replace("jpeg", "jpg");
			out.set(src, { dataURL, bytes, type, width, height });
		} catch {}
	}
	return out;
}

// A paragraph's lines, split at its line breaks: [[inline tokens], ...].
function lineGroups(children) {
	const out = [[]];
	for (const c of children) {
		if (c.type === "softbreak" || c.type === "hardbreak") out.push([]);
		else out[out.length - 1].push(c);
	}
	return out;
}

// In the script layout each line of a paragraph is its own part of the
// script (src/script.js), found from the lines of the compiled text.
function scriptParagraphs(tokens, markdown) {
	const kinds = scriptKinds(markdown.split("\n"));
	return (i) => {
		const t = tokens[i];
		if (t.type !== "paragraph_open" || t.level !== 0 || !t.map) return null;
		return lineGroups(tokens[i + 1].children || []).map((children, n) => ({ children, kind: kinds[t.map[0] + n] || "action" }));
	};
}

function renderScript(md, markdown) {
	const env = {};
	const tokens = md.parse(markdown, env);
	const lines = scriptParagraphs(tokens, markdown);
	const out = [];
	for (let i = 0; i < tokens.length; i++) {
		const parts = lines(i);
		if (!parts) { out.push(tokens[i]); continue; }
		const html = parts.map((p) => `<p class="sp-${p.kind}">${md.renderer.renderInline(p.children, md.options, env)}</p>`).join("\n");
		const block = Object.assign(Object.create(Object.getPrototypeOf(tokens[i])), tokens[i], { type: "html_block", tag: "", nesting: 0, content: `<div class="sp">\n${html}\n</div>\n` });
		out.push(block);
		i += 2;
	}
	return md.renderer.render(out, md.options, env);
}

// A whole HTML page, styled like a printed book.
export function toHTML(markdown, { title = "", images = new Map(), layout = "book" } = {}) {
	const md = parser();
	const img = md.renderer.rules.image;
	md.renderer.rules.image = (tokens, i, options, env, self) => {
		const t = tokens[i];
		const src = t.attrGet("src") || "";
		if (src.startsWith(IMG)) {
			const hit = images.get(src);
			if (!hit) return "";
			t.attrSet("src", hit.dataURL);
		}
		return img(tokens, i, options, env, self);
	};
	const body = layout === "script" ? renderScript(md, markdown) : md.render(markdown);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || "Compiled")}</title>
<style>${BOOK_CSS.replace("@page { margin: 1in; }", pageRule(pageSetup(), { title, titlePage: body.includes('class="title-page"') }))}</style>
</head>
<body><main${layout === "manuscript" || layout === "script" ? ` class="${layout}"` : ""}>
${body}</main></body>
</html>
`;
}

// ---- Word ------------------------------------------------------------------------

// Page setup's paper and margins, as Word's section page.
function wordPage() {
	const p = pageTwips(pageSetup());
	return { size: { width: p.width, height: p.height }, margin: { top: p.margin, right: p.margin, bottom: p.margin, left: p.margin } };
}

// Page setup's header and footer, as Word's: one line each, centered, or with
// tab stops for left | center | right. -> { headers, footers } for a section.
function wordMargins(d, title, titlePage) {
	const { Header, Footer, Paragraph, TextRun, PageNumber, AlignmentType, TabStopType } = d;
	const s = pageSetup(), p = pageTwips(s), width = p.width - 2 * p.margin;
	const line = (text) => {
		const parts = marginParts(text, { title });
		if (!parts) return null;
		const runs = (pieces) => pieces.map((x) => (typeof x === "string" ? new TextRun({ text: x, size: 18, color: "555555" })
			: new TextRun({ children: [x.field === "page" ? PageNumber.CURRENT : PageNumber.TOTAL_PAGES], size: 18, color: "555555" })));
		if (!parts.left.length && !parts.right.length) return new Paragraph({ alignment: AlignmentType.CENTER, children: runs(parts.center) });
		const tab = () => new TextRun({ text: "\t", size: 18 });
		return new Paragraph({
			tabStops: [{ type: TabStopType.CENTER, position: Math.round(width / 2) }, { type: TabStopType.RIGHT, position: width }],
			children: [...runs(parts.left), tab(), ...runs(parts.center), tab(), ...runs(parts.right)],
		});
	};
	const out = {};
	const head = line(s.header), foot = line(s.footer);
	const bare = () => new Paragraph({ children: [] });
	if (head) out.headers = { default: new Header({ children: [head] }), ...(titlePage ? { first: new Header({ children: [bare()] }) } : {}) };
	if (foot) out.footers = { default: new Footer({ children: [foot] }), ...(titlePage ? { first: new Footer({ children: [bare()] }) } : {}) };
	return out;
}

export async function toDocx(markdown, { title = "", author = "", images = new Map(), layout = "book" } = {}) {
	const ms = layout === "manuscript", sp = layout === "script";
	const d = await import("docx");
	const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ExternalHyperlink, FootnoteReferenceRun, PageBreak, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle, LevelFormat } = d;
	const env = {};
	const tokens = parser().parse(markdown, env);
	const scriptLines = sp ? scriptParagraphs(tokens, markdown) : () => null;
	// A screenplay page's indents, in twips (1440 to the inch) from the text's left.
	const SP = {
		scene: { keepNext: true, spacing: { before: 480, after: 240 } },
		action: { spacing: { after: 240 } },
		character: { keepNext: true, indent: { left: 3168 } },
		paren: { keepNext: true, indent: { left: 2160, right: 2880 } },
		dialogue: { indent: { left: 1440, right: 2160 } },
		transition: { alignment: AlignmentType.RIGHT, spacing: { before: 240, after: 240 } },
	};
	const CAPS = new Set(["scene", "character", "transition"]);

	// Footnotes first: markdown-it puts their text in a block at the end.
	const footnotes = {};
	const isFn = (t) => t.type.startsWith("footnote");
	{
		let id = null, paras = [];
		for (let i = 0; i < tokens.length; i++) {
			const t = tokens[i];
			if (t.type === "footnote_open") { id = t.meta.id; paras = []; }
			else if (t.type === "footnote_close") { footnotes[id + 1] = { children: paras.length ? paras : [new Paragraph("")] }; id = null; }
			else if (id != null && t.type === "inline") paras.push(new Paragraph({ children: runs(t.children) }));
		}
	}

	const HEAD = [null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
	const out = [];
	if (title || author) {
		out.push(new Paragraph({ children: [], spacing: { before: 3600 } }));
		if (title) out.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun(title)] }));
		if (author) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "by " + author, italics: true })] }));
		out.push(new Paragraph({ children: [new PageBreak()] }));
	}

	let olCount = 0;
	const lists = []; // { ordered, instance }
	let quote = 0, pendingBreak = false;
	const para = (opts) => {
		if (pendingBreak) { opts.pageBreakBefore = true; pendingBreak = false; }
		if (quote) opts.indent = { left: 720 * quote };
		if (quote) opts.border = { left: { style: BorderStyle.SINGLE, size: 8, color: "BBBBBB", space: 10 } };
		out.push(new Paragraph(opts));
	};

	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (isFn(t) && t.type !== "footnote_ref") {
			// Skip the footnote block; its text is in `footnotes`.
			if (t.type === "footnote_block_open") while (i < tokens.length && tokens[i].type !== "footnote_block_close") i++;
			continue;
		}
		switch (t.type) {
			case "heading_open": {
				const inline = tokens[i + 1];
				const level = Number(t.tag.slice(1));
				para({ heading: HEAD[level], alignment: level <= 2 ? AlignmentType.CENTER : undefined, children: runs(inline.children) });
				i += 2;
				break;
			}
			case "paragraph_open": {
				const parts = scriptLines(i);
				if (parts) {
					parts.forEach((p, n) => {
						const last = n === parts.length - 1;
						const opts = { ...SP[p.kind], children: runs(p.children, { bold: p.kind === "scene", caps: CAPS.has(p.kind) }) };
						if (last && (p.kind === "dialogue" || p.kind === "paren" || p.kind === "character")) opts.spacing = { after: 240 };
						para(opts);
					});
					i += 2;
					break;
				}
				const inline = tokens[i + 1];
				const opts = { children: runs(inline.children) };
				const l = lists[lists.length - 1];
				if (l) {
					// A list item's text: the first paragraph gets the bullet or number.
					if (l.ordered) opts.numbering = { reference: "ol", level: Math.min(lists.length - 1, 5), instance: l.instance };
					else opts.bullet = { level: Math.min(lists.length - 1, 5) };
					if (l.used) { delete opts.numbering; delete opts.bullet; opts.indent = { left: 720 * lists.length }; }
					l.used = true;
				} else if (ms && !quote) opts.indent = { firstLine: 720 };
				para(opts);
				i += 2;
				break;
			}
			case "bullet_list_open": lists.push({ ordered: false }); break;
			case "ordered_list_open": lists.push({ ordered: true, instance: ++olCount }); break;
			case "bullet_list_close": case "ordered_list_close": lists.pop(); break;
			case "list_item_open": if (lists.length) lists[lists.length - 1].used = false; break;
			case "blockquote_open": quote++; break;
			case "blockquote_close": quote--; break;
			case "hr": para({ alignment: AlignmentType.CENTER, children: [new TextRun("*   *   *")], spacing: { before: 240, after: 240 } }); break;
			case "fence": case "code_block": {
				const lines = t.content.replace(/\n$/, "").split("\n");
				para({ children: lines.map((line, n) => new TextRun({ text: line, font: "Courier New", size: 20, break: n ? 1 : 0 })) });
				break;
			}
			case "html_block": {
				if (/class="pagebreak"/.test(t.content)) { pendingBreak = true; break; }
				const text = t.content.replace(/<[^>]+>/g, "").trim();
				if (text) para({ children: [new TextRun(text)] });
				break;
			}
			case "table_open": {
				const rows = [];
				let row = null;
				for (i++; i < tokens.length && tokens[i].type !== "table_close"; i++) {
					const c = tokens[i];
					if (c.type === "tr_open") row = [];
					else if (c.type === "tr_close") { rows.push(new TableRow({ children: row })); row = null; }
					else if (c.type === "inline" && row) {
						const head = tokens[i - 1].type === "th_open";
						row.push(new TableCell({ children: [new Paragraph({ children: runs(c.children, head ? { bold: true } : {}) })] }));
					}
				}
				if (rows.length) out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
				break;
			}
		}
	}

	function runs(children = [], base = {}) {
		const res = [];
		const st = { ...base };
		let link = null;
		const push = (r) => (link ? link.children.push(r) : res.push(r));
		for (const c of children) {
			switch (c.type) {
				case "text": if (c.content) push(new TextRun({ text: c.content, ...style(st) })); break;
				case "code_inline": push(new TextRun({ text: c.content, font: "Courier New", ...style(st) })); break;
				case "softbreak": push(new TextRun({ text: " ", ...style(st) })); break;
				case "hardbreak": push(new TextRun({ text: "", break: 1 })); break;
				case "strong_open": st.bold = true; break;
				case "strong_close": st.bold = base.bold || false; break;
				case "em_open": st.italics = true; break;
				case "em_close": st.italics = false; break;
				case "s_open": st.strike = true; break;
				case "s_close": st.strike = false; break;
				case "html_inline":
					if (/^<mark\b/i.test(c.content)) st.highlight = "yellow";
					else if (/^<\/mark>/i.test(c.content)) st.highlight = undefined;
					else if (/^<br\s*\/?>/i.test(c.content)) push(new TextRun({ text: "", break: 1 }));
					break;
				case "link_open": {
					const href = c.attrGet("href") || "";
					if (/^(https?|mailto):/i.test(href)) link = { href, children: [] };
					break;
				}
				case "link_close":
					if (link) { res.push(new ExternalHyperlink({ link: link.href, children: link.children })); link = null; }
					break;
				case "footnote_ref": res.push(new FootnoteReferenceRun(c.meta.id + 1)); break;
				case "image": {
					const hit = images.get(c.attrGet("src") || "");
					const type = hit && { jpg: "jpg", png: "png", gif: "gif", bmp: "bmp" }[hit.type];
					if (type && hit.width) {
						const w = Math.min(450, hit.width), h = Math.round(hit.height * (w / hit.width));
						push(new ImageRun({ type, data: hit.bytes, transformation: { width: w, height: h } }));
					} else if (c.content) push(new TextRun({ text: `[${c.content}]`, italics: true }));
					break;
				}
			}
		}
		return res;
	}
	function style(st) {
		return { bold: st.bold || undefined, italics: st.italics || undefined, strike: st.strike || undefined, highlight: st.highlight, allCaps: st.caps || undefined, font: sp ? "Courier New" : undefined, style: undefined };
	}

	const doc = new Document({
		creator: author || "wr1t3r",
		title: title || undefined,
		styles: {
			default: { document: { run: { font: "Times New Roman", size: 24 }, paragraph: { spacing: ms ? { after: 0, line: 480 } : sp ? { after: 0, line: 240 } : { after: 160, line: 360 } } } },
		},
		numbering: {
			config: [{
				reference: "ol",
				levels: [0, 1, 2, 3, 4, 5].map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })),
			}],
		},
		footnotes,
		sections: [{ properties: { page: wordPage(), titlePage: !!(title || author) }, ...wordMargins(d, title, !!(title || author)), children: out }],
	});
	return Packer.toBlob(doc);
}
