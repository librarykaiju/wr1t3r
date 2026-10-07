// Google Calendar from the page itself, for builds without our Worker's
// Google account (src/google.js signs in). Answers the same calls as the
// Worker's /api/calendar/ (src/api.js) and the built-in calendar
// (src/notecal.js), sharing the Worker's code for the Google side.

import { listEvents, importEvents as importAll, eventBody, slimEvent } from "../worker/calendar.js";

const API = "https://www.googleapis.com/calendar/v3";

export function googleCalendar(call) {
	const google = (path, init) => call(API + path, init);
	return {
		events: (from, to, ids) => listEvents(google, from, to, ids),
		async addEvent(body) {
			const id = body.calendarId || "primary";
			const made = await google(`/calendars/${encodeURIComponent(id)}/events`, { method: "POST", body: JSON.stringify(eventBody(body)) });
			return slimEvent(made, { id });
		},
		async deleteEvent(calendar, id) {
			await google(`/calendars/${encodeURIComponent(calendar)}/events/${encodeURIComponent(id)}`, { method: "DELETE" });
			return { deleted: true };
		},
		importEvents: (calendarId, events) => importAll(google, calendarId || "primary", events),
	};
}
