// Google Drive as the place notes live (a prototype): one of the storage
// kinds in src/storage.js, signed in through src/google.js.
//
// wr1t3r asks only for drive.file, which Google grants without a security
// audit: the app sees the files it made itself (notes written here, and
// anything put in through wr1t3r's Upload) and nothing else in the person's
// Drive. A file dropped into the folder from Drive's own website or desktop
// app stays invisible to wr1t3r.
//
// The notebook is a folder called "wr1t3r" at the top of My Drive, found by
// the appProperties wr1t3r puts on it. Drive is organized by ids, not paths,
// so each listing rebuilds path -> {id, version} from the parent folders.
// Drive has no "only if unchanged" write, so a write checks the file's
// version first; two devices saving in the same second could still collide.
// Deleting moves the file to Drive's trash.

import { isNotePath, isAttachmentPath, attachmentType } from "./paths.js";

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const ROOT_KEY = "wr1t3r-drive-root";
const FIELDS = "id,name,parents,mimeType,version,size,trashed";

// call(url, init) from src/google.js googleClient; init.raw returns the Response.
export function driveStorage({ call, store = globalThis.localStorage }) {
	let index = null; // path -> {id, version, size, folder}
	const folders = new Map(); // folder path ("" is the notebook) -> id

	async function root() {
		let id = store?.getItem(ROOT_KEY);
		if (id) {
			const f = await call(`${API}/files/${id}?fields=id,trashed`).catch(() => null);
			if (f && !f.trashed) return id;
		}
		const found = await call(`${API}/files?` + new URLSearchParams({ q: `appProperties has { key='wr1t3r' and value='notebook' } and trashed=false`, fields: "files(id)", spaces: "drive" }));
		id = found.files?.[0]?.id;
		if (!id) id = (await call(`${API}/files?fields=id`, { method: "POST", body: JSON.stringify({ name: "wr1t3r", mimeType: FOLDER, appProperties: { wr1t3r: "notebook" } }) })).id;
		try { store?.setItem(ROOT_KEY, id); } catch {}
		return id;
	}

	// Every file wr1t3r can see under the notebook folder, by path.
	async function scan() {
		const top = await root();
		const all = [];
		let page = "";
		do {
			const r = await call(`${API}/files?` + new URLSearchParams({ q: "trashed=false", fields: `nextPageToken,files(${FIELDS})`, pageSize: "1000", spaces: "drive", ...(page ? { pageToken: page } : {}) }));
			all.push(...(r.files || []));
			page = r.nextPageToken || "";
		} while (page);
		const byId = new Map(all.map((f) => [f.id, f]));
		const pathOf = (f, seen = 0) => {
			const parent = f.parents?.[0];
			if (parent === top) return f.name;
			const p = byId.get(parent);
			if (!p || seen > 50) return null; // outside the notebook
			const up = pathOf(p, seen + 1);
			return up == null ? null : up + "/" + f.name;
		};
		index = new Map();
		folders.clear();
		folders.set("", top);
		for (const f of all) {
			const path = pathOf(f);
			if (path == null) continue;
			if (f.mimeType === FOLDER) folders.set(path, f.id);
			else index.set(path, { id: f.id, version: String(f.version), size: Number(f.size || 0) });
		}
		return index;
	}
	const known = async () => index || scan();

	async function current(path) {
		const at = (await known()).get(path);
		if (!at) return null;
		const f = await call(`${API}/files/${at.id}?fields=${FIELDS}`).catch((e) => (/not found/i.test(e.message) ? null : Promise.reject(e)));
		if (!f || f.trashed) { index.delete(path); return null; }
		at.version = String(f.version);
		return at;
	}

	// The folder for a path, making any that are missing.
	async function folderFor(path) {
		await known();
		const parts = path.split("/").slice(0, -1);
		let here = "";
		for (const name of parts) {
			const next = here ? here + "/" + name : name;
			if (!folders.has(next)) {
				const made = await call(`${API}/files?fields=id`, { method: "POST", body: JSON.stringify({ name, mimeType: FOLDER, parents: [folders.get(here)] }) });
				folders.set(next, made.id);
			}
			here = next;
		}
		return folders.get(here);
	}

	function multipart(meta, blob) {
		const b = "wr1t3r" + Math.random().toString(36).slice(2);
		return {
			headers: { "Content-Type": `multipart/related; boundary=${b}` },
			body: new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`, blob, `\r\n--${b}--`]),
		};
	}

	async function create(path, blob) {
		const parent = await folderFor(path);
		const made = await call(`${UPLOAD}/files?uploadType=multipart&fields=id,version,size`, { method: "POST", ...multipart({ name: path.split("/").pop(), parents: [parent] }, blob) });
		const at = { id: made.id, version: String(made.version), size: Number(made.size || blob.size) };
		index.set(path, at);
		return at;
	}

	async function download(path) {
		const at = await current(path);
		if (!at) return null;
		const res = await call(`${API}/files/${at.id}?alt=media`, { raw: true });
		return { version: at.version, bytes: new Uint8Array(await res.arrayBuffer()) };
	}

	const blobOf = (path, bytes) => new Blob([bytes], { type: isNotePath(path) ? "text/markdown" : attachmentType(path) });

	return {
		async check() {
			await call(`${API}/about?fields=user`);
			await root();
		},
		async list() {
			return [...(await scan())].filter(([p]) => isNotePath(p)).map(([path, f]) => ({ path, version: f.version, size: f.size })).sort((a, b) => (a.path < b.path ? -1 : 1));
		},
		async attachments() {
			return [...(await known())].filter(([p]) => isAttachmentPath(p)).map(([path, f]) => ({ path, version: f.version, size: f.size })).sort((a, b) => (a.path < b.path ? -1 : 1));
		},
		async read(paths) {
			await known();
			const out = new Array(paths.length);
			let i = 0;
			const next = async () => {
				while (i < paths.length) {
					const k = i++, path = paths[k];
					const f = isNotePath(path) && (await download(path));
					out[k] = f ? { path, version: f.version, bytes: f.bytes } : { path, missing: true };
				}
			};
			await Promise.all(Array.from({ length: Math.min(6, paths.length) }, next));
			return out;
		},
		async write(path, bytes, expected) {
			if (!isNotePath(path)) throw new Error("Not a note path: " + path);
			const cur = await current(path);
			if (!expected) {
				if (cur) return { ok: false, version: cur.version };
				return { ok: true, version: (await create(path, blobOf(path, bytes))).version };
			}
			if (!cur || cur.version !== expected) return { ok: false, version: cur?.version ?? null };
			const r = await call(`${UPLOAD}/files/${cur.id}?uploadType=media&fields=version,size`, { method: "PATCH", headers: { "Content-Type": "text/markdown" }, body: blobOf(path, bytes) });
			cur.version = String(r.version);
			cur.size = Number(r.size || bytes.length);
			return { ok: true, version: cur.version };
		},
		async remove(path, expected) {
			const cur = await current(path);
			if (!cur) return { ok: true };
			if (cur.version !== expected) return { ok: false, version: cur.version };
			await call(`${API}/files/${cur.id}?fields=id`, { method: "PATCH", body: JSON.stringify({ trashed: true }) });
			index.delete(path);
			return { ok: true };
		},
		async attachment(path) {
			const f = isAttachmentPath(path) && (await download(path));
			if (!f) throw new Error("No such attachment");
			return new Blob([f.bytes], { type: attachmentType(path) });
		},
		async uploadAttachment(path, blob) {
			if (!isAttachmentPath(path)) throw new Error("Not an attachment path: " + path);
			if (await current(path)) return false;
			const at = await create(path, blob.type ? blob : new Blob([blob], { type: attachmentType(path) }));
			return { path, version: at.version, size: at.size };
		},
	};
}
