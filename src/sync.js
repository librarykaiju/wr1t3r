// Offline-first sync. The browser keeps every note (src/store.js); the vault
// is whatever the Worker's backend holds. Each local note remembers the
// version it was last synced at ("base"), so a sync can tell who changed what:
//
//   remote moved on, local clean      -> take the remote copy
//   local edited, remote unchanged    -> send the local copy (conditional write)
//   both changed                      -> keep both: the local text moves to
//                                        "Name (conflict YYYY-MM-DD).md" and the
//                                        note itself takes the remote text
//   deleted on one side, edited on the other -> the edit wins
//
// Nothing here touches the DOM or IndexedDB directly; `local` and `api` are
// passed in, so the same code runs under node --test.

export const READ_BATCH = 25;
// Each round re-plans from a fresh listing, until there's nothing left to do
// (a conflict copy made in one round is uploaded in the next).
const MAX_ROUNDS = 4;

// Decide what to do for each note. local and remote are Maps keyed by path.
export function plan(local, remote) {
	const actions = [];
	const paths = new Set([...local.keys(), ...remote.keys()]);
	for (const path of paths) {
		const l = local.get(path);
		const r = remote.get(path);
		if (!l) {
			actions.push({ type: "download", path });
			continue;
		}
		if (l.deleted) {
			if (!r) actions.push({ type: "forget", path });
			else if (r.version === l.base) actions.push({ type: "delete-remote", path, expected: l.base });
			else actions.push({ type: "download", path, restore: true });
			continue;
		}
		if (!l.dirty) {
			if (!r) actions.push({ type: "forget", path });
			else if (r.version !== l.base) actions.push({ type: "download", path });
			continue;
		}
		if (!r) actions.push({ type: "upload", path, expected: null });
		else if (l.base && r.version === l.base) actions.push({ type: "upload", path, expected: l.base });
		else actions.push({ type: "conflict", path });
	}
	return actions.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// "Folder/Note.md" -> "Folder/Note (conflict 2026-09-26).md", numbered if taken.
export function conflictPath(path, taken, date = new Date()) {
	const day = date.toISOString().slice(0, 10);
	const m = path.match(/^(.*?)(\.md|\.board|\.base)$/i);
	const stem = m ? m[1] : path;
	const ext = m ? m[2] : "";
	for (let n = 1; ; n++) {
		const candidate = `${stem} (conflict ${day}${n > 1 ? " " + n : ""})${ext}`;
		if (!taken(candidate)) return candidate;
	}
}

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

// A note as stored locally. Text that isn't valid UTF-8 is kept as bytes and
// shown read-only, so it round-trips untouched.
export function fromBytes(path, bytes, version) {
	try {
		return { path, text: decoder.decode(bytes), base: version, dirty: false, deleted: false };
	} catch {
		return { path, bytes, binary: true, base: version, dirty: false, deleted: false };
	}
}

export function toBytes(note) {
	return note.binary ? note.bytes : encoder.encode(note.text);
}

function sameContent(note, remote) {
	if (note.binary || remote.binary) {
		const a = toBytes(note), b = toBytes(remote);
		return a.length === b.length && a.every((x, i) => x === b[i]);
	}
	return note.text === remote.text;
}

// Run one sync. Returns {downloaded, uploaded, deleted, conflicts: [{path, copy}]}.
//   local: {all(), get(path), put(note), update(path, fn)} -- see src/store.js
//   api:   {list(), read(paths), write(path, bytes, expected), remove(path, expected)}
//   onNote(path, note|null): called whenever a note changes because of the sync
export async function sync({ local, api, onNote = () => {}, now = () => new Date() }) {
	const result = { downloaded: 0, uploaded: 0, deleted: 0, conflicts: [] };
	for (let round = 0; round < MAX_ROUNDS; round++) {
		const remoteList = await api.list();
		const remote = new Map(remoteList.map((f) => [f.path, f]));
		const localNotes = new Map((await local.all()).map((n) => [n.path, n]));
		const actions = plan(localNotes, remote);
		if (!actions.length) return result;

		// Fetch everything that needs a remote copy.
		const needs = actions.filter((a) => a.type === "download" || a.type === "conflict");
		const fetched = new Map();
		for (let i = 0; i < needs.length; i += READ_BATCH) {
			for (const f of await api.read(needs.slice(i, i + READ_BATCH).map((a) => a.path))) fetched.set(f.path, f);
		}

		const taken = (p) => remote.has(p) || localNotes.has(p);
		const edited = (n, incoming) => n && n.dirty && !n.deleted && !sameContent(n, incoming);

		for (const a of actions) {
			if (a.type === "download" || a.type === "conflict") {
				const f = fetched.get(a.path);
				if (!f || f.missing) continue; // gone since list(); the next round sorts it out
				const incoming = fromBytes(a.path, f.bytes, f.version);
				const current = await local.get(a.path);
				if (edited(current, incoming)) {
					// Keep both: the local text moves to a conflict copy first, so a
					// crash between the two writes can't lose it.
					const copy = conflictPath(a.path, taken, now());
					localNotes.set(copy, null);
					const moved = { ...current, path: copy, base: null, dirty: true, deleted: false };
					await local.put(moved);
					const { before } = await local.update(a.path, () => incoming);
					if (edited(before, incoming) && !sameContent(before, current)) {
						// More typing landed between the two writes; it belongs in the copy.
						const later = { ...before, path: copy, base: null, dirty: true, deleted: false };
						await local.put(later);
						onNote(copy, later);
					} else onNote(copy, moved);
					onNote(a.path, incoming);
					result.conflicts.push({ path: a.path, copy });
				} else {
					// If an edit started since the read above, leave it; the next round
					// sees it as a conflict.
					const { after } = await local.update(a.path, (cur) => (edited(cur, incoming) ? undefined : incoming));
					if (after === incoming || sameContent(after ?? {}, incoming)) {
						onNote(a.path, after);
						result.downloaded++;
					}
				}
			} else if (a.type === "forget") {
				const { before, after } = await local.update(a.path, (cur) => (cur && (cur.deleted || !cur.dirty) ? null : undefined));
				if (before && !after) onNote(a.path, null);
			} else if (a.type === "delete-remote") {
				const current = await local.get(a.path);
				if (!current?.deleted) continue;
				const r = await api.remove(a.path, a.expected);
				if (!r.ok) continue;
				const { after } = await local.update(a.path, (cur) => (cur?.deleted ? null : undefined));
				if (!after) onNote(a.path, null);
				result.deleted++;
			} else if (a.type === "upload") {
				const current = await local.get(a.path);
				if (!current?.dirty || current.deleted) continue;
				const r = await api.write(a.path, toBytes(current), a.expected);
				if (!r.ok) continue; // changed remotely; the next round turns this into a conflict
				// Typing that landed during the upload stays dirty for the next round.
				// A delete (or rename) that landed during it becomes a tombstone for
				// the version just written, so the next round removes it again.
				const { after } = await local.update(a.path, (cur) =>
					!cur || cur.deleted
						? { ...(cur || current), base: r.version, deleted: true, dirty: true }
						: { ...cur, base: r.version, dirty: !sameContent(cur, current) },
				);
				if (!after.deleted) onNote(a.path, after);
				result.uploaded++;
			}
		}
	}
	return result;
}
