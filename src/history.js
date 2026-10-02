// Version history: earlier copies of each note, kept on this device in their
// own IndexedDB database. A copy is the text a note had just before it
// changed (an edit here or a new version from sync), taken at most every
// GAP minutes per note, so a writing session leaves a copy of where it started
// and one about every GAP minutes after. Restoring keeps the current text too.

export const GAP = 10 * 60 * 1000;
export const MAX = 60; // copies per note; the oldest go first

// Whether `text` should become a new copy, given the note's newest copy.
export function shouldKeep(latest, text, now, force = false) {
	if (typeof text !== "string" || !text.trim()) return false;
	if (!latest) return true;
	if (latest.text === text) return false;
	return force || now - latest.at >= GAP;
}

// The copies to drop so `max` remain (list in any order).
export function overflow(list, max = MAX) {
	return [...list].sort((a, b) => b.at - a.at).slice(max);
}

// Line diff of a against b: [{ op: "same" | "del" | "add", text }].
// Lines over the size limit compare as one block, so a huge note stays quick.
export function lineDiff(a, b, limit = 4000) {
	const x = a.split("\n"), y = b.split("\n");
	let s = 0;
	while (s < x.length && s < y.length && x[s] === y[s]) s++;
	let ex = x.length, ey = y.length;
	while (ex > s && ey > s && x[ex - 1] === y[ey - 1]) { ex--; ey--; }
	const head = x.slice(0, s).map((text) => ({ op: "same", text }));
	const tail = x.slice(ex).map((text) => ({ op: "same", text }));
	const mx = x.slice(s, ex), my = y.slice(s, ey);
	let mid;
	if (mx.length * my.length > limit * limit / 4) {
		mid = [...mx.map((text) => ({ op: "del", text })), ...my.map((text) => ({ op: "add", text }))];
	} else {
		// Longest common subsequence, then walk it.
		const n = mx.length, m = my.length;
		const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
		for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = mx[i] === my[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
		mid = [];
		let i = 0, j = 0;
		while (i < n && j < m) {
			if (mx[i] === my[j]) { mid.push({ op: "same", text: mx[i] }); i++; j++; }
			else if (L[i + 1][j] >= L[i][j + 1]) mid.push({ op: "del", text: mx[i++] });
			else mid.push({ op: "add", text: my[j++] });
		}
		while (i < n) mid.push({ op: "del", text: mx[i++] });
		while (j < m) mid.push({ op: "add", text: my[j++] });
	}
	return [...head, ...mid, ...tail];
}

// ---- storage ---------------------------------------------------------------

let dbp;
function db() {
	dbp ||= new Promise((resolve, reject) => {
		const req = indexedDB.open("wr1t3r-history", 1);
		req.onupgradeneeded = () => {
			const s = req.result.createObjectStore("copies", { keyPath: "id", autoIncrement: true });
			s.createIndex("path", "path");
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return dbp;
}

async function tx(mode, fn) {
	const d = await db();
	return new Promise((resolve, reject) => {
		const t = d.transaction("copies", mode);
		let out;
		fn(t.objectStore("copies"), (v) => { out = v; });
		t.oncomplete = () => resolve(out);
		t.onerror = () => reject(t.error);
		t.onabort = () => reject(t.error);
	});
}

// Every copy of a note, newest first.
export async function copies(path) {
	const list = await tx("readonly", (s, done) => {
		const req = s.index("path").getAll(path);
		req.onsuccess = () => done(req.result);
	});
	return (list || []).sort((a, b) => b.at - a.at);
}

// Keeps `text` as a copy of `path` if it's due (see shouldKeep). Never throws.
export async function keep(path, text, { force = false, now = Date.now() } = {}) {
	try {
		await tx("readwrite", (s) => {
			const req = s.index("path").getAll(path);
			req.onsuccess = () => {
				const list = req.result;
				const latest = list.reduce((a, c) => (!a || c.at > a.at ? c : a), null);
				if (!shouldKeep(latest, text, now, force)) return;
				s.add({ path, text, at: now });
				for (const old of overflow([...list, { at: now }], MAX)) if (old.id != null) s.delete(old.id);
			};
		});
	} catch {}
}

// A note renamed or moved: its copies go with it.
export async function move(from, to) {
	try {
		await tx("readwrite", (s) => {
			const req = s.index("path").getAll(from);
			req.onsuccess = () => { for (const c of req.result) s.put({ ...c, path: to }); };
		});
	} catch {}
}
