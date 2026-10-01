import { test } from "node:test";
import assert from "node:assert/strict";
import { planNotes, planFiles, contentHash, firstPassSummary, fileConflictPath } from "../src/localvault.js";

const note = (text) => ({ text });
const rec = (text, size = 10, mtime = 100) => ({ size, mtime, hash: contentHash(note(text)) });
const file = (size = 10, mtime = 100) => ({ size, mtime });
const types = (a) => Object.fromEntries(a.map((x) => [x.path, x.type]));

test("notes: each side's changes go to the other, both-sided ones keep both", () => {
	const app = new Map([
		["same.md", note("A")], ["app-edit.md", note("B2")], ["folder-edit.md", note("C")], ["both.md", note("D2")],
		["new-in-app.md", note("E")], ["gone-from-folder.md", note("F")], ["gone-but-edited.md", note("G2")], ["first.md", note("H")],
	]);
	const folder = new Map([
		["same.md", file()], ["app-edit.md", file()], ["folder-edit.md", file(11, 200)], ["both.md", file(11, 200)],
		["new-in-folder.md", file()], ["deleted-in-app.md", file()], ["deleted-but-edited.md", file(12, 300)], ["first.md", file()],
		["notes.txt", file()], [".obsidian/app.md", file()],
	]);
	const records = new Map([
		["same.md", rec("A")], ["app-edit.md", rec("B")], ["folder-edit.md", rec("C")], ["both.md", rec("D")],
		["gone-from-folder.md", rec("F")], ["gone-but-edited.md", rec("G")], ["deleted-in-app.md", rec("X")], ["deleted-but-edited.md", rec("Y")],
		["gone-everywhere.md", rec("Z")],
	]);
	assert.deepEqual(types(planNotes(app, folder, records)), {
		"app-edit.md": "write", "folder-edit.md": "read", "both.md": "conflict", "new-in-app.md": "write",
		"gone-from-folder.md": "ask-delete", "gone-but-edited.md": "write", "first.md": "compare",
		"new-in-folder.md": "create", "deleted-in-app.md": "remove-file", "deleted-but-edited.md": "restore",
		"gone-everywhere.md": "forget",
	});
	// Nothing to do once both sides match their records.
	assert.deepEqual(planNotes(new Map([["a.md", note("x")]]), new Map([["a.md", file()]]), new Map([["a.md", rec("x")]])), []);
	// Binary notes hash by their bytes.
	assert.notEqual(contentHash({ bytes: new Uint8Array([1, 2]) }), contentHash({ bytes: new Uint8Array([1, 3]) }));
});

test("files: pictures come down as the vault changes them; new ones in the folder go up", () => {
	const app = [{ path: "img/a.png", version: "v2", size: 5 }, { path: "img/b.png", version: "v1", size: 5 }, { path: "img/new.png", version: "v1", size: 5 }, { path: "img/same.png", version: "v1", size: 7 }, { path: "img/hand.png", version: "v2", size: 5 }];
	const folder = new Map([["img/a.png", file(5)], ["img/b.png", file(5)], ["img/mine.jpg", file(5)], ["img/huge.png", file(30 * 1024 * 1024)], ["img/old.png", file(5)], ["img/same.png", file(7)], ["img/hand.png", file(9, 999)], ["doc.pdf", file()]]);
	const records = new Map([["img/a.png", { size: 5, mtime: 100, version: "v1" }], ["img/b.png", { size: 5, mtime: 100, version: "v1" }], ["img/old.png", { size: 5, mtime: 100, version: "v1" }], ["img/hand.png", { size: 5, mtime: 100, version: "v1" }], ["img/gone.png", { size: 1, mtime: 1, version: "v1" }]]);
	assert.deepEqual(types(planFiles(app, folder, records)), {
		"img/a.png": "download", "img/new.png": "download", "img/mine.jpg": "upload", "img/old.png": "remove-file", "img/same.png": "record", "img/gone.png": "forget",
	});
});

test("a first pass into a folder with files is summed up before anything happens", () => {
	const actions = [{ type: "compare", path: "a.md" }, { type: "compare", path: "b.md" }, { type: "create", path: "c.md" }, { type: "write", path: "d.md" }, { type: "write", path: "e.md" }];
	assert.deepEqual(firstPassSummary(actions, new Map([["a.md", true], ["b.md", false]])), { same: 1, differ: 1, folderOnly: 1, vaultOnly: 2 });
});

import { runPass } from "../src/localvaultview.js";
import { fakeDir } from "./fakefs.js";
import { isNotePath, isAttachmentPath } from "../src/paths.js";

function harness(root, notes, files = []) {
	const asked = { first: null, deletes: null };
	const uploaded = [];
	const host = {
		root, records: { notes: new Map(), files: new Map() },
		notes: () => new Map([...notes].filter(([, n]) => !n.deleted)),
		putNote: async (p, n) => { notes.set(p, { ...n }); },
		deleteNote: async (p) => { notes.set(p, { ...notes.get(p), deleted: true }); },
		conflictPath: (p) => p.replace(/\.md$/, " (conflict 2026-10-01).md"),
		attachments: () => files,
		fetchAttachment: async (f) => new Blob([`bytes of ${f.path} ${f.version}`]),
		// Like wr1t3r's: the new picture joins the vault's list.
		uploadPicture: async (p, blob) => { uploaded.push([p, blob.size]); files.push({ path: p, version: "up1", size: blob.size }); return "up1"; },
		confirmFirst: async (s) => { asked.first = s; return true; },
		confirmDeletes: async (ps) => { asked.deletes = ps; return host.allowDeletes; },
		isNote: isNotePath, isFile: isAttachmentPath, allowDeletes: true,
	};
	return { host, asked, uploaded };
}

test("a pass keeps a folder and wr1t3r in step, both ways", async () => {
	const root = fakeDir();
	const notes = new Map([["content/a.md", { text: "A\r\n" }], ["content/b.md", { text: "B" }]]);
	const files = [{ path: "content/img/p.png", version: "v1", size: 3 }];
	const { host, asked, uploaded } = harness(root, notes, files);

	// An empty folder: everything goes down, no questions.
	let r = await runPass(host);
	assert.deepEqual([r.errors, r.declined, asked.first], [[], false, null]);
	assert.equal(await root.get("content/a.md"), "A\r\n");
	assert.equal(await root.get("content/img/p.png"), "bytes of content/img/p.png v1");
	assert.equal((await runPass(host)).changed, 0); // nothing new

	// Edits on each side, a new file and a new picture in the folder.
	notes.set("content/a.md", { text: "A2\r\n" });
	await root.put("content/b.md", "B from Notepad");
	await root.put("content/new.md", "# New");
	await root.put("content/img/mine.png", "pic");
	r = await runPass(host);
	assert.deepEqual(r.errors, []);
	assert.equal(await root.get("content/a.md"), "A2\r\n");
	assert.equal(notes.get("content/b.md").text, "B from Notepad");
	assert.equal(notes.get("content/new.md").text, "# New");
	assert.deepEqual(uploaded, [["content/img/mine.png", 3]]);

	// Both sides change the same note: both kept.
	notes.set("content/b.md", { text: "B in wr1t3r" });
	await root.put("content/b.md", "B in Notepad again");
	await runPass(host);
	assert.equal(await root.get("content/b.md"), "B in wr1t3r");
	assert.equal(notes.get("content/b (conflict 2026-10-01).md").text, "B in Notepad again");
	assert.equal(await root.get("content/b (conflict 2026-10-01).md"), "B in Notepad again");

	// Deleted in wr1t3r: the file goes. Deleted in the folder: asked first.
	notes.set("content/new.md", { ...notes.get("content/new.md"), deleted: true });
	await (await root.getDirectoryHandle("content")).removeEntry("a.md");
	r = await runPass(host);
	assert.equal(await root.get("content/new.md"), null);
	assert.deepEqual(asked.deletes, ["content/a.md"]);
	assert.equal(notes.get("content/a.md").deleted, true);
	// Said no: put back in the folder instead.
	host.allowDeletes = false;
	await (await root.getDirectoryHandle("content")).removeEntry("b.md");
	await runPass(host);
	assert.equal(await root.get("content/b.md"), "B in wr1t3r");
	assert.ok(!notes.get("content/b.md").deleted);

	// A new version of a picture in the vault comes down; the uploaded one stays.
	files[0] = { ...files[0], version: "v2" };
	await runPass(host);
	assert.equal(await root.get("content/img/p.png"), "bytes of content/img/p.png v2");
	assert.equal(await root.get("content/img/mine.png"), "pic");
});

test("pictures are left alone until the vault's list is known", async () => {
	const root = fakeDir();
	const files = [{ path: "img/p.png", version: "v1", size: 3 }];
	const { host } = harness(root, new Map(), files);
	await runPass(host);
	assert.ok(await root.get("img/p.png"));
	host.attachments = () => null; // not loaded yet
	await runPass(host);
	assert.ok(await root.get("img/p.png"));
	assert.ok(host.records.files.has("img/p.png"));
});

test("a picture both sides have, different, keeps both", async () => {
	const root = fakeDir();
	await root.put("img/p.png", "mine, longer");
	const files = [{ path: "img/p.png", version: "v1", size: 3 }];
	const { host, uploaded } = harness(root, new Map(), files);
	assert.deepEqual(types(planFiles(files, new Map([["img/p.png", file(12)]]), new Map())), { "img/p.png": "keep-both" });
	await runPass(host);
	assert.equal(await root.get("img/p.png"), "bytes of img/p.png v1");
	const copy = "img/p (conflict " + new Date().toISOString().slice(0, 10) + ").png";
	assert.equal(await root.get(copy), "mine, longer");
	await runPass(host); // the copy is a new picture: it goes up
	assert.deepEqual(uploaded.map((u) => u[0]), [copy]);
});

test("conflict names for attachments keep the extension", () => {
	const d = new Date("2026-10-01T12:00:00Z");
	assert.equal(fileConflictPath("a/photo.png", () => false, d), "a/photo (conflict 2026-10-01).png");
	assert.equal(fileConflictPath("a/photo.png", (p) => p === "a/photo (conflict 2026-10-01).png", d), "a/photo (conflict 2026-10-01 2).png");
	assert.equal(fileConflictPath("a.b/noext", () => false, d), "a.b/noext (conflict 2026-10-01)");
});

test("a folder that already has notes is summed up first; saying no changes nothing", async () => {
	const root = fakeDir();
	await root.put("content/a.md", "A");
	await root.put("content/old.md", "an old note");
	await root.put(".obsidian/workspace.json", "{}");
	const notes = new Map([["content/a.md", { text: "A" }], ["content/b.md", { text: "B" }]]);
	const { host, asked } = harness(root, notes);
	host.confirmFirst = async (s) => { asked.first = s; return false; };
	const r = await runPass(host);
	assert.equal(r.declined, true);
	assert.deepEqual(asked.first, { same: 1, differ: 0, folderOnly: 1, vaultOnly: 1 });
	assert.equal(await root.get("content/b.md"), null);
	assert.equal(notes.has("content/old.md"), false);
});
