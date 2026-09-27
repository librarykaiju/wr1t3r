// The table of contents: the note's headings, read from the editor's syntax
// tree so a "#" inside a code block or frontmatter never counts.

import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";

// [{level, from, text}] in document order.
export function headings(state) {
	const tree = ensureSyntaxTree(state, state.doc.length, 100) || syntaxTree(state);
	const out = [];
	tree.iterate({
		enter(n) {
			const m = /^(ATX|Setext)Heading([1-6])$/.exec(n.name);
			if (!m) return;
			const line = state.doc.lineAt(n.from).text;
			const raw = m[1] === "ATX" ? line.replace(/^ {0,3}#{1,6}(?=\s|$)/, "").replace(/(^|\s)#+\s*$/, "") : line;
			const text = plain(raw);
			if (text) out.push({ level: Number(m[2]), from: n.from, text });
			return false;
		},
	});
	return out;
}

// Heading text without markdown marks: links keep their text, wikilinks their
// alias or name.
export function plain(s) {
	return s
		.replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/!?\[\[([^\]]+)\]\]/g, "$1")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__|==|~~)(.+?)\1/g, "$2")
		.replace(/(\*|_)(.+?)\1/g, "$2")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

// Depth relative to the shallowest heading (so a note that starts at ## isn't
// all indented), whether each one has sub-headings, and its parent's index.
export function outline(list) {
	const min = Math.min(...list.map((h) => h.level));
	const stack = [];
	return list.map((h, i) => {
		while (stack.length && list[stack.at(-1)].level >= h.level) stack.pop();
		const parent = stack.length ? stack.at(-1) : -1;
		stack.push(i);
		const next = list[i + 1];
		return { ...h, depth: h.level - min, parent, hasKids: !!next && next.level > h.level };
	});
}

// Index of the heading whose section holds pos, or -1 above the first one.
export function activeIndex(list, pos) {
	let lo = 0, hi = list.length - 1, found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (list[mid].from <= pos) { found = mid; lo = mid + 1; } else hi = mid - 1;
	}
	return found;
}

// Hidden by a collapsed ancestor?
export function hidden(items, i, collapsed) {
	for (let p = items[i].parent; p !== -1; p = items[p].parent) if (collapsed.has(key(items[p]))) return true;
	return false;
}

export const key = (h) => `${h.level}:${h.text}`;
