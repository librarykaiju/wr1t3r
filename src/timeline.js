// A daily note's Timeline section, filled from one calendar: each of the day's
// events becomes a task like the template's hour slots,
//   - [ ] 09:30 - 10:15 | Dentist
//   - [ ] All day | Mom's birthday
// in time order among the slots. An empty slot the event covers entirely is
// replaced by it; slots with anything written in them are never touched. An
// event already in the section (same start and title) isn't added again, so
// pulling twice changes nothing.

import { byDay, eventStart } from "./agenda.js";

const pad = (n) => String(n).padStart(2, "0");
const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

// "- [ ] 09:00 - 10:00 | text": indent, start, end (may be missing), text after the bar.
const TASK = /^(\s*)[-*+] \[.\]\s+(?:(\d{1,2}:\d{2})(?:\s*[-–]\s*(\d{1,2}:\d{2}))?|(all day))\s*(\|?)(.*)$/i;
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

// The events on `date` (a Date on that day), all-day ones first.
export function eventsOn(events, date) {
	return byDay(events, date, 1)[0].events;
}

export function eventLine(e) {
	if (e.allDay) return `- [ ] All day | ${e.title}`;
	const start = eventStart(e), end = new Date(e.end);
	return `- [ ] ${clock(start)} - ${clock(end)} | ${e.title}`;
}

// The Timeline section: the lines after a heading ending in "Timeline"
// ("# Timeline", "# Daily Timeline") up to the next heading. Front matter and
// code blocks are skipped. -> {start, end} line indexes, or null.
function findSection(lines) {
	let i = 0;
	if (lines[0]?.trim() === "---") {
		const close = lines.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\s*$/.test(l));
		if (close > 0) i = close + 1;
	}
	let fenced = false, start = -1;
	for (; i < lines.length; i++) {
		if (FENCE.test(lines[i])) { fenced = !fenced; continue; }
		if (fenced) continue;
		const h = lines[i].match(HEADING);
		if (!h) continue;
		if (start >= 0) return { start, end: i };
		if (/timeline$/i.test(h[1])) start = i + 1;
	}
	return start >= 0 ? { start, end: lines.length } : null;
}

// The changes ({from, to, insert}, CodeMirror style) that put `events` into
// the note's Timeline, and how many events that adds. null when the note has
// no Timeline heading.
export function timelineChanges(text, events) {
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const section = findSection(lines);
	if (!section) return null;
	const offsets = [];
	for (let i = 0, at = 0; i <= lines.length; i++) { offsets.push(at); at += (lines[i]?.length ?? 0) + nl.length; }

	const tasks = [];
	for (let i = section.start; i < section.end; i++) {
		const m = lines[i].match(TASK);
		if (!m) continue;
		const allDay = !!m[4];
		const from = allDay ? -1 : minutes(m[2]);
		let to = m[3] ? minutes(m[3]) : from;
		if (to < from) to += 24 * 60;
		tasks.push({ i, allDay, from, to, text: m[6].trim(), line: lines[i] });
	}

	const have = (e) => {
		const key = e.allDay ? "all day" : clock(eventStart(e));
		return tasks.some((t) => t.text.includes(e.title) && (t.allDay ? key === "all day" : t.line.includes(key)));
	};
	const wanted = events.filter((e) => !have(e));
	if (!wanted.length) return { changes: [], added: 0 };

	const drop = new Set(); // empty slots an event fills
	const after = new Map(); // line index -> event lines inserted after it (-1: before the first task)
	const put = (i, line) => after.set(i, [...(after.get(i) || []), line]);
	for (const e of wanted) {
		if (e.allDay) { put(-1, eventLine(e)); continue; }
		const start = eventStart(e), end = new Date(e.end);
		const from = start.getHours() * 60 + start.getMinutes();
		const to = from + Math.max(0, Math.round((end - start) / 60000));
		for (const t of tasks) if (!t.allDay && !t.text && t.from !== t.to && t.from >= from && t.to <= to) drop.add(t.i);
		// After the last task starting at or before this event (so ties keep what's there first).
		const prev = tasks.filter((t) => t.allDay || t.from <= from).at(-1);
		put(prev ? prev.i : -1, eventLine(e));
	}

	const changes = [];
	const firstTask = tasks[0]?.i;
	if (after.has(-1)) {
		const block = after.get(-1).join(nl) + nl;
		if (firstTask != null) changes.push({ from: offsets[firstTask], to: offsets[firstTask], insert: block });
		else {
			// No tasks yet: right under the heading.
			const at = section.start;
			changes.push(at < lines.length ? { from: offsets[at], to: offsets[at], insert: block } : { from: text.length, to: text.length, insert: nl + block.slice(0, -nl.length) });
		}
	}
	for (const t of tasks) {
		const extra = after.get(t.i) || [];
		const lineEnd = offsets[t.i] + lines[t.i].length;
		if (drop.has(t.i)) {
			// Swap the empty slot for the event(s) placed after it.
			changes.push({ from: offsets[t.i], to: lineEnd, insert: extra.length ? extra.join(nl) : "" });
			if (!extra.length) changes[changes.length - 1] = { from: offsets[t.i], to: Math.min(offsets[t.i + 1], text.length), insert: "" };
		} else if (extra.length) changes.push({ from: lineEnd, to: lineEnd, insert: nl + extra.join(nl) });
	}
	return { changes, added: wanted.length };
}
