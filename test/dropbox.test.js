import { test } from "node:test";
import assert from "node:assert/strict";
import { dropboxStorage, headerJson, beginDropboxSignIn, finishDropboxSignIn, isDropboxReturn, dropboxTokens, dropboxSignedIn } from "../src/dropbox.js";
import { AuthError } from "../src/api.js";
import { fakeDropbox } from "./fakedropbox.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

function memStore() {
	const m = new Map();
	return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function setup(opts) {
	const dbx = fakeDropbox(opts);
	let t = { access: dbx.state.access, refresh: dbx.state.refresh, expires: Date.now() + 3600e3 };
	const s = dropboxStorage({ appKey: "k", get: dbx.fetch, tokens: { load: () => t, save: (x) => { t = x; } }, wait: async () => {} });
	return { s, dbx, tokens: () => t, setTokens: (x) => { t = x; } };
}

test("a long listing is read page by page", async () => {
	const { s, dbx } = setup({ pageSize: 2 });
	for (const p of ["a.md", "b.md", "c.md", "d/e.md", "img/p.png"]) await s.write(p.endsWith(".png") ? "x.md" : p, enc.encode(p), null).catch(() => {});
	await s.uploadAttachment("img/p.png", new Blob([new Uint8Array([1])]));
	assert.deepEqual((await s.list()).map((f) => f.path), ["a.md", "b.md", "c.md", "d/e.md", "x.md"]);
	assert.ok(dbx.state.calls.filter((c) => c === "/2/files/list_folder/continue").length >= 2);
	assert.deepEqual((await s.attachments()).map((f) => f.path), ["img/p.png"]);
});

test("an ended access token is renewed once and the call goes through", async () => {
	const { s, dbx, tokens } = setup();
	await s.write("a.md", enc.encode("A"), null);
	dbx.state.expire();
	assert.equal(dec.decode((await s.read(["a.md"]))[0].bytes), "A");
	assert.equal(tokens().access, dbx.state.access);
});

test("an expired token by the clock is renewed before the call", async () => {
	const { s, dbx, setTokens } = setup();
	dbx.state.expire();
	setTokens({ access: "old", refresh: dbx.state.refresh, expires: 0 });
	await s.check();
	assert.deepEqual(dbx.state.calls, ["/oauth2/token", "/2/users/get_current_account"], "renewed first, no wasted call");
});

test("a revoked refresh token is a sign-in error", async () => {
	const { s, dbx, setTokens } = setup();
	setTokens({ access: "x", refresh: "revoked", expires: 0 });
	await assert.rejects(s.check(), AuthError);
	setTokens(null);
	await assert.rejects(s.check(), AuthError);
	assert.ok(dbx);
});

test("names outside ASCII survive the header", async () => {
	assert.equal(headerJson({ path: "/Café ☕.md" }), '{"path":"/Caf\\u00e9 \\u2615.md"}');
	const { s } = setup();
	const w = await s.write("Café ☕.md", enc.encode("x"), null);
	assert.equal(w.ok, true);
	assert.equal((await s.list())[0].path, "Café ☕.md");
	assert.equal(dec.decode((await s.read(["Café ☕.md"]))[0].bytes), "x");
});

test("a note deleted elsewhere: writing against it fails with no version", async () => {
	const { s } = setup();
	const v = (await s.write("a.md", enc.encode("A"), null)).version;
	await s.remove("a.md", v);
	assert.deepEqual(await s.write("a.md", enc.encode("B"), v), { ok: false, version: null });
});

test("busy Dropbox is retried", async () => {
	const { s, dbx } = setup();
	let busy = 2;
	const inner = dbx.fetch;
	const s2 = dropboxStorage({ appKey: "k", get: (u, i) => (busy-- > 0 ? new Response("", { status: 429, headers: { "Retry-After": "1" } }) : inner(u, i)), tokens: { load: () => ({ access: dbx.state.access, refresh: "r1", expires: Date.now() + 3600e3 }), save() {} }, wait: async () => {} });
	await s2.check();
	assert.ok(s);
});

test("sign-in: PKCE out to Dropbox and the code back for tokens", async () => {
	globalThis.sessionStorage = memStore();
	globalThis.localStorage = memStore();
	try {
		let went = "";
		await beginDropboxSignIn({ appKey: "k", redirectUri: "https://w/", go: (u) => { went = u; } });
		const q = new URL(went).searchParams;
		assert.equal(new URL(went).origin + new URL(went).pathname, "https://www.dropbox.com/oauth2/authorize");
		assert.equal(q.get("code_challenge_method"), "S256");
		assert.equal(q.get("token_access_type"), "offline");
		assert.equal(q.get("redirect_uri"), "https://w/");
		assert.ok(isDropboxReturn(`https://w/?code=good&state=${q.get("state")}`));
		assert.ok(!isDropboxReturn("https://w/?code=good"));

		const dbx = fakeDropbox();
		await finishDropboxSignIn({ appKey: "k", url: `https://w/?code=good&state=${q.get("state")}`, get: dbx.fetch });
		assert.equal(dropboxTokens().refresh, "r1");
		assert.ok(dropboxSignedIn());
		await assert.rejects(finishDropboxSignIn({ appKey: "k", url: `https://w/?code=good&state=${q.get("state")}`, get: dbx.fetch }), /didn't come from this page/);

		await beginDropboxSignIn({ appKey: "k", redirectUri: "https://w/", go: (u) => { went = u; } });
		await assert.rejects(finishDropboxSignIn({ appKey: "k", url: "https://w/?code=good&state=forged", get: dbx.fetch }), /didn't come from this page/);
	} finally {
		delete globalThis.sessionStorage;
		delete globalThis.localStorage;
	}
});
