import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryStorage, checkStorage, STORAGE_METHODS, storageKind, openStorage, registerStorage } from "../src/storage.js";
import { workerStorage } from "../src/api.js";
import { sync } from "../src/sync.js";
import { memoryLocal } from "./fakes.js";
import worker from "../worker/index.js";
import { dropboxStorage } from "../src/dropbox.js";
import { fakeDropbox } from "./fakedropbox.js";

crypto.subtle.timingSafeEqual ??= (a, b) => Buffer.from(a).equals(Buffer.from(b));

const enc = new TextEncoder();
const dec = new TextDecoder();

// An R2 bucket that honours onlyIf, as the real one does.
function strictBucket() {
	let n = 0;
	const m = new Map();
	const obj = (key) => ({ key, etag: m.get(key).etag, size: m.get(key).body.length, arrayBuffer: async () => m.get(key).body });
	return {
		map: m,
		async list() { return { objects: [...m.keys()].map(obj), truncated: false }; },
		async get(k) { return m.has(k) ? obj(k) : null; },
		async head(k) { return m.has(k) ? obj(k) : null; },
		async put(k, body, opts = {}) {
			const want = opts.onlyIf;
			const cur = m.get(k);
			if (want?.get("If-None-Match") === "*" && cur) return null;
			const match = want?.get("If-Match");
			if (match && (!cur || `"${cur.etag}"` !== match)) return null;
			const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
			m.set(k, { body: bytes, etag: "e" + ++n });
			return obj(k);
		},
		async delete(k) { m.delete(k); },
	};
}

// The page's Worker storage, talking to the real Worker code over a fake fetch.
function viaWorker() {
	const env = { WR1T3R_TOKEN: "t", VAULT: strictBucket() };
	return workerStorage({ get: (path, init) => worker.fetch(new Request("https://w" + path, init), env), auth: () => "t" });
}

// The page's Dropbox storage, talking to a fake Dropbox.
function viaDropbox() {
	const { fetch, state } = fakeDropbox();
	let t = { access: state.access, refresh: state.refresh, expires: Date.now() + 3600e3 };
	return dropboxStorage({ appKey: "k", get: fetch, tokens: { load: () => t, save: (x) => { t = x; } } });
}

const kinds = { memory: () => memoryStorage(), worker: viaWorker, dropbox: viaDropbox };
const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

for (const [kind, make] of Object.entries(kinds)) {
	test(`${kind}: has every method`, () => {
		checkStorage(make(), kind);
	});

	test(`${kind}: create, read, list`, async () => {
		const s = make();
		await s.check();
		const a = await s.write("notes/a.md", enc.encode("A"), null);
		assert.equal(a.ok, true);
		assert.ok(a.version);
		const [f, gone] = await s.read(["notes/a.md", "notes/nope.md"]);
		assert.equal(dec.decode(f.bytes), "A");
		assert.equal(f.version, a.version);
		assert.deepEqual(gone, { path: "notes/nope.md", missing: true });
		assert.deepEqual((await s.list()).map((x) => [x.path, x.version]), [["notes/a.md", a.version]]);
	});

	test(`${kind}: creating over an existing note fails with its version`, async () => {
		const s = make();
		const a = await s.write("a.md", enc.encode("A"), null);
		assert.deepEqual(await s.write("a.md", enc.encode("B"), null), { ok: false, version: a.version });
	});

	test(`${kind}: a write against an old version fails and keeps the newer text`, async () => {
		const s = make();
		const v1 = (await s.write("a.md", enc.encode("1"), null)).version;
		const v2 = (await s.write("a.md", enc.encode("2"), v1)).version;
		assert.notEqual(v1, v2);
		assert.deepEqual(await s.write("a.md", enc.encode("stale"), v1), { ok: false, version: v2 });
		assert.equal(dec.decode((await s.read(["a.md"]))[0].bytes), "2");
	});

	test(`${kind}: remove needs the current version; already gone is fine`, async () => {
		const s = make();
		const v1 = (await s.write("a.md", enc.encode("1"), null)).version;
		const v2 = (await s.write("a.md", enc.encode("2"), v1)).version;
		assert.deepEqual(await s.remove("a.md", v1), { ok: false, version: v2 });
		assert.deepEqual(await s.remove("a.md", v2), { ok: true });
		assert.deepEqual(await s.remove("a.md", v2), { ok: true });
		assert.deepEqual(await s.list(), []);
	});

	test(`${kind}: pictures upload once, list apart from notes, and read back`, async () => {
		const s = make();
		await s.write("a.md", enc.encode("A"), null);
		const up = await s.uploadAttachment("img/p.png", png());
		assert.equal(up.path, "img/p.png");
		assert.equal(up.size, 4);
		assert.equal(await s.uploadAttachment("img/p.png", png()), false);
		assert.deepEqual((await s.attachments()).map((x) => x.path), ["img/p.png"]);
		assert.deepEqual((await s.list()).map((x) => x.path), ["a.md"]);
		const blob = await s.attachment("img/p.png");
		assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [137, 80, 78, 71]);
	});

	test(`${kind}: a full sync round trip`, async () => {
		const s = make();
		await s.write("a.md", enc.encode("A"), null);
		const local = memoryLocal();
		assert.equal((await sync({ local, api: s })).downloaded, 1);
		const n = await local.get("a.md");
		await local.put({ ...n, text: "A2", dirty: true });
		assert.equal((await sync({ local, api: s })).uploaded, 1);
		assert.equal(dec.decode((await s.read(["a.md"]))[0].bytes), "A2");
	});
}

test("the Worker is the default kind, and unknown kinds fall back to it", () => {
	assert.equal(storageKind(), "worker");
	assert.deepEqual(Object.keys(openStorage("nonsense")).sort(), [...STORAGE_METHODS].sort());
});

test("a registered kind opens, and one missing methods is refused", () => {
	registerStorage("test-memory", () => memoryStorage());
	assert.ok(openStorage("test-memory").map instanceof Map);
	registerStorage("test-broken", () => ({ list() {} }));
	assert.throws(() => openStorage("test-broken"), /missing check, read/);
});
