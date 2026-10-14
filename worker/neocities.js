// Publish to Neocities, passed through. Neocities' API doesn't answer web
// pages (no CORS), so the page sends its calls here and they go on to
// neocities.org unchanged:
//
//   GET  /api/neocities/info   -> the site's name and domain
//   GET  /api/neocities/list   -> every file with its SHA-1
//   POST /api/neocities/upload multipart: one part per file, named by its path
//   POST /api/neocities/delete form: filenames[]=...
//
// The person's Neocities API key comes in the X-Neocities-Key header (the
// self-hosted Worker's own Authorization header is its token) and goes on as
// Neocities' Bearer key. Nothing is kept or logged: the key, the files and
// Neocities' answer only pass through. Only these four calls, only to
// neocities.org, so it can't be used to reach anything else.

import { HttpError } from "./util.js";

const API = "https://neocities.org/api/";
const CALLS = { info: "GET", list: "GET", upload: "POST", delete: "POST" };

export async function neocitiesApi(request, env, url, fetchFn = fetch) {
	const m = /^\/api\/neocities\/(\w+)$/.exec(url.pathname);
	if (!m) return null;
	const call = m[1];
	if (!CALLS[call]) throw new HttpError(404, "Not found");
	if (request.method !== CALLS[call]) throw new HttpError(405, `${CALLS[call]} only`);
	const key = (request.headers.get("X-Neocities-Key") || "").trim();
	if (!key) throw new HttpError(400, "No Neocities API key");
	const headers = { Authorization: `Bearer ${key}`, "User-Agent": "wr1t3r (+https://wr1t3r.app)" };
	const type = request.headers.get("Content-Type");
	if (type && CALLS[call] === "POST") headers["Content-Type"] = type;
	const res = await fetchFn(API + call, { method: CALLS[call], headers, body: CALLS[call] === "POST" ? request.body : undefined });
	// Neocities answers JSON, errors included ({ result: "error", error_type, message }).
	const text = await res.text();
	let data;
	try { data = JSON.parse(text); } catch { data = { result: "error", message: `Neocities said ${res.status}` }; }
	return new Response(JSON.stringify(data), { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
