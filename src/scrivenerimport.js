// Import from Scrivener: a project (the .scriv folder, or a .zip of it), from
// Scrivener 3 on Mac or Windows, or Scrivener 1 and 2. The binder becomes
// folders and notes in the same order, each folder with a _Binder.md
// (src/binder.js), so the storyboard, outliner, draft and compile show it the
// way Scrivener did. Each document's text comes over from its RTF
// (src/rtf.js) with its synopsis, label, status, keywords and custom metadata
// as properties, its document notes in a %% comment at the end (compile
// leaves those out), and its comments as review comments. Pictures and PDFs
// in the binder go in an attachments folder, each with a note that shows it.

import { frontmatter, uniquePath, fileName, decodeEntities, attrsOf, embed, plural, yamlValue } from "./imports.js";
import { isAttachmentPath } from "./paths.js";
import { rtfToMarkdown } from "./rtf.js";

// ---- a small XML reader: the binder nests, so a tree is needed ----------------------

// -> { name, attrs, children, text } for the document's root element.
export function parseXml(xml) {
	const root = { name: "#root", attrs: {}, children: [], text: "" };
	const stack = [root];
	const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
	for (const m of String(xml || "").matchAll(re)) {
		const top = stack[stack.length - 1];
		if (m[1] != null) top.text += m[1];
		else if (m[2]) { if (stack.length > 1 && top.name === m[2]) stack.pop(); }
		else if (m[3]) {
			const el = { name: m[3], attrs: attrsOf(m[4] || ""), children: [], text: "" };
			top.children.push(el);
			if (!m[5]) stack.push(el);
		} else if (m[6] != null) top.text += decodeEntities(m[6]);
	}
	return root.children[0] || root;
}

const kid = (el, name) => el?.children.find((c) => c.name === name) || null;
const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
const textIn = (el) => (el ? (el.text + el.children.map(textIn).join("")).trim() : "");

// ---- the project's lists ------------------------------------------------------------

// { labels: Map id -> { name, slot }, statuses: Map id -> name, keywords: Map id -> name, fields: Map id -> { key, title, type, options } }
export function projectLists(project) {
	const labels = new Map();
	let slot = 0;
	for (const l of kids(kid(kid(project, "LabelSettings"), "Labels"), "Label")) {
		const id = l.attrs.ID;
		if (id == null || id === "-1") continue;
		slot++;
		labels.set(id, { name: textIn(l), slot: slot <= 7 ? slot : null });
	}
	const statuses = new Map();
	for (const s of kids(kid(kid(project, "StatusSettings"), "StatusItems"), "Status")) if (s.attrs.ID != null && s.attrs.ID !== "-1") statuses.set(s.attrs.ID, textIn(s));
	const keywords = new Map();
	for (const k of kids(kid(project, "Keywords"), "Keyword")) keywords.set(k.attrs.ID, textIn(kid(k, "Title")) || k.text.trim());
	const fields = new Map(), keys = new Set(["title", "synopsis", "label", "label-name", "status", "tags", "compile"]);
	for (const f of kids(kid(project, "CustomMetaDataSettings"), "MetaDataField")) {
		const title = textIn(kid(f, "Title")) || f.attrs.ID;
		let key = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "field";
		if (keys.has(key)) key = "scrivener_" + key;
		keys.add(key);
		const options = new Map(kids(kid(f, "ListOptions"), "Option").map((o) => [o.attrs.ID, textIn(o)]));
		fields.set(f.attrs.ID, { key, title, type: (f.attrs.Type || "Text").toLowerCase(), options });
	}
	return { labels, statuses, keywords, fields };
}

// A custom metadata value as a property value.
function fieldValue(field, raw) {
	const v = String(raw ?? "").trim();
	if (!v) return "";
	if (field?.type === "checkbox") return /^(yes|true|1)$/i.test(v);
	if (field?.type === "date") return (v.match(/^\d{4}-\d{2}-\d{2}/) || [v])[0];
	if (field?.options?.has(v)) return field.options.get(v);
	return v;
}

// ---- the import ---------------------------------------------------------------------

// From a note at from to a file at to (both inside the project), as a relative link target.
function relative(from, to) {
	const a = from.split("/").slice(0, -1), b = to.split("/");
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
	return "../".repeat(a.length - i) + b.slice(i).join("/");
}

const hrefFor = (name) => encodeURI(name).replace(/\(/g, "%28").replace(/\)/g, "%29") + "/";
const binderLine = (it, n) => {
	const name = it.path.replace(/\/$/, "").split("/").pop().replace(/\.md$/i, "");
	return `${n}. ` + (it.kind === "folder" ? `[${name.replace(/([[\]])/g, "\\$1")}](${hrefFor(name)})` : `[[${name}]]`);
};
const BINDER_NOTE = "%% The order of this folder in wr1t3r (storyboard, outliner, compile). Reorder the list to reorder the folder. %%";

// paths: every file in the project, inside the .scriv folder ("Project.scrivx",
// "Files/Data/<id>/content.rtf", ...). text(path): a file's text (the .rtf ones
// one character per byte), or null. name: the project's name, for when the
// paths don't say it.
// -> { name, notes: [{ path, text }], files: [{ path, from } | { path, bytes }], skipped, remarks }
export function readScrivener(paths, text, name = "") {
	const scrivx = paths.filter((p) => /\.scrivx$/i.test(p)).sort((a, b) => a.split("/").length - b.split("/").length)[0];
	if (!scrivx) throw new Error("That isn't a Scrivener project: there's no .scrivx file in it. Pick the project's .scriv folder, or a .zip of it.");
	const base = scrivx.slice(0, scrivx.lastIndexOf("/") + 1);
	const project = parseXml(text(scrivx) || "");
	const binder = kid(project, "Binder");
	if (!binder) throw new Error("That Scrivener project's binder couldn't be read.");
	const projectName = (base ? base.slice(0, -1).split("/").pop() : name || scrivx).replace(/\.(scriv|scrivx|zip)$/i, "") || "Scrivener project";
	const lists = projectLists(project);
	const have = new Set(paths);
	const byFolder = new Map(); // "Files/Data/<id>/" -> [file names]
	for (const p of paths) {
		const at = p.lastIndexOf("/") + 1;
		const f = p.slice(0, at);
		if (!byFolder.has(f)) byFolder.set(f, []);
		byFolder.get(f).push(p.slice(at));
	}

	const notes = [], files = [], skipped = [];
	const taken = new Set(["attachments"]);
	const used = { labels: new Set(), notes: 0, comments: 0, trash: 0 };

	// Where an item's files are: Scrivener 3 keeps a folder per document, 1 and 2 a flat folder by number.
	function filesOf(item) {
		const uuid = item.attrs.UUID, id = item.attrs.ID;
		if (uuid) {
			const dir = `${base}Files/Data/${uuid}/`;
			const names = byFolder.get(dir) || [];
			const media = names.find((n) => /^content\./i.test(n) && !/\.(rtf|rtfd|comments|styles|txt|xml)$/i.test(n));
			return { dir, content: dir + "content.rtf", notes: dir + "notes.rtf", synopsis: dir + "synopsis.txt", comments: dir + "content.comments", media: media ? dir + media : null };
		}
		const dir = `${base}Files/Docs/`;
		const names = byFolder.get(dir) || [];
		const media = names.find((n) => n.toLowerCase().startsWith(id + ".") && !/\.(rtf|rtfd|txt)$/i.test(n));
		return { dir, content: `${dir}${id}.rtf`, notes: `${dir}${id}_notes.rtf`, synopsis: `${dir}${id}_synopsis.txt`, comments: `${dir}${id}_comments.xml`, media: media ? dir + media : null };
	}

	// Scrivener 3's linked comments and footnotes: id -> { text, footnote }.
	function commentsOf(path) {
		const out = new Map();
		const xml = have.has(path) ? text(path) : null;
		if (!xml) return out;
		for (const c of kids(parseXml(xml), "Comment")) {
			const raw = textIn(c);
			const body = raw.startsWith("{\\rtf") ? rtfToMarkdown(raw).text : raw;
			out.set(c.attrs.ID, { text: body, footnote: /^(yes|true)$/i.test(c.attrs.Footnote || c.attrs.IsFootnote || "") });
		}
		return out;
	}

	// An item's own text as markdown, with its pictures saved. -> { body, notes }
	function textOf(item, title, notePath, where) {
		const f = filesOf(item);
		const comments = commentsOf(f.comments);
		let pics = 0;
		const image = (pic) => {
			let from = null, ext, bytes = null;
			if (pic.bytes) { bytes = pic.bytes; ext = pic.ext; }
			else {
				from = have.has(f.dir + pic.file) ? f.dir + pic.file : paths.find((p) => p.startsWith(base + "Files/") && p.endsWith("/" + pic.file)) || null;
				if (!from) return "";
				ext = pic.file.includes(".") ? pic.file.slice(pic.file.lastIndexOf(".") + 1).toLowerCase() : "";
			}
			const att = `attachments/${fileName(title, "picture")} ${++pics}.${ext}`;
			if (!isAttachmentPath(att)) { skipped.push({ path: `${where}: ${pic.file || "a picture"}`, why: "a kind of picture wr1t3r doesn't open" }); return ""; }
			const path = uniquePath(taken, att);
			files.push(bytes ? { path, bytes } : { path, from });
			return embed(relative(notePath, path));
		};
		const read = (path, opts) => {
			const t = have.has(path) ? text(path) : null;
			if (!t || !t.trim()) return "";
			const r = rtfToMarkdown(t, opts);
			for (const why of r.features) skipped.push({ path: where, why });
			return r.text;
		};
		const body = read(f.content, { image, comment: (id) => { const c = comments.get(id); if (c) used.comments++; return c; } });
		const extra = read(f.notes, { image });
		const synopsis = have.has(f.synopsis) ? (text(f.synopsis) || "").replace(/\s+/g, " ").trim() : "";
		return { body, notes: extra, synopsis, media: f.media };
	}

	// An item's properties.
	function propsOf(item, title, synopsis, inDraft) {
		const meta = kid(item, "MetaData") || item;
		const pairs = [];
		if (fileName(title) !== title) pairs.push(["title", title]);
		if (synopsis) pairs.push(["synopsis", synopsis]);
		const label = lists.labels.get(textIn(kid(meta, "LabelID")) || textIn(kid(item, "LabelID")));
		if (label) {
			used.labels.add(label);
			if (label.slot) pairs.push(["label", label.slot]);
			pairs.push(["label-name", label.name]);
		}
		const status = lists.statuses.get(textIn(kid(meta, "StatusID")) || textIn(kid(item, "StatusID")));
		if (status) pairs.push(["status", status]);
		const kw = kid(item, "Keywords") || kid(meta, "Keywords");
		const tags = kw ? kw.children.map((k) => lists.keywords.get(textIn(k)) || lists.keywords.get(k.attrs.ID) || "").filter(Boolean) : [];
		if (tags.length) pairs.push(["tags", tags]);
		for (const m of kids(kid(meta, "CustomMetaData"), "MetaDataItem")) {
			const field = lists.fields.get(textIn(kid(m, "FieldID")));
			const v = fieldValue(field, textIn(kid(m, "Value")));
			if (v !== "") pairs.push([field?.key || textIn(kid(m, "FieldID")), v]);
		}
		const inc = textIn(kid(meta, "IncludeInCompile"));
		if (inDraft && /^no$/i.test(inc)) pairs.push(["compile", false]);
		return pairs;
	}

	function noteText(pairs, body, extra) {
		const head = pairs.length ? frontmatter(pairs) : "";
		let out = body ? body + "\n" : "";
		if (extra) {
			used.notes++;
			out += (out ? "\n" : "") + "%%\nNotes from Scrivener:\n\n" + extra.replace(/%%/g, "% %") + "\n%%\n";
		}
		return head + out;
	}

	const countItems = (items) => items.reduce((n, it) => n + 1 + countItems(kids(kid(it, "Children"), "BinderItem")), 0);

	// The items in one binder folder, written under folder. -> [{ kind, path }] in order.
	function walk(items, folder, inDraft, trail) {
		const order = [];
		for (const item of items) {
			const type = item.attrs.Type || "Text";
			const children = kids(kid(item, "Children"), "BinderItem");
			if (type === "TrashFolder") { used.trash += countItems(children); continue; }
			const title = textIn(kid(item, "Title")) || "Untitled";
			const where = trail ? `${trail} > ${title}` : title;
			const draft = inDraft || type === "DraftFolder";
			if (/Folder$/.test(type) || children.length) {
				const dir = uniquePath(taken, folder + fileName(title)) + "/";
				const inner = [];
				const own = dir + fileName(title) + ".md";
				const t = textOf(item, title, own, where);
				const pairs = propsOf(item, title, t.synopsis, draft);
				if (t.body || t.notes || (type === "Text" && pairs.length) || t.synopsis) {
					const path = uniquePath(taken, own);
					notes.push({ path, text: noteText(pairs, t.body, t.notes) });
					inner.push({ kind: "note", path });
				}
				inner.push(...walk(children, dir, draft, where));
				const settings = type === "DraftFolder" ? `---\ncompile:\n  title: ${yamlValue(projectName)}\n---\n` : "";
				notes.push({ path: dir + "_Binder.md", text: settings + [BINDER_NOTE, "", ...inner.map((it, k) => binderLine(it, k + 1)), ""].join("\n") });
				order.push({ kind: "folder", path: dir });
				continue;
			}
			const path = uniquePath(taken, folder + fileName(title) + ".md");
			const t = textOf(item, title, path, where);
			const pairs = propsOf(item, title, t.synopsis, draft);
			let body = t.body;
			if (type !== "Text") {
				if (t.media && isAttachmentPath("attachments/x." + t.media.split(".").pop().toLowerCase())) {
					const att = uniquePath(taken, `attachments/${fileName(title, "file")}.${t.media.split(".").pop().toLowerCase()}`);
					files.push({ path: att, from: t.media });
					body = embed(relative(path, att), title) + (body ? "\n\n" + body : "");
				} else if (t.media) skipped.push({ path: where, why: `a ${t.media.split(".").pop()} file, which wr1t3r doesn't open` });
				else if (type === "WebArchive") skipped.push({ path: where, why: "a web archive, which wr1t3r doesn't open" });
				else if (!body) skipped.push({ path: where, why: "its file wasn't in the project" });
			}
			notes.push({ path, text: noteText(pairs, body, t.notes) });
			order.push({ kind: "note", path });
		}
		return order;
	}

	const top = walk(kids(binder, "BinderItem"), "", false, "");
	notes.push({ path: "_Binder.md", text: [BINDER_NOTE, "", ...top.map((it, k) => binderLine(it, k + 1)), ""].join("\n") });

	const remarks = [];
	const draft = kids(binder, "BinderItem").find((it) => it.attrs.Type === "DraftFolder");
	if (draft) remarks.push(`Right-click the ${textIn(kid(draft, "Title")) || "Draft"} folder for its Storyboard, Outliner, Draft and Compile, in the same order as Scrivener's binder.`);
	if (used.labels.size) {
		const colored = [...used.labels].filter((l) => l.slot).sort((a, b) => a.slot - b.slot);
		remarks.push("Labels are in each note's `label-name` property" + (colored.length ? ", and their colors are the theme's: " + colored.map((l) => `${l.name} is color ${l.slot}`).join(", ") : "") + ".");
	}
	if (used.notes) remarks.push(`${plural(used.notes, "document's notes", "documents' notes")} are at the end of the note, between %% marks, so compile leaves them out.`);
	if (used.comments) remarks.push(`${plural(used.comments, "comment")} came in as review comments (and linked footnotes as footnotes).`);
	if (used.trash) remarks.push(`Left out ${plural(used.trash, "item")} in Scrivener's Trash.`);
	if (paths.some((p) => /(^|\/)snapshots\//i.test(p.slice(base.length)) || /\.snapshots\//i.test(p))) remarks.push("Snapshots stay in Scrivener; each note has the current text.");
	return { name: projectName, notes, files, skipped, remarks };
}
