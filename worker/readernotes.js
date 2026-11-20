// Highlights and bookmarks from Reader (librarykaiju/reader), for the page's
// Pull notes from Reader. The Worker asks Reader's GET /api/export itself,
// with a read-only token Reader takes for that one route (its NOTES_TOKEN),
// so the token never reaches the browser and Reader needs no CORS. Like every
// /api/ route here, it only answers someone holding WR1T3R_TOKEN.
//
// Settings:
//   READER_NOTES_TOKEN  secret; the same string as Reader's NOTES_TOKEN
//   READER_URL          optional; Reader's address, default https://reader.brandonj.ink
//
//   GET /api/reader/notes  -> {"reader": <Reader's address>, "books": [...]} as
//                             Reader's /api/export has them

import { HttpError } from "./util.js";

const DEFAULT_READER = "https://reader.brandonj.ink";
const TIMEOUT_MS = 20000;

export function readerBase(env) {
	const raw = String(env.READER_URL || DEFAULT_READER).trim().replace(/\/+$/, "");
	let u;
	try { u = new URL(raw); } catch { throw new HttpError(500, "READER_URL isn't an address"); }
	if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) throw new HttpError(500, "READER_URL must start with https://");
	return u.origin + u.pathname.replace(/\/+$/, "");
}

export async function readerNotesApi(request, env, url, fetchFn = fetch) {
	if (url.pathname !== "/api/reader/notes") return null;
	if (request.method !== "GET") throw new HttpError(405, "Only GET");
	const token = String(env.READER_NOTES_TOKEN || "").trim();
	if (!token) throw new HttpError(501, "Pulling from Reader isn't set up: this Worker needs a READER_NOTES_TOKEN secret, the same string as Reader's NOTES_TOKEN.");
	const base = readerBase(env);
	let res;
	try {
		res = await fetchFn(base + "/api/export", {
			headers: { Authorization: "Bearer " + token, Accept: "application/json" },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (e) {
		throw new HttpError(502, `Couldn't reach Reader at ${base} (${e?.name === "TimeoutError" ? "it took too long" : e?.message || e}).`);
	}
	if (res.status === 401) {
		await res.body?.cancel();
		throw new HttpError(502, "Reader turned the token down. Reader's NOTES_TOKEN and this Worker's READER_NOTES_TOKEN must be the same string (and Reader needs the version that takes it).");
	}
	if (!res.ok) {
		await res.body?.cancel();
		throw new HttpError(502, `Reader answered ${res.status}.`);
	}
	let data;
	try { data = await res.json(); } catch { throw new HttpError(502, "Reader's answer wasn't JSON. Is READER_URL Reader's address?"); }
	if (!Array.isArray(data?.books)) throw new HttpError(502, "Reader's answer had no books in it.");
	return { reader: base, books: data.books };
}
