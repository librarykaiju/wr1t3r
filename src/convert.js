// Turns an uploaded file into markdown, in the browser, so uploads work
// offline too. Loaded only when someone uploads (the converters are big).
//
//   .md .markdown .txt   kept as they are
//   .html .htm           HTML -> markdown (turndown, with GFM tables)
//   .docx                Word -> HTML (mammoth) -> markdown
//   .pdf                 text layer only (pdf.js); layout is approximate and
//                        scanned PDFs, having no text layer, come out empty
// Images are left out everywhere: wr1t3r doesn't handle attachments yet.

import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { pdfPageText } from "./convert-text.js";

export { noteName, withFrontmatter } from "./convert-text.js";

export const ACCEPT = ".md,.markdown,.txt,.html,.htm,.docx,.pdf";

const ext = (name) => (name.match(/\.([^.]+)$/)?.[1] || "").toLowerCase();

export async function toMarkdown(file) {
	const kind = ext(file.name);
	if (kind === "md" || kind === "markdown" || kind === "txt") return { markdown: decodeText(await file.arrayBuffer()), notes: [] };
	if (kind === "html" || kind === "htm") return fromHtml(decodeText(await file.arrayBuffer()));
	if (kind === "docx") return fromDocx(await file.arrayBuffer());
	if (kind === "pdf") return fromPdf(await file.arrayBuffer());
	throw new Error(`Can't convert .${kind || "(no extension)"} files`);
}

// UTF-8, or Windows-1252 for older text files that aren't.
function decodeText(buf) {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(buf);
	} catch {
		return new TextDecoder("windows-1252").decode(buf);
	}
}

function turndown() {
	const td = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
		emDelimiter: "*",
		hr: "---",
	});
	td.use(gfm);
	// "- item", not turndown's "-   item"; nested lines indent to match.
	td.addRule("listItem", {
		filter: "li",
		replacement(content, node, options) {
			const parent = node.parentNode;
			let prefix = options.bulletListMarker + " ";
			if (parent.nodeName === "OL") {
				const start = Number(parent.getAttribute("start") || 1);
				prefix = start + Array.prototype.indexOf.call(parent.children, node) + ". ";
			}
			content = content.replace(/^\n+/, "").replace(/\n+$/, "\n").replace(/\n/gm, "\n" + " ".repeat(prefix.length));
			return prefix + content + (node.nextSibling && !/\n$/.test(content) ? "\n" : "");
		},
	});
	td.remove(["script", "style", "noscript", "iframe", "object", "embed", "head", "meta", "link"]);
	return td;
}

function fromHtml(html, notes = []) {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const title = doc.querySelector("title")?.textContent.trim();
	let markdown = htmlToMarkdown(doc.body || doc.documentElement, { notes });
	if (title && !markdown.startsWith("# ")) markdown = `# ${title}\n\n` + markdown;
	return { markdown, notes };
}

// HTML (an element or a document's body) -> markdown. Images are dropped,
// unless keepImages, when those with an absolute web address stay, linked to
// where they are (clippings; Obsidian shows them when online).
export function htmlToMarkdown(root, { keepImages = false, notes = [] } = {}) {
	const doc = root.ownerDocument || root;
	root.querySelectorAll("svg, source").forEach((el) => el.remove());
	let dropped = 0;
	for (const img of root.querySelectorAll("img")) {
		if (keepImages && /^https?:/i.test(img.getAttribute("src") || "")) continue;
		img.remove();
		dropped++;
	}
	if (dropped) notes.push(`${dropped} image${dropped === 1 ? "" : "s"} left out`);
	// GFM tables need a header row and single-line cells. Word tables have
	// neither, so the first row becomes the header and cell paragraphs are joined.
	for (const table of root.querySelectorAll("table")) {
		for (const cell of table.querySelectorAll("td, th")) {
			const ps = cell.querySelectorAll("p");
			if (ps.length) cell.innerHTML = [...ps].map((p) => p.innerHTML).join(" ");
		}
		const first = table.querySelector("tr");
		if (first && !table.querySelector("th")) {
			for (const td of [...first.children]) {
				const th = doc.createElement("th");
				th.innerHTML = td.innerHTML;
				td.replaceWith(th);
			}
		}
	}
	return turndown().turndown(root).trim() + "\n";
}

async function fromDocx(buf) {
	const mammoth = (await import("mammoth/mammoth.browser.js")).default;
	let images = 0;
	const r = await mammoth.convertToHtml(
		{ arrayBuffer: buf },
		{ convertImage: mammoth.images.imgElement(() => { images++; return { src: "" }; }) },
	);
	const notes = [];
	if (images) notes.push(`${images} image${images === 1 ? "" : "s"} left out`);
	const out = fromHtml(`<body>${r.value}</body>`);
	return { markdown: out.markdown, notes };
}

async function fromPdf(buf) {
	const pdfjs = await import("pdfjs-dist");
	pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
	const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
	const pages = [];
	for (let n = 1; n <= pdf.numPages; n++) {
		const page = await pdf.getPage(n);
		const { items } = await page.getTextContent();
		pages.push(pdfPageText(items));
	}
	const markdown = pages.filter(Boolean).join("\n\n").trim();
	const notes = markdown ? [] : ["no text found (a scanned PDF needs OCR first)"];
	return { markdown: markdown + "\n", notes };
}

// Fetch the converters once while online, so the service worker keeps them
// for offline uploads.
export function warm() {
	import("pdfjs-dist").catch(() => {});
	import("mammoth/mammoth.browser.js").catch(() => {});
	fetch(pdfWorkerUrl).catch(() => {});
}
