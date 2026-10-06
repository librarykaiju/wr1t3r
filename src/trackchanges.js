// Track changes, written as CriticMarkup so the changes live in the note's own
// text, sync like any edit, and Obsidian (and any CriticMarkup tool) reads them:
//   {++added++}  {--deleted--}  {~~old~>new~~}  {==marked==}{>>a comment<<}
// While tracking is on, typing goes in as an insertion and deleting strikes
// text out instead of removing it; deleting text you inserted removes it for
// real. Each change can be accepted or rejected. This file is the text side;
// src/trackview.js wires it into the editor.

const TOKEN = /\{\+\+([\s\S]*?)\+\+\}|\{--([\s\S]*?)--\}|\{~~([\s\S]*?)~>([\s\S]*?)~~\}|\{==([\s\S]*?)==\}|\{>>([\s\S]*?)<<\}/g;

// Fenced code is left alone: markup there is just text.
function codeRanges(text) {
	const out = [];
	const re = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))/gm;
	for (const m of text.matchAll(re)) out.push([m.index, m.index + m[0].length]);
	return out;
}

// Every change in the text, in order:
// { type: "ins"|"del"|"sub"|"mark"|"comment", from, to, text, old?, new? }.
// from/to cover the markup; for ins/del/mark/comment, text is what's inside.
export function changesIn(text) {
	const code = codeRanges(text);
	const out = [];
	for (const m of text.matchAll(TOKEN)) {
		const from = m.index, to = from + m[0].length;
		if (code.some(([a, b]) => from >= a && from < b)) continue;
		if (m[1] != null) out.push({ type: "ins", from, to, text: m[1] });
		else if (m[2] != null) out.push({ type: "del", from, to, text: m[2] });
		else if (m[3] != null) out.push({ type: "sub", from, to, old: m[3], new: m[4] });
		else if (m[5] != null) out.push({ type: "mark", from, to, text: m[5] });
		else out.push({ type: "comment", from, to, text: m[6] });
	}
	return out;
}

// The edit that accepts (or, with accept false, rejects) a change.
export function resolveChange(c, accept) {
	const keep = c.type === "ins" ? (accept ? c.text : "")
		: c.type === "del" ? (accept ? "" : c.text)
		: c.type === "sub" ? (accept ? c.new : c.old)
		: c.type === "mark" ? c.text
		: ""; // a comment goes either way
	return { from: c.from, to: c.to, insert: keep };
}

// Every change accepted or rejected at once (comments and marks are kept;
// they aren't changes to the text).
export function resolveAll(text, accept) {
	const changes = changesIn(text).filter((c) => c.type === "ins" || c.type === "del" || c.type === "sub");
	return { changes: changes.map((c) => resolveChange(c, accept)), count: changes.length };
}

// ---- Tracking an edit -------------------------------------------------------
// The text around an edit is read as atoms: each visible character, marked
// plain, inserted or deleted (the markup itself takes no atoms). The edit is
// applied to the atoms (plain characters it removes become deleted ones,
// inserted ones just go, deleted ones stay), and the atoms are written back
// as markup, so neighboring changes merge: "{--ab--}{--c--}" never happens.

const OPEN = { ins: "{++", del: "{--" }, CLOSE = { ins: "++}", del: "--}" };

// The span of text to rework for an edit of [from, to]: those positions, grown
// to cover any insertion, deletion or substitution they touch.
function region(changes, from, to) {
	let a = from, b = to;
	for (const c of changes) {
		if (c.type !== "ins" && c.type !== "del" && c.type !== "sub") continue;
		if (c.to >= a && c.from <= b) { a = Math.min(a, c.from); b = Math.max(b, c.to); }
	}
	return [a, b];
}

// Atoms for text[a, b), and where each document position in it falls: pos ->
// atom index (the atom right after it).
function atomize(text, changes, a, b) {
	const atoms = [], index = new Map();
	let pos = a;
	const plain = (upto) => { for (; pos < upto; pos++) { index.set(pos, atoms.length); atoms.push({ ch: text[pos], kind: "plain" }); } };
	const run = (start, s, kind) => { for (let i = 0; i < s.length; i++) { index.set(start + i, atoms.length); atoms.push({ ch: s[i], kind }); } };
	for (const c of changes) {
		if (c.from < a || c.to > b || (c.type !== "ins" && c.type !== "del" && c.type !== "sub")) continue;
		plain(c.from);
		// The opening marker's positions belong to the atom after it.
		for (let p = c.from; p < c.from + 3; p++) index.set(p, atoms.length);
		if (c.type === "sub") {
			run(c.from + 3, c.old, "del");
			for (let p = c.from + 3 + c.old.length; p < c.from + 5 + c.old.length; p++) index.set(p, atoms.length);
			run(c.from + 5 + c.old.length, c.new, "ins");
		} else run(c.from + 3, c.text, c.type);
		for (let p = c.to - 3; p < c.to; p++) index.set(p, atoms.length);
		pos = c.to;
	}
	plain(b);
	index.set(b, atoms.length);
	return { atoms, at: (p) => index.get(p) ?? atoms.length };
}

// Atoms back to text, deletions before insertions where they meet. Also gives
// where each atom's character landed, and where each group opens and closes.
function write(atoms) {
	let out = "";
	const charAt = [], openAt = [], closeAt = [];
	for (let i = 0; i < atoms.length; i++) {
		const k = atoms[i].kind, prev = atoms[i - 1]?.kind;
		if (k !== prev) {
			if (prev && prev !== "plain") out += CLOSE[prev];
			openAt[i] = out.length;
			if (k !== "plain") out += OPEN[k];
		} else openAt[i] = out.length;
		charAt[i] = out.length;
		out += atoms[i].ch;
		closeAt[i] = out.length + (atoms[i + 1]?.kind !== k && k !== "plain" ? 3 : 0);
	}
	const last = atoms.at(-1)?.kind;
	if (last && last !== "plain") out += CLOSE[last];
	return { out, charAt, openAt, closeAt };
}

// A typed, pasted or deleted edit, tracked: { from, to, insert } (the change
// to make instead) and cursor (where the cursor goes), or null when there's
// nothing to change (backspacing over text already struck out just moves the
// cursor: then cursor is set and from === to, insert "").
// edit: { from, to, insert, backward, cursor } -- cursor is where the original
// edit put the cursor, as an offset into the inserted text (or null for its end).
export function trackEdit(text, edit) {
	const changes = changesIn(text);
	// Inside a comment or a code block, edits aren't tracked.
	if (changes.some((c) => c.type === "comment" && edit.from > c.from && edit.to < c.to)) return null;
	if (codeRanges(text).some(([a, b]) => edit.from > a && edit.to < b)) return null;
	const [a, b] = region(changes, edit.from, edit.to);
	const { atoms, at } = atomize(text, changes, a, b);
	let i = at(edit.from), j = edit.to > edit.from ? at(edit.to) : i;
	// A delete that only caught markup (hidden on screen) takes the character beyond it.
	if (edit.to > edit.from && i === j && !edit.insert) {
		if (edit.backward && i > 0) i--;
		else if (!edit.backward && j < atoms.length) j++;
	}
	const before = atoms.slice(0, i), hit = atoms.slice(i, j), after = atoms.slice(j);
	// What the edit takes out: plain text is struck, inserted text goes, struck text stays.
	const kept = hit.filter((x) => x.kind !== "ins").map((x) => ({ ch: x.ch, kind: "del" }));
	const added = [...edit.insert].map((ch) => ({ ch, kind: "ins" }));
	if (!added.length && kept.length === hit.length && hit.every((x) => x.kind === "del")) {
		// Nothing to delete: only struck text (or markup) was in the way.
		const w = write(atoms);
		const cursor = edit.backward
			? a + (i < atoms.length ? w.openAt[i] : w.out.length)
			: a + (j > 0 ? w.closeAt[j - 1] : 0);
		return { from: a, to: a, insert: "", cursor, noop: true };
	}
	const next = [...before, ...kept, ...added, ...after];
	const { out, charAt, openAt, closeAt } = write(next);
	let cursor;
	if (added.length) {
		const k = edit.cursor == null ? added.length : Math.max(0, Math.min(edit.cursor, added.length));
		const first = before.length + kept.length;
		cursor = a + (k < added.length ? charAt[first + k] : charAt[first + added.length - 1] + 1);
	} else if (!kept.length) {
		// Only inserted text went: the cursor stays where it was, inside its neighbors' markup.
		cursor = a + (before.length ? charAt[before.length - 1] + 1 : next.length ? openAt[0] : 0);
	} else if (edit.backward) {
		cursor = a + (before.length < next.length ? openAt[before.length] : out.length);
	} else {
		const end = before.length + kept.length;
		cursor = a + (end > 0 ? closeAt[end - 1] : 0);
	}
	return { from: a, to: b, insert: out, cursor };
}

// The change under (or next to) pos, or null.
export function changeAt(text, pos) {
	return changesIn(text).find((c) => c.type !== "comment" && pos >= c.from && pos <= c.to) || null;
}

// Wraps [from, to) for a comment: {==text==}{>>|<<}, the cursor in the comment.
export function commentEdit(text, from, to) {
	const sel = text.slice(from, to);
	const insert = sel ? `{==${sel}==}{>><<}` : "{>><<}";
	return { from, to, insert, cursor: from + insert.length - 3 };
}

// The text as it reads with every change accepted and comments taken out:
// what exports and compiles use.
export function finalText(text) {
	if (!/\{(\+\+|--|~~|==|>>)/.test(text)) return text;
	let out = text;
	for (const c of changesIn(text).reverse()) out = out.slice(0, c.from) + resolveChange(c, true).insert + out.slice(c.to);
	return out;
}
