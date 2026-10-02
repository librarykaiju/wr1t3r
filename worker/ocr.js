// Searchable pictures and PDFs: Claude reads the text in a picture or a
// scanned PDF (or says what a picture shows when it has no text), and the
// page's search looks through it.
//
//   GET  /api/ocr          -> {"files": {path: {version, text}}} everything read so far
//   POST /api/ocr?path=    reads that attachment (unless this version was read
//                          already) -> {path, version, text}
//
// Secret: ANTHROPIC_API_KEY (the same one media notes use). The texts live in
// the VAULT bucket at .wr1t3r/ocr.json, outside any note path.

import { HttpError } from "./util.js";
import { attachmentType } from "../src/paths.js";

const INDEX_KEY = ".wr1t3r/ocr.json";
const MODEL = "claude-haiku-4-5-20251001";
const MAX_TEXT = 20000;
// Claude's limits: 5 MB for a picture, 32 MB for a PDF.
const LIMITS = { "image/jpeg": 5e6, "image/png": 5e6, "image/gif": 5e6, "image/webp": 5e6, "application/pdf": 32e6 };
const PROMPT = "Transcribe all the text in this file exactly as written, in reading order, as plain text with no commentary. If it has no text, answer with one short sentence starting with \"Picture:\" that says what it shows.";

async function readIndex(env) {
	const o = await env.VAULT.get(INDEX_KEY);
	return (o && (await o.json().catch(() => null))) || {};
}

function base64(bytes) {
	let s = "";
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

export async function ocrApi(request, env, url, storeOf, isExcluded) {
	if (url.pathname !== "/api/ocr") return null;
	if (!env.VAULT) throw new HttpError(501, "Reading pictures needs the VAULT bucket");
	if (request.method === "GET") return { files: await readIndex(env) };
	if (request.method !== "POST") throw new HttpError(405, "GET or POST");
	if (!env.ANTHROPIC_API_KEY) throw new HttpError(501, "Reading pictures needs the ANTHROPIC_API_KEY secret on the Worker", { setup: true });
	const path = url.searchParams.get("path") || "";
	const type = attachmentType(path);
	if (!LIMITS[type] || isExcluded(path)) throw new HttpError(400, "Not a picture or PDF: " + path.slice(0, 200));
	const f = await storeOf().read(path);
	if (!f) throw new HttpError(404, "No such file");
	const index = await readIndex(env);
	if (index[path]?.version === f.version) return { path, ...index[path] };
	let text = "";
	if (f.bytes.length <= LIMITS[type]) {
		const source = { type: "base64", media_type: type, data: base64(new Uint8Array(f.bytes)) };
		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
			body: JSON.stringify({
				model: MODEL,
				max_tokens: 4096,
				messages: [{ role: "user", content: [{ type: type === "application/pdf" ? "document" : "image", source }, { type: "text", text: PROMPT }] }],
			}),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => null);
			throw new HttpError(502, "Claude couldn't read it: " + (err?.error?.message || res.status));
		}
		const data = await res.json();
		text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim().slice(0, MAX_TEXT);
	}
	// Too big to send: remembered with no text, so it isn't tried again.
	const fresh = await readIndex(env);
	fresh[path] = { version: f.version, text };
	await env.VAULT.put(INDEX_KEY, JSON.stringify(fresh), { httpMetadata: { contentType: "application/json" } });
	return { path, version: f.version, text };
}
