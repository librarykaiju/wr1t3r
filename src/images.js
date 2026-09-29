// Images and attachments: a line with ![alt](https://...), ![[photo.png]] or
// ![](attachments/photo.png) gets the picture drawn under it, as Obsidian shows
// them. The markdown stays as typed. Obsidian's size syntax works too:
// ![alt|300](url) or ![[photo.png|300]] is 300px wide, |300x200 sets both.
// Web images load from their own sites (no referrer is sent). Vault files come
// through the Worker (src/attachments.js): images drawn, audio and video with
// player controls, PDFs as a card that opens them.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { attachmentKind } from "./attachments.js";
import { attachmentType } from "./paths.js";

const WIKI_EMBED = /!\[\[([^\]\n|#]+)(?:#[^\]\n|]*)?(?:\|([^\]\n]*))?\]\]/g;
const CODE = /^(InlineCode|CodeText|FencedCode|CodeBlock|Comment)$/;
function inCode(state, pos) {
	for (let n = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (CODE.test(n.name)) return true;
	return false;
}

// "alt|300" or "alt|300x200" -> { alt, width, height }.
export function imageSize(alt) {
	const m = alt.match(/^(.*?)\|(\d+)(?:x(\d+))?$/);
	return m ? { alt: m[1].trim(), width: Number(m[2]), height: m[3] ? Number(m[3]) : null } : { alt, width: null, height: null };
}

// The images in a state: [{ line (end of the line they're on), url, alt,
// width, height }] for web images and [{ line, name, alt, width, height }] for
// vault files, where name is the link as written.
export function imagesIn(state) {
	const out = [];
	for (let n = 1; n <= state.doc.lines; n++) {
		const line = state.doc.line(n);
		if (!line.text.includes("![[")) continue;
		for (const m of line.text.matchAll(WIKI_EMBED)) {
			if (!attachmentType(m[1].trim()) || inCode(state, line.from + m.index)) continue;
			out.push({ line: line.to, name: m[1].trim(), ...imageSize("|" + (m[2] ?? "")), alt: m[1].trim(), from: line.from + m.index });
		}
	}
	syntaxTree(state).iterate({
		enter(n) {
			if (n.name !== "Image") return;
			const u = n.node.getChild("URL");
			if (!u) return false;
			const url = state.sliceDoc(u.from, u.to).replace(/^<|>$/g, "");
			const marks = n.node.getChildren("LinkMark");
			const alt = marks.length >= 2 ? state.sliceDoc(marks[0].to, marks[1].from) : "";
			if (/^https:\/\//i.test(url)) out.push({ line: state.doc.lineAt(n.to).to, url, ...imageSize(alt), from: n.from });
			else if (!/^[a-z][\w+.-]*:|^\/\//i.test(url) && attachmentType(url.split(/[?#]/)[0])) out.push({ line: state.doc.lineAt(n.to).to, name: url.split(/[?#]/)[0], ...imageSize(alt), from: n.from });
			return false;
		},
	});
	return out.sort((a, b) => a.from - b.from);
}

// A dashed note in place of a file that can't be shown. It sits inside the
// widget, which keeps its spacing as padding (see .md-image in style.css).
function brokenNote(wrap, text) {
	const span = document.createElement("span");
	span.className = "md-image-note";
	span.textContent = text;
	wrap.classList.add("broken");
	wrap.replaceChildren(span);
}

class ImageWidget extends WidgetType {
	constructor(img) { super(); this.img = img; }
	eq(o) { return ["url", "alt", "width", "height", "path", "version"].every((k) => o.img[k] === this.img[k]) && !!o.img.missing === !!this.img.missing; }
	get estimatedHeight() { return this.img.height || 200; }
	toDOM(view) {
		if (this.img.name != null) return this.vaultDOM(view);
		const wrap = document.createElement("div");
		wrap.className = "md-image";
		const img = document.createElement("img");
		img.src = this.img.url;
		img.alt = this.img.alt;
		img.loading = "lazy";
		img.decoding = "async";
		img.referrerPolicy = "no-referrer";
		if (this.img.width) img.width = this.img.width;
		if (this.img.height) img.height = this.img.height;
		// Its height changes once it loads (or fails); tell the editor, so clicks
		// below it still land where they look.
		img.addEventListener("load", () => view.requestMeasure());
		img.addEventListener("error", () => {
			brokenNote(wrap, navigator.onLine ? "Image didn't load" : "Image not shown offline");
			view.requestMeasure();
		});
		wrap.append(img);
		return wrap;
	}
	// A file in the vault: fetched through the host, drawn by its kind.
	vaultDOM(view) {
		const wrap = document.createElement("div");
		wrap.className = "md-image md-attachment";
		const { name, path, missing } = this.img;
		const note = (text) => brokenNote(wrap, text);
		if (missing || !path) { note(`“${name}” isn't in the vault`); return wrap; }
		const host = view.state.facet(vaultHost);
		const kind = attachmentKind(path);
		const fileName = path.split("/").pop();
		if (kind === "pdf") {
			const card = document.createElement("button");
			card.type = "button";
			card.className = "md-pdf";
			card.textContent = "📄 " + fileName;
			card.title = "Open the PDF";
			card.addEventListener("mousedown", (e) => e.preventDefault());
			card.addEventListener("click", async () => {
				const tab = window.open("", "_blank");
				try { const u = await host.attachmentURL(path); if (tab) tab.location.href = u; else window.open(u, "_blank"); }
				catch { tab?.close(); note(navigator.onLine ? "Couldn't load the PDF" : "PDF not shown offline"); }
			});
			wrap.append(card);
			return wrap;
		}
		const el = document.createElement(kind === "image" ? "img" : kind);
		if (kind === "image") { el.alt = this.img.alt || fileName; el.decoding = "async"; }
		else { el.controls = true; el.preload = "metadata"; el.title = fileName; }
		if (this.img.width) el.width = this.img.width;
		if (this.img.height) el.height = this.img.height;
		el.addEventListener(kind === "image" ? "load" : "loadedmetadata", () => view.requestMeasure());
		host.attachmentURL(path).then((u) => { el.src = u; }, () => { note(navigator.onLine ? "Couldn't load " + fileName : fileName + " isn't shown offline until it's been opened online"); view.requestMeasure(); });
		wrap.append(el);
		return wrap;
	}
	ignoreEvent() { return false; }
}

function build(state) {
	const b = new RangeSetBuilder();
	const host = state.facet(vaultHost);
	const files = host?.attachments ? host.attachments() : [];
	for (const img of imagesIn(state)) {
		if (img.name != null) {
			if (!host?.attachments) continue;
			const path = host.resolveAttachment(img.name, state.facet(notePath));
			const file = path && files.find((f) => f.path === path);
			Object.assign(img, file ? { path, version: file.version } : { missing: files.length > 0 || host.attachmentsLoaded?.() });
			if (!file && !img.missing) continue; // the list hasn't arrived yet
		}
		b.add(img.line, img.line, Decoration.widget({ widget: new ImageWidget(img), block: true, side: 1 }));
	}
	return b.finish();
}

export const webImages = StateField.define({
	create: build,
	update(deco, tr) {
		if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state) || tr.effects.some((e) => e.is(vaultChanged))) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});
