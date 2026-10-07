// Import from Evernote: .enex files (in Evernote, right-click a notebook >
// Export notebook, one file per notebook). Each note becomes a note in a
// folder named after its notebook, with its tags, dates, author and source
// address as properties. Pictures and other attachments are saved in the
// notebook's attachments folder and linked where they were in the note, and
// checkboxes become tasks.

import { frontmatter, uniquePath, fileName, xmlAll, xmlOne, xmlText, base64Bytes, extFor, embed, MAX_FILE } from "./imports.js";
import { isAttachmentPath } from "./paths.js";

// MD5 of bytes as hex: Evernote names each attachment in a note by it.
export function md5(bytes) {
	const K = new Int32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
	for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
	const n = bytes.length, words = new Int32Array(((n + 8 >> 6) + 1) * 16);
	for (let i = 0; i < n; i++) words[i >> 2] |= bytes[i] << (i % 4 * 8);
	words[n >> 2] |= 0x80 << (n % 4 * 8);
	words[words.length - 2] = n * 8;
	words[words.length - 1] = Math.floor(n / 0x20000000);
	let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
	for (let o = 0; o < words.length; o += 16) {
		let a = a0, b = b0, c = c0, d = d0;
		for (let i = 0; i < 64; i++) {
			let f, g;
			if (i < 16) { f = (b & c) | (~b & d); g = i; }
			else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
			else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
			else { f = c ^ (b | ~d); g = (7 * i) % 16; }
			const s = S[(i >> 4) * 4 + (i % 4)];
			const t = (a + f + K[i] + words[o + g]) | 0;
			a = d; d = c; c = b;
			b = (b + ((t << s) | (t >>> (32 - s)))) | 0;
		}
		a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
	}
	return [a0, b0, c0, d0].map((x) => [0, 8, 16, 24].map((s) => ((x >>> s) & 255).toString(16).padStart(2, "0")).join("")).join("");
}

// "20231005T142210Z" -> a Date.
const enDate = (s) => {
	const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || "");
	return m ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
};
const ymd = (d) => (d ? d.toISOString().slice(0, 10) : "");

// One .enex file. xml: its text; notebook: its file name without .enex.
// toMarkdown(html) -> markdown (src/convert.js in the page). taken: lower-case
// paths already used, shared across files.
// -> { notes: [{ path, text }], files: [{ path, bytes }], skipped, plugins }
export function readEnex(xml, notebook, toMarkdown, taken = new Set()) {
	if (!/<en-export[\s>]/.test(xml)) throw new Error(`${notebook}.enex isn't an Evernote export.`);
	const folder = fileName(notebook, "Evernote") + "/";
	const notes = [], files = [], skipped = [], plugins = [];
	for (const { inner } of xmlAll(xml, "note")) {
		const title = xmlOne(inner.replace(/<content>[\s\S]*<\/content>/, "").replace(/<resource>[\s\S]*<\/resource>/g, ""), "title") || "Untitled";
		const path = uniquePath(taken, folder + fileName(title) + ".md");
		// Attachments, by the MD5 the note's <en-media> tags name them by.
		const media = new Map();
		for (const r of xmlAll(inner, "resource")) {
			const b64 = (r.inner.match(/<data[^>]*>([\s\S]*?)<\/data>/) || [])[1];
			if (!b64) continue;
			const mime = xmlOne(r.inner, "mime");
			const given = xmlOne(r.inner, "file-name");
			let bytes;
			try { bytes = base64Bytes(b64); } catch { continue; }
			let name = fileName(given ? given.replace(/\.[^.]+$/, "") : title, "attachment") + "." + ((given && given.includes(".") ? given.slice(given.lastIndexOf(".") + 1) : extFor(mime)) || "bin").toLowerCase();
			if (!isAttachmentPath(folder + "attachments/" + name)) { skipped.push({ path: `${title}: ${given || mime}`, why: "a kind of file wr1t3r doesn't open" }); media.set(md5(bytes), { left: given || mime }); continue; }
			if (bytes.length > MAX_FILE) { skipped.push({ path: `${title}: ${given || name}`, why: "bigger than 20 MB" }); media.set(md5(bytes), { left: given || name }); continue; }
			const at = uniquePath(taken, folder + "attachments/" + name);
			files.push({ path: at, bytes });
			media.set(md5(bytes), { rel: at.slice(folder.length), name: given || "" });
		}
		let html = xmlText(xmlAll(inner, "content")[0]?.inner || "");
		html = (html.match(/<en-note[^>]*>([\s\S]*)<\/en-note>/) || [, html])[1];
		const marks = [];
		const mark = (md) => { marks.push(md); return `WRMARK${marks.length - 1}X`; };
		const features = [];
		html = html
			.replace(/<en-media([^>]*?)\/?>(?:\s*<\/en-media>)?/g, (all, a) => {
				const m = media.get((a.match(/hash="([0-9a-f]+)"/i) || [])[1]);
				return m?.rel ? mark(embed(m.rel, m.name)) : m?.left ? mark(`(${m.left} left out)`) : "";
			})
			.replace(/<en-todo([^>]*?)\/?>(?:\s*<\/en-todo>)?/g, (all, a) => mark(/checked="true"/.test(a) ? "[x] " : "[ ] "))
			.replace(/<en-crypt[^>]*>[\s\S]*?<\/en-crypt>/g, () => { features.push("encrypted text (left out)"); return mark("(encrypted text left out)"); });
		let body = html.trim() ? toMarkdown(html).trim() : "";
		// A checkbox starts its line: make it a task.
		body = body.replace(/^(\s*)(?:[-*] )?WRMARK(\d+)X\s*/gm, (all, sp, i) => (/^\[[ x]\] $/.test(marks[i]) ? `${sp}- ${marks[i]}` : all))
			.replace(/WRMARK(\d+)X/g, (all, i) => marks[i])
			.replace(/^(\s*- \[[ x]\] .*)\n\n(?=\s*- \[[ x]\] )/gm, "$1\n"); // one task per <div>: no blank lines between them
		const created = enDate(xmlOne(inner, "created")), updated = enDate(xmlOne(inner, "updated"));
		const attrs = xmlAll(inner, "note-attributes")[0]?.inner || "";
		const text = frontmatter([
			["title", title],
			["date", ymd(created)],
			["updated", ymd(updated) !== ymd(created) ? ymd(updated) : ""],
			["author", xmlOne(attrs, "author")],
			["source", xmlOne(attrs, "source-url")],
			["tags", xmlAll(inner, "tag").map((t) => xmlText(t.inner))],
		]) + `# ${title}\n\n` + (body ? body + "\n" : "");
		notes.push({ path, text });
		if (features.length) plugins.push({ path, features });
	}
	return { notes, files, skipped, plugins };
}
