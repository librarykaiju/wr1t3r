import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { runBackup } from "../worker/backup.js";

crypto.subtle.timingSafeEqual ??= (a, b) => Buffer.from(a).equals(Buffer.from(b));

const enc = new TextEncoder();

function fakeBucket(files) {
	let n = 0;
	const m = new Map(Object.entries(files).map(([k, v]) => [k, { body: enc.encode(v), etag: "e" + ++n }]));
	const obj = (key) => {
		const f = m.get(key);
		return {
			key, etag: f.etag, size: f.body.length, uploaded: new Date("2026-10-01T00:00:00Z"),
			httpMetadata: { contentType: key.endsWith(".md") ? "text/markdown" : undefined },
			arrayBuffer: async () => f.body, json: async () => JSON.parse(new TextDecoder().decode(f.body)),
		};
	};
	return {
		map: m,
		set(k, v) { m.set(k, { body: enc.encode(v), etag: "e" + ++n }); },
		async list({ cursor } = {}) {
			// Two pages, to follow the cursor.
			const keys = [...m.keys()].sort();
			const half = Math.ceil(keys.length / 2);
			const page = cursor ? keys.slice(half) : keys.slice(0, half);
			return { objects: page.map(obj), truncated: !cursor && half < keys.length, cursor: "c2" };
		},
		async get(k) { return m.has(k) ? obj(k) : null; },
		async put(k, body) { m.set(k, { body: typeof body === "string" ? enc.encode(body) : body, etag: "e" + ++n }); },
	};
}

// Google's token endpoint and just enough of Drive: files with a name,
// parents and body, found by name, made, and updated.
function fakeDrive() {
	const files = new Map(); // id -> {name, parents, folder, body, modifiedTime}
	let n = 0;
	const seen = [];
	const real = globalThis.fetch;
	globalThis.fetch = async (url, init = {}) => {
		const u = new URL(url);
		seen.push(`${init.method || "GET"} ${u.pathname}`);
		const j = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
		if (u.pathname === "/token") return j({ access_token: "ab", expires_in: 3600 });
		if (u.pathname === "/drive/v3/files" && !init.method) {
			const q = u.searchParams.get("q");
			const [, name, parent] = q.match(/^name = '(.*)' and '(.*)' in parents/);
			const folder = q.includes("mimeType =");
			const hit = [...files].find(([, f]) => f.name === name.replace(/\\'/g, "'") && f.parents[0] === parent && f.folder === folder);
			return j({ files: hit ? [{ id: hit[0] }] : [] });
		}
		if (u.pathname === "/drive/v3/files" && init.method === "POST") {
			const meta = JSON.parse(init.body);
			const id = "f" + ++n;
			files.set(id, { name: meta.name, parents: meta.parents, folder: true });
			return j({ id });
		}
		const m = u.pathname.match(/^\/upload\/drive\/v3\/files(?:\/(.+))?$/);
		if (m && u.searchParams.get("uploadType") === "multipart") {
			const text = await new Response(init.body).text();
			const boundary = init.headers["Content-Type"].split("boundary=")[1];
			const [, metaPart, bodyPart] = text.split(`--${boundary}`);
			const meta = JSON.parse(metaPart.split("\r\n\r\n")[1]);
			const body = bodyPart.split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, "");
			if (m[1]) {
				if (!files.has(m[1])) return j({ error: { message: "File not found" } }, 404);
				Object.assign(files.get(m[1]), { body, modifiedTime: meta.modifiedTime });
				return j({ id: m[1] });
			}
			const id = "f" + ++n;
			files.set(id, { name: meta.name, parents: meta.parents, folder: false, body, modifiedTime: meta.modifiedTime });
			return j({ id });
		}
		return j({ error: { message: "nope " + u.pathname } }, 400);
	};
	// The path of a file, by folder names.
	const pathOf = (id) => { const f = files.get(id); return f.parents[0] === "root" ? f.name : pathOf(f.parents[0]) + "/" + f.name; };
	const tree = () => Object.fromEntries([...files].filter(([, f]) => !f.folder).map(([id, f]) => [pathOf(id), f.body]).sort());
	return { files, seen, tree, restore: () => (globalThis.fetch = real) };
}

const env = (vault) => ({
	WR1T3R_TOKEN: "t", VAULT: vault, DRIVE_BACKUP: "Vault backup",
	GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "sec", GOOGLE_REFRESH_TOKEN: "rb",
	GOOGLE_TOKEN_URL: "https://g/token", GOOGLE_DRIVE_API: "https://g",
});

test("copies the bucket into Drive folders, then only what changed, and never deletes", async () => {
	const g = fakeDrive();
	try {
		const vault = fakeBucket({ "content/a.md": "A", "content/sub/it's.md": "B", "top.md": "T", ".obsidian/app.json": "{}" });
		const e = env(vault);
		const s = await runBackup(e, 1000);
		assert.equal(s.last.error, undefined);
		assert.deepEqual(s.last, { at: 1000, copied: 4, remaining: 0 });
		assert.equal(s.upToDate, 1000);
		assert.deepEqual(g.tree(), {
			"Vault backup/.obsidian/app.json": "{}", "Vault backup/content/a.md": "A",
			"Vault backup/content/sub/it's.md": "B", "Vault backup/top.md": "T",
		});
		assert.equal([...g.files.values()].find((f) => f.name === "a.md").modifiedTime, "2026-10-01T00:00:00.000Z");
		assert.ok(vault.map.has(".wr1t3r/backup.json"), "progress is kept in the bucket");

		g.seen.length = 0;
		await runBackup(e, 2000);
		assert.ok(!g.seen.some((x) => x.includes("/upload/")), "nothing changed, nothing sent");

		vault.set("content/a.md", "A2");
		vault.map.delete("top.md");
		const s3 = await runBackup(e, 3000);
		assert.equal(s3.last.copied, 1);
		assert.equal(g.tree()["Vault backup/content/a.md"], "A2", "updated in place");
		assert.equal(g.tree()["Vault backup/top.md"], "T", "a file gone from the bucket keeps its copy");
		assert.ok(!(await runBackup(e, 4000)).files["top.md"]);
		assert.equal(g.tree()["Vault backup/.wr1t3r/backup.json"], undefined, "its own state isn't copied");
	} finally {
		g.restore();
	}
});

test("a batch stops at the call budget and the next run carries on", async () => {
	const g = fakeDrive();
	try {
		const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`n${String(i).padStart(2, "0")}.md`, "x" + i]));
		const e = { ...env(fakeBucket(files)), BACKUP_CALLS: "10" };
		const first = await runBackup(e, 1);
		assert.ok(first.last.copied > 0 && first.last.remaining > 0, JSON.stringify(first.last));
		assert.equal(first.upToDate, null);
		let s = first;
		for (let i = 0; i < 10 && s.last.remaining; i++) s = await runBackup(e, 2 + i);
		assert.equal(s.last.remaining, 0);
		assert.equal(Object.keys(g.tree()).length, 12);
	} finally {
		g.restore();
	}
});

test("by default a batch stays under the free plan's 50 subrequests, in nested folders too", async () => {
	const g = fakeDrive();
	try {
		const files = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`content/f${i % 7}/sub${i % 3}/n${i}.md`, "x" + i]));
		const e = env(fakeBucket(files));
		let s, runs = 0;
		do {
			g.seen.length = 0;
			s = await runBackup(e, ++runs);
			assert.equal(s.last.error, undefined);
			assert.ok(g.seen.length <= 45, `run ${runs} made ${g.seen.length} calls`);
		} while (s.last.remaining && runs < 20);
		assert.equal(s.last.remaining, 0);
		assert.equal(Object.keys(g.tree()).length, 60);
	} finally {
		g.restore();
	}
});

test("one batch at a time; Cloudflare's subrequest limit isn't an error", async () => {
	const g = fakeDrive();
	try {
		const vault = fakeBucket({ "a.md": "A", "b.md": "B" });
		const e = env(vault);
		await vault.put(".wr1t3r/backup.json", JSON.stringify({ running: 1000 }));
		const busy = await runBackup(e, 2000);
		assert.equal(busy.busy, true);
		assert.equal(Object.keys(g.tree()).length, 0, "nothing copied while another batch runs");
		const stale = await runBackup(e, 1000 + 4 * 60 * 1000);
		assert.equal(stale.last.copied, 2, "a batch that died is taken over");
		assert.equal(stale.running, null);

		vault.set("a.md", "A2");
		const real = globalThis.fetch;
		globalThis.fetch = async (url, init) => (/\/upload\//.test(url) ? Promise.reject(new Error("Too many subrequests by single Worker invocation.")) : real(url, init));
		try {
			const s = await runBackup(e, 10 ** 7);
			assert.deepEqual(s.last, { at: 10 ** 7, copied: 0, remaining: 1 });
		} finally {
			globalThis.fetch = real;
		}
	} finally {
		g.restore();
	}
});

test("a copy deleted in Drive is made again, and lost progress finds the existing copies", async () => {
	const g = fakeDrive();
	try {
		const vault = fakeBucket({ "a.md": "A", "b.md": "B" });
		const e = env(vault);
		await runBackup(e);
		const idA = [...g.files].find(([, f]) => f.name === "a.md")[0];
		g.files.delete(idA);
		vault.set("a.md", "A2");
		const s = await runBackup(e);
		assert.equal(s.last.error, undefined);
		assert.equal(g.tree()["Vault backup/a.md"], "A2");

		vault.map.delete(".wr1t3r/backup.json");
		vault.set("b.md", "B2");
		await runBackup(e);
		assert.equal(g.files.size, 3, "no second backup folder or copies");
		assert.equal(g.tree()["Vault backup/b.md"], "B2");
	} finally {
		g.restore();
	}
});

test("errors are kept with the progress; the API runs a batch and reports", async () => {
	const g = fakeDrive();
	try {
		const vault = fakeBucket({ "a.md": "A" });
		const off = await worker.fetch(new Request("https://w/api/backup", { headers: { Authorization: "Bearer t" } }), { WR1T3R_TOKEN: "t", VAULT: vault });
		assert.equal(off.status, 404);
		const e = { ...env(vault), GOOGLE_DRIVE_API: "https://g/broken" };
		const bad = await runBackup(e, 5);
		assert.match(bad.last.error, /Google Drive: nope/);
		assert.equal(bad.upToDate, null);
		const r = await worker.fetch(new Request("https://w/api/backup", { method: "POST", headers: { Authorization: "Bearer t" } }), env(vault));
		const body = await r.json();
		assert.equal(r.status, 200);
		assert.deepEqual([body.folder, body.files, body.last.copied, body.last.remaining], ["Vault backup", 1, 1, 0]);
		const status = await (await worker.fetch(new Request("https://w/api/backup", { headers: { Authorization: "Bearer t" } }), env(vault))).json();
		assert.equal(status.files, 1);
	} finally {
		g.restore();
	}
});

test("the hourly cron runs the backup; the every-minute one only while it's behind", async () => {
	const g = fakeDrive();
	try {
		const vault = fakeBucket({ "a.md": "A" });
		const waits = [];
		const ctx = { waitUntil: (p) => waits.push(p) };
		await worker.scheduled({ cron: "* * * * *" }, env(vault), ctx);
		await Promise.all(waits);
		assert.ok(!vault.map.has(".wr1t3r/backup.json"));
		await worker.scheduled({ cron: "17 * * * *" }, env(vault), ctx);
		await Promise.all(waits);
		assert.deepEqual(g.tree(), { "Vault backup/a.md": "A" });

		for (let i = 0; i < 20; i++) vault.set(`n${i}.md`, "x");
		const e = { ...env(vault), BACKUP_CALLS: "10" };
		await worker.scheduled({ cron: "17 * * * *" }, e, ctx);
		await Promise.all(waits);
		const left = Object.keys(g.tree()).length;
		assert.ok(left < 21, "the hourly batch didn't finish");
		for (let i = 0; i < 10; i++) {
			await worker.scheduled({ cron: "* * * * *" }, e, ctx);
			await Promise.all(waits);
		}
		assert.equal(Object.keys(g.tree()).length, 21, "the every-minute cron finished it");
	} finally {
		g.restore();
	}
});
