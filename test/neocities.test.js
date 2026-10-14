import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha1, neocitiesUrl, neocitiesSite, publishToNeocities } from "../src/neocitiespublish.js";
import { neocitiesApi } from "../worker/neocities.js";
import product from "../worker/product.js";

const hex = (buf) => createHash("sha1").update(buf).digest("hex");

// Just enough of Neocities' API: one site, files as path -> bytes. A free
// site turns away a whole upload with an .mp3 in it.
function fakeNeocities({ key = "k", sitename = "you", domain = null } = {}) {
	const files = new Map([["index.html", Buffer.from("<p>Neocities' own</p>")], ["mine.html", Buffer.from("theirs")]]);
	const calls = [];
	const answer = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
	async function fetch(url, init = {}) {
		const req = new Request(url, { ...init, duplex: "half" });
		const name = new URL(req.url).pathname.replace("/api/", "");
		calls.push(`${req.method} ${name}`);
		if (req.headers.get("Authorization") !== `Bearer ${key}`) return answer({ result: "error", error_type: "invalid_auth", message: "invalid credentials" }, 403);
		if (name === "info") return answer({ result: "success", info: { sitename, domain } });
		if (name === "list") return answer({ result: "success", files: [{ path: "pics", is_directory: true }, ...[...files].map(([path, b]) => ({ path, is_directory: false, size: b.length, sha1_hash: hex(b) }))] });
		const form = await req.formData();
		if (name === "upload") {
			const got = [...form.entries()];
			const bad = got.find(([path]) => path.endsWith(".mp3"));
			if (bad) return answer({ result: "error", error_type: "invalid_file_type", message: `${bad[0]} is not a valid file type (or contains not allowed content) for this site, files have not been uploaded` }, 400);
			for (const [path, blob] of got) files.set(path, Buffer.from(await blob.arrayBuffer()));
			return answer({ result: "success", message: "your file(s) have been successfully uploaded" });
		}
		if (name === "delete") {
			for (const path of form.getAll("filenames[]")) {
				if (path === "index.html") return answer({ result: "error", error_type: "cannot_delete_index", message: "you cannot delete your index.html file, files have not been deleted" }, 400);
				files.delete(path);
			}
			return answer({ result: "success", message: "file(s) have been deleted" });
		}
		return answer({ result: "error", message: "not found" }, 404);
	}
	return { files, calls, fetch };
}

// The page's calls, through the Worker's pass-through, to the fake.
const through = (neo) => async (path, init = {}) => {
	const req = new Request("https://my.wr1t3r.app" + path, { ...init, duplex: "half" });
	return (await neocitiesApi(req, {}, new URL(req.url), neo.fetch)) || new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } });
};

const site = (extra = {}) => new Map([["index.html", "<h1>Hi</h1>"], ["style.css", "body{}"], ["pics/a.png", { attachment: "a.png" }], ...Object.entries(extra)]);
const read = async () => new Blob([new Uint8Array([1, 2, 3])]);

test("SHA-1s match Neocities' list", async () => {
	assert.equal(await sha1("hello\n"), hex(Buffer.from("hello\n")));
	assert.equal(await sha1(new Uint8Array([1, 2, 3])), hex(Buffer.from([1, 2, 3])));
});

test("the site's address: its own domain, else its neocities.org one", () => {
	assert.equal(neocitiesUrl({ sitename: "you" }), "https://you.neocities.org/");
	assert.equal(neocitiesUrl({ sitename: "you", domain: "you.example" }), "https://you.example/");
	assert.equal(neocitiesUrl({ sitename: "you", domain: "https://you.example/" }), "https://you.example/");
});

test("publishes the site, then sends only what changed and takes down what was unpublished", async () => {
	const neo = fakeNeocities();
	const call = through(neo);
	const r = await publishToNeocities({ key: "k", call, files: site({ "old.html": "x" }), read });
	assert.equal(r.url, "https://you.neocities.org/");
	assert.equal(r.changed, 4);
	assert.deepEqual(r.failed, []);
	assert.equal(neo.files.get("index.html").toString(), "<h1>Hi</h1>");
	assert.deepEqual([...neo.files.get("pics/a.png")], [1, 2, 3]);
	assert.equal(neo.calls.filter((c) => c === "POST upload").length, 1, "one batch");

	neo.calls.length = 0;
	const again = await publishToNeocities({ key: "k", call, files: site(), read, last: r.paths });
	assert.equal(again.changed, 0);
	assert.equal(again.deleted, 1);
	assert.ok(!neo.files.has("old.html"), "an unpublished page comes down");
	assert.ok(neo.files.has("mine.html"), "files wr1t3r didn't put there stay");
	assert.ok(!neo.calls.includes("POST upload"));
});

test("never asks to delete index.html", async () => {
	const neo = fakeNeocities();
	const r = await publishToNeocities({ key: "k", call: through(neo), files: new Map([["about.html", "a"]]), read, last: ["index.html", "gone.html"] });
	assert.equal(r.deleted, 0);
	assert.ok(neo.files.has("index.html"));
});

test("a file a free site won't take is reported, and the rest still goes up", async () => {
	const neo = fakeNeocities();
	const r = await publishToNeocities({ key: "k", call: through(neo), files: site({ "media/song.mp3": "id3" }), read });
	assert.equal(r.failed.length, 1);
	assert.equal(r.failed[0].path, "media/song.mp3");
	assert.match(r.failed[0].message, /not a valid file type/);
	assert.equal(r.changed, 3);
	assert.ok(neo.files.has("style.css"));
	assert.ok(!r.paths.includes("media/song.mp3"));
});

test("big sites go up in batches", async () => {
	const neo = fakeNeocities();
	const many = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`p/${i}.html`, String(i)]));
	const r = await publishToNeocities({ key: "k", call: through(neo), files: site(many), read });
	assert.equal(r.changed, 48);
	assert.equal(neo.calls.filter((c) => c === "POST upload").length, 3);
});

test("a wrong key or a copy with no Worker says so plainly", async () => {
	const neo = fakeNeocities();
	await assert.rejects(neocitiesSite({ key: "nope", call: through(neo) }), /didn't accept the API key/);
	await assert.rejects(publishToNeocities({ key: "nope", call: through(neo), files: site(), read }), /didn't accept the API key/);
	await assert.rejects(neocitiesSite({ key: "", call: through(neo) }), /Paste your Neocities API key/);
	const pages = async () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } });
	await assert.rejects(neocitiesSite({ key: "k", call: pages }), /can't send to Neocities/);
	assert.deepEqual(await neocitiesSite({ key: "k", call: through(fakeNeocities({ domain: "you.example" })) }), { sitename: "you", domain: "you.example", url: "https://you.example/" });
});

test("the Worker passes on only Neocities' four calls, with the key", async () => {
	const neo = fakeNeocities();
	const ask = (path, init = {}) => {
		const req = new Request("https://my.wr1t3r.app" + path, init);
		return neocitiesApi(req, {}, new URL(req.url), neo.fetch);
	};
	assert.equal(await ask("/api/feed"), null);
	await assert.rejects(ask("/api/neocities/rename", { method: "POST", headers: { "X-Neocities-Key": "k" } }), /Not found/);
	await assert.rejects(ask("/api/neocities/upload", { headers: { "X-Neocities-Key": "k" } }), /POST only/);
	await assert.rejects(ask("/api/neocities/list"), /No Neocities API key/);
	const res = await ask("/api/neocities/info", { headers: { "X-Neocities-Key": "k" } });
	assert.equal(res.headers.get("Cache-Control"), "no-store");
	assert.equal((await res.json()).info.sitename, "you");
});

test("the product Worker turns away other sites' pages", async () => {
	const env = { ASSETS: { fetch: () => new Response("") } };
	const res = await product.fetch(new Request("https://my.wr1t3r.app/api/neocities/info", { headers: { "X-Neocities-Key": "k", Origin: "https://evil.example" } }), env);
	assert.equal(res.status, 403);
	const bare = await product.fetch(new Request("https://my.wr1t3r.app/api/neocities/info", { headers: { "X-Neocities-Key": "k" } }), env);
	assert.equal(bare.status, 403, "no Origin and no Sec-Fetch-Site");
});
