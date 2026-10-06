// Where the notebook's files live. The page keeps its own copy in IndexedDB
// (src/store.js) and src/sync.js keeps it in step with one of these. Today
// that's always the Worker; other kinds (a cloud drive, this browser only)
// plug in here without the rest of the page changing.
//
// Every kind has the same methods. A version is any string that changes
// whenever the file does (an R2 etag, a Dropbox rev...).
//
//   check()                     -> resolves if storage is reachable and signed in
//   list()                      -> [{path, version, size}] for every note, by path
//   read(paths)                 -> [{path, version, bytes} | {path, missing: true}]
//   write(path, bytes, expected)-> {ok: true, version} | {ok: false, version|null}
//                                  expected = the version last seen; null creates
//                                  the file and fails if it exists
//   remove(path, expected)      -> {ok: true} | {ok: false, version}; already gone is ok
//   attachments()               -> [{path, version, size}] for pictures, PDFs, audio, video
//   attachment(path)            -> Blob
//   uploadAttachment(path, blob)-> {path, version, size}, or false if the name is taken
//
// "Notes" and "attachments" are the paths src/paths.js says they are.

import { isNotePath, isAttachmentPath, attachmentType } from "./paths.js";
import { workerStorage } from "./api.js";

export const STORAGE_METHODS = ["check", "list", "read", "write", "remove", "attachments", "attachment", "uploadAttachment"];

const KEY = "wr1t3r-storage";
const kinds = new Map([["worker", () => workerStorage()]]);

// Another kind of storage; make() returns an object with STORAGE_METHODS.
export function registerStorage(name, make) {
	kinds.set(name, make);
}

// The kind this device uses. Anything unknown falls back to the Worker.
export function storageKind() {
	let k = "";
	try { k = localStorage.getItem(KEY) || ""; } catch {}
	return kinds.has(k) ? k : "worker";
}
export function setStorageKind(name) {
	try { name && name !== "worker" ? localStorage.setItem(KEY, name) : localStorage.removeItem(KEY); } catch {}
}

export function openStorage(name = storageKind()) {
	return checkStorage((kinds.get(name) || kinds.get("worker"))(), name);
}

// Fails loudly if a kind is missing a method, rather than at the first sync.
export function checkStorage(s, name = "storage") {
	const missing = STORAGE_METHODS.filter((m) => typeof s?.[m] !== "function");
	if (missing.length) throw new Error(`${name} is missing ${missing.join(", ")}`);
	return s;
}

// Storage held in memory: the reference for what the methods promise, and a
// stand-in for tests. files: {path: string | Uint8Array}.
export function memoryStorage(files = {}) {
	let n = 0;
	const enc = new TextEncoder();
	const m = new Map();
	const put = (path, bytes) => {
		const f = { bytes: new Uint8Array(bytes), version: "m" + ++n };
		m.set(path, f);
		return f;
	};
	for (const [p, v] of Object.entries(files)) put(p, typeof v === "string" ? enc.encode(v) : v);
	const listOf = (keep) =>
		[...m]
			.filter(([p]) => keep(p))
			.map(([path, f]) => ({ path, version: f.version, size: f.bytes.length }))
			.sort((a, b) => (a.path < b.path ? -1 : 1));
	return {
		map: m,
		async check() {},
		async list() { return listOf(isNotePath); },
		async read(paths) {
			return paths.map((path) => {
				const f = isNotePath(path) && m.get(path);
				return f ? { path, version: f.version, bytes: f.bytes } : { path, missing: true };
			});
		},
		async write(path, bytes, expected) {
			if (!isNotePath(path)) throw new Error("Not a note path: " + path);
			const cur = m.get(path);
			if (expected ? cur?.version !== expected : cur) return { ok: false, version: cur?.version ?? null };
			return { ok: true, version: put(path, bytes).version };
		},
		async remove(path, expected) {
			const cur = m.get(path);
			if (!cur) return { ok: true };
			if (cur.version !== expected) return { ok: false, version: cur.version };
			m.delete(path);
			return { ok: true };
		},
		async attachments() { return listOf(isAttachmentPath); },
		async attachment(path) {
			const f = isAttachmentPath(path) && m.get(path);
			if (!f) throw new Error("No such attachment");
			return new Blob([f.bytes], { type: attachmentType(path) });
		},
		async uploadAttachment(path, blob) {
			if (!isAttachmentPath(path)) throw new Error("Not an attachment path: " + path);
			if (m.has(path)) return false;
			const f = put(path, new Uint8Array(await blob.arrayBuffer()));
			return { path, version: f.version, size: f.bytes.length };
		},
	};
}
