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
