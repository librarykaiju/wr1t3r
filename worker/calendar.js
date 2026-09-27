// Google Calendar for the agenda panel. The Worker holds a refresh token for
// the owner's Google account (made once with `npm run google-auth`) and trades
// it for short-lived access tokens; the page never sees any Google token.
//
//   GET  /api/calendar/events?from=&to=[&calendars=id,id]
//                                          events in [from, to) from the named
//                                          calendars, or from every calendar
//                                          shown in Google Calendar ->
//                                          {calendars: [...], events: [...]}
//   POST /api/calendar/events              {title, start, end, allDay, location,
//                                          description, reminder, calendarId}
//                                          -> {event}; calendarId defaults to
//                                          the main calendar
//
// Settings: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
// (secrets). GOOGLE_TOKEN_URL and GOOGLE_API are only for testing.

import { HttpError } from "./util.js";

const MAX_RANGE_DAYS = 62;
let cached = null; // {key, token, expires} -- lives as long as the isolate

export function calendarConfigured(env) {
	return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
}

async function accessToken(env) {
	const key = env.GOOGLE_REFRESH_TOKEN;
	if (cached?.key === key && cached.expires > Date.now() + 60000) return cached.token;
	const res = await fetch(env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.GOOGLE_CLIENT_ID,
			client_secret: env.GOOGLE_CLIENT_SECRET,
			refresh_token: key,
			grant_type: "refresh_token",
		}),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || !data.access_token) {
		// invalid_grant: the token was revoked, or expired because the Google
		// app was left in "Testing" (those tokens last 7 days).
		const why = data.error === "invalid_grant" ? "Google sign-in has expired. Run `npm run google-auth` again." : `Google sign-in failed (${data.error || res.status})`;
		throw new HttpError(502, why, { reconnect: data.error === "invalid_grant" });
	}
	cached = { key, token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
	return cached.token;
}

async function google(env, path, init = {}) {
	const token = await accessToken(env);
	const res = await fetch((env.GOOGLE_API || "https://www.googleapis.com/calendar/v3") + path, {
		...init,
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new HttpError(502, `Google Calendar: ${data.error?.message || res.status}`);
	return data;
}

export async function calendarApi(request, env, url) {
	if (!url.pathname.startsWith("/api/calendar/")) return null;
	if (!calendarConfigured(env)) throw new HttpError(404, "Google Calendar isn't set up", { setup: true });

	if (url.pathname === "/api/calendar/events" && request.method === "GET") {
		const from = new Date(url.searchParams.get("from") || ""), to = new Date(url.searchParams.get("to") || "");
		if (isNaN(from) || isNaN(to) || to <= from || to - from > MAX_RANGE_DAYS * 864e5) {
			throw new HttpError(400, `from and to: a range of up to ${MAX_RANGE_DAYS} days`);
		}
		const list = await google(env, "/users/me/calendarList?minAccessRole=reader&maxResults=250");
		const all = list.items || [];
		const asked = url.searchParams.get("calendars");
		const wanted = asked == null ? null : new Set(asked.split(",").filter(Boolean));
		const calendars = all.filter((c) => (wanted ? wanted.has(c.id) : c.selected || c.primary));
		const perCalendar = await Promise.all(calendars.map(async (c) => {
			const q = new URLSearchParams({
				timeMin: from.toISOString(), timeMax: to.toISOString(),
				singleEvents: "true", orderBy: "startTime", maxResults: "250",
			});
			const r = await google(env, `/calendars/${encodeURIComponent(c.id)}/events?${q}`);
			return (r.items || []).filter((e) => e.status !== "cancelled").map((e) => slimEvent(e, c));
		}));
		const events = perCalendar.flat().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
		return {
			// Every calendar, so events can be added to one that's hidden in the agenda.
			calendars: all.map((c) => ({
				id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor, primary: !!c.primary,
				shown: !!(c.selected || c.primary), writable: c.accessRole === "owner" || c.accessRole === "writer",
			})),
			events,
		};
	}

	if (url.pathname === "/api/calendar/events" && request.method === "POST") {
		const body = await request.json().catch(() => null);
		const event = eventBody(body);
		const id = body.calendarId == null || body.calendarId === "" ? "primary" : body.calendarId;
		if (typeof id !== "string" || id.length > 300) throw new HttpError(400, "Bad calendarId");
		// Google itself refuses calendars you can't write to.
		const made = await google(env, `/calendars/${encodeURIComponent(id)}/events`, { method: "POST", body: JSON.stringify(event) });
		return { event: slimEvent(made, { id }) };
	}
	return null;
}

// Only what the agenda shows, plus when to alert: the event's own reminders,
// or its calendar's defaults (popup ones only; email reminders are Google's job).
export function slimEvent(e, cal) {
	const reminders = e.reminders?.useDefault === false ? e.reminders.overrides || [] : cal.defaultReminders || [];
	return {
		id: e.id,
		calendar: cal.id,
		title: e.summary || "(No title)",
		allDay: !!e.start?.date,
		start: e.start?.dateTime || e.start?.date,
		end: e.end?.dateTime || e.end?.date,
		location: e.location || "",
		link: e.htmlLink || "",
		color: cal.backgroundColor || "",
		alerts: reminders.filter((r) => r.method === "popup").map((r) => r.minutes),
	};
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

// {title, allDay, start, end, timeZone, location, description, reminder}
// Timed events come as local wall-clock times plus the device's time zone;
// all-day ones as dates, with end the last day (Google wants the day after).
export function eventBody(b) {
	if (!b || typeof b.title !== "string" || !b.title.trim() || b.title.length > 500) throw new HttpError(400, "Give the event a title");
	const out = { summary: b.title.trim() };
	if (b.allDay) {
		if (!DATE.test(b.start) || (b.end && !DATE.test(b.end))) throw new HttpError(400, "All-day events need dates");
		const last = b.end && b.end >= b.start ? b.end : b.start;
		const next = new Date(last + "T00:00:00Z");
		next.setUTCDate(next.getUTCDate() + 1);
		out.start = { date: b.start };
		out.end = { date: next.toISOString().slice(0, 10) };
	} else {
		if (!LOCAL.test(b.start) || !LOCAL.test(b.end) || b.end <= b.start) throw new HttpError(400, "The event needs a start and a later end");
		if (typeof b.timeZone !== "string" || !b.timeZone || b.timeZone.length > 64) throw new HttpError(400, "Missing time zone");
		const sec = (t) => (t.length === 16 ? t + ":00" : t);
		out.start = { dateTime: sec(b.start), timeZone: b.timeZone };
		out.end = { dateTime: sec(b.end), timeZone: b.timeZone };
	}
	if (b.location) out.location = String(b.location).slice(0, 1000);
	if (b.description) out.description = String(b.description).slice(0, 8000);
	if (b.reminder === "none") out.reminders = { useDefault: false, overrides: [] };
	else if (Number.isInteger(b.reminder) && b.reminder >= 0 && b.reminder <= 40320) {
		out.reminders = { useDefault: false, overrides: [{ method: "popup", minutes: b.reminder }] };
	}
	return out;
}
