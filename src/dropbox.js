// Dropbox as the place notes live: one of the storage kinds in src/storage.js.
//
// The page talks to Dropbox itself, so no server is involved. Sign-in is
// OAuth with PKCE, which needs only the app key (public, no secret), and asks
// for an App Folder: the notebook is /Apps/<app name>/ in the person's
// Dropbox and wr1t3r can't see anything else there.
//
// A Dropbox "rev" is the version. Writes send the rev they expect
// (WriteMode update, strict_conflict) so a newer copy is never overwritten;
// creates use add, which fails if the name is taken.
//
// Set the app key at build time: VITE_DROPBOX_APP_KEY=... npm run build.
// The app's redirect URI must be this page's address (https://host/).

import { isNotePath, isAttachmentPath, attachmentType } from "./paths.js";
import { AuthError } from "./api.js";

const API = "https://api.dropboxapi.com";
const CONTENT = "https://content.dropboxapi.com";
const AUTHORIZE = "https://www.dropbox.com/oauth2/authorize";
const TOKENS = "wr1t3r-dropbox";
const PENDING = "wr1t3r-dropbox-pending";
const PARALLEL = 6;

export const dropboxAppKey = () => {
	try { return import.meta.env?.VITE_DROPBOX_APP_KEY || ""; } catch { return ""; }
};

const readJson = (store, key) => {
	try { return JSON.parse(store.getItem(key) || "null"); } catch { return null; }
};
const writeJson = (store, key, v) => {
	try { v == null ? store.removeItem(key) : store.setItem(key, JSON.stringify(v)); } catch {}
};
const local = () => globalThis.localStorage;
const session = () => globalThis.sessionStorage;

export const dropboxTokens = () => readJson(local(), TOKENS);
export const dropboxSignedIn = () => !!dropboxTokens()?.refresh;
export const forgetDropbox = () => writeJson(local(), TOKENS, null);

// Dropbox-API-Arg is a header, so anything outside ASCII goes as \uXXXX.
export const headerJson = (v) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Sends the browser to Dropbox to sign in. It comes back to redirectUri with
// ?code=...&state=..., which finishDropboxSignIn turns into tokens.
export async function beginDropboxSignIn({ appKey = dropboxAppKey(), redirectUri, go = (u) => location.assign(u) } = {}) {
	const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
	const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
	const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
	writeJson(session(), PENDING, { verifier, state, redirectUri });
	const q = new URLSearchParams({
		client_id: appKey,
		response_type: "code",
		code_challenge: challenge,
		code_challenge_method: "S256",
		redirect_uri: redirectUri,
		token_access_type: "offline",
		state,
	});
	go(AUTHORIZE + "?" + q);
}

// True when the page's address is Dropbox sending someone back from sign-in.
export function isDropboxReturn(url) {
	const q = new URL(url).searchParams;
	return (q.has("code") || q.has("error")) && q.has("state") && !!readJson(session(), PENDING);
}

// Trades the code in url for tokens and keeps them on this device.
export async function finishDropboxSignIn({ appKey = dropboxAppKey(), url, get = (...a) => fetch(...a), now = Date.now } = {}) {
	const q = new URL(url).searchParams;
	const pending = readJson(session(), PENDING);
	writeJson(session(), PENDING, null);
	if (!pending || q.get("state") !== pending.state) throw new Error("That sign-in didn't come from this page. Try again.");
	if (q.get("error")) throw new Error(q.get("error_description") || "Dropbox sign-in was cancelled.");
	const res = await get(API + "/oauth2/token", {
		method: "POST",
		body: new URLSearchParams({ grant_type: "authorization_code", code: q.get("code"), code_verifier: pending.verifier, client_id: appKey, redirect_uri: pending.redirectUri }),
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.access_token) throw new Error(body.error_description || "Dropbox didn't accept the sign-in.");
	const t = { access: body.access_token, refresh: body.refresh_token, expires: now() + (body.expires_in || 14400) * 1000 };
	writeJson(local(), TOKENS, t);
	return t;
}

// Runs fn over items, a few at a time, keeping order.
async function pool(items, fn) {
	const out = new Array(items.length);
	let i = 0;
	const next = async () => {
		while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
	};
	await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, next));
	return out;
}

const tagOf = (body) => body?.error_summary || "";

// The storage. get, tokens and now are swappable for tests.
export function dropboxStorage({ appKey = dropboxAppKey(), get = (...a) => fetch(...a), tokens, now = Date.now, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
	const load = tokens?.load || dropboxTokens;
	const save = tokens?.save || ((t) => writeJson(local(), TOKENS, t));

	async function refresh() {
		const t = load();
		if (!t?.refresh) throw new AuthError("Not signed in to Dropbox");
		const res = await get(API + "/oauth2/token", {
			method: "POST",
			body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: appKey }),
		});
		const body = await res.json().catch(() => ({}));
		if (res.status === 400 || res.status === 401) throw new AuthError("Dropbox sign-in has ended");
		if (!res.ok) throw new Error(body.error_description || `Dropbox HTTP ${res.status}`);
		const next = { ...t, access: body.access_token, expires: now() + (body.expires_in || 14400) * 1000 };
		save(next);
		return next.access;
	}

	async function access() {
		const t = load();
		if (!t?.refresh) throw new AuthError("Not signed in to Dropbox");
		return t.access && t.expires - 60000 > now() ? t.access : refresh();
	}

	// One call, with a fresh token after a 401 and a short wait after 429/503.
	// Returns the Response; a 409 (Dropbox's "that path...") is left to the caller.
	async function call(url, init = {}) {
		let fresh = false;
		for (let tries = 0; ; tries++) {
			const tok = fresh ? await refresh() : await access();
			const res = await get(url, { ...init, headers: { ...init.headers, Authorization: "Bearer " + tok } });
			if (res.status === 401) {
				if (fresh) throw new AuthError("Dropbox sign-in has ended");
				fresh = true;
				continue;
			}
			fresh = false;
			if ((res.status === 429 || res.status === 503) && tries < 3) {
				await wait(Math.min(10, Number(res.headers.get("Retry-After")) || 2 ** tries) * 1000);
				continue;
			}
			if (res.ok || res.status === 409) return res;
			const text = await res.text().catch(() => "");
			throw Object.assign(new Error(`Dropbox: ${text.slice(0, 200) || "HTTP " + res.status}`), { status: res.status });
		}
	}

	const rpc = async (route, arg) => {
		const res = await call(API + "/2/" + route, arg === undefined ? { method: "POST" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(arg) });
		const body = await res.json().catch(() => ({}));
		return { ok: res.ok, body };
	};

	const dbx = (path) => "/" + path;
	const fromDbx = (p) => p.replace(/^\//, "");

	async function metadata(path) {
		const r = await rpc("files/get_metadata", { path: dbx(path) });
		if (r.ok) return r.body[".tag"] === "file" ? r.body : null;
		if (tagOf(r.body).startsWith("path/not_found")) return null;
		throw new Error("Dropbox: " + tagOf(r.body));
	}

	// Every file in the App Folder, by path.
	async function everything() {
		const files = [];
		let r = await rpc("files/list_folder", { path: "", recursive: true, include_deleted: false, limit: 2000 });
		for (;;) {
			if (!r.ok) {
				// A brand-new App Folder may not exist until the first write.
				if (tagOf(r.body).startsWith("path/not_found")) return [];
				throw new Error("Dropbox: " + tagOf(r.body));
			}
			for (const e of r.body.entries) {
				if (e[".tag"] === "file") files.push({ path: fromDbx(e.path_display), version: e.rev, size: e.size });
			}
			if (!r.body.has_more) break;
			r = await rpc("files/list_folder/continue", { cursor: r.body.cursor });
		}
		return files.sort((a, b) => (a.path < b.path ? -1 : 1));
	}

	async function download(path) {
		const res = await call(CONTENT + "/2/files/download", { method: "POST", headers: { "Dropbox-API-Arg": headerJson({ path: dbx(path) }) } });
		if (res.status === 409) {
			const body = await res.json().catch(() => ({}));
			if (tagOf(body).startsWith("path/not_found")) return null;
			throw new Error("Dropbox: " + tagOf(body));
		}
		const meta = JSON.parse(res.headers.get("Dropbox-API-Result") || "{}");
		return { version: meta.rev, bytes: new Uint8Array(await res.arrayBuffer()) };
	}

	// {ok: true, meta} or {ok: false} when mode says the file is in the way.
	async function upload(path, body, mode) {
		const arg = { path: dbx(path), mode, autorename: false, mute: true, strict_conflict: true };
		const res = await call(CONTENT + "/2/files/upload", {
			method: "POST",
			headers: { "Content-Type": "application/octet-stream", "Dropbox-API-Arg": headerJson(arg) },
			body,
		});
		const out = await res.json().catch(() => ({}));
		if (res.ok) return { ok: true, meta: out };
		if (/^path\/conflict/.test(tagOf(out))) return { ok: false };
		throw new Error("Dropbox: " + tagOf(out));
	}

	return {
		async check() {
			const r = await rpc("users/get_current_account");
			if (!r.ok) throw new Error("Dropbox: " + tagOf(r.body));
		},
		async list() {
			return (await everything()).filter((f) => isNotePath(f.path));
		},
		async attachments() {
			return (await everything()).filter((f) => isAttachmentPath(f.path));
		},
		async read(paths) {
			return pool(paths, async (path) => {
				const f = isNotePath(path) && (await download(path));
				return f ? { path, version: f.version, bytes: f.bytes } : { path, missing: true };
			});
		},
		async write(path, bytes, expected) {
			if (!isNotePath(path)) throw new Error("Not a note path: " + path);
			const r = await upload(path, bytes, expected ? { ".tag": "update", update: expected } : { ".tag": "add" });
			if (r.ok) return { ok: true, version: r.meta.rev };
			return { ok: false, version: (await metadata(path))?.rev ?? null };
		},
		async remove(path, expected) {
			const r = await rpc("files/delete_v2", { path: dbx(path), parent_rev: expected });
			if (r.ok) return { ok: true };
			// Not there, or not the rev we expected: which, depends on what's there now.
			const cur = await metadata(path);
			if (!cur) return { ok: true };
			if (cur.rev === expected) throw new Error("Dropbox: " + tagOf(r.body));
			return { ok: false, version: cur.rev };
		},
		async attachment(path) {
			const f = isAttachmentPath(path) && (await download(path));
			if (!f) throw new Error("No such attachment");
			return new Blob([f.bytes], { type: attachmentType(path) });
		},
		async uploadAttachment(path, blob) {
			if (!isAttachmentPath(path)) throw new Error("Not an attachment path: " + path);
			const r = await upload(path, blob, { ".tag": "add" });
			if (!r.ok) return false;
			return { path, version: r.meta.rev, size: r.meta.size };
		},
	};
}
