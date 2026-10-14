// The front page builder: the website's Home note (src/website.js) as a stack
// of blocks to add, fill in, reorder and remove, with the page previewed
// beside them. The note stays plain markdown, so it can still be edited by
// hand, in Obsidian or anywhere; the builder reads it back into blocks and
// writes blocks out as markdown:
//
//   heading   ## Words                  (level 1 to 3)
//   text      any markdown              (anything the builder doesn't know)
//   picture   ![[path]]
//   posts     a posts block             (folder, count, show)
//   links     - [Words](address) lines
//   divider   ---
//
// Each block is separated by a blank line. The note's properties are kept,
// with publish: true added so the page goes on the site.
//
// host: {
//   text()            the Home note's text now, or "" when there's none
//   save(text)        writes it (making the note if need be) -> Promise
//   preview(text)     the front page built with this Home text -> Promise<html>
//   pictures()        the notebook's pictures' paths
//   folders()         the top-level folders with published notes
//   toast(text)
// }

import { setProperty } from "./bases.js";

export const BLOCK_TYPES = [
	["heading", "Heading"],
	["text", "Text"],
	["picture", "Picture"],
	["posts", "Latest posts"],
	["links", "Links"],
	["divider", "Divider"],
];

// ---- Markdown <-> blocks -----------------------------------------------------

function splitFront(text) {
	const m = /^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(text || "");
	return m ? [m[0], text.slice(m[0].length)] : ["", text || ""];
}

// The body's chunks: fenced blocks whole, the rest split at blank lines.
function chunks(body) {
	const out = [];
	let cur = [], fence = null;
	const flush = () => { if (cur.length) out.push(cur.join("\n")); cur = []; };
	for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
		const f = /^\s*(`{3,}|~{3,})/.exec(line);
		if (fence) {
			cur.push(line);
			if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length).trim()) { fence = null; flush(); }
			continue;
		}
		if (f) { flush(); fence = f[1]; cur.push(line); continue; }
		if (!line.trim()) { flush(); continue; }
		cur.push(line);
	}
	flush();
	return out;
}

const LINK = /^\s*[-*]\s+\[([^\]]*)\]\(([^)\s]+)\)\s*$/;

function blockOf(chunk) {
	const lines = chunk.split("\n");
	const h = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(chunk);
	if (lines.length === 1 && h) return { type: "heading", level: h[1].length, text: h[2] };
	if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(chunk)) return { type: "divider" };
	const pic = /^\s*!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/.exec(chunk);
	if (pic) return { type: "picture", path: pic[1].trim() };
	const posts = /^\s*(`{3,}|~{3,})\s*posts\s*\n([\s\S]*?)\n?\s*\1\s*$/.exec(chunk);
	if (posts) {
		const b = { type: "posts", folder: "", count: 5, show: "summary" };
		for (const l of posts[2].split("\n")) {
			const m = /^\s*(\w+)\s*:\s*(.*?)\s*$/.exec(l);
			if (!m) continue;
			const v = m[2].replace(/^["']|["']$/g, "");
			if (m[1] === "folder") b.folder = /^all$/i.test(v) ? "" : v;
			if (m[1] === "count") b.count = parseInt(v, 10) || 5;
			if (m[1] === "show" && /^(title|summary|full)$/i.test(v)) b.show = v.toLowerCase();
		}
		return b;
	}
	if (lines.every((l) => LINK.test(l))) return { type: "links", links: lines.map((l) => { const m = LINK.exec(l); return { text: m[1], url: m[2] }; }) };
	return { type: "text", text: chunk };
}

// The Home note's text as { front, blocks }: front is its properties, as written.
export function readBlocks(text) {
	const [front, body] = splitFront(text);
	const blocks = [];
	for (const c of chunks(body)) {
		const b = blockOf(c);
		// Paragraphs that follow each other are one text block.
		const last = blocks[blocks.length - 1];
		if (b.type === "text" && last?.type === "text") last.text += "\n\n" + b.text;
		else blocks.push(b);
	}
	return { front, blocks };
}

const blockText = (b) => {
	switch (b.type) {
		case "heading": return `${"#".repeat(Math.min(3, Math.max(1, b.level || 2)))} ${String(b.text || "").replace(/\n+/g, " ").trim() || "Heading"}`;
		case "divider": return "---";
		case "picture": return b.path ? `![[${b.path}]]` : "";
		case "posts": return ["```posts", ...(b.folder ? [`folder: ${b.folder}`] : []), `count: ${Math.max(1, parseInt(b.count, 10) || 5)}`, `show: ${b.show || "summary"}`, "```"].join("\n");
		case "links": return (b.links || []).filter((l) => l.url).map((l) => `- [${String(l.text || l.url).replace(/[[\]]/g, "")}](${String(l.url).replace(/\s/g, "%20")})`).join("\n");
		default: return String(b.text || "").trim();
	}
};

// The note's text from its properties and blocks, publish: true included.
export function writeBlocks(front, blocks) {
	const body = blocks.map(blockText).filter(Boolean).join("\n\n") + "\n";
	return setProperty(front + body, "publish", true);
}

// ---- The window ---------------------------------------------------------------

let open = null;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const button = (text, title) => Object.assign(el("button", "quiet", text), { type: "button", ...(title ? { title } : {}) });

export function openFrontBuilder(host) {
	open?.close();
	const back = document.activeElement;
	let { front, blocks } = readBlocks(host.text());
	const wrap = el("div", "palette compile front-builder");
	wrap.setAttribute("role", "dialog");
	wrap.setAttribute("aria-label", "Design the front page");
	const box = el("div", "compile-box");
	const head = el("header", "compile-head");
	const x = button("×");
	x.setAttribute("aria-label", "Close");
	head.append(el("h2", null, "Design the front page"), x);

	const side = el("div", "compile-form");
	side.append(el("p", "hint", "Your front page, top to bottom. Add blocks, fill them in, and move them with the arrows. It's saved as your Home note, so you can also edit it as text."));
	const list = el("ol", "fb-blocks");
	const addRow = el("div", "fb-add");
	const addPick = el("select");
	addPick.setAttribute("aria-label", "Block to add");
	for (const [v, label] of BLOCK_TYPES) addPick.append(new Option(label, v));
	const add = Object.assign(el("button", null, "Add block"), { type: "button" });
	addRow.append(addPick, add);
	const acts = el("div", "compile-actions");
	const saveBtn = Object.assign(el("button", null, "Save"), { type: "button" });
	const status = el("p", "hint");
	status.setAttribute("aria-live", "polite");
	acts.append(saveBtn);
	side.append(list, addRow, acts, status);

	const view = el("div", "website-side");
	const frame = Object.assign(el("iframe", "compile-preview"), { title: "Preview" });
	frame.setAttribute("sandbox", "");
	view.append(frame);
	const grid = el("div", "compile-grid");
	grid.append(side, view);
	box.append(head, grid);
	wrap.append(box);
	document.body.append(wrap);

	let dirty = false, timer = null, shown = 0;
	const changed = () => { dirty = true; status.textContent = "Not saved yet."; clearTimeout(timer); timer = setTimeout(preview, 300); };
	async function preview() {
		const n = ++shown;
		try { const html = await host.preview(writeBlocks(front, blocks)); if (n === shown) frame.srcdoc = html; }
		catch (e) { if (n === shown) frame.srcdoc = `<p style="font-family:sans-serif">Couldn't show the preview: ${String(e.message).replace(/</g, "&lt;")}</p>`; }
	}

	const input = (value, placeholder, on) => {
		const i = Object.assign(el("input"), { type: "text", value: value ?? "", placeholder });
		i.addEventListener("input", () => { on(i.value); changed(); });
		return i;
	};
	const choose = (options, value, on, label) => {
		const s = el("select");
		if (label) s.setAttribute("aria-label", label);
		for (const [v, text] of options) s.append(new Option(text, v, false, v === value));
		s.addEventListener("change", () => { on(s.value); changed(); });
		return s;
	};
	const labelled = (words, control) => { const l = el("label"); l.append(el("span", null, words), control); return l; };

	function editor(b) {
		const out = el("div", "fb-fields");
		if (b.type === "heading") {
			out.append(input(b.text, "A heading", (v) => (b.text = v)), choose([["1", "Big"], ["2", "Medium"], ["3", "Small"]], String(b.level || 2), (v) => (b.level = Number(v)), "Size"));
		} else if (b.type === "text") {
			const t = Object.assign(el("textarea"), { rows: Math.min(10, Math.max(3, (b.text || "").split("\n").length + 1)), value: b.text || "", placeholder: "Write something. **Bold**, *italic*, [links](https://…) and [[notes]] work." });
			t.addEventListener("input", () => { b.text = t.value; changed(); });
			out.append(t);
		} else if (b.type === "picture") {
			const pics = host.pictures();
			out.append(choose([["", pics.length ? "Choose a picture…" : "No pictures in the notebook yet"], ...pics.map((p) => [p, p])], b.path || "", (v) => (b.path = v), "Picture"));
		} else if (b.type === "posts") {
			out.append(
				labelled("From", choose([["", "Every folder"], ...host.folders().map((f) => [f, f])], b.folder || "", (v) => (b.folder = v))),
				labelled("How many", Object.assign(input(String(b.count || 5), "5", (v) => (b.count = parseInt(v, 10) || 5)), { type: "number", min: 1, max: 200 })),
				labelled("Show", choose([["summary", "Titles and a line or two"], ["title", "Just titles"], ["full", "Whole posts"]], b.show || "summary", (v) => (b.show = v))),
			);
		} else if (b.type === "links") {
			b.links ||= [];
			const rows = el("div", "fb-links");
			const draw = () => {
				rows.replaceChildren(...b.links.map((l, i) => {
					const row = el("div", "fb-link");
					const rm = button("×", "Remove this link");
					rm.addEventListener("click", () => { b.links.splice(i, 1); draw(); changed(); });
					row.append(input(l.text, "Words", (v) => (l.text = v)), input(l.url, "https://…", (v) => (l.url = v)), rm);
					return row;
				}));
			};
			draw();
			const more = button("+ Add a link");
			more.addEventListener("click", () => { b.links.push({ text: "", url: "" }); draw(); rows.lastChild?.querySelector("input")?.focus(); });
			out.append(rows, more);
		} else out.append(el("p", "hint", "A line across the page."));
		return out;
	}

	function draw() {
		list.replaceChildren(...blocks.map((b, i) => {
			const li = el("li", "fb-block");
			const top = el("div", "fb-top");
			const name = el("strong", null, (BLOCK_TYPES.find((t) => t[0] === b.type) || [, "Text"])[1]);
			const up = button("↑", "Move up"), down = button("↓", "Move down"), rm = button("Remove", "Remove this block");
			up.disabled = i === 0;
			down.disabled = i === blocks.length - 1;
			const move = (d) => { blocks.splice(i + d, 0, blocks.splice(i, 1)[0]); draw(); changed(); };
			up.addEventListener("click", () => move(-1));
			down.addEventListener("click", () => move(1));
			rm.addEventListener("click", () => { blocks.splice(i, 1); draw(); changed(); });
			top.append(name, up, down, rm);
			li.append(top, editor(b));
			return li;
		}));
		if (!blocks.length) list.append(el("li", "hint", "Nothing yet. Add a heading, some text, or your latest posts."));
	}

	add.addEventListener("click", () => {
		const type = addPick.value;
		blocks.push(type === "heading" ? { type, level: 2, text: "" } : type === "posts" ? { type, folder: "", count: 5, show: "summary" } : type === "links" ? { type, links: [{ text: "", url: "" }] } : type === "picture" ? { type, path: "" } : type === "divider" ? { type } : { type: "text", text: "" });
		draw();
		changed();
		list.lastChild?.querySelector("input, textarea, select")?.focus();
	});
	saveBtn.addEventListener("click", async () => {
		saveBtn.disabled = true;
		try {
			const text = writeBlocks(front, blocks);
			await host.save(text);
			({ front } = readBlocks(text));
			dirty = false;
			status.textContent = "Saved to your Home note. It goes online the next time you publish.";
		} catch (e) { status.textContent = "Couldn't save: " + e.message; }
		saveBtn.disabled = false;
	});

	function close() {
		if (dirty && !confirm("Close without saving your front page?")) return;
		clearTimeout(timer);
		wrap.remove();
		document.removeEventListener("keydown", esc, true);
		open = null;
		back?.focus?.();
	}
	const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
	x.addEventListener("click", close);
	document.addEventListener("keydown", esc, true);
	open = { close };
	draw();
	preview();
}
