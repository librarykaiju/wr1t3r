import { test } from "node:test";
import assert from "node:assert/strict";
import { driveStorage } from "../src/gdrive.js";
import { checkStorage } from "../src/storage.js";
import { fakeDrive } from "./fakedrive.js";

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
// What src/google.js googleClient does, minus the tokens.
const caller = (fake) => async (url, init = {}) => {
	const { raw, ...rest } = init;
	const res = await fake.fetch(url, { ...rest, headers: { ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...init.headers } });
	if (raw && res.ok) return res;
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.error?.message || `Google said ${res.status}`);
	return data;
};
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

test("Drive keeps notes and pictures under one folder, by path", async () => {
	const fake = fakeDrive(), s = store();
	const drive = checkStorage(driveStorage({ call: caller(fake), store: s }), "drive");
	await drive.check();
	assert.deepEqual(await drive.list(), []);
	const a = await drive.write("Story/Ch 1.md", enc("# One"), null);
	assert.equal(a.ok, true);
	assert.deepEqual(await drive.write("Story/Ch 1.md", enc("again"), null), { ok: false, version: a.version }, "create fails when it's there");
	const b = await drive.write("Story/Ch 1.md", enc("# One, longer"), a.version);
	assert.equal(b.ok, true);
	assert.notEqual(b.version, a.version);
	assert.deepEqual(await drive.write("Story/Ch 1.md", enc("stale"), a.version), { ok: false, version: b.version }, "a stale version is refused");
	await drive.write("Story/Ch 2.md", enc("two"), null);
	assert.equal(fake.find("Story").mimeType, "application/vnd.google-apps.folder");
	assert.equal([...fake.files.values()].filter((f) => f.name === "Story").length, 1, "one folder for both");

	// Another device, same Google account: finds the same notebook.
	const other = driveStorage({ call: caller(fake), store: store() });
	assert.deepEqual((await other.list()).map((f) => f.path), ["Story/Ch 1.md", "Story/Ch 2.md"]);
	const [r, gone] = await other.read(["Story/Ch 1.md", "Nope.md"]);
	assert.equal(dec(r.bytes), "# One, longer");
	assert.equal(r.version, b.version);
	assert.deepEqual(gone, { path: "Nope.md", missing: true });

	// Google bumping its own version number isn't a change.
	const v1 = (await drive.list()).find((f) => f.path === "Story/Ch 2.md").version;
	fake.bump("Story/Ch 2.md");
	const again = await drive.write("Story/Ch 2.md", enc("two, more"), v1);
	assert.equal(again.ok, true, "a second save after Google's own bump isn't a conflict");

	// A change made elsewhere shows as a conflict here.
	const f2 = fake.find("Story/Ch 2.md"); f2.bytes = enc("changed elsewhere"); f2.version++;
	const v2 = (await drive.list()).find((f) => f.path === "Story/Ch 2.md").version;
	assert.deepEqual(await drive.remove("Story/Ch 2.md", "1"), { ok: false, version: v2 });
	assert.deepEqual(await drive.remove("Story/Ch 2.md", v2), { ok: true });
	assert.equal(fake.find("Story/Ch 2.md"), null, "trashed");
	assert.deepEqual(await drive.remove("Story/Ch 2.md", v2), { ok: true }, "already gone is fine");

	const pic = new Blob([new Uint8Array([137, 80, 78, 71, 0, 255])], { type: "image/png" });
	const up = await drive.uploadAttachment("Story/pics/map.png", pic);
	assert.equal(up.size, 6);
	assert.equal(await drive.uploadAttachment("Story/pics/map.png", pic), false);
	assert.deepEqual((await drive.attachments()).map((f) => f.path), ["Story/pics/map.png"]);
	await other.list(); // the other device's next sync sees it
	assert.deepEqual([...new Uint8Array(await (await other.attachment("Story/pics/map.png")).arrayBuffer())], [137, 80, 78, 71, 0, 255]);
});

test("files wr1t3r didn't make stay out of sight", async () => {
	const fake = fakeDrive();
	const drive = driveStorage({ call: caller(fake), store: store() });
	await drive.write("A.md", enc("a"), null);
	fake.add({ name: "Dropped.md", parents: [fake.find("A.md").parents[0]], bytes: enc("x"), hidden: true });
	assert.deepEqual((await drive.list()).map((f) => f.path), ["A.md"]);
});
