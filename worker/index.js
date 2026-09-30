// wr1t3r: the Worker. Serves the built page from dist/ (static assets) and a
// small file API over the vault. The browser keeps its own copy of every note
// and syncs through this API; see src/sync.js.
//
// Settings (wrangler.toml / Cloudflare dashboard -> this Worker -> Settings):
//   WR1T3R_TOKEN   secret; any long random string, entered once on the page
//   BACKEND        "r2" (default) or "github"
//   VAULT          R2 bucket binding (backend "r2")
//   VAULT_PREFIX   key prefix of the vault inside the bucket or repo, e.g.
//                  "content/"; "" for the whole bucket or repo
//   GITHUB_TOKEN   secret (backend "github"); a fine-grained token with
//                  Contents read/write on GITHUB_REPO only
//   GITHUB_REPO    "owner/name"
//   GITHUB_BRANCH  default "main"
//   EXCLUDE        folders and files wr1t3r must never list, read or write,
//                  comma separated, e.g. "_includes/,content/404.md"; paths
//                  as the page sees them
//
// Routes (all need "Authorization: Bearer <WR1T3R_TOKEN>"). Paths are relative
// to the vault root; every note has a version (R2 etag or git blob sha) that
// writes must name, so nothing is overwritten that the caller hasn't seen.
//   GET    /api/files              -> {"files": [{path, version, size}]}
//   POST   /api/files/read         {paths: [...]} (max 25) ->
//                                  {"files": [{path, version, data (base64)} | {path, missing: true}]}
//   PUT    /api/file?path=         body = the note's bytes; header
//                                  If-Match: <version> to replace, or
//                                  If-None-Match: * to create -> {"version"}
//                                  412 {"error", "version"} if the note has moved on
//   DELETE /api/file?path=         header If-Match: <version> -> 204, 412 as above
//   GET    /api/attachments        -> {"files": [{path, version, size}]} for images,
//                                  PDFs, audio and video
//   GET    /api/attachment?path=   that file's bytes, with its Content-Type
//   PUT    /api/attachment?path=   body = a new picture's bytes (png, jpg, gif, webp,
//                                  avif, bmp; up to 20 MB); header If-None-Match: *
//                                  (pictures are only ever added) -> {"version"},
//                                  412 if the name is taken
//   GET    /api/obsidian           the vault's attachment settings from
//                                  .obsidian/app.json -> {attachmentFolderPath,
//                                  useMarkdownLinks, newLinkFormat} (those set)
//   GET    /api/fetch?url=         a public web page for the clipper -> its body and
//                                  Content-Type, and X-Final-URL after redirects
//   /api/calendar/...              Google Calendar agenda; see worker/calendar.js
//   /api/media/...                 movie, book, music, game, comic and podcast
//                                  lookups for media notes; see worker/media.js

import { r2Backend } from "./r2.js";
import { githubBackend } from "./github.js";
import { proxyFetch } from "./fetch.js";
import { calendarApi } from "./calendar.js";
import { mediaApi } from "./media.js";
import { HttpError, toBase64 } from "./util.js";
import { isNotePath, isAttachmentPath, attachmentType } from "../src/paths.js";

// Matches READ_BATCH in src/sync.js.
const READ_BATCH = 25;
// Pictures pasted or dropped into a note. No SVG: it can carry scripts.
const UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"]);
const MAX_UPLOAD = 20 * 1024 * 1024;

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: "Not found" }, 404);
		if (!(await authorized(request, env))) return json({ error: "Unauthorized" }, 401);
		try {
			if (url.pathname === "/api/fetch" && request.method === "GET") return await proxyFetch(url.searchParams.get("url"), env);
			const cal = await calendarApi(request, env, url);
			if (cal) return json(cal);
			const media = await mediaApi(request, env, url);
			if (media) return json(media);
			return (await api(request, backend(env), url, excluded(env))) || json({ error: "Not found" }, 404);
		} catch (err) {
			if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status);
			return json({ error: String(err?.message || err) }, 500);
		}
	},
};

function backend(env) {
	const prefix = env.VAULT_PREFIX || "";
	if ((env.BACKEND || "r2") === "github") return githubBackend(env, prefix);
	if (!env.VAULT) throw new HttpError(500, "No VAULT bucket bound");
	return r2Backend(env.VAULT, prefix);
}

// Returns a test for paths inside an EXCLUDE folder, or naming an EXCLUDE
// file (an entry with an extension, like "content/404.md"). Matching ignores
// case, since some devices' file systems do too.
function excluded(env) {
	const entries = (env.EXCLUDE || "")
		.split(",")
		.map((f) => f.trim().replace(/^\/+/, "").toLowerCase())
		.filter(Boolean);
	const files = new Set(entries.filter((f) => /\.[a-z0-9]+$/.test(f)));
	const folders = entries.filter((f) => !files.has(f)).map((f) => (f.endsWith("/") ? f : f + "/"));
	return (path) => {
		const p = path.toLowerCase();
		return files.has(p) || folders.some((f) => p.startsWith(f));
	};
}

async function authorized(request, env) {
	if (!env.WR1T3R_TOKEN) return false;
	const given = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
	// Hash both sides so the constant-time compare always sees equal lengths.
	const enc = new TextEncoder();
	const [a, b] = await Promise.all([
		crypto.subtle.digest("SHA-256", enc.encode(given)),
		crypto.subtle.digest("SHA-256", enc.encode(env.WR1T3R_TOKEN.trim())),
	]);
	return crypto.subtle.timingSafeEqual(a, b);
}

async function api(request, store, url, isExcluded) {
	const checkPath = (path) => {
		if (!isNotePath(path) || isExcluded(path)) throw new HttpError(400, "Not a note path: " + String(path).slice(0, 200));
	};
	const m = request.method;
	const p = url.pathname;

	if (p === "/api/files" && m === "GET") {
		const files = (await store.list()).filter((f) => isNotePath(f.path) && !isExcluded(f.path));
		files.sort((a, b) => (a.path < b.path ? -1 : 1));
		return json({ files });
	}

	if (p === "/api/attachments" && m === "GET") {
		const files = (await store.list()).filter((f) => isAttachmentPath(f.path) && !isExcluded(f.path));
		files.sort((a, b) => (a.path < b.path ? -1 : 1));
		return json({ files });
	}

	if (p === "/api/attachment" && m === "PUT") {
		const path = url.searchParams.get("path") || "";
		const type = attachmentType(path);
		if (!isAttachmentPath(path) || isExcluded(path) || !UPLOAD_TYPES.has(type)) throw new HttpError(400, "Not a picture path: " + String(path).slice(0, 200));
		if (request.headers.get("If-None-Match") !== "*") throw new HttpError(428, "Send If-None-Match: *");
		const bytes = new Uint8Array(await request.arrayBuffer());
		if (!bytes.length || bytes.length > MAX_UPLOAD) throw new HttpError(413, "Pictures can be up to 20 MB");
		const r = await store.write(path, bytes, null, type);
		if (!r.ok) throw new HttpError(412, "A file with that name exists", { version: r.version ?? null });
		return json({ version: r.version });
	}

	// Only the settings that say where pasted pictures go and how they're linked.
	if (p === "/api/obsidian" && m === "GET") {
		const f = await store.read(".obsidian/app.json").catch(() => null);
		let app = {};
		try { app = f ? JSON.parse(new TextDecoder().decode(f.bytes)) : {}; } catch {}
		const out = {};
		for (const k of ["attachmentFolderPath", "useMarkdownLinks", "newLinkFormat"]) if (app?.[k] !== undefined) out[k] = app[k];
		return json(out);
	}

	if (p === "/api/attachment" && m === "GET") {
		const path = url.searchParams.get("path") || "";
		if (!isAttachmentPath(path) || isExcluded(path)) throw new HttpError(400, "Not an attachment path: " + String(path).slice(0, 200));
		const f = await store.read(path);
		if (!f) throw new HttpError(404, "No such attachment");
		return new Response(f.bytes, {
			headers: {
				"Content-Type": attachmentType(path),
				ETag: `"${f.version}"`,
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
				// An SVG opened on its own can't run scripts on this origin.
				"Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
			},
		});
	}

	if (p === "/api/files/read" && m === "POST") {
		const body = await request.json().catch(() => null);
		const paths = Array.isArray(body?.paths) ? body.paths : null;
		if (!paths || paths.length > READ_BATCH) throw new HttpError(400, `paths: 1 to ${READ_BATCH} note paths`);
		paths.forEach(checkPath);
		const files = await Promise.all(
			paths.map(async (path) => {
				const f = await store.read(path);
				return f ? { path, version: f.version, data: toBase64(f.bytes) } : { path, missing: true };
			}),
		);
		return json({ files });
	}

	if (p === "/api/file") {
		const path = url.searchParams.get("path") || "";
		checkPath(path);
		const ifMatch = unquote(request.headers.get("If-Match"));
		const create = request.headers.get("If-None-Match") === "*";

		if (m === "PUT") {
			if (!ifMatch && !create) throw new HttpError(428, "Send If-Match: <version> or If-None-Match: *");
			const bytes = new Uint8Array(await request.arrayBuffer());
			const r = await store.write(path, bytes, create ? null : ifMatch);
			if (!r.ok) throw new HttpError(412, "The note changed since you last synced", { version: r.version ?? null });
			return json({ version: r.version });
		}

		if (m === "DELETE") {
			if (!ifMatch) throw new HttpError(428, "Send If-Match: <version>");
			const r = await store.remove(path, ifMatch);
			if (!r.ok) throw new HttpError(412, "The note changed since you last synced", { version: r.version ?? null });
			return new Response(null, { status: 204 });
		}
	}
	return null;
}

function unquote(v) {
	if (!v) return null;
	return v.trim().replace(/^W\//, "").replace(/^"|"$/g, "") || null;
}

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
	});
}
