// An in-memory stand-in for the File System Access API's directory handles:
// just the parts src/localvaultview.js uses.
export function fakeDir() {
	let clock = 1000;
	const mk = () => {
		const kids = new Map();
		const dir = {
			kind: "directory",
			async *entries() { for (const [n, h] of kids) yield [n, h]; },
			async getDirectoryHandle(n, { create } = {}) {
				if (!kids.has(n)) { if (!create) throw Object.assign(new Error("no"), { name: "NotFoundError" }); kids.set(n, mk()); }
				return kids.get(n);
			},
			async getFileHandle(n, { create } = {}) {
				if (!kids.has(n)) { if (!create) throw Object.assign(new Error("no"), { name: "NotFoundError" }); kids.set(n, file()); }
				return kids.get(n);
			},
			async removeEntry(n) { if (!kids.delete(n)) throw Object.assign(new Error("no"), { name: "NotFoundError" }); },
		};
		return dir;
	};
	const file = () => {
		const f = { kind: "file", data: new Uint8Array(), mtime: clock++ };
		f.getFile = async () => ({ size: f.data.length, lastModified: f.mtime, arrayBuffer: async () => f.data.slice().buffer });
		f.createWritable = async () => {
			const parts = [];
			return {
				write: async (d) => parts.push(d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : typeof d === "string" ? new TextEncoder().encode(d) : new Uint8Array(d)),
				close: async () => { const n = parts.reduce((s, p) => s + p.length, 0); const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; } f.data = all; f.mtime = clock++; },
			};
		};
		return f;
	};
	const root = mk();
	// Test helpers: put and get a file's text by path, as another program would.
	root.put = async (path, text) => {
		const parts = path.split("/"); let d = root;
		for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
		const h = await d.getFileHandle(parts.at(-1), { create: true });
		const w = await h.createWritable(); await w.write(text); await w.close();
	};
	root.get = async (path) => {
		try { const parts = path.split("/"); let d = root; for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p); const h = await d.getFileHandle(parts.at(-1)); return new TextDecoder().decode((await h.getFile()).arrayBuffer ? new Uint8Array(await (await h.getFile()).arrayBuffer()) : new Uint8Array()); } catch { return null; }
	};
	return root;
}
