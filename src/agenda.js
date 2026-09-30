// The agenda panel's date handling, kept apart from the page for testing.
// Events come from worker/calendar.js: start/end are RFC 3339 times, or
// YYYY-MM-DD dates for all-day events (end is the day after, as Google has it).

export const DAYS = 8; // today plus the next week

// Google Calendar's event colors (colorId -> name and the color its web app
// shows). An event without one takes its calendar's color.
export const EVENT_COLORS = {
	1: ["Lavender", "#7986cb"], 2: ["Sage", "#33b679"], 3: ["Grape", "#8e24aa"], 4: ["Flamingo", "#e67c73"],
	5: ["Banana", "#f6bf26"], 6: ["Tangerine", "#f4511e"], 7: ["Peacock", "#039be5"], 8: ["Graphite", "#616161"],
	9: ["Blueberry", "#3f51b5"], 10: ["Basil", "#0b8043"], 11: ["Tomato", "#d50000"],
};

export function dayKey(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function startOfDay(d) {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// All-day dates are days on the wall calendar, not moments.
export function eventStart(e) {
	return e.allDay ? localDate(e.start) : new Date(e.start);
}
function localDate(s) {
	const [y, m, d] = s.split("-").map(Number);
	return new Date(y, m - 1, d);
}

// [{key, date, events}] for each day from `from`, in order. All-day events
// show on every day they cover; timed ones on the day they start.
export function byDay(events, from, days = DAYS) {
	const out = [];
	for (let i = 0; i < days; i++) {
		const date = addDays(startOfDay(from), i), key = dayKey(date);
		const list = events.filter((e) => (e.allDay ? e.start <= key && key < e.end : dayKey(new Date(e.start)) === key));
		list.sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : eventStart(a) - eventStart(b)));
		out.push({ key, date, events: list });
	}
	return out;
}

export function dayLabel(date, today) {
	const diff = Math.round((startOfDay(date) - startOfDay(today)) / 864e5);
	if (diff === 0) return "Today";
	if (diff === 1) return "Tomorrow";
	return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

export function timeLabel(e) {
	if (e.allDay) return "All day";
	const t = (s) => new Date(s).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	return `${t(e.start)}–${t(e.end)}`;
}

// The next timed event that hasn't ended, for the header button.
export function nextEvent(events, now) {
	return events.find((e) => !e.allDay && new Date(e.end) > now) || null;
}

// Reminders due in (since, now]: [{event, at, minutes}]. Ones more than 15
// minutes late (the page was closed) are skipped rather than shown stale.
export function dueAlerts(events, since, now) {
	const due = [];
	for (const e of events) {
		for (const minutes of e.alerts || []) {
			const at = eventStart(e).getTime() - minutes * 60000;
			if (at > since && at <= now && now - at < 15 * 60000) due.push({ event: e, at, minutes });
		}
	}
	return due.sort((a, b) => a.at - b.at);
}

export function alertText({ event, minutes }) {
	if (event.allDay) return `${event.title} (all day)`;
	if (minutes === 0) return `${event.title} is starting`;
	const h = minutes / 60;
	const lead = minutes < 60 ? `${minutes} min` : Number.isInteger(h) ? `${h} hour${h === 1 ? "" : "s"}` : `${minutes} min`;
	return `${event.title} starts in ${lead}`;
}

// The line put into a note for an event.
export function noteLine(e, today = new Date()) {
	const when = e.allDay ? dayLabel(eventStart(e), today) : `${eventStart(e).toLocaleDateString([], { month: "short", day: "numeric" })}, ${timeLabel(e)}`;
	return `- ${when}: ${e.title}${e.location ? ` (${e.location})` : ""}`;
}

// The add-event form's fields -> the body worker/calendar.js expects.
export function formEvent({ title, allDay, date, endDate, startTime, endTime, reminder, location, colorId }, timeZone) {
	const body = { title: title.trim(), allDay: !!allDay, location: location?.trim() || "" };
	if (allDay) Object.assign(body, { start: date, end: endDate || date });
	else {
		let end = `${date}T${endTime}`;
		if (endTime <= startTime) end = `${dayKey(addDays(localDate(date), 1))}T${endTime}`; // past midnight
		Object.assign(body, { start: `${date}T${startTime}`, end, timeZone });
	}
	if (colorId) body.colorId = String(colorId);
	if (reminder === "none") body.reminder = "none";
	else if (reminder !== "" && reminder != null) body.reminder = Number(reminder);
	return body;
}

// The add-event form's end time after the start moves to `start` ("HH:MM"):
// the same length as before (prevStart to prevEnd, past midnight counting),
// or an hour when there was none. Wraps past midnight like formEvent.
export function endAfterStart(start, prevStart, prevEnd) {
	const min = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
	const s = min(start);
	if (s == null) return prevEnd || "";
	const a = min(prevStart), b = min(prevEnd);
	let len = a != null && b != null ? (b - a + 1440) % 1440 : 60;
	if (!len) len = 60;
	const e = (s + len) % 1440;
	return `${String(Math.floor(e / 60)).padStart(2, "0")}:${String(e % 60).padStart(2, "0")}`;
}

// A calendar's name as the agenda shows it. Google names your main calendar
// after your email address, so an address is never shown: the main calendar
// reads "Main", any other one "b•••@gmail.com".
export function calendarLabel(c) {
	const name = String(c?.name || "");
	const m = name.match(/^([^@\s])[^@\s]*@([^@\s]+)$/);
	if (!m) return name;
	return c.primary ? "Main" : `${m[1]}•••@${m[2]}`;
}

// The month calendar above the agenda (desktop): six weeks of days starting on
// the Sunday on or before the 1st, so every month fits the same grid.
export const GRID_DAYS = 42;
export function startOfMonth(d) {
	return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function addMonths(d, n) {
	return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
export function gridStart(month) {
	const first = startOfMonth(month);
	return addDays(first, -first.getDay());
}
export function monthGrid(month) {
	const start = gridStart(month);
	return Array.from({ length: GRID_DAYS }, (_, i) => addDays(start, i));
}
