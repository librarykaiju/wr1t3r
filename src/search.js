// Sidebar search, with Obsidian's operators: words (all must appear, in the
// note's text or path), "an exact phrase", path:folder, file:name, tag:x or
// #x (nested tags count: #book finds #book/fiction), and -word to leave notes
// out. Results show the first line that matches.

// "path:drafts \"red fox\" -old #idea" -> [{ kind, value, not }].
export function parseQuery(q) {
	const out = [];
	for (const m of q.matchAll(/(-?)(?:(path|file|tag):)?(?:"([^"]*)"?|(\S+))/gi)) {
		const value = (m[3] ?? m[4] ?? "").toLowerCase();
		if (!value && !m[2]) continue;
		let kind = m[2] ? m[2].toLowerCase() : m[3] != null ? "phrase" : "word";
		let v = value;
		if (kind === "word" && /^#[^\s#]+$/.test(v)) { kind = "tag"; v = v.slice(1); }
		if (kind === "tag") v = v.replace(/^#/, "");
		if (!v) continue;
		out.push({ kind, value: v, not: m[1] === "-" });
	}
	return out;
}

const baseName = (p) => p.split("/").pop().replace(/\.md$/i, "");

// Whether a note ({ path, text }) matches the parsed query. tagsOf(text) lists its tags.
export function matches(note, terms, tagsOf) {
	const path = note.path.toLowerCase();
	const text = (note.text || "").toLowerCase();
	let tags = null;
	return terms.every((t) => {
		let hit;
		if (t.kind === "path") hit = path.includes(t.value);
		else if (t.kind === "file") hit = baseName(path).includes(t.value);
		else if (t.kind === "tag") {
			tags ??= (note.text ? tagsOf(note.text) : []).map((x) => x.toLowerCase());
			hit = tags.some((x) => x === t.value || x.startsWith(t.value + "/"));
		} else hit = path.includes(t.value) || text.includes(t.value);
		return hit !== t.not;
	});
}

// The first line of text holding a word or phrase from the query, cut to
// about width characters around it: { before, match, after }, or null.
export function snippet(text, terms, width = 90) {
	if (!text) return null;
	const wanted = terms.filter((t) => !t.not && (t.kind === "word" || t.kind === "phrase")).map((t) => t.value);
	if (!wanted.length) return null;
	const lower = text.toLowerCase();
	const body = text.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/)?.[0].length || 0;
	let at = -1, len = 0;
	for (const w of wanted) {
		let i = lower.indexOf(w, body);
		if (i < 0) i = lower.indexOf(w);
		if (i >= 0 && (at < 0 || i < at)) { at = i; len = w.length; }
	}
	if (at < 0) return null;
	const start = text.lastIndexOf("\n", at) + 1;
	let end = text.indexOf("\n", at);
	if (end < 0) end = text.length;
	let from = start, to = end;
	if (to - from > width) {
		from = Math.max(start, at - Math.floor((width - len) / 3));
		to = Math.min(end, from + width);
	}
	return {
		before: (from > start ? "…" : "") + text.slice(from, at).replace(/^\s+/, ""),
		match: text.slice(at, at + len),
		after: text.slice(at + len, to).replace(/\s+$/, "") + (to < end ? "…" : ""),
	};
}

// Archived notes are left out of the notes list but still found by search.
// A note is archived when its frontmatter says `archived: true` or has
// `archived` as its `status` (scalar, [flow] list or "- item" list).
const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const bare = (s) => s.replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
export function isArchived(text) {
	const fm = text?.match(FRONTMATTER)?.[1];
	if (!fm || !/archived/i.test(fm)) return false;
	const lines = fm.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/^(archived|status)[ \t]*:(.*)$/i);
		if (!m) continue;
		const key = m[1].toLowerCase(), value = m[2].trim();
		if (key === "archived") { if (/^(true|yes)$/.test(bare(value))) return true; continue; }
		const items = value.startsWith("[") ? value.replace(/^\[|\].*$/g, "").split(",") : value ? [value] : [];
		for (let j = i + 1; !value && j < lines.length && /^\s*-\s|^\s*$/.test(lines[j]); j++) items.push(lines[j].replace(/^\s*-\s*/, ""));
		if (items.some((x) => bare(x) === "archived")) return true;
	}
	return false;
}

// "archive" or "archived" alone as the search lists every archived note.
export const asksForArchive = (terms) => terms.length === 1 && !terms[0].not && terms[0].kind === "word" && /^archived?$/.test(terms[0].value);

// The note's text archived (`archived: true` added, status left alone) or not
// (an `archived:` line dropped, and a `status: archived` emptied). setProperty
// is src/bases.js's, passed in so this file stays free of it.
export function archiveText(text, on, setProperty) {
	if (on) return isArchived(text) ? text : setProperty(text, "archived", true);
	let out = text;
	const m = text.match(FRONTMATTER);
	if (m) {
		const start = m.index + m[0].indexOf(m[1]);
		const lines = m[1].split(/(?<=\n)/);
		const kept = lines.filter((l) => !/^archived[ \t]*:/i.test(l));
		if (!kept.length) out = setProperty(text, "archived", null);
		else if (kept.length < lines.length) out = text.slice(0, start) + kept.join("").replace(/\r?\n$/, "") + text.slice(start + m[1].length);
	}
	return isArchived(out) ? setProperty(out, "status", null) : out;
}
