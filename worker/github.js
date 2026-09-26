// Backend: a GitHub repository, through the REST API. Versions are git blob
// shas. Every write is its own commit on GITHUB_BRANCH; GitHub refuses one
// whose sha doesn't match the file's current blob, which is the conflict check.

import { HttpError, toBase64, fromBase64 } from "./util.js";

export function githubBackend(env, prefix) {
	if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) throw new HttpError(500, "GITHUB_TOKEN and GITHUB_REPO must be set");
	const repo = env.GITHUB_REPO;
	const branch = env.GITHUB_BRANCH || "main";
	const contentsUrl = (path) =>
		`https://api.github.com/repos/${repo}/contents/${(prefix + path).split("/").map(encodeURIComponent).join("/")}`;

	async function gh(url, init = {}) {
		return fetch(url, {
			...init,
			headers: {
				Authorization: `Bearer ${env.GITHUB_TOKEN}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "wr1t3r",
				...(init.body ? { "Content-Type": "application/json" } : {}),
				...init.headers,
			},
		});
	}

	async function fail(res, what) {
		const text = await res.text().catch(() => "");
		throw new HttpError(502, `GitHub ${what} failed (${res.status}): ${text.slice(0, 300)}`);
	}

	async function currentSha(path) {
		const meta = await gh(`${contentsUrl(path)}?ref=${encodeURIComponent(branch)}`);
		if (meta.status === 404) return null;
		if (!meta.ok) await fail(meta, "read");
		return (await meta.json()).sha;
	}

	return {
		async list() {
			const res = await gh(`https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
			if (!res.ok) await fail(res, "tree");
			const tree = await res.json();
			if (tree.truncated) throw new HttpError(502, "The repository is too big for one tree listing");
			return tree.tree
				.filter((e) => e.type === "blob" && e.path.startsWith(prefix))
				.map((e) => ({ path: e.path.slice(prefix.length), version: e.sha, size: e.size }));
		},

		async read(path) {
			const res = await gh(`${contentsUrl(path)}?ref=${encodeURIComponent(branch)}`);
			if (res.status === 404) return null;
			if (!res.ok) await fail(res, "read");
			const f = await res.json();
			if (Array.isArray(f) || f.type !== "file") return null;
			if (f.encoding === "base64") return { version: f.sha, bytes: fromBase64(f.content) };
			// Over 1 MB the contents API leaves the content out; the blob API has it.
			const blob = await gh(`https://api.github.com/repos/${repo}/git/blobs/${f.sha}`, {
				headers: { Accept: "application/vnd.github.raw+json" },
			});
			if (!blob.ok) await fail(blob, "blob");
			return { version: f.sha, bytes: new Uint8Array(await blob.arrayBuffer()) };
		},

		async write(path, bytes, expected) {
			const res = await gh(contentsUrl(path), {
				method: "PUT",
				body: JSON.stringify({
					message: `${expected ? "Update" : "Add"} ${path} (wr1t3r)`,
					content: toBase64(bytes),
					branch,
					...(expected ? { sha: expected } : {}),
				}),
			});
			if (res.ok) return { ok: true, version: (await res.json()).content.sha };
			// 409: sha doesn't match. 422: no sha given but the file exists.
			if (res.status === 409 || res.status === 422) return { ok: false, version: await currentSha(path) };
			await fail(res, "write");
		},

		async remove(path, expected) {
			const res = await gh(contentsUrl(path), {
				method: "DELETE",
				body: JSON.stringify({ message: `Delete ${path} (wr1t3r)`, sha: expected, branch }),
			});
			if (res.ok || res.status === 404) return { ok: true };
			if (res.status === 409 || res.status === 422) return { ok: false, version: await currentSha(path) };
			await fail(res, "delete");
		},
	};
}
