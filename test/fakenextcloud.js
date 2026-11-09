// A Nextcloud stand-in that answers the WebDAV calls src/nextcloud.js makes,
// with the rules found testing a real one (2026-10-28): Basic auth with an
// app password, PROPFIND at depth 0, 1 and infinity, a principal lookup,
// If-Match / If-None-Match on PUT and DELETE (412), PUT into a missing folder
// is 404, MKCOL is 405 when the folder exists, folder ETags change when
// anything inside does, OC-Checksum is stored and listed, and a file's ETag
// only changes when a second has passed since its last write.

import { createHash } from "node:crypto";

export function fakeNextcloud({ base = "https://cloud.example.com", login = "me@example.com", uid = "me", password = "app-pass", infinity = true, frozen = false } = {}) {
	let n = 0;
	let t = 1000; // seconds
	// The clock moves a second after each write unless frozen, when every
	// write lands in the same second.
	const tick = () => t;
	const later = () => { if (!frozen) t++; };
	const home = `/remote.php/dav/files/${uid}/`;
	// path under home ("" for home itself, "a/b" ...) -> {folder, bytes, etag, mtime, sha1}
	const nodes = new Map([["", { folder: true, etag: "h0" }]]);
	const state = { calls: [], nodes, password, unreachable: false };

	const parent = (p) => p.split("/").slice(0, -1).join("/");
	const touchFolders = (p) => {
		for (let q = parent(p); ; q = parent(q)) {
			const f = nodes.get(q);
			if (f) f.etag = "d" + ++n;
			if (!q) break;
		}
	};
	// Same-second writes keep the ETag, as the real server's did.
	const fileEtag = (prev) => (prev && prev.mtime === tick() ? prev.etag : "f" + ++n);
	const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
	const href = (p, folder) => home + p.split("/").filter(Boolean).map(encodeURIComponent).join("/") + (folder && p ? "/" : "");
	const entry = (p, f) => `<d:response><d:href>${esc(href(p, f.folder))}</d:href><d:propstat><d:prop><d:getetag>&quot;${f.etag}&quot;</d:getetag>${f.folder ? "<d:resourcetype><d:collection/></d:resourcetype>" : `<d:getcontentlength>${f.bytes.length}</d:getcontentlength><d:resourcetype/>`}${f.sha1 ? `<oc:checksums><oc:checksum>SHA1:${f.sha1} MD5:abc</oc:checksum></oc:checksums>` : ""}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>${f.sha1 ? "" : "<d:propstat><d:prop><oc:checksums/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>"}</d:response>`;
	const multi = (body) => new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns">${body}</d:multistatus>`, { status: 207, headers: { "Content-Type": "application/xml; charset=utf-8" } });
	const status = (code, msg = "") => new Response(msg ? `<?xml version="1.0"?><d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns"><s:message>${msg}</s:message></d:error>` : null, { status: code });
	const matches = (h, f) => {
		const im = h.get("If-Match");
		if (im && (!f || im !== `"${f.etag}"`)) return false;
		if (h.get("If-None-Match") === "*" && f) return false;
		return true;
	};
	const bytesOf = async (body) => (body == null ? new Uint8Array() : body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new Uint8Array(body));

	// Puts a file straight on the server, as another Nextcloud app would (no checksum).
	state.drop = (p, content) => {
		const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
		const segs = p.split("/");
		for (let i = 1; i < segs.length; i++) {
			const q = segs.slice(0, i).join("/");
			if (!nodes.has(q)) nodes.set(q, { folder: true, etag: "d" + ++n });
		}
		const prev = nodes.get(p);
		nodes.set(p, { folder: false, bytes, etag: fileEtag(prev), mtime: tick(), sha1: "" });
		touchFolders(p);
		later();
	};

	async function fetch(url, init = {}) {
		if (state.unreachable) throw new TypeError("Failed to fetch");
		const u = new URL(url);
		const method = init.method || "GET";
		const h = new Headers(init.headers);
		state.calls.push(`${method} ${decodeURIComponent(u.pathname)}${h.get("Depth") != null ? " " + h.get("Depth") : ""}`);
		if (u.origin !== base) throw new TypeError("Failed to fetch");
		const want = "Basic " + Buffer.from(`${login}:${state.password}`).toString("base64");
		if (h.get("Authorization") !== want) return status(401, "No public access to this resource.");

		if (u.pathname === "/remote.php/dav/" && method === "PROPFIND") {
			return multi(`<d:response><d:href>/remote.php/dav/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/remote.php/dav/principals/users/${encodeURIComponent(uid)}/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
		}
		if (!u.pathname.startsWith(home)) return status(404);
		const trailing = u.pathname.endsWith("/");
		const p = u.pathname.slice(home.length).replace(/\/$/, "").split("/").filter(Boolean).map(decodeURIComponent).join("/");
		const cur = nodes.get(p);

		switch (method) {
			case "PROPFIND": {
				if (!cur) return status(404, `File with name ${p} could not be located`);
				const depth = h.get("Depth");
				if (depth === "infinity" && !infinity) return status(403, "PROPFIND requests with a Depth of infinity are not allowed");
				const out = [entry(p, cur)];
				if (cur.folder && depth !== "0") {
					for (const [q, f] of nodes) {
						if (q === p || !(p ? q.startsWith(p + "/") : q)) continue;
						if (depth === "1" && parent(q) !== p) continue;
						out.push(entry(q, f));
					}
				}
				return multi(out.join(""));
			}
			case "GET":
				if (!cur || cur.folder) return status(404);
				return new Response(cur.bytes, { headers: { ETag: `"${cur.etag}"` } });
			case "PUT": {
				if (trailing) return status(400);
				if (!matches(h, cur)) return status(412, "An If-Match header was specified, but none of the specified ETags matched.");
				if (!nodes.get(parent(p))?.folder) return status(404);
				const bytes = await bytesOf(init.body);
				const sum = /^SHA1:([0-9a-f]{40})$/i.exec(h.get("OC-Checksum") || "")?.[1]?.toLowerCase() || "";
				if (sum && sum !== createHash("sha1").update(bytes).digest("hex")) return status(400, "The computed checksum does not match the one received from the client.");
				nodes.set(p, { folder: false, bytes, etag: fileEtag(cur), mtime: tick(), sha1: sum });
				touchFolders(p);
				later();
				return new Response(null, { status: cur ? 204 : 201, headers: { ETag: `"${nodes.get(p).etag}"` } });
			}
			case "MKCOL":
				if (cur) return status(405, "The resource you tried to create already exists");
				if (!nodes.get(parent(p))?.folder) return status(409, "Parent node does not exist");
				nodes.set(p, { folder: true, etag: "d" + ++n });
				touchFolders(p);
				return new Response(null, { status: 201 });
			case "DELETE":
				if (!cur) return status(404);
				if (!matches(h, cur)) return status(412);
				for (const q of [...nodes.keys()]) if (q === p || q.startsWith(p + "/")) nodes.delete(q);
				touchFolders(p);
				return new Response(null, { status: 204 });
		}
		return status(405);
	}
	return { fetch, state, base, login, uid };
}
