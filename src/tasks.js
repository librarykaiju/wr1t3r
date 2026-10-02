// Task lines, read and edited the way the Obsidian Tasks plugin writes them,
// so a note ticked here reads the same there:
//   - [x] Call Sam 📅 2026-10-03 ✅ 2026-09-30 ^blockid
// Ticking a task appends "✅ <date>" (before a block id, which Tasks keeps
// last); unticking takes it off. Only the stamp's characters change.
// Tasks reads only a date there, so no time is written: a time after it would
// stop Tasks from reading the done date at all.

import { nextTask } from "./recur.js";

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
	if (stamps.length) return [];
	// A repeating task's next copy goes on the line above (src/recur.js).
	const next = nextTask(lineText, isoDay(date));
	const out = next ? [{ from: lineFrom, insert: next + "\n" }] : [];
	const body = lineText.slice(m[0].length);
	if (!stamping || !body.trim()) return out;
	const id = lineText.match(BLOCK_ID);
	const end = id ? id.index : lineText.trimEnd().length;
	return [...out, { from: lineFrom + end, insert: ` ✅ ${isoDay(date)}` }];
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

// ---- Due dates --------------------------------------------------------------
// "📅 2026-10-03", as the Tasks plugin writes a due date. It goes before a done
// date and a block id (Tasks' order), or replaces the one already there.

const DUE = / ?📅️? ?(\d{4}-\d{2}-\d{2})/u;

// The task's due date ("YYYY-MM-DD"), or null.
export function dueOf(lineText) {
	return taskMark(lineText) ? lineText.match(DUE)?.[1] ?? null : null;
}

// The changes that set a task's due date to day ("YYYY-MM-DD"), or take it off
// (null). Empty for a line that isn't a task, or when nothing changes.
export function setDueChanges(lineText, lineFrom, day) {
	if (!taskMark(lineText)) return [];
	const m = lineText.match(DUE);
	if (m) {
		if (m[1] === day) return [];
		const at = lineFrom + m.index;
		if (!day) return [{ from: at, to: at + m[0].length, insert: "" }];
		const d = at + m[0].length - 10;
		return [{ from: d, to: d + 10, insert: day }];
	}
	if (!day) return [];
	const done = lineText.match(/ ?✅ ?\d{4}-\d{2}-\d{2}/u);
	const id = lineText.match(BLOCK_ID);
	const end = done ? done.index : id ? id.index : lineText.trimEnd().length;
	return [{ from: lineFrom + end, insert: ` 📅 ${day}` }];
}

// Where each due date is in a task line, and how it stands on `today`:
// { from, to, day, state: "overdue" | "today" | "done" | "later" }, or null.
export function dueMark(lineText, today) {
	const t = taskMark(lineText);
	const m = t && lineText.match(DUE);
	if (!m) return null;
	const from = m.index + (m[0].startsWith(" ") ? 1 : 0);
	const state = t.char !== " " ? "done" : m[1] < today ? "overdue" : m[1] === today ? "today" : "later";
	return { from, to: m.index + m[0].length, day: m[1], state };
}

// ---- Ticking a task from somewhere else -------------------------------------
// A Dataview task list ticks the real line in its note: the one at `line`
// (0-based) if it's still that task, else the one task with that text. The
// done date is added or taken off as usual. Null when it can't be found for sure.
export function tickInText(text, line, taskText, checked, date = new Date()) {
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const want = String(taskText ?? "").trim();
	const same = (l) => { const t = taskMark(l); return !!t && l.slice(t.at + 2).trim() === want; };
	let i = Number.isInteger(line) && line >= 0 && line < lines.length && same(lines[line]) ? line : -1;
	if (i < 0 && want) {
		const hits = lines.map((l, n) => (same(l) ? n : -1)).filter((n) => n >= 0);
		if (hits.length === 1) i = hits[0];
	}
	if (i < 0) return null;
	lines[i] = setTaskLine(lines[i], checked ? "x" : " ", date);
	return lines.join(nl);
}
