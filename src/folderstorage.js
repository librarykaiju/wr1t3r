// "My Computer": the notebook kept in a folder on this computer, as plain
// files, with no cloud in between. Chrome and Edge on a computer let a page
// read and write a folder the person picks (the File System Access API); the
// folder's handle is kept in IndexedDB so the next visit finds it again.
//
// A file's version is its modified time and size: both change whenever the
// file is saved, here or by another app.
//
// This is a storage kind (src/storage.js). The Settings "Local folder" option
// (src/localvault.js) is something else: a copy of a notebook kept elsewhere.

import { isNotePath, isAttachmentPath, attachmentType } from "./paths.js";
import { scanFolder, writeFile, removeFile, folderSupported } from "./localvaultview.js";
import { AuthError } from "./api.js";

export { folderSupported };
export const FOLDER_KEY = "notebookFolder";

const versionOf = (f) => `${f.mtime}:${f.size}`;

// The browser's answer for this folder: "granted", "prompt" or "denied".
export async function folderPermission(handle, ask = false) {
	try {
		const opts = { mode: "readwrite" };
		const state = await handle.queryPermission(opts);
		if (state === "granted" || !ask) return state;
		return await handle.requestPermission(opts);
	} catch {
		return "denied";
	}
}

// root() -> Promise<FileSystemDirectoryHandle | null>
export function folderStorage({ root }) {
	async function dir() {
		const h = await root();
		// The folder was forgotten (site data cleared): back to the start page.
		if (!h) throw new AuthError("wr1t3r lost track of your folder");
		if ((await folderPermission(h)) !== "granted") throw new Error("wr1t3r needs your OK to use the folder again. Reload the page and press Open.");
		return h;
	}

	// The file at path, or null. Missing folders on the way mean no file.
	async function fileAt(h, path) {
		const parts = path.split("/");
		try {
			let d = h;
			for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
			const fh = await d.getFileHandle(parts.at(-1));
			const f = await fh.getFile();
			return { file: f, size: f.size, mtime: f.lastModified };
		} catch (e) {
			if (e?.name === "NotFoundError" || e?.name === "TypeMismatchError") return null;
			throw e;
		}
	}

	const listOf = async (keep) =>
		[...(await scanFolder(await dir(), keep))]
			.map(([path, f]) => ({ path, version: versionOf(f), size: f.size }))
			.sort((a, b) => (a.path < b.path ? -1 : 1));

	return {
		async check() { await dir(); },
		list: () => listOf(isNotePath),
		attachments: () => listOf(isAttachmentPath),
		async read(paths) {
			const h = await dir();
			const out = [];
			for (const path of paths) {
				const f = isNotePath(path) && (await fileAt(h, path));
				out.push(f ? { path, version: versionOf(f), bytes: new Uint8Array(await f.file.arrayBuffer()) } : { path, missing: true });
			}
			return out;
		},
		async write(path, bytes, expected) {
			if (!isNotePath(path)) throw new Error("Not a note path: " + path);
			const h = await dir();
			const cur = await fileAt(h, path);
			const now = cur ? versionOf(cur) : null;
			if (now !== (expected ?? null)) return { ok: false, version: now };
			return { ok: true, version: versionOf(await writeFile(h, path, bytes)) };
		},
		async remove(path, expected) {
			const h = await dir();
			const cur = await fileAt(h, path);
			if (!cur) return { ok: true };
			if (versionOf(cur) !== expected) return { ok: false, version: versionOf(cur) };
			await removeFile(h, path);
			return { ok: true };
		},
		async attachment(path) {
			const f = isAttachmentPath(path) && (await fileAt(await dir(), path));
			if (!f) throw new Error("No such attachment");
			return new Blob([await f.file.arrayBuffer()], { type: attachmentType(path) });
		},
		async uploadAttachment(path, blob) {
			if (!isAttachmentPath(path)) throw new Error("Not an attachment path: " + path);
			const h = await dir();
			if (await fileAt(h, path)) return false;
			const bytes = new Uint8Array(await blob.arrayBuffer());
			return { path, version: versionOf(await writeFile(h, path, bytes)), size: bytes.length };
		},
	};
}
