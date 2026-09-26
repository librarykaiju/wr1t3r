// In-memory stand-ins for the browser store and the Worker API.
const enc = new TextEncoder();
const dec = new TextDecoder();

export function memoryLocal(notes = []) {
	const m = new Map(notes.map((n) => [n.path, structuredClone(n)]));
	return {
		map: m,
		async all() { return [...m.values()].map((n) => structuredClone(n)); },
		async get(p) { return m.has(p) ? structuredClone(m.get(p)) : null; },
		async put(n) { m.set(n.path, structuredClone(n)); },
		async del(p) { m.delete(p); },
		async update(p, fn) {
			const before = m.has(p) ? structuredClone(m.get(p)) : null;
			let after = fn(before ? structuredClone(before) : null);
			if (after === undefined) after = before;
			else if (after === null) m.delete(p);
			else m.set(p, structuredClone(after));
			return { before, after };
		},
	};
}

export function memoryRemote(files = {}) {
	let n = 0;
	const m = new Map(Object.entries(files).map(([p, t]) => [p, { bytes: enc.encode(t), version: "v" + ++n }]));
	const api = {
		map: m,
		text: (p) => (m.has(p) ? dec.decode(m.get(p).bytes) : undefined),
		// Simulates an edit from another device.
		set(p, t) { m.set(p, { bytes: enc.encode(t), version: "v" + ++n }); },
		async list() { return [...m].map(([path, f]) => ({ path, version: f.version, size: f.bytes.length })); },
		async read(paths) {
			return paths.map((path) => (m.has(path) ? { path, version: m.get(path).version, bytes: m.get(path).bytes } : { path, missing: true }));
		},
		async write(path, bytes, expected) {
			const cur = m.get(path);
			if (expected ? cur?.version !== expected : cur) return { ok: false, version: cur?.version ?? null };
			const f = { bytes: new Uint8Array(bytes), version: "v" + ++n };
			m.set(path, f);
			return { ok: true, version: f.version };
		},
		async remove(path, expected) {
			const cur = m.get(path);
			if (!cur) return { ok: true };
			if (cur.version !== expected) return { ok: false, version: cur.version };
			m.delete(path);
			return { ok: true };
		},
	};
	return api;
}
