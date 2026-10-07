import { test } from "node:test";
import assert from "node:assert/strict";

const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; };
globalThis.localStorage = store();
globalThis.sessionStorage = store();

const { googleAuthApi } = await import("../worker/googleauth.js");
const product = (await import("../worker/product.js")).default;
const G = await import("../src/google.js");
const { googleCalendar } = await import("../src/gcal.js");

const env = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "sec", GOOGLE_TOKEN_URL: "https://g/token", GOOGLE_REVOKE_URL: "https://g/revoke" };
const idToken = "x." + btoa(JSON.stringify({ email: "me@example.com" })).replace(/=+$/, "") + ".y";

function fakeGoogleToken() {
	const seen = [];
	const real = globalThis.fetch;
	globalThis.fetch = async (url, init = {}) => {
		const body = Object.fromEntries(new URLSearchParams(String(init.body)));
		seen.push({ url: String(url), body });
		const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
		if (String(url) === "https://g/revoke") return j({});
		if (body.grant_type === "authorization_code") return body.code === "good" ? j({ access_token: "a1", refresh_token: "r1", expires_in: 3600, scope: "s1 s2", id_token: idToken }) : j({ error: "invalid_grant" }, 400);
		if (body.grant_type === "refresh_token") return body.refresh_token === "r1" ? j({ access_token: "a2", expires_in: 3600 }) : j({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
		return j({}, 404);
	};
	return { seen, restore: () => (globalThis.fetch = real) };
}
const post = (path, body, e = env) => googleAuthApi(new Request("https://p" + path, { method: "POST", body: JSON.stringify(body) }), e, new URL("https://p" + path));

test("the token swap adds the secret, keeps nothing, and says when to reconnect", async () => {
	const g = fakeGoogleToken();
	try {
		const t = await post("/api/google/token", { code: "good", verifier: "v", redirectUri: "https://my.wr1t3r.app/" });
		assert.deepEqual(t, { access: "a1", refresh: "r1", expiresIn: 3600, scope: "s1 s2", email: "me@example.com" });
		assert.equal(g.seen[0].body.client_secret, "sec");
		assert.equal(g.seen[0].body.code_verifier, "v");
		assert.deepEqual(await post("/api/google/refresh", { refresh: "r1" }), { access: "a2", expiresIn: 3600, scope: "" });
		await assert.rejects(post("/api/google/refresh", { refresh: "old" }), (e) => e.status === 401 && e.extra.reconnect);
		await assert.rejects(post("/api/google/token", { code: "good" }), (e) => e.status === 400);
		await assert.rejects(post("/api/google/token", {}, {}), (e) => e.status === 404 && e.extra.setup);
		assert.deepEqual(await post("/api/google/revoke", { token: "r1" }), { revoked: true });
	} finally { g.restore(); }
});

test("the product Worker serves the page and only its own page's token calls", async () => {
	const g = fakeGoogleToken();
	try {
		const assets = { fetch: async () => new Response("page") };
		assert.equal(await (await product.fetch(new Request("https://my.wr1t3r.app/notes"), { ...env, ASSETS: assets })).text(), "page");
		const ok = await product.fetch(new Request("https://my.wr1t3r.app/api/google/refresh", { method: "POST", headers: { Origin: "https://my.wr1t3r.app" }, body: JSON.stringify({ refresh: "r1" }) }), { ...env, ASSETS: assets });
		assert.equal(ok.status, 200);
		const other = await product.fetch(new Request("https://my.wr1t3r.app/api/google/refresh", { method: "POST", headers: { Origin: "https://evil.example" }, body: "{}" }), { ...env, ASSETS: assets });
		assert.equal(other.status, 403);
		const gone = await product.fetch(new Request("https://my.wr1t3r.app/api/google/refresh", { method: "POST", body: JSON.stringify({ refresh: "old" }) }), { ...env, ASSETS: assets });
		assert.equal(gone.status, 401);
		assert.equal((await gone.json()).reconnect, true);
		assert.equal((await product.fetch(new Request("https://my.wr1t3r.app/api/nope", { method: "POST" }), { ...env, ASSETS: assets })).status, 404);
	} finally { g.restore(); }
});

test("the page: sign-in round trip, fresh tokens, and a sign-in that has ended", async () => {
	localStorage.clear(); sessionStorage.clear();
	let went = "";
	await G.beginGoogleSignIn({ clientId: "cid", scopes: G.CALENDAR_SCOPES, redirectUri: "https://my.wr1t3r.app/", go: (u) => (went = u) });
	const q = new URL(went).searchParams;
	assert.equal(q.get("access_type"), "offline");
	assert.equal(q.get("code_challenge_method"), "S256");
	assert.match(q.get("scope"), /calendar\.events/);
	const back = `https://my.wr1t3r.app/?state=${q.get("state")}&code=good`;
	assert.equal(G.isGoogleReturn(back), true);
	assert.equal(G.isGoogleReturn("https://my.wr1t3r.app/?state=dropbox&code=x"), false, "a Dropbox return isn't ours");

	// The page's fetch goes to our Worker for tokens and to Google for the rest.
	let now = 1e12, calls = [];
	const get = async (url, init = {}) => {
		calls.push({ url, auth: init.headers?.Authorization });
		const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
		if (url === "/api/google/token") return j({ access: "a1", refresh: "r1", expiresIn: 3600, scope: G.CALENDAR_SCOPES.join(" "), email: "me@example.com" });
		if (url === "/api/google/refresh") return JSON.parse(init.body).refresh === "r1" ? j({ access: "a2", expiresIn: 3600 }) : j({ error: "ended", reconnect: true }, 401);
		if (url.endsWith("/stale")) return init.headers.Authorization === "Bearer a1" ? j({}, 401) : j({ ok: 2 });
		return j({ ok: 1 });
	};
	await G.finishGoogleSignIn({ url: back, get, now: () => now });
	assert.equal(G.googleTokens().email, "me@example.com");
	assert.equal(G.googleHas(G.CALENDAR_SCOPES), true);
	const call = G.googleClient({ get, now: () => now });
	assert.deepEqual(await call("https://www.googleapis.com/x"), { ok: 1 });
	assert.equal(calls.at(-1).auth, "Bearer a1");
	assert.deepEqual(await call("https://www.googleapis.com/stale"), { ok: 2 }, "a 401 gets one retry with a new token");
	now += 2 * 3600e3;
	await call("https://www.googleapis.com/x");
	assert.equal(calls.at(-2).url, "/api/google/refresh", "expired: refreshed first");
	localStorage.setItem("wr1t3r-google", JSON.stringify({ ...G.googleTokens(), refresh: "dead", expires: 0 }));
	await assert.rejects(call("https://www.googleapis.com/x"), G.GoogleSignInEnded);
	assert.equal(G.googleTokens(), null, "forgotten here");
});

test("Google Calendar from the page uses the Worker's own event code", async () => {
	const seen = [];
	const call = async (url, init = {}) => {
		seen.push({ url, init });
		if (url.includes("/users/me/calendarList")) return { items: [{ id: "me@x", primary: true, selected: true, summary: "Me", accessRole: "owner" }] };
		if (url.includes("/events?")) return { items: [{ id: "e", summary: "Lunch", start: { dateTime: "2026-10-07T12:00:00Z" }, end: { dateTime: "2026-10-07T13:00:00Z" } }] };
		if (init.method === "POST") return { id: "new", ...JSON.parse(init.body) };
		return {};
	};
	const c = googleCalendar(call);
	const r = await c.events(new Date("2026-10-07T00:00:00Z"), new Date("2026-10-08T00:00:00Z"), null);
	assert.deepEqual(r.events.map((e) => e.title), ["Lunch"]);
	const added = await c.addEvent({ title: "Tea", start: "2026-10-07T15:00", end: "2026-10-07T16:00", timeZone: "UTC" });
	assert.equal(added.title, "Tea");
	assert.ok(seen.at(-1).url.endsWith("/calendars/primary/events"));
	const imp = await c.importEvents("", [{ uid: "u", title: "Class", allDay: true, start: "2026-10-09", end: "2026-10-09", recurrence: ["RRULE:FREQ=WEEKLY"] }]);
	assert.equal(imp.imported, 1);
	assert.equal(JSON.parse(seen.at(-1).init.body).iCalUID, "u");
	await c.deleteEvent("me@x", "e");
	assert.equal(seen.at(-1).init.method, "DELETE");
});
