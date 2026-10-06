// The built-in calendar: events kept as notes in the notebook, one note per
// event in _wr1t3r/Calendar/, so it works offline, syncs like everything else,
// and two devices adding events never collide. It answers the same three
// calls as Google Calendar through the Worker (api.events, addEvent,
// deleteEvent), so the agenda, month view, timeline and alerts don't care
// which one they're talking to.
//
//   ---
//   title: Dentist
//   start: 2026-10-07T15:00      a date alone (2026-10-07) is all day
//   end: 2026-10-07T16:00        all day: the last day, not the day after
//   location: Main St
//   color: 7                     a Google event color (src/agenda.js)
//   reminder: 30                 minutes before; none for no alert
//   repeat: weekly               daily, weekly, monthly or yearly
//   until: 2026-12-31            optional last day it repeats on
//   skip: [2026-10-14]           occurrences deleted from a repeating event
//   ---
//   Notes about the event.
//
// Times are wall-clock times on whatever device shows them.

import { parseYaml } from "./bases.js";
import { EVENT_COLORS, dayKey, addDays } from "./agenda.js";

export const CALENDAR_ID = "notebook";
export const CALENDAR_FOLDER = "Calendar/";
export const REPEATS = ["daily", "weekly", "monthly", "yearly"];
const DEFAULT_ALERT = 10; // minutes, for "Calendar default" on a timed event
const COLOR = "#039be5";

export const NOTEBOOK_CALENDAR = { id: CALENDAR_ID, name: "Calendar", color: COLOR, primary: true, shown: true, writable: true };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const fenceOf = (text) => {
	const lines = String(text || "").split("\n");
	if (!/^---\s*$/.test(lines[0] ?? "")) return null;
	for (let i = 1; i < lines.length; i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) return { yaml: lines.slice(1, i).join("\n"), body: lines.slice(i + 1).join("\n") };
	return null;
};

const day = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const str = (v) => (v == null ? "" : String(v).trim());
// "2026-10-07T15:00:00" or "2026-10-07 15:00" read as the form writes them.
const cleanTime = (v) => str(v).replace(" ", "T").replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):\d{2}$/, "$1");

// The event in a note's text, or null if it isn't one.
export function parseEvent(path, text) {
	const f = fenceOf(text);
	if (!f) return null;
	let y;
	try { y = parseYaml(f.yaml); } catch { return null; }
	if (!y || typeof y !== "object") return null;
	const start = cleanTime(y.start);
	const allDay = DATE.test(start);
	if (!allDay && !LOCAL.test(start)) return null;
	let end = cleanTime(y.end);
	if (allDay) end = DATE.test(end) && end >= start ? end : start;
	else end = LOCAL.test(end) && end > start ? end : localTime(new Date(day(start.slice(0, 10)).getTime() + minutesOf(start) * 60000 + 3600000));
	const reminder = str(y.reminder).toLowerCase();
	const alerts = reminder === "none" ? [] : /^\d+$/.test(reminder) ? [Number(reminder)] : allDay ? [] : [DEFAULT_ALERT];
	const repeat = REPEATS.includes(str(y.repeat).toLowerCase()) ? str(y.repeat).toLowerCase() : "";
	const until = DATE.test(str(y.until)) ? str(y.until) : "";
	const skip = (Array.isArray(y.skip) ? y.skip : y.skip ? [y.skip] : []).map(str).filter((s) => DATE.test(s));
	return {
		path,
		title: str(y.title) || path.split("/").pop().replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2} /, "") || "(No title)",
		allDay, start, end,
		location: str(y.location),
		color: EVENT_COLORS[str(y.color)]?.[1] || COLOR,
		alerts, repeat, until, skip,
		description: f.body.trim(),
	};
}

function minutesOf(t) {
	return Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));
}
function localTime(d) {
	return `${dayKey(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// The nth period after the event's first day.
function shiftDay(first, repeat, n) {
	const d = day(first);
	if (repeat === "daily") return addDays(d, n);
	if (repeat === "weekly") return addDays(d, 7 * n);
	const months = repeat === "monthly" ? n : 12 * n;
	const y = d.getFullYear(), m = d.getMonth() + months;
	const last = new Date(y, m + 1, 0).getDate(); // the 31st becomes the month's last day
	return new Date(y, m, Math.min(d.getDate(), last));
}

// The agenda's event objects for every occurrence that overlaps [from, to).
export function occurrences(ev, from, to) {
	const firstDay = ev.start.slice(0, 10);
	const spanDays = Math.round((day(ev.end.slice(0, 10)) - day(firstDay)) / 864e5);
	const time = (t) => t.slice(10); // "" or "T15:00"
	const make = (startDay) => {
		const endDay = dayKey(addDays(day(startDay), spanDays));
		const o = {
			id: ev.repeat ? `${startDay}|${ev.path}` : ev.path,
			calendar: CALENDAR_ID,
			title: ev.title,
			allDay: ev.allDay,
			start: startDay + time(ev.start),
			end: ev.allDay ? dayKey(addDays(day(endDay), 1)) : endDay + time(ev.end),
			location: ev.location,
			link: "",
			color: ev.color,
			alerts: ev.alerts,
			repeats: !!ev.repeat,
			path: ev.path,
		};
		return o;
	};
	const overlaps = (o) => {
		const s = o.allDay ? day(o.start) : new Date(o.start);
		const e = o.allDay ? day(o.end) : new Date(o.end);
		return s < to && (e > from || (+e === +s && s >= from));
	};
	if (!ev.repeat) { const o = make(firstDay); return overlaps(o) ? [o] : []; }

	const out = [];
	const skip = new Set(ev.skip);
	// Jump close to `from` for daily and weekly, rather than walking from the start.
	const step = ev.repeat === "daily" ? 1 : ev.repeat === "weekly" ? 7 : 0;
	let n = step ? Math.max(0, Math.floor((from - day(firstDay)) / 864e5 / step) - spanDays - 1) : 0;
	for (let guard = 0; guard < 5000; guard++, n++) {
		const d = shiftDay(firstDay, ev.repeat, n);
		if (d >= to) break;
		const key = dayKey(d);
		if (ev.until && key > ev.until) break;
		if (skip.has(key)) continue;
		const o = make(key);
		if (overlaps(o)) out.push(o);
	}
	return out;
}

const yamlValue = (s) => (/^[\w .,'()&/-]*$/.test(s) && !/^[\s-]|\s$|^(true|false|null|yes|no|~|none)$/i.test(s) && !/^\d/.test(s) ? s : JSON.stringify(s));

// The note text for the add-event form's body (agenda.formEvent), plus repeat.
export function eventText(b) {
	const title = str(b.title);
	if (!title) throw new Error("Give the event a title");
	const lines = ["---", `title: ${yamlValue(title)}`];
	if (b.allDay) {
		if (!DATE.test(b.start) || (b.end && !DATE.test(b.end))) throw new Error("All-day events need dates");
		lines.push(`start: ${b.start}`, `end: ${b.end && b.end >= b.start ? b.end : b.start}`);
	} else {
		if (!LOCAL.test(b.start) || !LOCAL.test(b.end) || b.end <= b.start) throw new Error("The event needs a start and a later end");
		lines.push(`start: ${b.start}`, `end: ${b.end}`);
	}
	if (str(b.location)) lines.push(`location: ${yamlValue(str(b.location))}`);
	if (b.colorId && EVENT_COLORS[b.colorId]) lines.push(`color: ${b.colorId}`);
	if (b.reminder === "none") lines.push("reminder: none");
	else if (Number.isInteger(b.reminder) && b.reminder >= 0) lines.push(`reminder: ${b.reminder}`);
	if (REPEATS.includes(b.repeat)) lines.push(`repeat: ${b.repeat}`);
	lines.push("---", "");
	if (str(b.description)) lines.push(str(b.description), "");
	return lines.join("\n");
}

// The note's name for a new event: its first day and title.
export function eventName(b) {
	const t = str(b.title).replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
	return `${String(b.start).slice(0, 10)} ${t || "Event"}`;
}

// Adds a skipped day to a repeating event's text, keeping everything else.
export function skipDay(text, key) {
	const lines = text.split("\n");
	let close = -1;
	for (let i = 1; i < lines.length; i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) { close = i; break; }
	if (close < 0) return text;
	const at = lines.findIndex((l, i) => i > 0 && i < close && /^skip\s*:/.test(l));
	if (at < 0) { lines.splice(close, 0, `skip: [${key}]`); return lines.join("\n"); }
	// The list on that line, or a block list under it.
	const inline = lines[at].match(/^skip\s*:\s*\[(.*)\]\s*$/);
	if (inline) {
		const items = inline[1].split(",").map((s) => s.trim()).filter(Boolean);
		if (!items.includes(key)) items.push(key);
		lines[at] = `skip: [${items.join(", ")}]`;
		return lines.join("\n");
	}
	let j = at + 1;
	while (j < close && /^\s+-/.test(lines[j])) j++;
	if (j === at + 1 && lines[at].replace(/^skip\s*:/, "").trim()) lines[at] = `skip: [${lines[at].replace(/^skip\s*:/, "").trim()}, ${key}]`;
	else lines.splice(j, 0, `  - ${key}`);
	return lines.join("\n");
}

// The calendar over the notebook. host:
//   folder()                    -> where event notes live ("_wr1t3r/Calendar/")
//   notes()                     -> [{path, text}] for every note on this device
//   create(folder, name, text)  -> saves a new note (numbered if taken), its path
//   write(path, fn)             -> replaces a note's text with fn(text)
//   remove(path)                -> deletes a note
export function notebookCalendar(host) {
	const all = () => {
		const folder = host.folder().toLowerCase();
		return host.notes()
			.filter((n) => n.path.toLowerCase().startsWith(folder) && /\.md$/i.test(n.path))
			.map((n) => parseEvent(n.path, n.text))
			.filter(Boolean);
	};
	return {
		async events(from, to) {
			const events = all().flatMap((ev) => occurrences(ev, from, to));
			events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
			return { calendars: [NOTEBOOK_CALENDAR], events };
		},
		async addEvent(body) {
			const text = eventText(body);
			const path = await host.create(host.folder(), eventName(body), text);
			const ev = parseEvent(path, text);
			const first = day(ev.start.slice(0, 10));
			return occurrences(ev, first, addDays(first, 1))[0] || null;
		},
		async deleteEvent(_calendar, id) {
			const m = /^(\d{4}-\d{2}-\d{2})\|(.+)$/.exec(id);
			if (m) await host.write(m[2], (t) => skipDay(t, m[1]));
			else await host.remove(id);
			return { deleted: true };
		},
	};
}
