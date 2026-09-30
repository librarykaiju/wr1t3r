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
