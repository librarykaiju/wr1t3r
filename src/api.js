// Talks to the Worker. The token lives in localStorage, like Reader's.

import { READ_BATCH } from "./sync.js";

const KEY = "wr1t3r-token";

export function token() {
	try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}
export function setToken(t) {
	try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {}
}

export class AuthError extends Error {}

async function call(path, init = {}) {
	const res = await fetch(path, {
		...init,
		headers: { Authorization: "Bearer " + token(), ...init.headers },
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

export const api = {
	async check() {
		await jsonOrThrow(await call("/api/files"));
	},
	async list() {
		return (await jsonOrThrow(await call("/api/files"))).files;
	},
	async attachments() {
		return (await jsonOrThrow(await call("/api/attachments"))).files;
	},
	async attachment(path) {
		const res = await call("/api/attachment?path=" + encodeURIComponent(path));
		if (!res.ok) await jsonOrThrow(res);
		return res.blob();
	},
	// A new picture; false if the name is taken.
	async uploadAttachment(path, blob) {
		const res = await call("/api/attachment?path=" + encodeURIComponent(path), {
			method: "PUT",
			headers: { "If-None-Match": "*", "Content-Type": blob.type || "application/octet-stream" },
			body: blob,
		});
		if (res.status === 412) return false;
		return { path, version: (await jsonOrThrow(res)).version, size: blob.size };
	},
	// 16 kHz mono WAV -> { duration, segments } (src/transcript.js).
	async transcribe(wav) {
		return jsonOrThrow(await call("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav }));
	},
	async obsidian() {
		return jsonOrThrow(await call("/api/obsidian"));
	},
	async read(paths) {
		const out = [];
		for (let i = 0; i < paths.length; i += READ_BATCH) {
			const res = await call("/api/files/read", {
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
		const res = await call(q(path), {
			method: "PUT",
			headers: expected ? { "If-Match": `"${expected}"` } : { "If-None-Match": "*" },
			body: bytes,
		});
		if (res.status === 412) return { ok: false, version: (await res.json().catch(() => ({}))).version ?? null };
		return { ok: true, version: (await jsonOrThrow(res)).version };
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
	async mediaNote(kind, ref, cover, today) {
		return jsonOrThrow(await call("/api/media/note", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ref, cover, today }) }));
	},
	async usdaSearch(q) {
		return (await jsonOrThrow(await call("/api/usda/search?" + new URLSearchParams({ q })))).results;
	},
	async remove(path, expected) {
		const res = await call(q(path), { method: "DELETE", headers: { "If-Match": `"${expected}"` } });
		if (res.status === 412) return { ok: false, version: (await res.json().catch(() => ({}))).version ?? null };
		if (!res.ok) await jsonOrThrow(res);
		return { ok: true };
	},
};
