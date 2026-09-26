// The browser's copy of the vault, in IndexedDB. One record per note:
//   {path, text | bytes+binary, base (version last synced), dirty, deleted}
// Deleted notes stay as tombstones until the delete has reached the vault.

const DB_NAME = "wr1t3r";
let dbp;

function db() {
	dbp ||= new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore("notes", { keyPath: "path" });
			req.result.createObjectStore("meta");
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return dbp;
}

async function run(storeName, mode, fn) {
	const d = await db();
	return new Promise((resolve, reject) => {
		const tx = d.transaction(storeName, mode);
		const req = fn(tx.objectStore(storeName));
		tx.oncomplete = () => resolve(req?.result);
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

export const local = {
	all: () => run("notes", "readonly", (s) => s.getAll()),
	get: async (path) => (await run("notes", "readonly", (s) => s.get(path))) ?? null,
	put: (note) => run("notes", "readwrite", (s) => s.put(note)),
	del: (path) => run("notes", "readwrite", (s) => s.delete(path)),
	clear: () => run("notes", "readwrite", (s) => s.clear()),
	// Read-modify-write in one transaction, so a keystroke's save and a sync
	// finishing at the same moment can't overwrite each other's fields.
	// fn(current|null) returns the new note, null to delete, or undefined to leave it.
	async update(path, fn) {
		const d = await db();
		return new Promise((resolve, reject) => {
			const tx = d.transaction("notes", "readwrite");
			const store = tx.objectStore("notes");
			let out = null;
			const req = store.get(path);
			req.onsuccess = () => {
				const before = req.result ?? null;
				let after;
				try { after = fn(before); } catch (e) { tx.abort(); return reject(e); }
				if (after === undefined) after = before;
				else if (after === null) store.delete(path);
				else store.put(after);
				out = { before, after };
			};
			tx.oncomplete = () => resolve(out);
			tx.onerror = () => reject(tx.error);
		});
	},
};

export const meta = {
	get: (key) => run("meta", "readonly", (s) => s.get(key)),
	set: (key, value) => run("meta", "readwrite", (s) => s.put(value, key)),
};

// Ask the browser not to evict the vault under storage pressure. Safari only
// grants this to Home Screen apps; elsewhere it's usually granted quietly.
export async function persist() {
	try {
		if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
	} catch {}
}
