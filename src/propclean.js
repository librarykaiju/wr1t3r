// Cleaning up properties across the vault (src/propcleanview.js draws it):
// every key with how many notes use it and how many of those are empty, and
// the edits that rename, merge or delete a key, or clear empty values. Each
// edit touches only the lines of the property it's about; the rest of the
// note stays byte for byte.

const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#-][^:]*?)\s*:(?=\s|$)/;
const EMPTY_VALUE = /^(|""|''|\[\s*\])$/;
const BLANK_ITEM = /^\s*-\s*(|""|'')\s*$/;

const unquote = (k) => (/^".*"$/.test(k) ? JSON.parse(k) : /^'.*'$/.test(k) ? k.slice(1, -1).replace(/''/g, "'") : k);
const valueOf = (line) => line.replace(KEY, "").replace(/\s+#.*$/, "").trim();

// The note's properties: { nl, lines, items: [{ key, from, to, empty, blank }] }
// with each item's lines [from, to) and the blank list items ("- ", '- ""')
// under it, or null when the note has no frontmatter.
export function properties(text) {
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	if (!/^---[ \t]*$/.test(lines[0] ?? "")) return null;
	let close = -1;
	for (let n = 1; n < lines.length; n++) if (/^(---|\.\.\.)[ \t]*$/.test(lines[n])) { close = n; break; }
	if (close < 0) return null;
	const items = [];
	for (let n = 1; n < close; n++) {
		const m = lines[n].match(KEY);
		if (!m) continue;
		let end = n + 1;
		while (end < close && (/^\s+\S/.test(lines[end]) || /^-(\s|$)/.test(lines[end]) || !lines[end].trim())) end++;
		while (end > n + 1 && !lines[end - 1].trim()) end--;
		const kids = lines.slice(n + 1, end).map((l, i) => ({ l, i: n + 1 + i })).filter(({ l }) => l.trim());
		const listed = kids.filter(({ l }) => /^\s*-(\s|$)/.test(l));
		const blank = listed.filter(({ l }) => BLANK_ITEM.test(l)).map(({ i }) => i);
		const value = valueOf(lines[n]);
		const empty = EMPTY_VALUE.test(value) && kids.length === blank.length;
		items.push({ key: unquote(m[1].trim()), from: n, to: end, empty, blank: empty ? [] : blank });
		n = end - 1;
	}
	return { nl, lines, items };
}

// Every key in the notes ({ path: text }): [{ key, notes, empty, paths, emptyPaths }],
// most used first.
export function propertyIndex(notes) {
	const by = new Map();
	for (const [path, text] of Object.entries(notes)) {
		const p = text == null ? null : properties(text);
		if (!p) continue;
		for (const it of p.items) {
			const r = by.get(it.key) || { key: it.key, notes: 0, empty: 0, blanks: 0, paths: [], emptyPaths: [] };
			r.notes++;
			r.paths.push(path);
			if (it.empty) { r.empty++; r.emptyPaths.push(path); }
			if (it.blank.length) r.blanks++;
			by.set(it.key, r);
		}
	}
	return [...by.values()].sort((a, b) => b.notes - a.notes || a.key.localeCompare(b.key));
}

// The note with the given lines taken out.
function without(p, drop) {
	if (!drop.size) return null;
	return p.lines.filter((_, n) => !drop.has(n)).join(p.nl);
}

// The note without property `key` (every line of it).
export function deleteKey(text, key) {
	const p = properties(text);
	const it = p?.items.find((x) => x.key === key);
	if (!it) return text;
	const drop = new Set();
	for (let n = it.from; n < it.to; n++) drop.add(n);
	return without(p, drop);
}

// The note without empty values: properties with nothing in them ("key:",
// 'key: ""', "key: []", lists of only blank items), and blank items in lists
// that have others. Only `key`'s, or every key's when key is null.
export function clearEmpty(text, key = null) {
	const p = properties(text);
	if (!p) return text;
	const drop = new Set();
	for (const it of p.items) {
		if (key != null && it.key !== key) continue;
		if (it.empty) for (let n = it.from; n < it.to; n++) drop.add(n);
		else for (const n of it.blank) drop.add(n);
	}
	return without(p, drop) ?? text;
}

export const validKey = (k) => /^[\p{L}\p{N}_][\p{L}\p{N}_ .-]*$/u.test(String(k)) && !/\s$/.test(k);

// The note with property `from` renamed to `to`: { text, conflict }. If the
// note has both, an empty one gives way to the other; if both have values,
// the note is left as it is and conflict is true.
export function renameKey(text, from, to) {
	const p = properties(text);
	const a = p?.items.find((x) => x.key === from);
	if (!a || from === to) return { text, conflict: false };
	const b = p.items.find((x) => x.key === to);
	if (b && !a.empty && !b.empty) return { text, conflict: true };
	if (b && a.empty) return { text: deleteKey(text, from), conflict: false };
	const lines = [...p.lines];
	lines[a.from] = lines[a.from].replace(KEY, (m, k) => m.replace(k, to));
	const drop = new Set();
	if (b) for (let n = b.from; n < b.to; n++) drop.add(n);
	return { text: lines.filter((_, n) => !drop.has(n)).join(p.nl), conflict: false };
}

// Which notes a change would touch: [{ path, before, after }] for the notes
// ({ path: text }) that come out different, plus the ones left alone for a
// conflict. change(text) -> text or { text, conflict }.
export function planChange(notes, change) {
	const changed = [], conflicts = [];
	for (const [path, before] of Object.entries(notes)) {
		if (before == null || !before.startsWith("---")) continue;
		const r = change(before);
		const after = typeof r === "string" ? r : r.text;
		if (r?.conflict) conflicts.push(path);
		else if (after !== before) changed.push({ path, before, after });
	}
	return { changed, conflicts };
}

// The frontmatter lines that differ, for a preview: { removed, added }.
export function frontmatterDiff(before, after) {
	const fm = (t) => { const p = properties(t); return p ? p.lines.slice(0, p.lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)[ \t]*$/.test(l)) + 1) : []; };
	const a = fm(before), b = fm(after);
	const count = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
	const ca = count(a), cb = count(b);
	const removed = [], added = [];
	for (const l of a) { if (cb.get(l)) cb.set(l, cb.get(l) - 1); else removed.push(l); }
	for (const l of b) { if (ca.get(l)) ca.set(l, ca.get(l) - 1); else added.push(l); }
	return { removed, added };
}
