// Task lines, read and edited the way the Obsidian Tasks plugin writes them,
// so a note ticked here reads the same there:
//   - [x] Call Sam 📅 2026-10-03 ✅ 2026-09-30 ^blockid
// Ticking a task appends "✅ <date>" (before a block id, which Tasks keeps
// last); unticking takes it off. Only the stamp's characters change.
// Tasks reads only a date there, so no time is written: a time after it would
// stop Tasks from reading the done date at all.

const pad = (n) => String(n).padStart(2, "0");
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "- [ ] text": the box character's offset in the line, or -1.
const TASK = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)]) \[)([^\]])\]/;
const DONE = / ?✅ ?\d{4}-\d{2}-\d{2}/gu;
const BLOCK_ID = /\s+\^[\w-]+\s*$/;

let stamping = true;
export const setDoneDates = (on) => { stamping = on; };

// The changes (CodeMirror style, offsets from `lineFrom`) that stamp or unstamp
// a task line as it's ticked (done = true) or unticked. Empty when there's
// nothing to do: a stamp already there, none to take off, or a task with no text.
export function doneStampChanges(lineText, lineFrom, done, date = new Date()) {
	const m = lineText.match(TASK);
	if (!m) return [];
	const stamps = [...lineText.matchAll(DONE)];
	if (!done) return stamps.map((s) => ({ from: lineFrom + s.index, to: lineFrom + s.index + s[0].length, insert: "" }));
	if (!stamping || stamps.length) return [];
	const body = lineText.slice(m[0].length);
	if (!body.trim()) return [];
	const id = lineText.match(BLOCK_ID);
	const end = id ? id.index : lineText.trimEnd().length;
	return [{ from: lineFrom + end, insert: ` ✅ ${isoDay(date)}` }];
}

// The box character of a task line, or null for a line that isn't a task.
export function taskMark(lineText) {
	const m = lineText.match(TASK);
	return m ? { at: m[1].length, char: m[2] } : null;
}

// Every change for setting a task line's box to `char` (" " or "x"), stamp included.
export function setTaskChanges(lineText, lineFrom, char, date = new Date()) {
	const t = taskMark(lineText);
	if (!t) return [];
	const changes = t.char === char ? [] : [{ from: lineFrom + t.at, to: lineFrom + t.at + 1, insert: char }];
	return [...changes, ...doneStampChanges(lineText, lineFrom, char !== " ", date)];
}

// A whole line with its box set, for code that rewrites text rather than a document.
export function setTaskLine(lineText, char, date = new Date()) {
	const changes = setTaskChanges(lineText, 0, char, date).sort((a, b) => b.from - a.from);
	let s = lineText;
	for (const c of changes) s = s.slice(0, c.from) + c.insert + s.slice(c.to ?? c.from);
	return s;
}

// ---- Sorting checklists -----------------------------------------------------
// Done tasks ([x]) sink below the rest of their list, keeping their order;
// everything under an item (sub-items, indented lines) moves with it, and
// sub-lists are sorted the same way. Left alone: numbered lists (moving items
// would scramble their numbers), frontmatter, code blocks, and a Timeline
// section (the daily note's, which stays in time order). A blank line ends a
// list, so loose lists are sorted a paragraph at a time.

const ITEM = /^([ \t]*)([-*+]|\d+[.)])(?:[ \t]+\[(.)\](?=\s|$))?(?:[ \t]|$)/;
const width = (line) => { let n = 0; for (const c of line.match(/^[ \t]*/)[0]) n += c === "\t" ? 4 : 1; return n; };
const isDone = (line) => /^[xX]$/.test(line.match(ITEM)?.[3] ?? "");

// Lines that are never sorted: frontmatter, fenced code, a Timeline section.
function fixedLines(lines) {
	const fixed = new Array(lines.length).fill(false);
	let i = 0;
	if (/^﻿?---\s*$/.test(lines[0] ?? "")) {
		const close = lines.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\s*$/.test(l));
		if (close > 0) { for (; i <= close; i++) fixed[i] = true; }
	}
	let fence = null, timeline = false;
	for (; i < lines.length; i++) {
		const f = lines[i].match(/^\s*(`{3,}|~{3,})/);
		if (fence) { fixed[i] = true; if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; continue; }
		if (f) { fence = f[1]; fixed[i] = true; continue; }
		const h = lines[i].match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
		if (h) timeline = /timeline$/i.test(h[1]);
		fixed[i] = timeline;
	}
	return fixed;
}

// block: lines starting with a list item. Sorted copy.
function sortItems(block) {
	const base = width(block[0]);
	const items = [];
	for (const l of block) {
		if (ITEM.test(l) && width(l) <= base) items.push([l]);
		else items.at(-1).push(l);
	}
	const sorted = items.map(([head, ...rest]) => {
		const k = rest.findIndex((l) => ITEM.test(l));
		return k < 0 ? [head, ...rest] : [head, ...rest.slice(0, k), ...sortItems(rest.slice(k))];
	});
	if (/^\s*\d/.test(block[0])) return sorted.flat(); // numbered: children only
	return [...sorted.filter((it) => !isDone(it[0])), ...sorted.filter((it) => isDone(it[0]))].flat();
}

// The note's text with its checklists sorted, or null when nothing moves.
export function sortChecklists(text) {
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const fixed = fixedLines(lines);
	const out = [];
	for (let i = 0; i < lines.length;) {
		if (fixed[i] || !ITEM.test(lines[i])) { out.push(lines[i++]); continue; }
		const base = width(lines[i]);
		let j = i + 1;
		while (j < lines.length && !fixed[j] && lines[j].trim() && (ITEM.test(lines[j]) ? width(lines[j]) >= base : width(lines[j]) > base)) j++;
		out.push(...sortItems(lines.slice(i, j)));
		i = j;
	}
	const after = out.join(nl);
	return after === lines.join(nl) ? null : after;
}
