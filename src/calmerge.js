// Two calendar sources side by side: the usual one (Google through the
// Worker or the page, or the notebook's own) and Nextcloud's (src/caldav.js).
// It answers the same calls as each (events, addEvent, deleteEvent,
// importEvents, addCalendar), so the agenda, month view, Timeline and
// reminders see one list of calendars. Nextcloud's calendar ids carry a
// prefix ("nc:personal"), so an id says which side it belongs to.
//
//   runBase(fn)     runs fn on the usual source (with its own fallbacks)
//   extra           the Nextcloud calendar
//   extraFirst()    whether Nextcloud's main calendar is the main one (when
//                   the usual source is only the notebook's calendar)
//   onExtraError(e) told when Nextcloud fails; the usual side still shows
//   warn(e)         told when the usual side fails and Nextcloud's still shows

export const NC_PREFIX = "nc:";
export const isNextcloudId = (id) => String(id || "").startsWith(NC_PREFIX);
const strip = (id) => String(id).slice(NC_PREFIX.length);
const tagEvent = (e) => e && { ...e, calendar: NC_PREFIX + e.calendar };

export function mergedCalendar({ runBase, extra, extraFirst = () => false, onExtraError = () => {}, warn = () => {} }) {
	// Which side a new event goes to when the form names no calendar.
	let mainIsExtra = extraFirst();

	return {
		async events(from, to, ids = null) {
			const baseIds = ids == null ? null : ids.filter((id) => !isNextcloudId(id));
			const extraIds = ids == null ? null : ids.filter(isNextcloudId).map(strip);
			const [b, x] = await Promise.allSettled([runBase((c) => c.events(from, to, baseIds)), extra.events(from, to, extraIds)]);
			if (b.status === "rejected" && x.status === "rejected") { onExtraError(x.reason); throw b.reason; }
			if (x.status === "rejected") { onExtraError(x.reason); return b.value; }
			const xc = x.value.calendars.map((c) => ({ ...c, id: NC_PREFIX + c.id, primary: false }));
			const xe = x.value.events.map(tagEvent);
			if (b.status === "rejected") {
				warn(b.reason);
				mainIsExtra = true;
				const main = x.value.calendars.findIndex((c) => c.primary);
				if (main >= 0) xc[main].primary = true;
				return { calendars: xc, events: xe };
			}
			const baseMain = b.value.calendars.some((c) => c.primary);
			mainIsExtra = extraFirst() || !baseMain;
			const main = mainIsExtra ? x.value.calendars.findIndex((c) => c.primary) : -1;
			if (main >= 0) xc[main].primary = true;
			const bc = main >= 0 ? b.value.calendars.map((c) => ({ ...c, primary: false })) : b.value.calendars;
			const events = [...b.value.events, ...xe].sort((p, q) => (p.start < q.start ? -1 : p.start > q.start ? 1 : 0));
			return { calendars: mainIsExtra ? [...xc, ...bc] : [...bc, ...xc], events };
		},
		async addEvent(body) {
			const id = body.calendarId;
			if (isNextcloudId(id) || (!id && mainIsExtra)) return tagEvent(await extra.addEvent({ ...body, calendarId: id ? strip(id) : undefined }));
			return runBase((c) => c.addEvent(body));
		},
		async deleteEvent(calendar, id) {
			return isNextcloudId(calendar) ? extra.deleteEvent(strip(calendar), id) : runBase((c) => c.deleteEvent(calendar, id));
		},
		async importEvents(calendarId, events) {
			if (isNextcloudId(calendarId) || (!calendarId && mainIsExtra)) return extra.importEvents(calendarId ? strip(calendarId) : "", events);
			return runBase((c) => c.importEvents(calendarId, events));
		},
		async addCalendar(name) {
			return NC_PREFIX + (await extra.addCalendar(name));
		},
	};
}
