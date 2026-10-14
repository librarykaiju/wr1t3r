// What the calendar page adds to days besides events: penciled-in plans and
// stickers. They're kept in one note per month beside the built-in calendar
// ("_wr1t3r/Calendar/Marks 2026-10.md"), whichever calendar shows the
// events, one line each:
//
//   - 2026-10-15 pencil 14:00 Coffee with Sam
//   - 2026-10-15 pencil Maybe the farmers market
//   - 2026-10-15 sticker 🎉
//
// A penciled-in plan is a maybe: it's drawn in pencil, sends no reminders,
// and inking it makes it a real calendar event (and takes the line away).
// Stickers are OpenMoji emoji (the whole app's emoji font), any number a day.

export const MARKS_PREFIX = "Marks ";
const LINE = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2})\s+(pencil|sticker)\s+(.*?)\s*$/i;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)\s+/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// The month's marks note: "<folder>Marks 2026-10.md".
export const marksPath = (folder, day) => `${folder}${MARKS_PREFIX}${day.slice(0, 7)}.md`;

// Whether a path is a marks note, and the month it's for ("2026-10").
export function marksMonth(path) {
	return String(path || "").split("/").pop().match(/^Marks (\d{4}-\d{2})\.md$/i)?.[1] ?? null;
}

// A new marks note's text, before any lines.
export function newMarks(day) {
	const d = new Date(day.slice(0, 7) + "-01T12:00");
	return `# ${MONTHS[d.getMonth()]} ${d.getFullYear()}: penciled in and stickers\n\n`;
}

// Every mark in a note: [{ day, kind: "pencil" | "sticker", text, time, line }].
// time is "HH:MM" or null; line is 0-based.
export function readMarks(text) {
	const out = [];
	String(text || "").split(/\r?\n/).forEach((l, line) => {
		const m = LINE.exec(l);
		if (!m || !m[3]) return;
		const kind = m[2].toLowerCase();
		let body = m[3], time = null;
		const t = kind === "pencil" && TIME.exec(body);
		if (t) { time = `${t[1].padStart(2, "0")}:${t[2]}`; body = body.slice(t[0].length); }
		out.push({ day: m[1], kind, text: body.trim(), time, line });
	});
	return out;
}

// Marks grouped by day: Map day -> { pencils: [...], stickers: [...] }, with
// the day's pencils in time order (untimed ones last).
export function marksByDay(marks) {
	const map = new Map();
	for (const m of marks) {
		if (!map.has(m.day)) map.set(m.day, { pencils: [], stickers: [] });
		map.get(m.day)[m.kind === "pencil" ? "pencils" : "stickers"].push(m);
	}
	for (const v of map.values()) v.pencils.sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
	return map;
}

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

// The note's text with a mark added at the end. A pencil's time is "HH:MM"
// or empty.
export function addMark(text, day, kind, body, time = "") {
	const nl = String(text).includes("\r\n") ? "\r\n" : "\n";
	const b = clean(body);
	if (!b) return text;
	const line = `- ${day} ${kind} ${kind === "pencil" && /^\d{2}:\d{2}$/.test(time) ? time + " " : ""}${b}`;
	return String(text).replace(/\s*$/, "") + nl + line + nl;
}

// The note's text without the mark on `line` (0-based), if it's still that
// mark; else without the first line that matches it; unchanged if neither.
export function removeMark(text, mark) {
	const nl = String(text).includes("\r\n") ? "\r\n" : "\n";
	const lines = String(text).split(/\r?\n/);
	const same = (l) => {
		const m = readMarks(l)[0];
		return m && m.day === mark.day && m.kind === mark.kind && m.text === mark.text && m.time === mark.time;
	};
	let i = same(lines[mark.line] ?? "") ? mark.line : lines.findIndex(same);
	if (i < 0) return text;
	lines.splice(i, 1);
	return lines.join(nl);
}

// The event a penciled-in plan becomes when it's inked: all day, or an hour
// from its time.
export function inkedEvent(mark) {
	if (!mark.time) return { title: mark.text, allDay: true, date: mark.day, startTime: "", endTime: "" };
	const [h, m] = mark.time.split(":").map(Number);
	const end = `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	return { title: mark.text, allDay: false, date: mark.day, startTime: mark.time, endTime: end };
}
