import { test } from "node:test";
import assert from "node:assert/strict";
import { folderStorage, folderPermission } from "../src/folderstorage.js";
import { checkStorage } from "../src/storage.js";
import { AuthError } from "../src/api.js";
import { sync } from "../src/sync.js";
import { memoryLocal } from "./fakes.js";
import { fakeDir } from "./fakefs.js";

const enc = new TextEncoder();

function setup() {
	const dir = fakeDir();
	dir.permission = "granted";
	dir.queryPermission = async () => dir.permission;
	dir.requestPermission = async () => (dir.permission = dir.asked ?? dir.permission);
	const s = checkStorage(folderStorage({ root: async () => dir }), "folder");
	return { s, dir };
}

test("notes written in wr1t3r land in the folder as plain files", async () => {
	const { s, dir } = setup();
	const local = memoryLocal();
	await local.put({ path: "Ideas/first.md", text: "hello", dirty: true });
	assert.equal((await sync({ local, api: s })).uploaded, 1);
	assert.equal(await dir.get("Ideas/first.md"), "hello");
	assert.deepEqual(await sync({ local, api: s }), { downloaded: 0, uploaded: 0, deleted: 0, conflicts: [] });
});

test("a file edited by another app comes in on the next sync", async () => {
	const { s, dir } = setup();
	await dir.put("a.md", "one");
	const local = memoryLocal();
	assert.equal((await sync({ local, api: s })).downloaded, 1);
	await dir.put("a.md", "two");
	assert.equal((await sync({ local, api: s })).downloaded, 1);
	assert.equal((await local.get("a.md")).text, "two");
});

test("writes and deletes only go through when the file is as last seen", async () => {
	const { s, dir } = setup();
	const first = await s.write("a.md", enc.encode("A"), null);
	assert.equal(first.ok, true);
	assert.equal((await s.write("a.md", enc.encode("B"), null)).ok, false, "null expects no file");
	await dir.put("a.md", "changed elsewhere");
	const stale = await s.write("a.md", enc.encode("C"), first.version);
	assert.equal(stale.ok, false);
	assert.equal(await dir.get("a.md"), "changed elsewhere");
	assert.equal((await s.remove("a.md", first.version)).ok, false);
	assert.equal((await s.remove("a.md", stale.version)).ok, true);
	assert.equal(await dir.get("a.md"), null);
	assert.equal((await s.remove("a.md", stale.version)).ok, true, "already gone is fine");
});

test("hidden folders and non-note files stay out of the note list; pictures are attachments", async () => {
	const { s, dir } = setup();
	await dir.put(".obsidian/app.md", "x");
	await dir.put("notes.md", "n");
	await dir.put("pic.png", "p");
	assert.deepEqual((await s.list()).map((f) => f.path), ["notes.md"]);
	assert.deepEqual((await s.attachments()).map((f) => f.path), ["pic.png"]);
	assert.equal(await s.uploadAttachment("pic.png", new Blob(["q"])), false, "a taken name isn't overwritten");
	assert.equal((await s.uploadAttachment("new.png", new Blob(["q"]))).path, "new.png");
	assert.equal(await (await s.attachment("new.png")).text(), "q");
});

test("a forgotten folder signs out; a lapsed permission says how to fix it", async () => {
	const gone = folderStorage({ root: async () => null });
	await assert.rejects(gone.check(), AuthError);
	const { s, dir } = setup();
	dir.permission = "prompt";
	await assert.rejects(s.check(), /OK to use the folder/);
	dir.asked = "granted";
	assert.equal(await folderPermission(dir, true), "granted");
	await s.check();
});
