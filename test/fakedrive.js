// Just enough of Google Drive's API for src/gdrive.js, as fetch(url, init).
// Files the app didn't make (hidden: true) are left out of listings, as
// drive.file would.

export function fakeDrive() {
	let n = 0;
	const files = new Map(); // id -> {id, name, parents, mimeType, version, bytes, trashed, appProperties, hidden}
	const calls = [];
	const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
	const meta = (f) => ({ id: f.id, name: f.name, parents: f.parents, mimeType: f.mimeType, version: String(f.version), size: f.bytes ? String(f.bytes.length) : undefined, trashed: !!f.trashed });
	const add = (o) => { const f = { id: "f" + ++n, version: 1, parents: [], ...o }; files.set(f.id, f); return f; };
	const bytesOf = async (body) => (body == null ? new Uint8Array() : typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new Uint8Array(body));

	async function fetch(url, init = {}) {
		const u = new URL(url);
		const method = init.method || "GET";
		calls.push(`${method} ${u.pathname}${u.search}`);
		let m;
		if (u.pathname === "/drive/v3/about") return json({ user: { emailAddress: "me@example.com" } });
		if (u.pathname === "/drive/v3/files" && method === "GET") {
			const q = u.searchParams.get("q") || "";
			let list = [...files.values()].filter((f) => !f.trashed && !f.hidden);
			if (q.includes("appProperties")) list = list.filter((f) => f.appProperties?.wr1t3r === "notebook");
			return json({ files: list.map(meta) });
		}
		if (u.pathname === "/drive/v3/files" && method === "POST") {
			const b = JSON.parse(init.body);
			return json(meta(add({ name: b.name, mimeType: b.mimeType, parents: b.parents || [], appProperties: b.appProperties })));
		}
		if ((m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/))) {
			const f = files.get(m[1]);
			if (!f || f.hidden) return json({ error: { message: `File not found: ${m[1]}.` } }, 404);
			if (method === "PATCH") { Object.assign(f, JSON.parse(init.body)); f.version++; return json(meta(f)); }
			if (u.searchParams.get("alt") === "media") return new Response(f.bytes);
			return json(meta(f));
		}
		if (u.pathname === "/upload/drive/v3/files" && method === "POST") {
			const all = await bytesOf(init.body);
			const boundary = /boundary=(\S+)/.exec(init.headers["Content-Type"])[1];
			const text = new TextDecoder("latin1").decode(all);
			const [, metaPart, filePart] = text.split(`--${boundary}`);
			const metaJson = JSON.parse(metaPart.slice(metaPart.indexOf("\r\n\r\n") + 4).trim());
			const start = text.indexOf(filePart) + filePart.indexOf("\r\n\r\n") + 4;
			const end = text.lastIndexOf(`\r\n--${boundary}--`);
			const f = add({ name: metaJson.name, parents: metaJson.parents, mimeType: "application/octet-stream", bytes: all.slice(start, end) });
			return json(meta(f));
		}
		if ((m = u.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/)) && method === "PATCH") {
			const f = files.get(m[1]);
			if (!f) return json({ error: { message: "File not found" } }, 404);
			f.bytes = await bytesOf(init.body);
			f.version++;
			return json(meta(f));
		}
		return json({ error: { message: `fake has no ${method} ${u.pathname}` } }, 500);
	}
	// A path's file, for checking; and a way to edit one "elsewhere".
	const find = (path) => {
		const top = [...files.values()].find((f) => f.appProperties?.wr1t3r === "notebook" && !f.trashed);
		let at = top;
		for (const name of path.split("/")) { at = [...files.values()].find((f) => !f.trashed && f.name === name && f.parents[0] === at?.id); if (!at) return null; }
		return at;
	};
	return { fetch, calls, files, find, add };
}
