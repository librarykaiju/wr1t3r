import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";

// Node's WebCrypto lacks Workers' timingSafeEqual extension.
crypto.subtle.timingSafeEqual ??= (a, b) => Buffer.from(a).equals(Buffer.from(b));

// Just enough of an R2 bucket for the Worker.
function fakeBucket(files) {
	const m = new Map(Object.entries(files).map(([k, v]) => [k, { body: new TextEncoder().encode(v), etag: "e-" + k }]));
	const obj = (key) => ({ key, etag: m.get(key).etag, size: m.get(key).body.length, arrayBuffer: async () => m.get(key).body });
	return {
		map: m,
		async list() { return { objects: [...m.keys()].map(obj), truncated: false }; },
		async get(k) { return m.has(k) ? obj(k) : null; },
		async head(k) { return m.has(k) ? obj(k) : null; },
		async put(k, body) { m.set(k, { body, etag: "e2-" + k }); return obj(k); },
		async delete(k) { m.delete(k); },
	};
}

const call = (env, path, init = {}) =>
	worker.fetch(new Request("https://w" + path, { ...init, headers: { Authorization: "Bearer t", ...init.headers } }), env);

const env = () => ({
	WR1T3R_TOKEN: "t",
	EXCLUDE: "_includes/, content/404.md",
	VAULT: fakeBucket({ "content/a.md": "A", "content/404.md": "404", "content/404.md.bak/x.md": "Y", "_includes/snippets/marquee.md": "M", "_Includes/x.md": "X", "content/img/p.png": "PNG", "_includes/i.png": "I", ".obsidian/icon.png": "O", "content/x.exe": "E" }),
});

test("excluded folders and files are left out of the list, whatever their case", async () => {
	const r = await call(env(), "/api/files");
	assert.deepEqual((await r.json()).files.map((f) => f.path), ["content/404.md.bak/x.md", "content/a.md"], "a file entry hides only that file");
});

test("excluded folders can't be read, written or deleted", async () => {
	const e = env();
	const read = await call(e, "/api/files/read", { method: "POST", body: JSON.stringify({ paths: ["_includes/snippets/marquee.md"] }) });
	assert.equal(read.status, 400);
	const put = await call(e, "/api/file?path=" + encodeURIComponent("_includes/snippets/marquee.md"), {
		method: "PUT", headers: { "If-Match": '"e-_includes/snippets/marquee.md"' }, body: "hacked",
	});
	assert.equal(put.status, 400);
	const create = await call(e, "/api/file?path=" + encodeURIComponent("_INCLUDES/new.md"), { method: "PUT", headers: { "If-None-Match": "*" }, body: "x" });
	assert.equal(create.status, 400);
	const del = await call(e, "/api/file?path=" + encodeURIComponent("_includes/snippets/marquee.md"), {
		method: "DELETE", headers: { "If-Match": '"e-_includes/snippets/marquee.md"' },
	});
	assert.equal(del.status, 400);
	assert.equal(new TextDecoder().decode(e.VAULT.map.get("_includes/snippets/marquee.md").body), "M");
});

test("other notes still work, and the token is required", async () => {
	const e = env();
	assert.equal((await call(e, "/api/files", { headers: { Authorization: "Bearer nope" } })).status, 401);
	const put = await call(e, "/api/file?path=content%2Fa.md", { method: "PUT", headers: { "If-Match": '"e-content/a.md"' }, body: "A2" });
	assert.equal(put.status, 200);
});

test("the clipper's fetch refuses private addresses and needs the token", async () => {
	const e = env();
	for (const u of ["http://127.0.0.1/", "http://169.254.169.254/latest", "http://[::1]/", "file:///etc/passwd"]) {
		const r = await call(e, "/api/fetch?url=" + encodeURIComponent(u));
		assert.ok(r.status === 403 || r.status === 400, u + " -> " + r.status);
	}
	assert.equal((await call(e, "/api/fetch?url=https%3A%2F%2Fexample.com", { headers: { Authorization: "Bearer nope" } })).status, 401);
});

test("attachments are listed and read with their type, never excluded or hidden ones", async () => {
	const e = env();
	const list = await (await call(e, "/api/attachments")).json();
	assert.deepEqual(list.files.map((f) => f.path), ["content/img/p.png"]);
	const r = await call(e, "/api/attachment?path=content%2Fimg%2Fp.png");
	assert.equal(r.status, 200);
	assert.equal(r.headers.get("Content-Type"), "image/png");
	assert.match(r.headers.get("Content-Security-Policy"), /sandbox/);
	assert.equal(await r.text(), "PNG");
	for (const p of ["_includes/i.png", ".obsidian/icon.png", "content/x.exe", "content/a.md", "content/../x.png"]) {
		assert.equal((await call(e, "/api/attachment?path=" + encodeURIComponent(p))).status, 400, p);
	}
	assert.equal((await call(e, "/api/attachment?path=content%2Fnope.png")).status, 404);
	assert.equal((await call(e, "/api/attachments", { headers: { Authorization: "Bearer nope" } })).status, 401);
});

test("pictures can be added, never replaced, and only as pictures", async () => {
	const e = env();
	const put = (path, headers = { "If-None-Match": "*" }) => call(e, "/api/attachment?path=" + encodeURIComponent(path), { method: "PUT", headers, body: "PNGDATA" });
	assert.equal((await put("content/img/new.png")).status, 200);
	assert.equal(new TextDecoder().decode(e.VAULT.map.get("content/img/new.png").body), "PNGDATA");
	assert.equal((await put("content/img/x.png", {})).status, 428, "must say it's a new file");
	assert.equal((await put("content/img/x.svg")).status, 400, "no SVG");
	assert.equal((await put("_includes/x.png")).status, 400, "not in excluded folders");
	assert.equal((await put(".obsidian/x.png")).status, 400);
	assert.equal((await put("content/x.md")).status, 400);
});

test("the vault's attachment settings are read from .obsidian/app.json", async () => {
	const e = env();
	assert.deepEqual(await (await call(e, "/api/obsidian")).json(), {});
	e.VAULT.map.set(".obsidian/app.json", { body: new TextEncoder().encode('{"attachmentFolderPath":"./","useMarkdownLinks":false,"vimMode":true}'), etag: "x" });
	assert.deepEqual(await (await call(e, "/api/obsidian")).json(), { attachmentFolderPath: "./", useMarkdownLinks: false });
});
