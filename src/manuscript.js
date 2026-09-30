// The manuscript layout: a note whose properties include
//   cssclasses:
//     - manuscript
// (Obsidian's own property for styling a note) is shown double-spaced with the
// first line of each paragraph indented, in the editor and in what Compile
// exports. Nothing is added to the text itself: no spaces, no tabs, so the
// file stays exactly as written. Obsidian can match it with the CSS snippet in
// the README.

import { frontmatterOf } from "./binder.js";

export const MANUSCRIPT = "manuscript";

// The note's CSS classes: cssclasses (a list or a comma/space separated string)
// and the older cssclass.
export function cssClasses(text) {
	const fm = frontmatterOf(text);
	const out = [];
	for (const v of [fm.cssclasses, fm.cssclass]) {
		for (const item of Array.isArray(v) ? v : v == null ? [] : [v]) {
			for (const c of String(item ?? "").split(/[\s,]+/)) if (c) out.push(c);
		}
	}
	return out;
}

export const isManuscript = (text) => /^---/.test(String(text || "")) && cssClasses(text).some((c) => c.toLowerCase() === MANUSCRIPT);

// In a manuscript, each line of prose is its own paragraph (as it shows in
// Obsidian and wr1t3r, where a single line break is kept). For export that
// means a blank line between them, so each gets its own indent. Headings,
// lists, quotes, tables, code and HTML are left as they are.
export function paragraphLines(text) {
	const lines = String(text).split("\n");
	const out = [];
	let fence = null, prevProse = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const f = line.match(/^\s*(`{3,}|~{3,})/);
		if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; out.push(line); prevProse = false; continue; }
		if (fence) { out.push(line); continue; }
		const prose = isProse(line) && !/^\s*(=+|-+)\s*$/.test(lines[i + 1] ?? "");
		if (prose && prevProse) {
			out[out.length - 1] = out[out.length - 1].replace(/( {2,}|\\)$/, "");
			out.push("");
		}
		out.push(line);
		prevProse = prose;
	}
	return out.join("\n");
}

function isProse(line) {
	if (!line.trim()) return false;
	if (/^( {4}|\t)/.test(line)) return false; // code, or a list's inner lines
	return !/^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\||<|\[\^[^\]]+\]:|(\*\s*){3,}$|(-\s*){3,}$|(_\s*){3,}$|=+\s*$|\$\$)/.test(line);
}
