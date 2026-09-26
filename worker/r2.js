// Backend: an R2 bucket, the one Remotely Save syncs Obsidian with. Versions
// are R2 etags. Writes are conditional, so an edit made on another device
// since the browser last synced is never overwritten.

export function r2Backend(bucket, prefix) {
	return {
		async list() {
			const files = [];
			let cursor;
			do {
				const page = await bucket.list({ prefix, cursor, limit: 1000 });
				for (const o of page.objects) {
					if (o.key.endsWith("/")) continue;
					files.push({ path: o.key.slice(prefix.length), version: o.etag, size: o.size });
				}
				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor);
			return files;
		},

		async read(path) {
			const o = await bucket.get(prefix + path);
			if (!o) return null;
			return { version: o.etag, bytes: new Uint8Array(await o.arrayBuffer()) };
		},

		// expected: the version the caller last saw, or null to create a new note.
		async write(path, bytes, expected) {
			const onlyIf = new Headers(expected ? { "If-Match": `"${expected}"` } : { "If-None-Match": "*" });
			const o = await bucket.put(prefix + path, bytes, {
				onlyIf,
				httpMetadata: { contentType: "text/markdown; charset=utf-8" },
			});
			if (o) return { ok: true, version: o.etag };
			const now = await bucket.head(prefix + path);
			return { ok: false, version: now?.etag ?? null };
		},

		// R2 has no conditional delete, so this checks first. The gap between
		// the check and the delete is milliseconds; an edit landing in it is lost.
		async remove(path, expected) {
			const now = await bucket.head(prefix + path);
			if (!now) return { ok: true };
			if (now.etag !== expected) return { ok: false, version: now.etag };
			await bucket.delete(prefix + path);
			return { ok: true };
		},
	};
}
