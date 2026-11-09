// Nextcloud Calendar over CalDAV, straight from the browser with an app
// password (the same WebAppPassword origin setting as the files, src/nextcloud.js).
// It answers the same calls as Google Calendar (src/gcal.js) and the
// notebook's own calendar (src/notecal.js): events, addEvent, deleteEvent and
// importEvents, so the agenda, month view, Timeline and reminders don't care
// which one they're talking to. Events land in Nextcloud, so a phone syncing
// that calendar (DAVx5, iOS) shows them and rings their alarms.
//
//   calendar id  the calendar's name in its URL ("personal")
//   event id     the event's file in it ("abc.ics"), plus "|" and its
//                RECURRENCE-ID for one occurrence of a repeating event
//
// Reads ask the server to expand repeats (calendar-query with <expand>), so
// every occurrence comes back as its own event in UTC. Writes say the device's
// time zone (TZID plus a VTIMEZONE made from Intl), so a weekly 9:00 stays
// 9:00 across daylight saving.

import { requester, elements, element, text, cleanEtag, fail, findAccount, NextcloudError } from "./nextcloud.js";
import { AuthError } from "./api.js";
import { readIcs, readTime, zoneWall } from "./ics.js";
import { EVENT_COLORS, dayKey, addDays } from "./agenda.js";
import { REPEATS } from "./notecal.js";

const DEFAULT_ALERT = 10; // minutes, for "Calendar default" on a timed event, as notecal.js
const FALLBACK_COLOR = "#0082c9"; // Nextcloud blue
export const REMINDERS_CALENDAR = "wr1t3r reminders";

// Google's event colors as CSS color names, which is what COLOR holds
// (RFC 7986) and what Nextcloud's Calendar app reads and writes.
const CSS_COLORS = { 1: "slateblue", 2: "mediumseagreen", 3: "darkorchid", 4: "salmon", 5: "gold", 6: "orangered", 7: "deepskyblue", 8: "dimgray", 9: "darkslateblue", 10: "seagreen", 11: "crimson" };
const COLOR_OF_NAME = Object.fromEntries(Object.entries(CSS_COLORS).map(([id, name]) => [name, EVENT_COLORS[id][1]]));

const home = (c) => `${c.server}/remote.php/dav/calendars/${encodeURIComponent(c.uid || c.user)}/`;
const calUrl = (c, cal) => home(c) + encodeURIComponent(cal) + "/";
const eventUrl = (c, cal, name) => calUrl(c, cal) + encodeURIComponent(name);
const lastSegment = (href) => { const s = String(href).replace(/\/+$/, "").split("/").pop() || ""; try { return decodeURIComponent(s); } catch { return s; } };

const CALENDARS = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/" xmlns:oc="http://owncloud.org/ns"><d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><a:calendar-order/><c:supported-calendar-component-set/><d:current-user-privilege-set/><oc:calendar-enabled/></d:prop></d:propfind>`;
const utc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const query = (from, to) => `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data><c:expand start="${utc(from)}" end="${utc(to)}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${utc(from)}" end="${utc(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;

// [{id, name, color, primary, shown, writable}] from the calendar home's listing.
export function parseCalendars(xml) {
	const out = [];
	for (const r of elements("response", xml)) {
		const ok = elements("propstat", r).filter((ps) => /\s200\s/.test(" " + (text("status", ps) || "") + " ")).map((ps) => element("prop", ps) || "").join("");
		const type = element("resourcetype", ok) || "";
		if (!/<(?:[\w.-]+:)?calendar(?:\s[^>]*)?\/?>/i.test(type)) continue;
		const comps = element("supported-calendar-component-set", ok);
		if (comps != null && comps.trim() && !/name\s*=\s*["']VEVENT["']/i.test(comps)) continue; // tasks-only lists
		const privs = element("current-user-privilege-set", ok) || "";
		const color = /#[0-9a-f]{6}/i.exec(text("calendar-color", ok) || "")?.[0];
		out.push({
			id: lastSegment(text("href", r)),
			name: text("displayname", ok) || lastSegment(text("href", r)),
			color: color ? color.toLowerCase() : FALLBACK_COLOR,
			order: Number(text("calendar-order", ok)) || 0,
			primary: false,
			shown: text("calendar-enabled", ok) !== "0",
			writable: !privs.trim() || /<(?:[\w.-]+:)?(write|write-content|all)(?:\s[^>]*)?\/?>/i.test(privs),
		});
	}
	out.sort((a, b) => a.order - b.order);
	const main = out.find((c) => c.id === "personal" && c.writable) || out.find((c) => c.writable && c.name !== REMINDERS_CALENDAR);
	if (main) main.primary = true;
	return out.map(({ order, ...c }) => c);
}

// ---- writing iCalendar ----------------------------------------------------

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// Lines longer than 75 bytes are folded, never inside a character.
function fold(line) {
	const enc = new TextEncoder();
	if (enc.encode(line).length <= 75) return line;
	const parts = [];
	let cur = "", size = 0, limit = 75;
	for (const ch of line) {
		const n = enc.encode(ch).length;
		if (size + n > limit) { parts.push(cur); cur = ""; size = 0; limit = 74; }
		cur += ch;
		size += n;
	}
	parts.push(cur);
	return parts.join("\r\n ");
}
const compact = (wall) => wall.replace(/[-:]/g, "") + (wall.length === 16 ? "00" : ""); // "2026-11-10T09:00" -> "20261110T090000"
const dateOnly = (d) => d.replace(/-/g, "");
const dayOf = (s) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const offsetAt = (ms, tz) => Math.round((zoneWall(ms, tz) - ms) / 60000); // minutes east of UTC
const offsetText = (min) => (min < 0 ? "-" : "+") + String(Math.floor(Math.abs(min) / 60)).padStart(2, "0") + String(Math.abs(min) % 60).padStart(2, "0");
const WEEKDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

// The moments in a year when a zone's offset changes: [{at (ms), from, to}].
function transitions(tz, year) {
	const out = [];
	let t = Date.UTC(year, 0, 1), prev = offsetAt(t, tz);
	const end = Date.UTC(year + 1, 0, 1);
	for (let next = t + 864e5; next <= end; t = next, next += 864e5) {
		const o = offsetAt(next, tz);
		if (o === prev) continue;
		let lo = t, hi = next; // narrow to the minute
		while (hi - lo > 60000) { const mid = lo + Math.floor((hi - lo) / 120000) * 60000; if (offsetAt(mid, tz) === prev) lo = mid; else hi = mid; }
		out.push({ at: hi, from: prev, to: o });
		prev = o;
	}
	return out;
}

// A VTIMEZONE for the zone, from what Intl knows: daylight saving as yearly
// rules ("the second Sunday of March"), so a repeating event keeps its time in
// later years too.
const zones = new Map();
export function vtimezone(tz, year) {
	const key = tz + " " + year;
	if (!zones.has(key)) zones.set(key, makeVtimezone(tz, year));
	return zones.get(key);
}
function makeVtimezone(tz, year) {
	const lines = ["BEGIN:VTIMEZONE", `TZID:${tz}`];
	const ts = transitions(tz, year);
	if (!ts.length) {
		const o = offsetText(offsetAt(Date.UTC(year, 0, 1), tz));
		lines.push("BEGIN:STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${o}`, `TZOFFSETTO:${o}`, "END:STANDARD");
	} else {
		for (const x of ts) {
			const local = new Date(x.at + x.from * 60000); // the wall clock just before the change, read as UTC
			const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
			const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
			const nth = d + 7 > last ? -1 : Math.ceil(d / 7);
			const kind = x.to > x.from ? "DAYLIGHT" : "STANDARD";
			const wall = `${y}${String(m + 1).padStart(2, "0")}${String(d).padStart(2, "0")}T${String(local.getUTCHours()).padStart(2, "0")}${String(local.getUTCMinutes()).padStart(2, "0")}00`;
			lines.push(`BEGIN:${kind}`, `DTSTART:${wall}`, `TZOFFSETFROM:${offsetText(x.from)}`, `TZOFFSETTO:${offsetText(x.to)}`, `RRULE:FREQ=YEARLY;BYMONTH=${m + 1};BYDAY=${nth}${WEEKDAY[local.getUTCDay()]}`, `END:${kind}`);
		}
	}
	lines.push("END:VTIMEZONE");
	return lines;
}

const knownZone = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return !!tz; } catch { return false; } };

// The .ics text for an event body, as agenda.formEvent makes it (all-day end
// is the last day), reminderEvent (src/calreminders.js), or an import's
// googleEvent (src/ics.js: uid and recurrence lines). Throws on a bad body.
export function eventIcs(b, { uid, now = new Date() } = {}) {
	const title = String(b.title || "").trim();
	if (!title) throw new Error("Give the event a title");
	const DATE = /^\d{4}-\d{2}-\d{2}$/, LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
	const tz = knownZone(b.timeZone) ? b.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	const ev = ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${utc(now)}`];
	let zone = null;
	if (b.allDay) {
		const end = b.end && b.end >= b.start ? b.end : b.start;
		if (!DATE.test(b.start) || !DATE.test(end)) throw new Error("All-day events need dates");
		ev.push(`DTSTART;VALUE=DATE:${dateOnly(b.start)}`, `DTEND;VALUE=DATE:${dateOnly(dayKey(addDays(dayOf(end), 1)))}`);
	} else {
		if (!LOCAL.test(b.start) || !LOCAL.test(b.end) || b.end <= b.start) throw new Error("The event needs a start and a later end");
		ev.push(`DTSTART;TZID=${tz}:${compact(b.start)}`, `DTEND;TZID=${tz}:${compact(b.end)}`);
		zone = tz;
	}
	ev.push(`SUMMARY:${esc(title)}`);
	if (String(b.location || "").trim()) ev.push(`LOCATION:${esc(String(b.location).trim())}`);
	if (String(b.description || "").trim()) ev.push(`DESCRIPTION:${esc(String(b.description).trim())}`);
	if (b.colorId && CSS_COLORS[b.colorId]) ev.push(`COLOR:${CSS_COLORS[b.colorId]}`);
	if (b.transparent) ev.push("TRANSP:TRANSPARENT");
	if (REPEATS.includes(b.repeat)) ev.push(`RRULE:FREQ=${b.repeat.toUpperCase()}${DATE.test(b.until || "") ? ";UNTIL=" + dateOnly(b.until) : ""}`);
	for (const r of b.recurrence || []) if (/^(RRULE|EXDATE|RDATE)[:;]/i.test(r)) ev.push(r);
	const alert = b.reminder === "none" ? null : Number.isInteger(b.reminder) && b.reminder >= 0 ? b.reminder : b.allDay ? null : DEFAULT_ALERT;
	if (alert != null) ev.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`, `TRIGGER:${alert ? `-PT${alert}M` : "PT0S"}`, "END:VALARM");
	ev.push("END:VEVENT");
	const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//wr1t3r//Calendar//EN", "CALSCALE:GREGORIAN", ...(zone ? vtimezone(zone, Number(b.start.slice(0, 4))) : []), ...ev, "END:VCALENDAR"];
	return lines.map(fold).join("\r\n") + "\r\n";
}

// The .ics text with one occurrence of the repeating event taken out: an
// EXDATE on the main event, and any changed copy of that occurrence dropped.
export function withoutOccurrence(ics, recurrenceValue) {
	const lines = String(ics).replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
	const allDay = /^\d{8}$/.test(recurrenceValue);
	const target = readTime(recurrenceValue, allDay ? { VALUE: "DATE" } : {})?.local;
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		if (!/^BEGIN:VEVENT\s*$/i.test(lines[i])) { out.push(lines[i]); continue; }
		let j = i, depth = 0;
		for (; j < lines.length; j++) {
			if (/^BEGIN:/i.test(lines[j])) depth++;
			if (/^END:/i.test(lines[j]) && --depth === 0) break;
		}
		const block = lines.slice(i, j + 1);
		const rid = block.find((l, k) => k && /^RECURRENCE-ID[;:]/i.test(l));
		if (rid) {
			const m = /^RECURRENCE-ID((?:;[^:]*)?):(.*)$/i.exec(rid);
			const params = Object.fromEntries((m?.[1] || "").split(";").filter(Boolean).map((p) => p.split("=")).map(([k, v]) => [k.toUpperCase(), (v || "").replace(/^"|"$/g, "")]));
			if (m && readTime(m[2], params)?.local === target) { i = j; continue; } // its changed copy goes too
			out.push(...block);
		} else {
			const at = block.findIndex((l) => /^DTSTART[;:]/i.test(l));
			block.splice(at + 1, 0, allDay ? `EXDATE;VALUE=DATE:${recurrenceValue}` : `EXDATE:${recurrenceValue}`);
			out.push(...block);
		}
		i = j;
	}
	return out.filter(Boolean).map(fold).join("\r\n") + "\r\n";
}

// An id the server can use as a file name (reminders bring their own).
const newUid = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).toLowerCase();
const fileFor = (uid) => String(uid).replace(/[^\w.@-]+/g, "_").slice(0, 200) + ".ics";

// The agenda's event objects from one calendar-data (one file, expanded).
function instances(ics, name, calendar) {
	return readIcs(ics).map((e) => ({
		id: e.recurrenceValue ? `${name}|${e.recurrenceValue}` : name,
		calendar: calendar.id,
		title: e.title,
		allDay: e.allDay,
		start: e.start,
		end: e.allDay ? dayKey(addDays(dayOf(e.end), 1)) : e.end,
		location: e.location,
		link: "",
		color: COLOR_OF_NAME[e.color.toLowerCase()] || (/^#[0-9a-f]{6}$/i.test(e.color) ? e.color : calendar.color),
		alerts: e.reminder == null ? [] : [Math.max(0, e.reminder)],
		repeats: !!e.recurrenceValue,
	}));
}

// The calendar. creds() -> {server, user, uid, password}; get and wait are
// swappable for tests.
export function nextcloudCalendar({ creds, get = (...a) => fetch(...a), wait } = {}) {
	const call = requester({ creds, get, wait });
	let known = null; // the last calendar list, for picking which to read

	async function calendars() {
		const res = await call("PROPFIND", home(creds()), { depth: 1, body: CALENDARS });
		if (res.status !== 207) throw await fail(res, "Listing calendars");
		known = parseCalendars(await res.text());
		return known;
	}

	async function put(cal, name, ics, headers) {
		return call("PUT", eventUrl(creds(), cal, name), { headers: { "Content-Type": "text/calendar; charset=utf-8", ...headers }, body: ics });
	}

	const writableId = (id) => {
		if (id) return id;
		const main = known?.find((c) => c.primary) || known?.find((c) => c.writable);
		if (!main) throw new Error("There's no Nextcloud calendar to add to");
		return main.id;
	};

	return {
		async events(from, to, ids = null) {
			const all = await calendars();
			const wanted = ids == null ? null : new Set(ids);
			const read = all.filter((c) => (wanted ? wanted.has(c.id) : c.shown));
			const per = await Promise.all(read.map(async (c) => {
				const res = await call("REPORT", calUrl(creds(), c.id), { depth: 1, body: query(from, to) });
				if (res.status !== 207) throw await fail(res, `Reading ${c.name}`);
				return elements("response", await res.text()).flatMap((r) => {
					const data = element("calendar-data", r);
					if (!data) return [];
					const ics = text("calendar-data", r.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;")));
					return instances(ics, lastSegment(text("href", r)), c);
				});
			}));
			const events = per.flat().sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
			return { calendars: all, events };
		},

		// body as agenda.formEvent makes it, plus calendarId and repeat; or a
		// reminder with its own id. A reminder that's already there (another
		// device sent it) throws "already exists", which the sender skips.
		async addEvent(body) {
			if (!known) await calendars();
			const cal = writableId(body.calendarId);
			const uid = body.id || newUid();
			const ics = eventIcs(body, { uid });
			const res = await put(cal, fileFor(uid), ics, { "If-None-Match": "*" });
			if (res.status === 412) throw Object.assign(new Error("That event already exists"), { status: 409 });
			if (res.status !== 201 && res.status !== 204) throw await fail(res, "Adding the event");
			const c = known.find((x) => x.id === cal) || { id: cal, color: FALLBACK_COLOR };
			return instances(ics, fileFor(uid), c)[0] || null;
		},

		// One occurrence of a repeating event (id "file.ics|RECURRENCE-ID"),
		// or the whole event. Already gone counts as deleted.
		async deleteEvent(calendar, id) {
			const bar = String(id).indexOf("|");
			if (bar < 0) {
				const name = /\.ics$/i.test(id) ? id : fileFor(id);
				const res = await call("DELETE", eventUrl(creds(), calendar, name));
				if (res.status >= 300 && res.status !== 404 && res.status !== 410) throw await fail(res, "Deleting the event");
				return { deleted: true };
			}
			const name = id.slice(0, bar), rid = id.slice(bar + 1);
			for (let tries = 0; ; tries++) {
				const got = await call("GET", eventUrl(creds(), calendar, name));
				if (got.status === 404 || got.status === 410) return { deleted: true };
				if (!got.ok) throw await fail(got, "Opening the event");
				const etag = cleanEtag(got.headers.get("ETag"));
				const res = await put(calendar, name, withoutOccurrence(await got.text(), rid), etag ? { "If-Match": `"${etag}"` } : {});
				if (res.status === 412 && tries < 2) continue; // changed in between: read it again
				if (res.status >= 300) throw await fail(res, "Deleting the occurrence");
				return { deleted: true };
			}
		},

		// Events from an .ics file (src/ics.js planGoogle). One the calendar
		// already has from this file (same uid) is left as it is.
		async importEvents(calendarId, events) {
			if (!known) await calendars();
			const cal = writableId(calendarId);
			let imported = 0;
			const failed = [];
			for (const e of events) {
				try {
					const uid = e.uid || newUid();
					const res = await put(cal, fileFor(uid), eventIcs(e, { uid }), { "If-None-Match": "*" });
					if (res.status === 412 || res.status === 201 || res.status === 204) imported++;
					else throw await fail(res, "Adding");
				} catch (err) {
					if (err instanceof AuthError) throw err;
					failed.push({ title: e.title || "", error: err.message });
				}
			}
			return { imported, failed };
		},

		// Makes a calendar (MKCALENDAR) and returns its id; one with that name
		// already there is used as it is.
		async addCalendar(name, color = "#e9322d") {
			const all = known || (await calendars());
			const have = all.find((c) => c.name === name && c.writable);
			if (have) return have.id;
			const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "wr1t3r";
			const body = `<?xml version="1.0" encoding="utf-8"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:set><d:prop><d:displayname>${name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</d:displayname><a:calendar-color>${color}</a:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`;
			const res = await call("MKCALENDAR", calUrl(creds(), id), { body });
			if (res.status !== 201 && res.status !== 405) throw await fail(res, "Making the calendar");
			await calendars();
			return id;
		},
	};
}

// Connects the calendar on its own (the notes kept elsewhere): checks the
// account and that it has calendars. {server, user, uid, password}.
export async function connectCalendar({ server, user, password, get = (...a) => fetch(...a), pageProtocol = globalThis.location?.protocol } = {}) {
	const c = await findAccount({ server, user, password, get, pageProtocol });
	const res = await requester({ creds: () => c, get })("PROPFIND", home(c), { depth: 0, body: CALENDARS });
	if (res.status === 401) throw new NextcloudError("password", "Nextcloud didn't accept that username and app password.");
	if (res.status !== 207) throw new NextcloudError("address", `Nextcloud answered, but has no calendars for this account (HTTP ${res.status}). Is the Calendar app on?`);
	return c;
}
