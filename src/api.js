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
	if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
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
	async remove(path, expected) {
		const res = await call(q(path), { method: "DELETE", headers: { "If-Match": `"${expected}"` } });
		if (res.status === 412) return { ok: false, version: (await res.json().catch(() => ({}))).version ?? null };
		if (!res.ok) await jsonOrThrow(res);
		return { ok: true };
	},
};
