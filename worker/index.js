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
//   EXCLUDE        folders wr1t3r must never list, read or write, comma
//                  separated, e.g. "_includes/"; paths as the page sees them
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

import { r2Backend } from "./r2.js";
import { githubBackend } from "./github.js";
import { HttpError, toBase64 } from "./util.js";
import { isNotePath } from "../src/paths.js";

// Matches READ_BATCH in src/sync.js.
const READ_BATCH = 25;

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: "Not found" }, 404);
		if (!(await authorized(request, env))) return json({ error: "Unauthorized" }, 401);
		try {
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

// Returns a test for paths inside an EXCLUDE folder. Matching ignores case,
// since some devices' file systems do too.
function excluded(env) {
	const folders = (env.EXCLUDE || "")
		.split(",")
		.map((f) => f.trim().replace(/^\/+/, "").toLowerCase())
		.filter(Boolean)
		.map((f) => (f.endsWith("/") ? f : f + "/"));
	return (path) => folders.some((f) => path.toLowerCase().startsWith(f));
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
