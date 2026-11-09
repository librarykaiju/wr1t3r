// A Nextcloud stand-in for the CalDAV calls src/caldav.js makes: Basic auth
// with an app password, the principal lookup, PROPFIND on the calendar home,
// REPORT calendar-query with <expand> (repeats come back one VEVENT per
// occurrence in UTC with a RECURRENCE-ID, as Sabre does), PUT with
// If-None-Match / If-Match (412), GET with an ETag, DELETE and MKCALENDAR.
// It expands DAILY and WEEKLY rules with UNTIL and EXDATE, which is all the
// tests write.

import { zonedMoment } from "../src/ics.js";

export function fakeCaldav({ base = "https://cloud.example.com", login = "me@example.com", uid = "me", password = "app-pass" } = {}) {
	let n = 0;
	const home = `/remote.php/dav/calendars/${uid}/`;
	const calendars = new Map();
	const state = { calls: [], calendars, password, puts: [] };
	state.addCalendar = (id, { name = id, color = "#0082c9", enabled = true, writable = true, tasks = false } = {}) => {
		calendars.set(id, { name, color, enabled, writable, tasks, events: new Map() });
	};
	state.addCalendar("personal", { name: "Personal", color: "#0082c9" });
	state.drop = (cal, name, ics) => calendars.get(cal).events.set(name, { ics, etag: "e" + ++n });

	const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const multi = (body) => new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:cal="urn:ietf:params:xml:ns:caldav" xmlns:x1="http://apple.com/ns/ical/" xmlns:oc="http://owncloud.org/ns">${body}</d:multistatus>`, { status: 207 });
	const status = (code) => new Response(null, { status: code });

	// ---- a small expander ----
	const lines = (ics) => ics.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
	const prop = (block, name) => block.find((l) => new RegExp(`^${name}[;:]`, "i").test(l));
	const parseTime = (l) => {
		const m = /^[^:;]+((?:;[^:]*)?):(.*)$/.exec(l);
		const params = Object.fromEntries((m[1] || "").split(";").filter(Boolean).map((p) => p.split("=")));
		const v = m[2].trim();
		const d = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
		if (!d[4]) return { allDay: true, ms: Date.UTC(+d[1], +d[2] - 1, +d[3]) };
		if (d[7]) return { allDay: false, ms: Date.UTC(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6]) };
		const tz = params.TZID || "UTC";
		// The nth day after, at the same wall-clock time in its zone.
		const at = (days) => { const w = new Date(Date.UTC(+d[1], +d[2] - 1, +d[3] + days, +d[4], +d[5], +d[6])); return zonedMoment(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds(), tz).getTime(); };
		return { allDay: false, ms: at(0), at };
	};
	const stamp = (ms, allDay) => { const s = new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"); return allDay ? s.slice(0, 8) : s; };
	const blocks = (ics) => {
		const ls = lines(ics), out = [];
		for (let i = 0; i < ls.length; i++) {
			if (!/^BEGIN:VEVENT/i.test(ls[i])) continue;
			let j = i, depth = 0;
			for (; j < ls.length; j++) { if (/^BEGIN:/i.test(ls[j])) depth++; if (/^END:/i.test(ls[j]) && --depth === 0) break; }
			out.push(ls.slice(i, j + 1));
			i = j;
		}
		return out;
	};
	function expand(ics, from, to) {
		const evs = blocks(ics);
		const overrides = new Map(evs.filter((b) => prop(b, "RECURRENCE-ID")).map((b) => [parseTime(prop(b, "RECURRENCE-ID")).ms, b]));
		const out = [];
		const inst = (b, startMs, len, allDay, rid) => {
			if (!(startMs < to && startMs + len > from)) return;
			const keep = b.filter((l, k) => k && k < b.length - 1 && !/^(DTSTART|DTEND|RRULE|EXDATE|RECURRENCE-ID|DURATION)[;:]/i.test(l));
			out.push(["BEGIN:VEVENT", ...keep, allDay ? `DTSTART;VALUE=DATE:${stamp(startMs, true)}` : `DTSTART:${stamp(startMs)}`, allDay ? `DTEND;VALUE=DATE:${stamp(startMs + len, true)}` : `DTEND:${stamp(startMs + len)}`, ...(rid != null ? [allDay ? `RECURRENCE-ID;VALUE=DATE:${stamp(rid, true)}` : `RECURRENCE-ID:${stamp(rid)}`] : []), "END:VEVENT"].join("\r\n"));
		};
		for (const b of evs) {
			if (prop(b, "RECURRENCE-ID")) continue;
			const s = parseTime(prop(b, "DTSTART")), e = parseTime(prop(b, "DTEND"));
			const len = e.ms - s.ms;
			const rule = prop(b, "RRULE");
			if (!rule) { inst(b, s.ms, len, s.allDay, null); continue; }
			const freq = /FREQ=(\w+)/.exec(rule)[1];
			const until = /UNTIL=(\w+)/.exec(rule)?.[1];
			const untilMs = until ? parseTime("X:" + until).ms + (until.length === 8 ? 864e5 - 1 : 0) : Infinity;
			const ex = new Set(b.filter((l) => /^EXDATE[;:]/i.test(l)).flatMap((l) => { const [head, vals] = [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1)]; return vals.split(",").map((v) => parseTime(head + ":" + v).ms); }));
			const step = freq === "DAILY" ? 864e5 : 7 * 864e5;
			const days = step / 864e5;
			for (let k = 0, t = s.ms; t < to && t <= untilMs && k < 2000; k++, t = s.at ? s.at(k * days) : s.ms + k * step) {
				if (ex.has(t)) continue;
				const o = overrides.get(t);
				if (o) { const os = parseTime(prop(o, "DTSTART")), oe = parseTime(prop(o, "DTEND")); inst(o, os.ms, oe.ms - os.ms, os.allDay, t); }
				else inst(b, t, len, s.allDay, t);
			}
		}
		return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sabre//Sabre VObject//EN", ...out, "END:VCALENDAR"].join("\r\n");
	}

	async function fetch(url, init = {}) {
		const u = new URL(url);
		const method = init.method || "GET";
		const h = new Headers(init.headers);
		state.calls.push(`${method} ${decodeURIComponent(u.pathname)}`);
		if (u.origin !== base) throw new TypeError("Failed to fetch");
		if (h.get("Authorization") !== "Basic " + Buffer.from(`${login}:${state.password}`).toString("base64")) return status(401);
		const body = typeof init.body === "string" ? init.body : "";

		if (u.pathname === "/remote.php/dav/" && method === "PROPFIND") {
			return multi(`<d:response><d:href>/remote.php/dav/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/remote.php/dav/principals/users/${uid}/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
		}
		if (!u.pathname.startsWith(home)) return status(404);
		const [calId, name] = u.pathname.slice(home.length).split("/").map(decodeURIComponent);
		if (!calId) {
			if (method !== "PROPFIND") return status(405);
			const self = `<d:response><d:href>${home}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
			if (h.get("Depth") === "0") return multi(self);
			const rows = [...calendars].map(([id, c]) => `<d:response><d:href>${home}${encodeURIComponent(id)}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>${esc(c.name)}</d:displayname><x1:calendar-color>${c.color}FF</x1:calendar-color><cal:supported-calendar-component-set>${c.tasks ? '<cal:comp name="VTODO"/>' : '<cal:comp name="VEVENT"/><cal:comp name="VTODO"/>'}</cal:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:read/></d:privilege>${c.writable ? "<d:privilege><d:write/></d:privilege>" : ""}</d:current-user-privilege-set><oc:calendar-enabled>${c.enabled ? 1 : 0}</oc:calendar-enabled></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
			const inbox = `<d:response><d:href>${home}inbox/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:schedule-inbox/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
			return multi(self + rows.join("") + inbox);
		}
		const c = calendars.get(calId);
		if (method === "MKCALENDAR") {
			if (c) return status(405);
			state.addCalendar(calId, { name: /<d:displayname>([^<]*)</.exec(body)?.[1] || calId, color: /<a:calendar-color>([^<]*)</.exec(body)?.[1] || "#0082c9" });
			return status(201);
		}
		if (!c) return status(404);
		if (method === "REPORT") {
			const [, s, e] = /<c:expand start="(\w+)" end="(\w+)"/.exec(body);
			const from = parseTime("X:" + s).ms, to = parseTime("X:" + e).ms;
			const rows = [];
			for (const [nm, ev] of c.events) {
				const x = expand(ev.ics, from, to);
				if (!/BEGIN:VEVENT/.test(x)) continue;
				rows.push(`<d:response><d:href>${home}${encodeURIComponent(calId)}/${encodeURIComponent(nm)}</d:href><d:propstat><d:prop><d:getetag>&quot;${ev.etag}&quot;</d:getetag><cal:calendar-data>${esc(x)}</cal:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
			}
			return multi(rows.join(""));
		}
		const cur = c.events.get(name);
		const im = h.get("If-Match");
		if (method === "GET") return cur ? new Response(cur.ics, { headers: { ETag: `"${cur.etag}"` } }) : status(404);
		if (method === "PUT") {
			if (!c.writable) return status(403);
			if ((h.get("If-None-Match") === "*" && cur) || (im && (!cur || im !== `"${cur.etag}"`))) return status(412);
			if (!/^BEGIN:VCALENDAR/.test(body)) return status(415);
			c.events.set(name, { ics: body, etag: "e" + ++n });
			state.puts.push(body);
			return new Response(null, { status: cur ? 204 : 201, headers: { ETag: `"e${n}"` } });
		}
		if (method === "DELETE") {
			if (!cur) return status(404);
			if (im && im !== `"${cur.etag}"`) return status(412);
			c.events.delete(name);
			return status(204);
		}
		return status(405);
	}
	return { fetch, state, base, login, uid };
}
