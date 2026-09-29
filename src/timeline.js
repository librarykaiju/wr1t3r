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

// Where a list item sorts: all day first, then by start time. An item with no
// time (a plain "- [ ] call Sam") stays after the item above it.
function itemKey(line) {
	const m = line.match(TASK);
	if (!m) return null;
	if (m[4]) return -1;
	return minutes(m[2]);
}

// The change ({from, to, insert}, CodeMirror style) that puts `events` into
// the note's Timeline and sorts its items by time, and how many events that
// adds. No changes when nothing is new and the order is already right; null
// when the note has no Timeline heading.
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

	const drop = new Set(); // empty slots an event fills
	for (const e of wanted) {
		if (e.allDay) continue;
		const start = eventStart(e), end = new Date(e.end);
		const from = start.getHours() * 60 + start.getMinutes();
		const to = from + Math.max(0, Math.round((end - start) / 60000));
		for (const t of tasks) if (!t.allDay && !t.text && t.from !== t.to && t.from >= from && t.to <= to) drop.add(t.i);
	}

	// The section's list: from its first item to its last line that isn't
	// blank. Each top-level item carries the indented or loose lines under it.
	let first = section.start;
	while (first < section.end && !/^[-*+] /.test(lines[first])) first++;
	if (first === section.end) first = section.start; // no list yet: under the heading
	let last = section.end;
	while (last > first && !lines[last - 1].trim()) last--;
	const items = [];
	for (let i = first; i < last; i++) {
		if (drop.has(i)) continue;
		if (/^[-*+] /.test(lines[i]) || !items.length) items.push({ lines: [lines[i]], key: itemKey(lines[i]) });
		else items.at(-1).lines.push(lines[i]);
	}
	for (const e of wanted) items.push({ lines: [eventLine(e)], key: e.allDay ? -1 : itemKey(eventLine(e)) });
	let prev = -Infinity;
	for (const it of items) prev = it.key = it.key ?? prev;
	const sorted = items.map((it, n) => ({ it, n })).sort((a, b) => a.it.key - b.it.key || a.n - b.n).map((x) => x.it);

	const insert = sorted.flatMap((it) => it.lines).join(nl);
	const from = offsets[first], to = offsets[last] - (last > first ? nl.length : 0);
	const before = text.slice(from, Math.max(from, to));
	if (insert === before) return { changes: [], added: 0 };
	if (first < last) return { changes: [{ from, to, insert }], added: wanted.length };
	if (first < lines.length) return { changes: [{ from, to: from, insert: insert + nl }], added: wanted.length };
	return { changes: [{ from: text.length, to: text.length, insert: nl + insert }], added: wanted.length };
}
