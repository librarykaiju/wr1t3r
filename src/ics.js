// Importing an .ics file (iCalendar: what Google Calendar, Apple Calendar,
// Outlook and most school and team calendars export). readIcs turns its
// events into plain objects with times on this device's clock; icsNote makes
// a built-in calendar note from one (src/notecal.js), and googleEvent the
// body Google Calendar's import wants.
//
// The built-in calendar repeats daily, weekly, monthly or yearly. A weekly
// rule on several days (Mon, Wed, Fri) becomes one weekly event per day.
// Rules it can't hold (every other week, the second Tuesday of the month)
// come in as their first date only, and are counted so the person is told.

import { eventText, REPEATS } from "./notecal.js";
import { dayKey, addDays } from "./agenda.js";

// Lines as {name, params, value}, with folded lines joined.
function contentLines(text) {
	const raw = String(text || "").replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
	const out = [];
	for (const line of raw) {
		if (!line.trim()) continue;
		// NAME;PARAM=a;PARAM="b:c":value
		let i = 0, quoted = false;
		for (; i < line.length; i++) {
			if (line[i] === '"') quoted = !quoted;
			else if (line[i] === ":" && !quoted) break;
		}
		const head = line.slice(0, i), value = line.slice(i + 1);
		const [name, ...ps] = head.split(";");
		const params = {};
		for (const p of ps) { const eq = p.indexOf("="); if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, ""); }
		out.push({ name: name.toUpperCase(), params, value, raw: line });
	}
	return out;
}

const unescape = (s) => s.replace(/\\([\\;,nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));

const pad = (n) => String(n).padStart(2, "0");
const wall = (d) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// What a moment's wall clock reads in a time zone, as if it were UTC.
function zoneWall(ms, tz) {
	const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
	return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
}

// The moment a wall-clock time in a time zone happens.
export function zonedMoment(y, mo, d, h, mi, s, tz) {
	const guess = Date.UTC(y, mo - 1, d, h, mi, s);
	let t = guess - (zoneWall(guess, tz) - guess);
	t = guess - (zoneWall(t, tz) - t);
	return new Date(t);
}

const knownZone = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };

// A DATE or DATE-TIME value as { allDay, local } on this device's clock.
export function readTime(value, params = {}) {
	const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value).trim());
	if (!m) return null;
	const [, y, mo, d, h, mi, s = "0", z] = m;
	if (h == null || params.VALUE === "DATE") return { allDay: true, local: `${y}-${mo}-${d}` };
	let at;
	if (z) at = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
	else if (params.TZID && knownZone(params.TZID)) at = zonedMoment(+y, +mo, +d, +h, +mi, +s, params.TZID);
	else return { allDay: false, local: `${y}-${mo}-${d}T${h}:${mi}` }; // floating, or a zone we can't read: as written
	return { allDay: false, local: wall(at) };
}

const day = (s) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// minutes before, from a VALARM's TRIGGER (-PT15M, -P1D, -PT1H30M)
function triggerMinutes(v) {
	const m = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v).trim());
	if (!m) return null;
	const mins = (+m[2] || 0) * 10080 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0) + Math.round((+m[6] || 0) / 60);
	return m[1] || mins === 0 ? mins : null; // alerts after the start aren't something we can do
}

// Every VEVENT as { uid, title, allDay, start, end (last day for all-day),
// location, description, reminder, rule, until, count, exdates, recurrence,
// recurrenceId }. rule: { freq, interval, byday, other } or null.
export function readIcs(text) {
	const events = [];
	let cur = null, depth = 0;
	for (const l of contentLines(text)) {
		if (l.name === "BEGIN" && l.value.toUpperCase() === "VEVENT") { cur = { exdates: [], recurrence: [], alarms: [] }; depth = 0; continue; }
		if (!cur) continue;
		if (l.name === "BEGIN") { depth++; if (l.value.toUpperCase() === "VALARM") cur.alarm = {}; continue; }
		if (l.name === "END" && l.value.toUpperCase() === "VEVENT") { const e = finish(cur); if (e) events.push(e); cur = null; continue; }
		if (l.name === "END") { depth--; if (cur.alarm) { cur.alarms.push(cur.alarm); cur.alarm = null; } continue; }
		if (cur.alarm) { if (l.name === "TRIGGER" && (l.params.RELATED || "START") === "START") cur.alarm.minutes = triggerMinutes(l.value); continue; }
		if (depth) continue;
		if (l.name === "EXDATE") { for (const v of l.value.split(",")) { const t = readTime(v, l.params); if (t) cur.exdates.push(t.local.slice(0, 10)); } }
		else if (l.name === "RRULE") cur.rrule = l.value;
		else if (!(l.name in cur)) cur[l.name] = l;
	}
	return events;
}

function finish(c) {
	if (!c.DTSTART || (c.STATUS && c.STATUS.value.toUpperCase() === "CANCELLED")) return null;
	const start = readTime(c.DTSTART.value, c.DTSTART.params);
	if (!start) return null;
	let end = c.DTEND ? readTime(c.DTEND.value, c.DTEND.params) : null;
	let endLocal;
	if (start.allDay) {
		// DTEND is the day after the last day; no DTEND means one day.
		endLocal = end?.allDay && end.local > start.local ? dayKey(addDays(day(end.local), -1)) : start.local;
	} else if (end && !end.allDay && end.local > start.local) endLocal = end.local;
	else {
		const dur = c.DURATION ? triggerMinutes("-" + c.DURATION.value.replace(/^[+-]/, "")) : null;
		const s = new Date(day(start.local).getTime());
		s.setHours(+start.local.slice(11, 13), +start.local.slice(14, 16) + (dur ?? 60));
		endLocal = wall(s);
	}
	const text = (k) => (c[k] ? unescape(c[k].value).trim() : "");
	const alarm = c.alarms.map((a) => a.minutes).find((m) => m != null);
	let rule = null, until = "", count = 0;
	if (c.rrule) {
		const parts = Object.fromEntries(c.rrule.split(";").map((p) => p.split("=")).map(([k, v]) => [k.toUpperCase(), v || ""]));
		const freq = (parts.FREQ || "").toLowerCase();
		if (parts.UNTIL) { const u = readTime(parts.UNTIL); if (u) until = u.local.slice(0, 10); }
		if (parts.COUNT) count = Math.max(1, parseInt(parts.COUNT, 10) || 1);
		const byday = parts.BYDAY ? parts.BYDAY.split(",").map((d) => d.toUpperCase()) : [];
		const other = Object.keys(parts).filter((k) => !["FREQ", "UNTIL", "COUNT", "INTERVAL", "BYDAY", "WKST"].includes(k));
		rule = { freq, interval: parseInt(parts.INTERVAL || "1", 10) || 1, byday, other };
	}
	return {
		uid: text("UID"),
		title: text("SUMMARY") || "(No title)",
		allDay: start.allDay,
		start: start.local,
		end: endLocal,
		location: text("LOCATION"),
		description: text("DESCRIPTION"),
		reminder: alarm ?? null,
		rule, until, count,
		exdates: c.exdates,
		rrule: c.rrule || "",
		recurrenceId: c["RECURRENCE-ID"] ? readTime(c["RECURRENCE-ID"].value, c["RECURRENCE-ID"].params)?.local.slice(0, 10) || "" : "",
	};
}

// The weekly event split by weekday: [{ start, end }] shifted to each day.
function shift(e, days) {
	const move = (s) => (s.length === 10 ? dayKey(addDays(day(s), days)) : dayKey(addDays(day(s), days)) + s.slice(10));
	return { start: move(e.start), end: move(e.end) };
}

// How the built-in calendar can hold an event's rule: [{ start, end, repeat,
// until }] (more than one for a weekly rule on several days), and whether
// anything had to be dropped.
export function asRepeats(e) {
	const once = [{ start: e.start, end: e.end, repeat: "", until: "" }];
	if (!e.rule) return { parts: once, simplified: false };
	const r = e.rule;
	const freq = REPEATS.includes(r.freq) ? r.freq : "";
	const first = day(e.start);
	const ok = freq && r.interval === 1 && !r.other.length &&
		(!r.byday.length || (freq === "weekly" && r.byday.every((d) => WEEKDAYS.includes(d))) || (freq === "daily" && r.byday.length === 7) ||
		 (r.byday.length === 1 && r.byday[0] === WEEKDAYS[first.getDay()] && freq === "weekly"));
	if (!ok) return { parts: once, simplified: true };
	let starts = [e];
	if (freq === "weekly" && r.byday.length) {
		starts = WEEKDAYS.map((d, i) => r.byday.includes(d) ? (i - first.getDay() + 7) % 7 : -1).filter((n) => n >= 0).sort((a, b) => a - b).map((n) => shift(e, n));
	}
	let until = e.until;
	if (e.count) {
		// The day of the count-th occurrence, across all the weekdays.
		let n = 0, d = first, last = first;
		for (let guard = 0; n < e.count && guard < 40000; guard++, d = addDays(d, 1)) {
			if (freq === "daily" || (freq === "weekly" && starts.some((s) => day(s.start).getDay() === d.getDay()))) { n++; last = d; }
			else if (freq === "monthly" && d.getDate() === first.getDate()) { n++; last = d; }
			else if (freq === "yearly" && d.getDate() === first.getDate() && d.getMonth() === first.getMonth()) { n++; last = d; }
		}
		const c = dayKey(last);
		until = until && until < c ? until : c;
	}
	return { parts: starts.map((s) => ({ start: s.start, end: s.end, repeat: freq, until })), simplified: false };
}

const yamlLine = (k, v) => `${k}: ${/^[\w .,'()&/@:-]*$/.test(v) && !/^[\s-]|\s$|^(true|false|null|yes|no|~|none)$/i.test(v) && !/^\d/.test(v) && !/: /.test(v) ? v : JSON.stringify(v)}`;

// The note text for one part of an imported event.
export function icsNote(e, part, skip = []) {
	const text = eventText({
		title: e.title, allDay: e.allDay, start: part.start, end: part.end,
		location: e.location, description: e.description,
		reminder: e.reminder == null ? undefined : e.reminder, repeat: part.repeat,
	});
	const extra = [];
	if (part.until) extra.push(`until: ${part.until}`);
	const skips = part.repeat ? [...new Set(skip)].filter((d) => d >= part.start.slice(0, 10)).sort() : [];
	if (skips.length) extra.push(`skip: [${skips.join(", ")}]`);
	if (e.uid) extra.push(yamlLine("uid", e.uid));
	const lines = text.split("\n");
	const close = lines.indexOf("---", 1);
	lines.splice(close, 0, ...extra);
	return lines.join("\n");
}

// An imported event's id in the notebook (its uid, plus the day for one
// changed occurrence of a repeating event).
const idOf = (e) => e.uid + (e.recurrenceId ? "|" + e.recurrenceId : "");

// What to import: events still to come (or repeating on past today) as
// notes, skipping ones whose uid is already in the calendar. existing: the
// uids already there. Overrides of one occurrence (RECURRENCE-ID) become
// one-off events, and that day is skipped on the repeating one.
export function planIcs(events, existing = new Set(), today = dayKey(new Date())) {
	const moved = new Map(); // uid -> days that were changed or cancelled
	for (const e of events) if (e.recurrenceId) moved.set(e.uid, [...(moved.get(e.uid) || []), e.recurrenceId]);
	const add = [];
	let past = 0, already = 0, simplified = 0;
	for (const e of events) {
		const key = idOf(e);
		if (e.uid && existing.has(key)) { already++; continue; }
		const { parts, simplified: s } = e.recurrenceId ? { parts: [{ start: e.start, end: e.end, repeat: "", until: "" }], simplified: false } : asRepeats(e);
		const lastDay = parts.some((p) => p.repeat && (!p.until || p.until >= today)) ? today : e.end.slice(0, 10);
		if (lastDay < today) { past++; continue; }
		if (s) simplified++;
		const skip = [...e.exdates, ...(e.recurrenceId ? [] : moved.get(e.uid) || [])];
		const uid = e.recurrenceId ? `${e.uid}|${e.recurrenceId}` : e.uid;
		for (const part of parts) add.push({ event: e, part, text: icsNote({ ...e, uid }, part, skip) });
	}
	return { add, past, already, simplified };
}

// For Google Calendar: the events still to come, each with its own repeat
// rule (Google's import keeps them all, and skips ones it already has by uid).
export function planGoogle(events, timeZone, today = dayKey(new Date())) {
	const moved = new Map();
	for (const e of events) if (e.recurrenceId) moved.set(e.uid, [...(moved.get(e.uid) || []), e.recurrenceId]);
	let past = 0;
	const add = [];
	for (const e of events) {
		const repeating = e.rrule && !e.recurrenceId && (!e.until || e.until >= today); // a COUNT rule is kept; Google knows when it ends
		if (!repeating && e.end.slice(0, 10) < today) { past++; continue; }
		add.push(googleEvent({ ...e, uid: e.recurrenceId ? `${e.uid}-${e.recurrenceId}` : e.uid || "", exdates: [...e.exdates, ...(e.recurrenceId ? [] : moved.get(e.uid) || [])] }, timeZone));
	}
	return { add, past };
}

// For Google Calendar's import (worker/calendar.js and the page's own
// Google client): the event with its own repeat rule, on this device's clock.
export function googleEvent(e, timeZone) {
	const recurrence = [];
	if (e.rrule && !e.recurrenceId) {
		recurrence.push("RRULE:" + e.rrule);
		const time = e.allDay ? "" : "T" + e.start.slice(11, 13) + e.start.slice(14, 16) + "00";
		if (e.exdates.length) recurrence.push(e.allDay ? `EXDATE;VALUE=DATE:${e.exdates.map((d) => d.replace(/-/g, "")).join(",")}` : `EXDATE;TZID=${timeZone}:${e.exdates.map((d) => d.replace(/-/g, "") + time).join(",")}`);
	}
	return {
		uid: e.uid, title: e.title, allDay: e.allDay, start: e.start, end: e.end, timeZone,
		location: e.location, description: e.description,
		reminder: e.reminder == null ? undefined : e.reminder,
		recurrence, recurrenceId: e.recurrenceId || "",
	};
}
