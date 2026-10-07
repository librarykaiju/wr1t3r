// Google sign-in for the page's own Google client (src/google.js). Google
// won't hand a page a lasting sign-in without the app's client secret, so
// this swaps codes and refresh tokens for access tokens with the secret
// added. It keeps nothing: the person's refresh token lives in their browser,
// and notes never come through here.
//
//   POST /api/google/token    {code, verifier, redirectUri}
//                             -> {access, refresh, expiresIn, scope, email}
//   POST /api/google/refresh  {refresh} -> {access, expiresIn, scope}
//   POST /api/google/revoke   {token} -> {revoked: true}
//
// Settings: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (secrets). GOOGLE_TOKEN_URL
// and GOOGLE_REVOKE_URL are only for testing.

import { HttpError } from "./util.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

const str = (v, max = 4096) => typeof v === "string" && v.length > 0 && v.length <= max;

// The email in an id_token's payload (no need to check its signature: it
// came straight from Google, and it's only shown as a label).
function emailOf(idToken) {
	try {
		const part = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
		return JSON.parse(atob(part + "===".slice((part.length + 3) % 4))).email || "";
	} catch { return ""; }
}

async function token(env, params) {
	const res = await fetch(env.GOOGLE_TOKEN_URL || TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || !data.access_token) {
		// invalid_grant: revoked, expired, or (for a Google app still in
		// Testing) more than 7 days old. The page asks to connect again.
		throw new HttpError(data.error === "invalid_grant" ? 401 : 502, data.error_description || `Google sign-in failed (${data.error || res.status})`, { reconnect: data.error === "invalid_grant" });
	}
	return data;
}

export async function googleAuthApi(request, env, url) {
	if (!url.pathname.startsWith("/api/google/")) return null;
	if (request.method !== "POST") throw new HttpError(405, "POST only");
	if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new HttpError(404, "Google isn't set up here", { setup: true });
	const body = await request.json().catch(() => ({}));
	if (url.pathname === "/api/google/token") {
		if (!str(body.code) || !str(body.verifier, 200) || !str(body.redirectUri, 500)) throw new HttpError(400, "code, verifier and redirectUri");
		const d = await token(env, { grant_type: "authorization_code", code: body.code, code_verifier: body.verifier, redirect_uri: body.redirectUri });
		return { access: d.access_token, refresh: d.refresh_token || "", expiresIn: d.expires_in || 3600, scope: d.scope || "", email: d.id_token ? emailOf(d.id_token) : "" };
	}
	if (url.pathname === "/api/google/refresh") {
		if (!str(body.refresh)) throw new HttpError(400, "refresh");
		const d = await token(env, { grant_type: "refresh_token", refresh_token: body.refresh });
		return { access: d.access_token, expiresIn: d.expires_in || 3600, scope: d.scope || "" };
	}
	if (url.pathname === "/api/google/revoke") {
		if (!str(body.token)) throw new HttpError(400, "token");
		await fetch(env.GOOGLE_REVOKE_URL || REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: body.token }) }).catch(() => {});
		return { revoked: true };
	}
	return null;
}
