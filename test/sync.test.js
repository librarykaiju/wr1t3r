import { test } from "node:test";
import assert from "node:assert/strict";
import { sync, plan, conflictPath, fromBytes, toBytes } from "../src/sync.js";
import { memoryLocal, memoryRemote } from "./fakes.js";

const day = new Date("2026-09-26T12:00:00Z");
const run = (local, api) => sync({ local, api, now: () => day });

test("first sync downloads the whole vault", async () => {
	const api = memoryRemote({ "a.md": "A", "dir/b.md": "B" });
	const local = memoryLocal();
	const r = await run(local, api);
	assert.equal(r.downloaded, 2);
	assert.equal((await local.get("dir/b.md")).text, "B");
	assert.equal((await local.get("a.md")).base, api.map.get("a.md").version);
});

test("a second sync with nothing changed does nothing", async () => {
	const api = memoryRemote({ "a.md": "A" });
	const local = memoryLocal();
	await run(local, api);
	const before = api.map.get("a.md").version;
	const r = await run(local, api);
	assert.deepEqual(r, { downloaded: 0, uploaded: 0, deleted: 0, conflicts: [] });
	assert.equal(api.map.get("a.md").version, before);
});

test("remote edits and deletes reach a clean local copy", async () => {
	const api = memoryRemote({ "a.md": "A", "b.md": "B" });
	const local = memoryLocal();
	await run(local, api);
	api.set("a.md", "A2");
	api.map.delete("b.md");
	await run(local, api);
	assert.equal((await local.get("a.md")).text, "A2");
	assert.equal(await local.get("b.md"), null);
});

test("a local edit is uploaded against the version it started from", async () => {
	const api = memoryRemote({ "a.md": "A" });
	const local = memoryLocal();
	await run(local, api);
	const n = await local.get("a.md");
	await local.put({ ...n, text: "A local", dirty: true });
	const r = await run(local, api);
	assert.equal(r.uploaded, 1);
	assert.equal(api.text("a.md"), "A local");
	const after = await local.get("a.md");
	assert.equal(after.dirty, false);
	assert.equal(after.base, api.map.get("a.md").version);
});

test("new local notes are created; local deletes are sent", async () => {
	const api = memoryRemote({ "old.md": "gone soon" });
	const local = memoryLocal();
	await run(local, api);
	await local.put({ path: "new.md", text: "hi", base: null, dirty: true, deleted: false });
	await local.put({ ...(await local.get("old.md")), deleted: true, dirty: true });
	const r = await run(local, api);
	assert.equal(api.text("new.md"), "hi");
	assert.equal(api.map.has("old.md"), false);
	assert.equal(r.deleted, 1);
	assert.equal(await local.get("old.md"), null);
});

test("both sides edited: keep both, the note takes the remote text", async () => {
	const api = memoryRemote({ "dir/Note.md": "base" });
	const local = memoryLocal();
	await run(local, api);
	await local.put({ ...(await local.get("dir/Note.md")), text: "mine", dirty: true });
	api.set("dir/Note.md", "theirs");
	const r = await run(local, api);
	const copy = "dir/Note (conflict 2026-09-26).md";
	assert.deepEqual(r.conflicts, [{ path: "dir/Note.md", copy }]);
	assert.equal(api.text("dir/Note.md"), "theirs");
	assert.equal(api.text(copy), "mine");
	assert.equal((await local.get("dir/Note.md")).text, "theirs");
	assert.equal((await local.get(copy)).dirty, false);
});

test("both sides made the same edit: no conflict copy", async () => {
	const api = memoryRemote({ "a.md": "base" });
	const local = memoryLocal();
	await run(local, api);
	await local.put({ ...(await local.get("a.md")), text: "same", dirty: true });
	api.set("a.md", "same");
	const r = await run(local, api);
	assert.deepEqual(r.conflicts, []);
	assert.equal(api.map.size, 1);
	assert.equal((await local.get("a.md")).dirty, false);
});

test("a note created on both sides with different text keeps both", async () => {
	const api = memoryRemote({});
	const local = memoryLocal([{ path: "x.md", text: "local", base: null, dirty: true, deleted: false }]);
	api.set("x.md", "remote");
	const r = await run(local, api);
	assert.equal(r.conflicts.length, 1);
	assert.equal(api.text("x.md"), "remote");
	assert.equal(api.text("x (conflict 2026-09-26).md"), "local");
});

test("edited here, deleted there: the edit comes back", async () => {
	const api = memoryRemote({ "a.md": "A" });
	const local = memoryLocal();
	await run(local, api);
	await local.put({ ...(await local.get("a.md")), text: "kept", dirty: true });
	api.map.delete("a.md");
	await run(local, api);
	assert.equal(api.text("a.md"), "kept");
});

test("deleted here, edited there: the edit comes back", async () => {
	const api = memoryRemote({ "a.md": "A" });
	const local = memoryLocal();
	await run(local, api);
	await local.put({ ...(await local.get("a.md")), deleted: true, dirty: true });
	api.set("a.md", "edited elsewhere");
	await run(local, api);
	assert.equal(api.text("a.md"), "edited elsewhere");
	const n = await local.get("a.md");
	assert.equal(n.text, "edited elsewhere");
	assert.equal(n.deleted, false);
});

test("typing during an upload stays dirty", async () => {
	const api = memoryRemote({ "a.md": "A" });
	const local = memoryLocal();
	await run(local, api);
	await local.put({ ...(await local.get("a.md")), text: "one", dirty: true });
	const write = api.write;
	api.write = async (...args) => {
		const r = await write(...args);
		await local.put({ ...(await local.get("a.md")), text: "one two" });
		return r;
	};
	await sync({ local, api, now: () => day });
	api.write = write;
	assert.equal((await local.get("a.md")).text, "one two");
	// The second round of the same sync already sent the rest.
	assert.equal(api.text("a.md"), "one two");
	assert.equal((await local.get("a.md")).dirty, false);
});

test("bytes round-trip exactly: BOM, CRLF, mixed endings, no trailing newline", () => {
	const cases = ["﻿---\ntitle: x\n---\nbody", "a\r\nb\r\n", "a\r\nb\nc", "no newline", ""];
	for (const t of cases) {
		const bytes = new TextEncoder().encode(t);
		assert.deepEqual(toBytes(fromBytes("a.md", bytes, "v")), bytes);
	}
	const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in Latin-1: not UTF-8
	const n = fromBytes("a.md", latin1, "v");
	assert.equal(n.binary, true);
	assert.deepEqual(toBytes(n), latin1);
});

test("conflict copies get numbered when the name is taken", () => {
	const taken = new Set(["a (conflict 2026-09-26).md"]);
	assert.equal(conflictPath("a.md", (p) => taken.has(p), day), "a (conflict 2026-09-26 2).md");
});

test("plan leaves synced notes alone", () => {
	const local = new Map([["a.md", { path: "a.md", base: "v1", dirty: false }]]);
	const remote = new Map([["a.md", { path: "a.md", version: "v1" }]]);
	assert.deepEqual(plan(local, remote), []);
});

test("a new note deleted while its first upload is in flight doesn't come back", async () => {
	const api = memoryRemote({});
	const local = memoryLocal([{ path: "n.md", text: "x", base: null, dirty: true, deleted: false }]);
	const write = api.write;
	api.write = async (...args) => {
		const r = await write(...args);
		await local.del("n.md"); // the user deleted (or renamed) it meanwhile
		return r;
	};
	await run(local, api);
	api.write = write;
	assert.equal(api.map.has("n.md"), false);
	assert.equal(await local.get("n.md"), null);
});
