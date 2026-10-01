// The local folder: a real folder of the vault's files on this computer
// (Chrome and Edge let a page read and write a folder the person picks),
// kept in step with wr1t3r's own copy both ways. src/localvaultview.js does
// the reading and writing; this file decides what to do.
//
// Each file the folder and wr1t3r last agreed on has a record: the file's
// size and modified time then, and a hash of the note's text. A pass compares
// both sides with their records:
//
//   changed in wr1t3r only           -> write the file
//   changed in the folder only       -> read it into wr1t3r (and so the cloud)
//   changed on both                  -> keep both: the folder's version comes
//                                       in as "Name (conflict DATE).md"
//   new file in the folder           -> a new note
//   deleted in wr1t3r, file unchanged -> remove the file
//   deleted in wr1t3r, file edited   -> the edit wins: the note comes back
//   gone from the folder             -> asked about before the vault loses it
//                                       (if wr1t3r edited it since, it's
//                                       written back instead)
//
// Pictures and other attachments come down as they change in the vault; a
// new picture put in the folder goes up (the vault only takes new pictures).

import { isNotePath, isAttachmentPath } from "./paths.js";

// FNV-1a over the note's text or bytes: enough to tell whether it changed.
export function contentHash(note) {
	let h = 0x811c9dc5;
	if (note.bytes) for (const b of note.bytes) { h ^= b; h = Math.imul(h, 0x01000193); }
	else { const s = note.text ?? ""; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } }
	return (h >>> 0).toString(36) + ":" + (note.bytes ? note.bytes.length : (note.text ?? "").length);
}

// What a pass does with the notes.
//   app:     Map path -> { text | bytes } (wr1t3r's notes; deleted ones left out)
//   folder:  Map path -> { size, mtime } (the folder's note files)
//   records: Map path -> { size, mtime, hash }
// -> [{ type, path }], type one of: write, read, conflict, create, remove-file,
//    restore, ask-delete, record (same on both sides, nothing to copy), forget.
export function planNotes(app, folder, records) {
	const out = [];
	const paths = new Set([...app.keys(), ...folder.keys(), ...records.keys()]);
	for (const path of [...paths].sort()) {
		if (!isNotePath(path)) continue;
		const a = app.get(path), f = folder.get(path), r = records.get(path);
		const fileChanged = f && (!r || r.size !== f.size || r.mtime !== f.mtime);
		const noteChanged = a && (!r || r.hash !== contentHash(a));
		if (a && f) {
			if (!r) out.push({ type: "compare", path }); // first meeting: same text or not is only known by reading
			else if (fileChanged && noteChanged) out.push({ type: "conflict", path });
			else if (fileChanged) out.push({ type: "read", path });
			else if (noteChanged) out.push({ type: "write", path });
		} else if (a) {
			if (!r) out.push({ type: "write", path });
			else if (noteChanged) out.push({ type: "write", path }); // the folder lost it, but wr1t3r edited it since: the edit wins
			else out.push({ type: "ask-delete", path });
		} else if (f) {
			if (!r) out.push({ type: "create", path });
			else if (fileChanged) out.push({ type: "restore", path }); // deleted in the vault, edited here: the edit wins
			else out.push({ type: "remove-file", path });
		} else if (r) out.push({ type: "forget", path });
	}
	return out;
}

// What a pass does with attachments.
//   app:     [{ path, version, size }] (the vault's attachments)
//   folder:  Map path -> { size, mtime } (the folder's attachment files)
//   records: Map path -> { size, mtime, version }
// -> [{ type, path }]: download, upload, keep-both, record, remove-file, forget.
export const UPLOADABLE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
export const MAX_UPLOAD = 20 * 1024 * 1024;
export function planFiles(app, folder, records) {
	const out = [];
	const vault = new Map(app.map((f) => [f.path, f]));
	const paths = new Set([...vault.keys(), ...folder.keys(), ...records.keys()]);
	for (const path of [...paths].sort()) {
		if (!isAttachmentPath(path)) continue;
		const v = vault.get(path), f = folder.get(path), r = records.get(path);
		const fileChanged = f && (!r || r.size !== f.size || r.mtime !== f.mtime);
		if (v) {
			// Down when the folder doesn't have this version, unless the file
			// there was changed by hand (that's left alone).
			if (!f || (r && r.version !== v.version && !fileChanged)) out.push({ type: "download", path });
			// First meeting, different files: the folder's is set aside as a
			// conflict copy (a new picture, so it goes up) and the vault's comes down.
			else if (!r) out.push({ type: f.size === v.size ? "record" : "keep-both", path });
		} else if (f) {
			if (!r && UPLOADABLE.test(path) && f.size <= MAX_UPLOAD) out.push({ type: "upload", path });
			else if (r && !fileChanged) out.push({ type: "remove-file", path }); // gone from the vault
		} else if (r) out.push({ type: "forget", path });
	}
	return out;
}

// "photo (conflict 2026-10-01).png": a free name for the folder's copy of an
// attachment both sides have different versions of.
export function fileConflictPath(path, taken, date = new Date()) {
	const day = date.toISOString().slice(0, 10);
	const m = path.match(/^(.*?)(\.[^./]+)?$/);
	for (let n = 1; ; n++) {
		const candidate = `${m[1]} (conflict ${day}${n > 1 ? " " + n : ""})${m[2] || ""}`;
		if (!taken(candidate)) return candidate;
	}
}

// A summary of a first pass into a folder that already has files, to show
// before anything is written: { same, folderOnly, vaultOnly, differ }.
// compareResults: Map path -> true (same text) / false, for "compare" actions.
export function firstPassSummary(actions, compareResults) {
	const s = { same: 0, differ: 0, folderOnly: 0, vaultOnly: 0 };
	for (const a of actions) {
		if (a.type === "compare") compareResults.get(a.path) ? s.same++ : s.differ++;
		else if (a.type === "create") s.folderOnly++;
		else if (a.type === "write") s.vaultOnly++;
	}
	return s;
}
