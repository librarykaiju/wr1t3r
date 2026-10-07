// Talks to the Worker. The token lives in localStorage, like Reader's.
//
// Two parts: workerStorage() is the Worker as the place notes live (one of
// the storage kinds in src/storage.js), and `api` is everything else the
// Worker does for the page (transcripts, calendar, media lookups...).

import { READ_BATCH } from "./sync.js";

const KEY = "wr1t3r-token";

export function token() {
	try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}
export function setToken(t) {
	try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {}
}

export class AuthError extends Error {}

async function call(path, init = {}, get = (...a) => fetch(...a), auth = token) {
	// Signed in another way (Dropbox): the Worker's extras aren't there, and
	// that's not a reason to sign out.
	if (!auth()) throw new Error("This needs the wr1t3r server");
	const res = await get(path, {
		...init,
		headers: { Authorization: "Bearer " + auth(), ...init.headers },
		cache: "no-store",
	});
	if (res.status === 401) throw new AuthError("Wrong or missing token");
	return res;
}

async function jsonOrThrow(res) {
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
	return body;
}

function fromBase64(b64) {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

const q = (path) => "/api/file?path=" + encodeURIComponent(path);

// The Worker as storage (see src/storage.js for what each method promises).
// `get` and `auth` are fetch and the token, swappable for tests.
export function workerStorage({ get, auth } = {}) {
	const c = (path, init) => call(path, init, get, auth);
	return {
		async check() {
			await jsonOrThrow(await c("/api/files"));
		},
		async list() {
			return (await jsonOrThrow(await c("/api/files"))).files;
		},
		async attachments() {
			return (await jsonOrThrow(await c("/api/attachments"))).files;
		},
		async attachment(path) {
			const res = await c("/api/attachment?path=" + encodeURIComponent(path));
			if (!res.ok) await jsonOrThrow(res);
			return res.blob();
		},
		// A new picture; false if the name is taken.
		async uploadAttachment(path, blob) {
			const res = await c("/api/attachment?path=" + encodeURIComponent(path), {
				method: "PUT",
				headers: { "If-None-Match": "*", "Content-Type": blob.type || "application/octet-stream" },
				body: blob,
			});
			if (res.status === 412) return false;
			return { path, version: (await jsonOrThrow(res)).version, size: blob.size };
		},
		async read(paths) {
			const out = [];
			for (let i = 0; i < paths.length; i += READ_BATCH) {
				const res = await c("/api/files/read", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ paths: paths.slice(i, i + READ_BATCH) }),
				});
				for (const f of (await jsonOrThrow(res)).files) {
					out.push(f.missing ? f : { path: f.path, version: f.version, bytes: fromBase64(f.data) });
				}
			}
			return out;
		},
		async write(path, bytes, expected) {
			const res = await c(q(path), {
				method: "PUT",
				headers: expected ? { "If-Match": `"${expected}"` } : { "If-None-Match": "*" },
				body: bytes,
			});
			if (res.status === 412) return { ok: false, version: (await res.json().catch(() => ({}))).version ?? null };
			return { ok: true, version: (await jsonOrThrow(res)).version };
		},
		async remove(path, expected) {
			const res = await c(q(path), { method: "DELETE", headers: { "If-Match": `"${expected}"` } });
			if (res.status === 412) return { ok: false, version: (await res.json().catch(() => ({}))).version ?? null };
			if (!res.ok) await jsonOrThrow(res);
			return { ok: true };
		},
	};
}

export const api = {
	// 16 kHz mono WAV -> { duration, segments } (src/transcript.js).
	async transcribe(wav) {
		return jsonOrThrow(await call("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav }));
	},
	// Grammar and style problems in some text (worker/grammar.js).
	async grammar(text) {
		return jsonOrThrow(await call("/api/grammar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }));
	},
	// Definitions and synonyms (worker/define.js).
	async define(word) {
		return jsonOrThrow(await call("/api/define?word=" + encodeURIComponent(word)));
	},
	// Text read from pictures and PDFs (worker/ocr.js).
	async ocrIndex() {
		return (await jsonOrThrow(await call("/api/ocr"))).files;
	},
	async ocr(path) {
		return jsonOrThrow(await call("/api/ocr?path=" + encodeURIComponent(path), { method: "POST" }));
	},
	// Task reminders (worker/push.js). Each returns the parsed answer.
	pushKey: async () => (await jsonOrThrow(await call("/api/push/key"))).key,
	pushSubscribe: async (subscription, device) => jsonOrThrow(await call("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription, device }) })),
	pushUnsubscribe: async (endpoint) => jsonOrThrow(await call("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint }) })),
	pushTest: async () => jsonOrThrow(await call("/api/push/test", { method: "POST" })),
	putReminders: async (reminders) => jsonOrThrow(await call("/api/reminders", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reminders }) })),
	// One batch of the Google Drive backup now (worker/backup.js) -> {files, last, upToDate}.
	backupNow: async () => jsonOrThrow(await call("/api/backup", { method: "POST" })),
	// Quick capture into the Inbox note (worker /api/capture).
	async capture(item) {
		return jsonOrThrow(await call("/api/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) }));
	},
	async obsidian() {
		return jsonOrThrow(await call("/api/obsidian"));
	},
	async events(from, to, calendars) {
		const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
		if (calendars) qs.set("calendars", calendars.join(","));
		return jsonOrThrow(await call("/api/calendar/events?" + qs));
	},
	async addEvent(event) {
		const res = await call("/api/calendar/events", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(event),
		});
		return (await jsonOrThrow(res)).event;
	},
	// Events from an .ics file (src/ics.js googleEvent), up to 40 at a time.
	async importEvents(calendarId, events) {
		const res = await call("/api/calendar/import", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ calendarId, events }),
		});
		return jsonOrThrow(res);
	},
	// One event (one occurrence of a repeating one) gone from Google Calendar.
	async deleteEvent(calendar, id) {
		const qs = new URLSearchParams({ calendar, id });
		return jsonOrThrow(await call("/api/calendar/events?" + qs, { method: "DELETE" }));
	},
	async mediaKinds() {
		return (await jsonOrThrow(await call("/api/media/kinds"))).kinds;
	},
	async mediaSearch(kind, q) {
		return (await jsonOrThrow(await call("/api/media/search?" + new URLSearchParams({ kind, q })))).results;
	},
	async mediaCovers(kind, ref) {
		return (await jsonOrThrow(await call("/api/media/covers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ref }) }))).covers;
	},
	async mediaFindCovers(kind, title, creator = "", year = "") {
		return (await jsonOrThrow(await call("/api/media/findcovers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, title, creator, year }) }))).covers;
	},
	async mediaNote(kind, ref, cover, today) {
		return jsonOrThrow(await call("/api/media/note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ref, cover, today }) }));
	},
	async usdaSearch(q) {
		return (await jsonOrThrow(await call("/api/usda/search?" + new URLSearchParams({ q })))).results;
	},
};
