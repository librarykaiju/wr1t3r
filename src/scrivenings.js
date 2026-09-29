// Scrivenings: every note in a folder (subfolders too, in binder order) as
// one long document. Each note is its own small editor, stacked, so every
// edit still saves to that note alone, the same way the editor saves. Only
// the notes near the screen get an editor; the rest show their text until
// scrolled to, which keeps a long manuscript quick.
//
// host: {
//   folder, order(folder),       as for the corkboard (src/folderview.js)
//   note(path),                  the note ({ path, text, dirty }) or null
//   editor,                      the page's editor (for editor.section)
//   edit(path, text),            save a section's change
//   open(path), openFolder(f),   a section's title, a part's title
//   focused(view, path),         a section got the cursor
// }

import { cardInfo } from "./binder.js";
import { stripFrontmatter } from "./count.js";

const folderName = (f) => f.replace(/\/+$/, "").split("/").pop();

// The folder's notes and parts (subfolders), in reading order.
export function readingOrder(folder, order, depth = 0) {
	const out = [];
	for (const it of order(folder)) {
		if (it.kind === "folder") {
			out.push({ kind: "folder", path: it.path, depth });
			out.push(...readingOrder(it.path, order, depth + 1));
		} else out.push({ kind: "note", path: it.path, depth });
	}
	return out;
}

// Where a section's text starts, below its properties ("\n" breaks, as
// CodeMirror counts positions).
function bodyStart(v) {
	const d = v.state.doc.toString();
	return d.length - stripFrontmatter(d).length;
}

export function mountScrivenings(root, host) {
	root.replaceChildren();
	const doc = document.createElement("div");
	doc.className = "scriv";
	root.append(doc);
	const parts = readingOrder(host.folder, host.order);
	const secs = []; // { path, el, body, ed }
	const observer = new IntersectionObserver((entries) => {
		for (const e of entries) if (e.isIntersecting) mount(secs.find((s) => s.el === e.target));
	}, { root, rootMargin: "1200px 0px" });

	for (const p of parts) {
		if (p.kind === "folder") {
			const h = document.createElement("h2");
			h.className = "scriv-part";
			h.style.setProperty("--depth", p.depth);
			const b = document.createElement("button");
			b.type = "button";
			b.textContent = folderName(p.path);
			b.title = "Show this folder";
			b.addEventListener("click", () => host.openFolder(p.path));
			h.append(b);
			doc.append(h);
			continue;
		}
		const note = host.note(p.path);
		if (!note || note.binary) continue;
		const el = document.createElement("section");
		el.className = "scriv-sec";
		el.dataset.path = p.path;
		const head = document.createElement("div");
		head.className = "scriv-head";
		const title = document.createElement("button");
		title.type = "button";
		title.className = "scriv-title";
		title.title = "Open this note on its own";
		title.addEventListener("click", () => host.open(p.path));
		const words = document.createElement("span");
		words.className = "scriv-words";
		head.append(title, words);
		const body = document.createElement("div");
		body.className = "scriv-body";
		const plain = document.createElement("div");
		plain.className = "scriv-plain";
		plain.textContent = stripFrontmatter(note.text).trim();
		body.append(plain);
		el.append(head, body);
		doc.append(el);
		const s = { path: p.path, el, body, ed: null, title, words };
		label(s, note.text);
		secs.push(s);
		observer.observe(el);
	}
	if (!secs.length) {
		const p = document.createElement("p");
		p.className = "hint";
		p.textContent = "There are no notes in this folder yet.";
		doc.append(p);
	}

	function label(s, text) {
		const info = cardInfo(s.path, text);
		s.title.textContent = info.title;
		s.words.textContent = `${info.words.toLocaleString()} word${info.words === 1 ? "" : "s"}`;
	}

	function mount(s) {
		if (!s || s.ed) return;
		const note = host.note(s.path);
		if (!note) return;
		s.body.replaceChildren();
		let wordTimer;
		s.ed = host.editor.section(s.body, note, {
			edits: (text) => {
				host.edit(s.path, text);
				clearTimeout(wordTimer);
				wordTimer = setTimeout(() => label(s, text), 300);
			},
			focus: (view) => host.focused(view, s.path),
			edge: (dir) => jump(s, dir),
		});
		s.body.addEventListener("focusin", () => host.focused(s.ed.view, s.path));
		observer.unobserve(s.el);
	}

	// Arrow keys past a section's first or last line go on into the next one.
	function jump(s, dir) {
		const next = secs[secs.indexOf(s) + dir];
		if (!next) return false;
		mount(next);
		const v = next.ed.view;
		const at = dir > 0 ? bodyStart(v) : v.state.doc.length;
		v.focus();
		v.dispatch({ selection: { anchor: at }, scrollIntoView: true });
		return true;
	}

	return {
		// The notes it shows, in order (to tell when the folder changed).
		key: parts.map((p) => p.path).join("\n"),
		// Brings in versions a sync changed, for sections without unsent edits here.
		sync() {
			for (const s of secs) {
				const note = host.note(s.path);
				if (!note) continue;
				if (!s.ed) { const plain = s.body.querySelector(".scriv-plain"); if (plain) plain.textContent = stripFrontmatter(note.text).trim(); label(s, note.text); continue; }
				if (!note.dirty && note.text !== s.ed.text()) { s.ed.replace(note); label(s, note.text); }
			}
		},
		hasFocus: () => secs.some((s) => s.ed?.view.hasFocus),
		// Scrolls to a note and puts the cursor at the start of its text.
		show(path) {
			const s = secs.find((x) => x.path === path);
			if (!s) return;
			mount(s);
			s.el.scrollIntoView({ block: "start" });
			const v = s.ed?.view;
			if (v) { v.focus(); v.dispatch({ selection: { anchor: bodyStart(v) } }); }
		},
		destroy() {
			observer.disconnect();
			for (const s of secs) s.ed?.destroy();
			root.replaceChildren();
		},
	};
}
