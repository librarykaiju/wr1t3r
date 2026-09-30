// Pasting and dropping, as in a word processor:
//  - Formatted text (from a web page, Google Docs, Word) comes in as markdown:
//    headings, bold, lists, links and tables kept. Inside code, the
//    properties or a link it stays plain text; Ctrl/Cmd+Shift+V always pastes
//    plain text (the browser sends no formatting then).
//  - Pictures (a screenshot on the clipboard, or image files dropped on the
//    note) are added to the vault and linked where they landed. main.js
//    does the upload: setPictureHost({ upload(file, notePath) -> link text }).

import { EditorView } from "@codemirror/view";
import { notePath } from "./vault.js";
import { plainAt } from "./writing.js";
import { pictureExt } from "./pictures.js";

let host = null;
export function setPictureHost(h) {
	host = h;
}

let seq = 0;

// Puts each picture in at pos, behind a placeholder until it's uploaded.
function addPictures(view, files, pos) {
	if (!host) return;
	const path = view.state.facet(notePath);
	for (const file of files) {
		const mark = `![Uploading ${file.name || "picture"} ${++seq}…]()`;
		const sep = pos > 0 && !/\s/.test(view.state.sliceDoc(pos - 1, pos)) ? " " : "";
		view.dispatch({ changes: { from: pos, insert: sep + mark }, selection: { anchor: pos + sep.length + mark.length }, userEvent: "input.paste" });
		pos += sep.length + mark.length;
		host.upload(file, path).then(
			(link) => swap(view, mark, link),
			() => swap(view, mark, ""),
		);
	}
}

function swap(view, mark, text) {
	const at = view.state.sliceDoc().indexOf(mark);
	if (at < 0) return;
	view.dispatch({ changes: { from: at, to: at + mark.length, insert: text }, userEvent: "input.paste" });
}

const pictures = (list) => [...(list || [])].filter((f) => pictureExt(f.type));

// Formatted text worth converting: more than the plain text says.
export function worthConverting(html, plain) {
	if (!html || !/<(h[1-6]|b|strong|i|em|a|ul|ol|li|table|blockquote|s|del|code|pre)[\s>]/i.test(html)) return false;
	// Code editors put their text in styled spans; it should paste as it looks.
	if (/<meta[^>]+vscode|class="?(monaco|cm-|highlight)/i.test(html)) return false;
	return !!plain || /<img/i.test(html);
}

// Google Docs wraps everything in <b style="font-weight:normal"> and marks
// bold and italic with styles, not tags: unwrap the one, turn the others into tags.
export function fromGoogleDocs(doc) {
	for (const b of doc.querySelectorAll('b[id^="docs-internal-guid"]')) b.replaceWith(...b.childNodes);
	for (const span of doc.querySelectorAll("span[style]")) {
		const st = span.getAttribute("style").toLowerCase();
		let node = span;
		const wrap = (tag) => {
			const el = doc.createElement(tag);
			el.append(...node.childNodes);
			node.append(el);
			node = el;
		};
		if (/font-weight:\s*(bold|[6-9]00)/.test(st)) wrap("strong");
		if (/font-style:\s*italic/.test(st)) wrap("em");
		if (/text-decoration[^;]*line-through/.test(st)) wrap("del");
	}
}

export const pasteAndDrop = EditorView.domEventHandlers({
	paste(e, view) {
		if (view.state.readOnly) return false;
		const data = e.clipboardData;
		if (!data) return false;
		const files = pictures(data.files);
		const { from, to } = view.state.selection.main;
		if (files.length && host) {
			e.preventDefault();
			if (from !== to) view.dispatch({ changes: { from, to }, selection: { anchor: from } });
			addPictures(view, files, from);
			return true;
		}
		const html = data.getData("text/html");
		const plain = data.getData("text/plain");
		if (!worthConverting(html, plain) || plainAt(view.state, from)) return false;
		e.preventDefault();
		import("./convert.js").then(({ htmlToMarkdown }) => {
			const doc = new DOMParser().parseFromString(html, "text/html");
			fromGoogleDocs(doc);
			let md = htmlToMarkdown(doc.body, { keepImages: true }).trim();
			if (!md) md = plain;
			const cur = view.state.selection.main;
			view.dispatch({
				changes: { from: cur.from, to: cur.to, insert: md },
				selection: { anchor: cur.from + md.length },
				userEvent: "input.paste",
				scrollIntoView: true,
			});
		}, () => view.dispatch(view.state.replaceSelection(plain), { userEvent: "input.paste" }));
		return true;
	},
	dragover(e) {
		if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === "file" && pictureExt(i.type))) { e.preventDefault(); return true; }
		return false;
	},
	drop(e, view) {
		const files = pictures(e.dataTransfer?.files);
		if (!files.length || !host || view.state.readOnly) return false;
		e.preventDefault();
		const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
		addPictures(view, files, pos);
		return true;
	},
});

// The toolbar's picture button: pick files, add them at the cursor.
export function choosePictures(view) {
	const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp", multiple: true });
	input.addEventListener("change", () => {
		const files = pictures(input.files);
		if (files.length) addPictures(view, files, view.state.selection.main.head);
		view.focus();
	});
	input.click();
}
