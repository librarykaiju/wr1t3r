// Autocomplete for links: typing "[[" lists notes (filtered as you type), and
// "[[Note#" lists that note's headings ("[[#" this note's). Picking one
// writes the shortest name that finds the note, the way Obsidian does, and
// closes the link with "]]" unless it's already closed.

import { vaultHost, notePath } from "./vault.js";
import { headingsOf } from "./vaultlinks.js";
import { resolveNote } from "./links.js";

const baseName = (p) => p.split("/").pop().replace(/\.md$/i, "");

// The shortest link text that resolves to path from the note at fromPath.
export function linkText(path, fromPath, paths) {
	const name = baseName(path);
	if (resolveNote({ note: name, wiki: true }, fromPath, paths) === path) return name;
	return path.replace(/\.md$/i, "");
}

const closing = (state, pos) => (state.sliceDoc(pos, pos + 2) === "]]" ? "" : "]]");

export function linkSource(context) {
	const host = context.state.facet(vaultHost);
	if (!host) return null;
	const line = context.state.doc.lineAt(context.pos);
	const before = line.text.slice(0, context.pos - line.from);
	const m = before.match(/\[\[([^\[\]\n|]*)$/);
	if (!m) return null;
	const inner = m[1];
	const from = context.pos - inner.length;
	const here = context.state.facet(notePath);
	const paths = host.paths();
	const hash = inner.indexOf("#");
	if (hash >= 0) {
		const note = inner.slice(0, hash);
		const target = note.trim() ? resolveNote({ note, wiki: true }, here, paths) : here;
		if (!target) return null;
		const text = target === here ? context.state.sliceDoc() : host.text(target);
		const options = [...new Set(headingsOf(text || ""))].map((h) => ({
			label: h,
			type: "heading",
			apply: (view, c, f, to) => {
				const insert = h + closing(view.state, to);
				view.dispatch({ changes: { from: f, to, insert }, selection: { anchor: f + insert.length } });
			},
		}));
		return options.length ? { from: from + hash + 1, options, validFor: /^[^\]\n|]*$/ } : null;
	}
	const counts = new Map();
	for (const p of paths) counts.set(baseName(p).toLowerCase(), (counts.get(baseName(p).toLowerCase()) || 0) + 1);
	const options = paths
		.filter((p) => p !== here)
		.map((p) => {
			const name = baseName(p);
			const folder = p.includes("/") ? p.slice(0, p.lastIndexOf("/")).replace(/^content(\/|$)/, "") : "";
			return {
				label: name,
				detail: counts.get(name.toLowerCase()) > 1 || folder ? folder : undefined,
				type: "note",
				apply: (view, c, f, to) => {
					const insert = linkText(p, here, paths) + closing(view.state, to);
					view.dispatch({ changes: { from: f, to, insert }, selection: { anchor: f + insert.length } });
				},
			};
		});
	return { from, options, validFor: /^[^\]\n|#]*$/ };
}
