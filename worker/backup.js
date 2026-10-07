// Backup of the whole vault bucket to Google Drive, run by the Worker's hourly
// cron. Like the old `rclone copy` workflow in librarykaiju/w3bz1n3 it only
// adds and updates: a file deleted or emptied in the bucket keeps its last
// copy in Drive, so the backup survives an accident on the R2 side.
//
//   GET  /api/backup   -> {folder, files, last, upToDate}
//   POST /api/backup   runs a batch now, same answer
//
// Each run lists the bucket and copies the files whose R2 etag differs from
// the one last copied, up to BACKUP_CALLS calls to Google (default 45) so a
// run stays inside the Worker's subrequest limit, which is 50 on Cloudflare's
// free plan (R2 calls don't count toward it). The next run carries on from
// there: while a backup is behind, the every-minute cron runs a batch too
// (backupBehind), and the app's "Back up now" asks for batch after batch.
// Only one batch runs at a time (state.running), so two can't copy the same
// new file twice.
// Folders mirror the bucket's paths under DRIVE_BACKUP, a folder at the top
// of My Drive.
//
// Settings: DRIVE_BACKUP (the Drive folder's name; unset turns backups off),
// and the Google secrets in worker/calendar.js, signed in with the Drive
// scope (`npm run google-auth`). The app only asks for drive.file, so it sees
// nothing in Drive but the files it made itself. State lives in the VAULT
// bucket at .wr1t3r/backup.json, which is the one thing not backed up.
// GOOGLE_DRIVE_API is only for testing.

import { HttpError } from "./util.js";
import { accessToken, calendarConfigured } from "./calendar.js";

const STATE_KEY = ".wr1t3r/backup.json";
const FOLDER = "application/vnd.google-apps.folder";
// Drive's one-request upload takes up to 5 MB; bigger files go up resumably.
const SIMPLE_MAX = 5 * 1024 * 1024;

export function backupConfigured(env) {
	return !!(env.DRIVE_BACKUP && env.VAULT && calendarConfigured(env));
}

async function readState(env) {
	const o = await env.VAULT.get(STATE_KEY);
	const s = o ? await o.json().catch(() => null) : null;
	return { folders: s?.folders || {}, files: s?.files || {}, last: s?.last || null, upToDate: s?.upToDate || null, running: s?.running || null };
}
const writeState = (env, s) => env.VAULT.put(STATE_KEY, JSON.stringify(s), { httpMetadata: { contentType: "application/json" } });

const summary = (env, s) => ({ folder: env.DRIVE_BACKUP, files: Object.keys(s.files).length, last: s.last, upToDate: s.upToDate, busy: !!s.busy });

// A batch that hasn't finished within this long is taken to have died.
const RUN_TIMEOUT = 3 * 60 * 1000;
const DEFAULT_CALLS = 45;

// True when the last batch left files to copy and didn't fail, so the
// every-minute cron should run another.
export async function backupBehind(env) {
	if (!backupConfigured(env)) return false;
	const { last } = await readState(env);
	return !!(last && last.remaining > 0 && !last.error);
}

export async function backupApi(request, env, url) {
	if (url.pathname !== "/api/backup") return null;
	if (!backupConfigured(env)) throw new HttpError(404, "Drive backup isn't set up", { setup: true });
	if (request.method === "GET") return summary(env, await readState(env));
	if (request.method === "POST") return summary(env, await runBackup(env));
	return null;
}

// One batch. Never throws: a failure is kept in state.last.error, along with
// what was copied before it.
// budget: Google calls this batch may make, when it shares its run with
// other work (the every-minute cron also sends reminders).
export async function runBackup(env, now = Date.now(), budget = Number(env.BACKUP_CALLS) || DEFAULT_CALLS) {
	const s = await readState(env);
	if (s.running && now - s.running < RUN_TIMEOUT) return { ...s, busy: true };
	s.running = now;
	await writeState(env, s);
	const ctx = { env, s, calls: 0, budget, token: null };
	let copied = 0, pending = [];
	try {
		const objects = await listAll(ctx);
		const keys = new Set(objects.map((o) => o.key));
		// Records of files gone from the bucket; their Drive copies stay.
		for (const k of Object.keys(s.files)) if (!keys.has(k)) delete s.files[k];
		pending = objects.filter((o) => o.key !== STATE_KEY && !o.key.endsWith("/") && s.files[o.key]?.etag !== o.etag);
		while (pending.length) {
			// Room for the token, the lookup, a resumable upload (two calls), and
			// two calls per folder not made yet.
			if (ctx.calls + 4 + 2 * newFolders(s, pending[0].key) > ctx.budget) break;
			await copyOne(ctx, pending[0]);
			pending.shift();
			copied++;
		}
		s.last = { at: now, copied, remaining: pending.length };
		if (!pending.length) s.upToDate = now;
	} catch (e) {
		const error = String(e?.message || e);
		// Cloudflare's own limit, if the budget is set above it: not a
		// failure, the next batch carries on.
		s.last = /too many subrequests/i.test(error) ? { at: now, copied, remaining: pending.length } : { at: now, copied, remaining: pending.length, error };
	}
	s.running = null;
	await writeState(env, s);
	return s;
}

// How many of a file's folders have no Drive folder yet (each costs a lookup
// and a create).
function newFolders(s, key) {
	const parts = key.split("/").slice(0, -1);
	let n = s.folders[""] ? 0 : 1;
	for (let i = 1; i <= parts.length; i++) if (!s.folders[parts.slice(0, i).join("/")]) n++;
	return n;
}

async function listAll(ctx) {
	const out = [];
	let cursor;
	do {
		const r = await ctx.env.VAULT.list({ cursor, limit: 1000 });
		for (const o of r.objects) out.push({ key: o.key, etag: o.etag, size: o.size });
		cursor = r.truncated ? r.cursor : undefined;
	} while (cursor);
	return out;
}

async function copyOne(ctx, o) {
	const { env, s } = ctx;
	const cut = o.key.lastIndexOf("/");
	const parent = await folderId(ctx, cut < 0 ? "" : o.key.slice(0, cut));
	const name = o.key.slice(cut + 1);
	const obj = await env.VAULT.get(o.key);
	if (!obj) return; // deleted since the listing
	const type = obj.httpMetadata?.contentType || "application/octet-stream";
	const meta = { name };
	if (obj.uploaded instanceof Date) meta.modifiedTime = obj.uploaded.toISOString();
	const bytes = obj.size <= SIMPLE_MAX ? new Uint8Array(await obj.arrayBuffer()) : null;
	let id = s.files[o.key]?.id || (await findChild(ctx, parent, name, false));
	try {
		if (id) await upload(ctx, id, meta, obj, bytes, type);
	} catch (e) {
		if (e.status !== 404) throw e;
		id = null; // its Drive copy was deleted for good: make a new one
	}
	if (!id) id = (await upload(ctx, null, { ...meta, parents: [parent] }, obj, bytes, type)).id;
	s.files[o.key] = { etag: o.etag, id };
}

async function upload(ctx, id, meta, obj, bytes, type) {
	const path = "/upload/drive/v3/files" + (id ? "/" + encodeURIComponent(id) : "");
	const method = id ? "PATCH" : "POST";
	if (bytes) {
		const b = "wr1t3r-" + crypto.randomUUID();
		const body = new Blob([
			`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`,
			bytes,
			`\r\n--${b}--`,
		]);
		return (await google(ctx, path + "?uploadType=multipart&fields=id", { method, headers: { "Content-Type": `multipart/related; boundary=${b}` }, body })).json();
	}
	const start = await google(ctx, path + "?uploadType=resumable&fields=id", {
		method,
		headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(obj.size) },
		body: JSON.stringify(meta),
	});
	return (await google(ctx, start.headers.get("Location"), { method: "PUT", headers: { "Content-Length": String(obj.size) }, body: fixedLength(obj.body, obj.size) })).json();
}

// Workers send a stream with no known length as chunked, which Drive refuses.
function fixedLength(body, size) {
	if (typeof FixedLengthStream !== "function") return body;
	const { readable, writable } = new FixedLengthStream(size);
	body.pipeTo(writable).catch(() => {});
	return readable;
}

// The Drive folder for a bucket folder ("" is the backup folder itself),
// found or made, and remembered.
async function folderId(ctx, dir) {
	const { s } = ctx;
	if (s.folders[dir]) return s.folders[dir];
	const cut = dir.lastIndexOf("/");
	const parent = dir === "" ? "root" : await folderId(ctx, cut < 0 ? "" : dir.slice(0, cut));
	const name = dir === "" ? ctx.env.DRIVE_BACKUP : dir.slice(cut + 1);
	let id = await findChild(ctx, parent, name, true);
	if (!id) {
		const made = await google(ctx, "/drive/v3/files?fields=id", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
		});
		id = (await made.json()).id;
	}
	s.folders[dir] = id;
	return id;
}

async function findChild(ctx, parent, name, folder) {
	const q = `name = '${quote(name)}' and '${quote(parent)}' in parents and trashed = false and mimeType ${folder ? "=" : "!="} '${FOLDER}'`;
	const r = await google(ctx, "/drive/v3/files?" + new URLSearchParams({ q, fields: "files(id)", pageSize: "1", spaces: "drive" }));
	return (await r.json()).files?.[0]?.id || null;
}

const quote = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function google(ctx, path, init = {}) {
	if (!ctx.token) {
		ctx.calls++;
		ctx.token = await accessToken(ctx.env);
	}
	ctx.calls++;
	const url = /^https:/.test(path) ? path : (ctx.env.GOOGLE_DRIVE_API || "https://www.googleapis.com") + path;
	const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${ctx.token}`, ...init.headers } });
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		const err = new Error(`Google Drive: ${data.error?.message || res.status}`);
		err.status = res.status;
		// A folder deleted in Drive: find or make them all again next run.
		if (res.status === 404 && /\/files\?/.test(path)) ctx.s.folders = {};
		throw err;
	}
	return res;
}
