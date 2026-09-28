// Vault attachments (images, PDFs, audio, video), shown read-only. The list
// comes from the Worker's /api/attachments; bytes come through the Worker with
// the token and are kept in the Cache API under their version, so an
// attachment you've seen once still shows offline. wr1t3r never writes them.

import { attachmentType } from "./paths.js";

const CACHE = "wr1t3r-attachments";

// "image", "audio", "video" or "pdf"; null for anything else.
export function attachmentKind(path) {
	const t = attachmentType(path);
	if (!t) return null;
	return t === "application/pdf" ? "pdf" : t.split("/")[0];
}

// Which attachment a link names, the way Obsidian finds it: a path from the
// linking note's folder or the vault root, else any file with that name (the
// shortest path when several share it). paths: every attachment's path.
export function resolveAttachment(name, fromPath, paths) {
	let want = String(name || "").trim();
	try { want = decodeURIComponent(want); } catch {}
	want = want.replace(/^\.\//, "").replace(/^\/+/, "");
	if (!want) return null;
	const lower = new Map(paths.map((p) => [p.toLowerCase(), p]));
	const folder = fromPath && fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/") + 1) : "";
	const parts = [];
	for (const seg of (folder + want).split("/")) {
		if (seg === "..") parts.pop();
		else if (seg !== ".") parts.push(seg);
	}
	for (const p of [parts.join("/"), want]) if (lower.has(p.toLowerCase())) return lower.get(p.toLowerCase());
	const tail = want.toLowerCase();
	const hits = paths.filter((p) => p.toLowerCase().endsWith("/" + tail));
	return hits.sort((a, b) => a.length - b.length || a.localeCompare(b))[0] || null;
}

const urls = new Map(); // path + version -> Promise<object URL>

// An object URL for the attachment's bytes: from the cache when this version
// is there, else fetched (fetchBlob(path) -> Blob) and cached.
export function attachmentURL(file, fetchBlob) {
	const key = file.path + "\0" + file.version;
	if (!urls.has(key)) {
		const p = (async () => {
			const req = new Request("/__attachments/" + encodeURIComponent(file.path) + "?v=" + encodeURIComponent(file.version));
			let cache = null;
			try { cache = await caches.open(CACHE); } catch {}
			const hit = cache && (await cache.match(req).catch(() => null));
			let blob = hit ? await hit.blob() : null;
			if (!blob) {
				blob = await fetchBlob(file.path);
				if (cache) {
					await cache.put(req, new Response(blob, { headers: { "Content-Type": blob.type } })).catch(() => {});
					// Drop older versions of the same file.
					for (const k of await cache.keys().catch(() => [])) {
						if (k.url.includes("/__attachments/" + encodeURIComponent(file.path) + "?") && !k.url.endsWith("?v=" + encodeURIComponent(file.version))) cache.delete(k);
					}
				}
			}
			return URL.createObjectURL(blob);
		})();
		p.catch(() => urls.delete(key)); // try again next time
		urls.set(key, p);
	}
	return urls.get(key);
}
