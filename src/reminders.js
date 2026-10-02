// Reminders on tasks, written as Obsidian's Reminder plugin writes them, so
// Obsidian reminds you too:
//   - [ ] Call Sam (@2026-10-03 14:30)
// A date with no time reminds at DEFAULT_TIME. Open tasks only; a ticked task
// never reminds. The page sends the list to the Worker, which sends each one
// as a notification to every device that turned reminders on.

export const DEFAULT_TIME = "09:00";
const REMIND = /\(@(\d{4})-(\d{2})-(\d{2})(?: (\d{1,2}):(\d{2}))?\)/;
const TASK = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)]) \[(.)\]\s*(.*)$/;

// The reminder in a line: { from, to, day, time }, or null.
export function reminderMark(lineText) {
	const m = lineText.match(REMIND);
	if (!m || !TASK.test(lineText)) return null;
	return { from: m.index, to: m.index + m[0].length, day: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4].padStart(2, "0")}:${m[5]}` : null };
}

// The task's words, without its dates, markers and block id.
export function taskTitle(body) {
	return body
		.replace(/\(@[^)]*\)/g, "")
		.replace(/[📅⏳🛫✅➕]️? ?\d{4}-\d{2}-\d{2}/gu, "")
		.replace(/🔁️?[^📅⏳🛫✅➕^]*/gu, "")
		.replace(/[⏫🔼🔽⏬🔺]/gu, "")
		.replace(/\s+\^[\w-]+\s*$/, "")
		.replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2")
		.replace(/\s+/g, " ")
		.trim();
}

// A short stable id, so the Worker knows a reminder it has already sent.
function hash(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return (h >>> 0).toString(36);
}

// Every open task's reminder in a note: [{ id, at (ms, this device's time
// zone), title, path }].
export function remindersIn(path, text) {
	const out = [];
	if (!text.includes("(@")) return out;
	for (const line of text.split(/\r?\n/)) {
		const t = line.match(TASK);
		if (!t || t[1] !== " ") continue;
		const r = reminderMark(line);
		if (!r) continue;
		const [h, min] = (r.time || DEFAULT_TIME).split(":").map(Number);
		const [y, mo, d] = r.day.split("-").map(Number);
		const at = new Date(y, mo - 1, d, h, min).getTime();
		if (!Number.isFinite(at)) continue;
		const title = taskTitle(t[2]) || "Reminder";
		out.push({ id: hash(`${path}\n${title}\n${at}`), at, title, path });
	}
	return out;
}

// The changes that set the reminder of a task line to "YYYY-MM-DD HH:MM" (or
// take it off with null), offsets from lineFrom. It goes before a done date
// and a block id.
export function setReminderChanges(lineText, lineFrom, when) {
	const r = reminderMark(lineText);
	if (r) {
		const at = lineFrom + r.from - (lineText[r.from - 1] === " " ? 1 : 0);
		return [{ from: at, to: lineFrom + r.to, insert: when ? ` (@${when})` : "" }];
	}
	if (!when || !TASK.test(lineText)) return [];
	const done = lineText.match(/ ?✅️? ?\d{4}-\d{2}-\d{2}/u);
	const id = lineText.match(/\s+\^[\w-]+\s*$/);
	const end = done ? done.index : id ? id.index : lineText.trimEnd().length;
	return [{ from: lineFrom + end, insert: ` (@${when})` }];
}
