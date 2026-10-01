// The local folder (src/localvault.js decides; this does it): the folder the
// person picked, read and written with the File System Access API (Chrome
// and Edge on a computer), its handle and the per-file records kept in
// IndexedDB, and the passes that keep it in step with wr1t3r's copy.

import { planNotes, planFiles, contentHash, firstPassSummary, fileConflictPath } from "./localvault.js";
import { attachmentType } from "./paths.js";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
const toBytes = (n) => (n.bytes ? n.bytes : encoder.encode(n.text ?? ""));
const fromBytes = (bytes) => { try { return { text: decoder.decode(bytes) }; } catch { return { bytes }; } };

export const folderSupported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

// ---- the folder itself -------------------------------------------------------

// Every note and attachment file under root: Map path -> { size, mtime, handle }.
// Hidden folders and files (.obsidian, .trash) are skipped.
export async function scanFolder(root, keep) {
	const out = new Map();
	async function walk(dir, prefix) {
		for await (const [name, h] of dir.entries()) {
			if (name.startsWith(".")) continue;
			const path = prefix + name;
			if (h.kind === "directory") await walk(h, path + "/");
			else if (keep(path)) {
				const f = await h.getFile();
				out.set(path, { size: f.size, mtime: f.lastModified, handle: h });
			}
		}
	}
	await walk(root, "");
	return out;
}

async function dirFor(root, path, create) {
	let dir = root;
	const parts = path.split("/");
	for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create });
	return { dir, name: parts.at(-1) };
}

export async function writeFile(root, path, data) {
	const { dir, name } = await dirFor(root, path, true);
	const h = await dir.getFileHandle(name, { create: true });
	const w = await h.createWritable();
	await w.write(data);
	await w.close();
	const f = await h.getFile();
	return { size: f.size, mtime: f.lastModified };
}

export async function readFile(handle) {
	return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

export async function removeFile(root, path) {
	try {
		const { dir, name } = await dirFor(root, path, false);
		await dir.removeEntry(name);
	} catch (e) {
		if (e?.name !== "NotFoundError") throw e;
	}
}

// ---- a pass ------------------------------------------------------------------

// One pass. host: {
//   root, records: { notes: Map, files: Map } (changed in place),
//   notes() -> Map path -> { text | bytes } (deleted left out),
//   putNote(path, { text | bytes }) -> Promise, deleteNote(path) -> Promise,
//   conflictPath(path) -> a free "(conflict DATE)" path,
//   attachments() -> [{ path, version, size }], or null while the list isn't
//     loaded (pictures are left alone then), fetchAttachment(file) -> Promise<Blob>,
//   uploadPicture(path, blob) -> Promise<version | null>,
//   confirmFirst(summary) -> Promise<boolean>, confirmDeletes(paths) -> Promise<boolean>,
//   isNote(path), isFile(path)
// } -> { changed, errors: [path], declined }
export async function runPass(host) {
	const { root, records } = host;
	const folder = await scanFolder(root, (p) => host.isNote(p) || host.isFile(p));
	const folderNotes = new Map([...folder].filter(([p]) => host.isNote(p)));
	const folderFiles = new Map([...folder].filter(([p]) => host.isFile(p)));
	const app = host.notes();
	const actions = planNotes(app, folderNotes, records.notes);
	const errors = [];
	let changed = 0;

	// A folder that already has notes, met for the first time: read the ones
	// both sides have, sum it up, and ask before anything is written.
	const compares = new Map();
	for (const a of actions.filter((x) => x.type === "compare")) {
		const bytes = await readFile(folderNotes.get(a.path).handle);
		const mine = toBytes(app.get(a.path));
		compares.set(a.path, bytes.length === mine.length && bytes.every((b, i) => b === mine[i]));
	}
	if (!records.notes.size && folderNotes.size) {
		if (!(await host.confirmFirst(firstPassSummary(actions, compares)))) return { changed: 0, errors, declined: true };
	}

	const record = (path, stat, note) => records.notes.set(path, { size: stat.size, mtime: stat.mtime, hash: contentHash(note) });
	const write = async (path, note) => record(path, await writeFile(root, path, toBytes(note)), note);
	const read = async (path) => fromBytes(await readFile(folderNotes.get(path).handle));
	const asks = [];
	for (const a of actions) {
		try {
			const f = folderNotes.get(a.path);
			switch (a.type) {
			case "write": await write(a.path, app.get(a.path)); changed++; break;
			case "read": case "create": case "restore": {
				const n = await read(a.path);
				await host.putNote(a.path, n);
				record(a.path, f, n);
				changed++;
				break;
			}
			case "compare": case "conflict": {
				if (compares.get(a.path)) { record(a.path, f, app.get(a.path)); break; }
				// Both changed: the folder's version comes in as a conflict copy,
				// and the file takes wr1t3r's.
				const theirs = await read(a.path);
				const copy = host.conflictPath(a.path);
				await host.putNote(copy, theirs);
				await write(copy, theirs);
				await write(a.path, app.get(a.path));
				changed += 2;
				break;
			}
			case "remove-file": await removeFile(root, a.path); records.notes.delete(a.path); changed++; break;
			case "forget": records.notes.delete(a.path); break;
			case "ask-delete": asks.push(a.path); break;
			}
		} catch {
			errors.push(a.path);
		}
	}
	if (asks.length) {
		if (await host.confirmDeletes(asks)) {
			for (const p of asks) { await host.deleteNote(p); records.notes.delete(p); changed++; }
		} else {
			for (const p of asks) { try { await write(p, app.get(p)); changed++; } catch { errors.push(p); } }
		}
	}

	// Attachments. Not before the vault's list is known: an empty list would
	// read as every picture gone from the vault.
	const vaultFiles = host.attachments();
	if (!vaultFiles) return { changed, errors, declined: false };
	for (const a of planFiles(vaultFiles, folderFiles, records.files)) {
		try {
			const f = folderFiles.get(a.path), v = vaultFiles.find((x) => x.path === a.path);
			switch (a.type) {
			case "download": {
				const stat = await writeFile(root, a.path, await host.fetchAttachment(v));
				records.files.set(a.path, { ...stat, version: v.version });
				changed++;
				break;
			}
			case "keep-both": {
				const copy = fileConflictPath(a.path, (p) => folder.has(p) || vaultFiles.some((x) => x.path === p));
				await writeFile(root, copy, await readFile(f.handle));
				folder.set(copy, true);
				const stat = await writeFile(root, a.path, await host.fetchAttachment(v));
				records.files.set(a.path, { ...stat, version: v.version });
				changed += 2;
				break;
			}
			case "record": records.files.set(a.path, { size: f.size, mtime: f.mtime, version: v.version }); break;
			case "upload": {
				const blob = new Blob([await readFile(f.handle)], { type: attachmentType(a.path) || "application/octet-stream" });
				const version = await host.uploadPicture(a.path, blob);
				if (version) { records.files.set(a.path, { size: f.size, mtime: f.mtime, version }); changed++; }
				break;
			}
			case "remove-file": await removeFile(root, a.path); records.files.delete(a.path); changed++; break;
			case "forget": records.files.delete(a.path); break;
			}
		} catch {
			errors.push(a.path);
		}
	}
	return { changed, errors, declined: false };
}
