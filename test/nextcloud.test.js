import { test } from "node:test";
import assert from "node:assert/strict";
import { nextcloudStorage, connectNextcloud, serverAddress, folderName, parseMultistatus, NextcloudError } from "../src/nextcloud.js";
import { AuthError } from "../src/api.js";
import { sync } from "../src/sync.js";
import { memoryLocal } from "./fakes.js";
import { fakeNextcloud } from "./fakenextcloud.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

function setup(opts = {}) {
	const nc = fakeNextcloud(opts);
	let clock = 0;
	const creds = { server: nc.base, user: nc.login, uid: nc.uid, password: nc.state.password, folder: opts.folder || "wr1t3r" };
	const s = nextcloudStorage({ creds: () => creds, get: nc.fetch, wait: async () => {}, now: () => clock });
	return { s, nc, creds, later: (ms) => (clock += ms) };
}

test("a note changed by another app in the same second as wr1t3r's save still syncs", async () => {
	const { s, nc } = setup({ frozen: true });
	const local = memoryLocal();
	await s.write("a.md", enc.encode("mine"), null);
	await sync({ local, api: s });
	const etagBefore = nc.state.nodes.get("wr1t3r/a.md").etag;
	nc.state.drop("wr1t3r/a.md", "theirs, same second");
	assert.equal(nc.state.nodes.get("wr1t3r/a.md").etag, etagBefore, "the ETag didn't move");
	assert.equal((await sync({ local, api: s })).downloaded, 1);
	assert.equal((await local.get("a.md")).text, "theirs, same second");
});

test("a file dropped in from Nextcloud's own apps syncs once and then settles", async () => {
	const { s, nc } = setup();
	await s.check();
	nc.state.drop("wr1t3r/Inbox/From phone.md", "hello");
	const local = memoryLocal();
	assert.equal((await sync({ local, api: s })).downloaded, 1);
	assert.equal((await local.get("Inbox/From phone.md")).text, "hello");
	assert.deepEqual(await sync({ local, api: s }), { downloaded: 0, uploaded: 0, deleted: 0, conflicts: [] });
});

test("an idle sync is one small request; a change or ten minutes lists again", async () => {
	const { s, nc, later } = setup();
	await s.write("a.md", enc.encode("A"), null);
	await s.list();
	nc.state.calls.length = 0;
	await s.list();
	await s.attachments();
	assert.deepEqual(nc.state.calls, ["PROPFIND /remote.php/dav/files/me/wr1t3r/ 0", "PROPFIND /remote.php/dav/files/me/wr1t3r/ 0"]);
	nc.state.drop("wr1t3r/deep/b.md", "B");
	assert.deepEqual((await s.list()).map((f) => f.path), ["a.md", "deep/b.md"]);
	nc.state.calls.length = 0;
	later(11 * 60000);
	await s.list();
	assert.equal(nc.state.calls.length, 2, "the folder check plus a full listing");
});

test("a server that refuses Depth: infinity is walked folder by folder, skipping hidden ones", async () => {
	const { s, nc } = setup({ infinity: false });
	await s.write("a.md", enc.encode("A"), null);
	await s.write("x/y/z.md", enc.encode("Z"), null);
	nc.state.drop("wr1t3r/.obsidian/workspace.md", "skip");
	assert.deepEqual((await s.list()).map((f) => f.path), ["a.md", "x/y/z.md"]);
	assert.ok(!nc.state.calls.some((c) => c.includes(".obsidian") && c.startsWith("PROPFIND")), "didn't open the hidden folder");
});

test("names with #, ?, % and accents survive the URL", async () => {
	const { s } = setup();
	for (const p of ["Issue #4.md", "What? 100%.md", "Café ☕/Notes & more.md"]) {
		const w = await s.write(p, enc.encode(p), null);
		assert.equal(w.ok, true, p);
		assert.equal(dec.decode((await s.read([p]))[0].bytes), p);
	}
	assert.deepEqual((await s.list()).map((f) => f.path), ["Café ☕/Notes & more.md", "Issue #4.md", "What? 100%.md"]);
});

test("writing into a folder that isn't there makes it first", async () => {
	const { s, nc } = setup({ folder: "Notes/wr1t3r" });
	assert.equal((await s.write("Projects/Novel/Ch 1.md", enc.encode("x"), null)).ok, true);
	assert.ok(nc.state.nodes.get("Notes/wr1t3r/Projects/Novel").folder);
	assert.equal(nc.state.calls.filter((c) => c.startsWith("MKCOL")).length, 4);
	assert.equal((await s.write("Projects/Novel/Ch 2.md", enc.encode("y"), null)).ok, true);
	assert.equal(nc.state.calls.filter((c) => c.startsWith("MKCOL")).length, 4, "no MKCOL when the folder exists");
});

test("check() makes the notebook folder on a fresh account", async () => {
	const { s, nc } = setup();
	await s.check();
	assert.ok(nc.state.nodes.get("wr1t3r").folder);
	assert.deepEqual(await s.list(), []);
});

test("a revoked app password is a sign-in error at once, with no retry", async () => {
	const { s, nc } = setup();
	nc.state.password = "revoked";
	nc.state.calls.length = 0;
	await assert.rejects(s.list(), AuthError);
	assert.equal(nc.state.calls.length, 1);
});

test("a busy server is retried", async () => {
	const nc = fakeNextcloud();
	let busy = 2;
	const creds = { server: nc.base, user: nc.login, uid: nc.uid, password: nc.state.password, folder: "wr1t3r" };
	const s = nextcloudStorage({ creds: () => creds, get: (u, i) => (busy-- > 0 ? new Response("", { status: 503 }) : nc.fetch(u, i)), wait: async () => {} });
	await s.check();
	assert.ok(busy < 0);
});

test("a delete goes away cleanly, and a stale one reports what's there", async () => {
	const { s } = setup();
	const v1 = (await s.write("a.md", enc.encode("1"), null)).version;
	const v2 = (await s.write("a.md", enc.encode("2"), v1)).version;
	assert.deepEqual(await s.remove("a.md", v1), { ok: false, version: v2 });
	assert.deepEqual(await s.remove("a.md", v2), { ok: true });
	assert.deepEqual(await s.write("a.md", enc.encode("3"), v2), { ok: false, version: null });
});

test("connecting finds the user ID behind an email sign-in and makes the folder", async () => {
	const nc = fakeNextcloud({ login: "me@example.com", uid: "me" });
	let saved = null;
	const c = await connectNextcloud({ server: "cloud.example.com/index.php/apps/files/", user: " me@example.com ", password: "app-pass", folder: "/Journal/", get: nc.fetch, pageProtocol: "https:", save: (x) => (saved = x) });
	assert.deepEqual(c, { server: "https://cloud.example.com", user: "me@example.com", uid: "me", password: "app-pass", folder: "Journal" });
	assert.deepEqual(saved, c);
	assert.ok(nc.state.nodes.get("Journal").folder);
});

test("connecting says which thing is wrong", async () => {
	const nc = fakeNextcloud();
	const go = (o) => connectNextcloud({ server: nc.base, user: nc.login, password: "app-pass", get: nc.fetch, pageProtocol: "https:", save() {}, ...o });
	const reason = (o) => go(o).then(() => "ok", (e) => (e instanceof NextcloudError ? e.reason : e));
	assert.equal(await reason({ password: "nope" }), "password");
	assert.equal(await reason({ server: "http://cloud.example.com" }), "insecure");
	assert.equal(await reason({ server: "https://elsewhere.example.com" }), "blocked");
	assert.equal(await reason({ server: "https://cloud.example.com/wrong" }), "address");
	assert.equal(await reason({ server: "" }), "address");
	assert.equal(await reason({ password: "" }), "password");
	assert.equal(await reason({ folder: "../up" }), "folder");
	assert.equal(await reason({}), "ok");
	assert.equal(await reason({ password: " app-pass\n" }), "ok", "spaces from copying are dropped");
});

test("server addresses are cleaned up", () => {
	assert.equal(serverAddress("cloud.example.com"), "https://cloud.example.com");
	assert.equal(serverAddress(" https://example.com/nextcloud/index.php/apps/files/?dir=/ "), "https://example.com/nextcloud");
	assert.equal(serverAddress("https://example.com/remote.php/dav/files/me/"), "https://example.com");
	assert.equal(serverAddress("http://192.168.1.5:8080/"), "http://192.168.1.5:8080");
	assert.equal(serverAddress("ftp://x"), "");
	assert.equal(serverAddress(""), "");
	assert.equal(folderName(""), "wr1t3r");
	assert.equal(folderName("\\Notes\\wr1t3r\\"), "Notes/wr1t3r");
});

test("multistatus from other WebDAV servers reads the same", () => {
	const xml = `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/a%20b.md</D:href><D:propstat><D:prop><D:getetag>W/"x1"</D:getetag><D:getcontentlength>3</D:getcontentlength><D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response><response xmlns="DAV:"><href>/dav/sub/</href><propstat><prop><getetag>"y"</getetag><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response></D:multistatus>`;
	assert.deepEqual(parseMultistatus(xml), [
		{ href: "/dav/a%20b.md", etag: "x1", size: 3, folder: false, sha1: "" },
		{ href: "/dav/sub/", etag: "y", size: 0, folder: true, sha1: "" },
	]);
});

test("checking whether the server allows the page sends no password", async () => {
	const { nextcloudAllowsPage, webAppPasswordLinks } = await import("../src/nextcloud.js");
	const seen = [];
	const allows = await nextcloudAllowsPage("cloud.example.com", async (url, init) => { seen.push([url, init.headers.Authorization]); return new Response(null, { status: 401 }); });
	assert.equal(allows, true, "a 401 it could read is a yes");
	assert.deepEqual(seen, [["https://cloud.example.com/remote.php/dav/", undefined]]);
	assert.equal(await nextcloudAllowsPage("cloud.example.com", async () => { throw new TypeError("Failed to fetch"); }), false);
	assert.equal(await nextcloudAllowsPage("", async () => new Response()), false);
	assert.deepEqual(webAppPasswordLinks("https://example.com/nextcloud/index.php/apps/files"), { install: "https://example.com/nextcloud/index.php/settings/apps/security/webapppassword", settings: "https://example.com/nextcloud/index.php/settings/admin/webapppassword" });
});
