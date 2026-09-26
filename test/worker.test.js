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
	EXCLUDE: "_includes/",
	VAULT: fakeBucket({ "content/a.md": "A", "_includes/snippets/marquee.md": "M", "_Includes/x.md": "X" }),
});

test("excluded folders are left out of the list, whatever their case", async () => {
	const r = await call(env(), "/api/files");
	assert.deepEqual((await r.json()).files.map((f) => f.path), ["content/a.md"]);
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
