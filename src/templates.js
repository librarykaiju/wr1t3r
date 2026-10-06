// Templates from the vault's _templates/ folder, as Obsidian's Templates and
// Templater plugins use them: a new note made from one, or one inserted into
// the open note. Templater's <% %> tags are filled in by src/daily.js (dates,
// the title), never run; prompts and pickers a template asks for come out
// empty, as when you cancel them in Obsidian.

const FM = /^---[ \t]*\r?\n([\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

const IN_TEMPLATES = /(^|\/)_templates\//i;

// Whether a path is in a _templates folder. Those stay out of the notes list;
// Aa > Templates lists them instead.
export const isTemplatePath = (path) => IN_TEMPLATES.test(path);

// The _templates folder new templates go in: the one the vault's templates
// are already in (the shallowest, if there are several), else home + "_templates/".
export function templatesFolder(paths, home = "") {
	const dirs = paths.filter((p) => /\.md$/i.test(p) && IN_TEMPLATES.test(p)).map((p) => p.slice(0, p.toLowerCase().indexOf("_templates/") + 11));
	return dirs.sort((a, b) => a.length - b.length)[0] || home + "_templates/";
}

// The templates among paths: [{ path, name }] by name.
export function templatesIn(paths) {
	return paths
		.filter((p) => /(^|\/)_templates\/.+\.md$/i.test(p))
		.map((p) => ({ path: p, name: p.slice(p.toLowerCase().lastIndexOf("_templates/") + 11).replace(/\.md$/i, "") }))
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

// Top-level properties as blocks of lines: [{ key, text }] (a key's list items
// and other indented lines belong to it).
function blocks(fmBody) {
	const out = [];
	for (const line of fmBody.split(/(?<=\n)/)) {
		const m = line.match(/^([^\s#-][^:]*):/);
		if (m) out.push({ key: m[1].trim(), text: line });
		else if (out.length) out[out.length - 1].text += line;
	}
	return out;
}

// What inserting a rendered template into a note at pos changes: the
// template's body goes at pos, and its properties the note doesn't have yet
// join the note's frontmatter (a note without any gets the template's).
// Existing properties are never changed. -> [{ from, to, insert }]
export function insertTemplate(note, rendered, pos) {
	const t = rendered.match(FM);
	const body = t ? rendered.slice(t[0].length).replace(/^\r?\n/, "") : rendered;
	const n = note.match(FM);
	const changes = [];
	if (t) {
		if (!n) changes.push({ from: 0, to: 0, insert: t[0] });
		else {
			const have = new Set(blocks(n[1] || "").map((b) => b.key.toLowerCase()));
			let add = blocks(t[1] || "").filter((b) => !have.has(b.key.toLowerCase())).map((b) => b.text).join("");
			if (add) {
				const close = n[0].lastIndexOf(n[0].match(/(?:---|\.\.\.)[ \t]*(?:\r?\n|$)$/)[0]);
				if (note.includes("\r\n")) add = add.replace(/\r?\n/g, "\r\n");
				changes.push({ from: close, to: close, insert: add });
			}
		}
	}
	if (n && pos < n[0].length) pos = n[0].length;
	if (body) changes.push({ from: pos, to: pos, insert: body });
	return changes;
}
