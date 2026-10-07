// The page's own Google sign-in (the paid build: no Worker of ours holding
// a Google account). Google sends the person back here with a code; the
// product Worker swaps it for tokens with wr1t3r's client secret
// (worker/googleauth.js) and keeps nothing. The refresh token stays in this
// browser, like Dropbox's.
//
// Set the client ID at build time: VITE_GOOGLE_CLIENT_ID=... (public).
// The Google client's redirect URI must be this page's address (https://host/).

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKENS = "wr1t3r-google";
const PENDING = "wr1t3r-google-pending";

export const CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"];

export const googleClientId = () => {
	try { return import.meta.env?.VITE_GOOGLE_CLIENT_ID || ""; } catch { return ""; }
};

const readJson = (store, key) => {
	try { return JSON.parse(store.getItem(key) || "null"); } catch { return null; }
};
const writeJson = (store, key, v) => {
	try { v == null ? store.removeItem(key) : store.setItem(key, JSON.stringify(v)); } catch {}
};
const local = () => globalThis.localStorage;
const session = () => globalThis.sessionStorage;

export const googleTokens = () => readJson(local(), TOKENS);
export const googleSignedIn = () => !!googleTokens()?.refresh;
export const googleHas = (scopes) => { const have = new Set((googleTokens()?.scope || "").split(" ")); return scopes.every((s) => have.has(s)); };

export class GoogleSignInEnded extends Error {}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function post(path, body, get) {
	const res = await get(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		if (data.reconnect) throw new GoogleSignInEnded(data.error || "Google sign-in has ended");
		throw new Error(data.error || `Google sign-in failed (${res.status})`);
	}
	return data;
}

// Sends the browser to Google. It comes back to redirectUri with
// ?code=...&state=..., which finishGoogleSignIn turns into tokens. Scopes
// already granted are kept (include_granted_scopes).
export async function beginGoogleSignIn({ clientId = googleClientId(), scopes, redirectUri, go = (u) => location.assign(u) }) {
	const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
	const state = "g" + b64url(crypto.getRandomValues(new Uint8Array(16)));
	const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
	writeJson(session(), PENDING, { verifier, state, redirectUri });
	const q = new URLSearchParams({
		client_id: clientId,
		response_type: "code",
		redirect_uri: redirectUri,
		scope: ["openid", "email", ...scopes].join(" "),
		access_type: "offline",
		prompt: "consent", // so Google sends a refresh token every time
		include_granted_scopes: "true",
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
	});
	go(AUTHORIZE + "?" + q);
}

// True when the page's address is Google sending someone back.
export function isGoogleReturn(url) {
	const q = new URL(url).searchParams;
	const pending = readJson(session(), PENDING);
	return (q.has("code") || q.has("error")) && !!pending && q.get("state") === pending.state;
}

export async function finishGoogleSignIn({ url, get = (...a) => fetch(...a), now = Date.now }) {
	const q = new URL(url).searchParams;
	const pending = readJson(session(), PENDING);
	writeJson(session(), PENDING, null);
	if (!pending || q.get("state") !== pending.state) throw new Error("That sign-in didn't come from this page. Try again.");
	if (q.get("error")) throw new Error(q.get("error") === "access_denied" ? "Google sign-in was cancelled." : q.get("error"));
	const d = await post("/api/google/token", { code: q.get("code"), verifier: pending.verifier, redirectUri: pending.redirectUri }, get);
	const old = googleTokens();
	const t = { access: d.access, refresh: d.refresh || old?.refresh || "", expires: now() + d.expiresIn * 1000, scope: d.scope, email: d.email || old?.email || "" };
	writeJson(local(), TOKENS, t);
	return t;
}

// Forgets the tokens here, and asks Google to end the sign-in.
export async function forgetGoogle({ get = (...a) => fetch(...a) } = {}) {
	const t = googleTokens();
	writeJson(local(), TOKENS, null);
	if (t?.refresh) await post("/api/google/revoke", { token: t.refresh }, get).catch(() => {});
}

// A function that calls a Google API with a fresh token:
// call(url, init) -> parsed JSON, throwing Error (or GoogleSignInEnded).
export function googleClient({ get = (...a) => fetch(...a), now = Date.now } = {}) {
	async function access(force = false) {
		const t = googleTokens();
		if (!t?.refresh) throw new GoogleSignInEnded("Not connected to Google");
		if (!force && t.access && t.expires - 60000 > now()) return t.access;
		try {
			const d = await post("/api/google/refresh", { refresh: t.refresh }, get);
			writeJson(local(), TOKENS, { ...t, access: d.access, expires: now() + d.expiresIn * 1000, scope: d.scope || t.scope });
			return d.access;
		} catch (e) {
			if (e instanceof GoogleSignInEnded) writeJson(local(), TOKENS, null);
			throw e;
		}
	}
	return async function call(url, init = {}) {
		for (let tries = 0; ; tries++) {
			const res = await get(url, { ...init, headers: { Authorization: `Bearer ${await access(tries > 0)}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
			if (res.status === 401 && tries === 0) continue;
			const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.error?.message || `Google said ${res.status}`);
			return data;
		}
	};
}
