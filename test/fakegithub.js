import { createHash } from "node:crypto";

const gitSha = (buf) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest("hex");

// Just enough of GitHub's API: one repo, commits as path -> sha maps.
export function fakeGitHub({ empty = false, pages = false, canPages = true, push = true } = {}) {
	const blobs = new Map(), texts = new Map(), trees = new Map(), commits = new Map(), refs = new Map();
	const calls = [];
	let n = 0;
	const id = () => `id${++n}`;
	const commit = (files, parents = []) => { const t = id(); trees.set(t, files); const c = id(); commits.set(c, { tree: t, parents }); return c; };
	if (!empty) refs.set("main", commit(new Map([["README.md", "readme-sha"]])));
	const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
	const fetch = async (url, { method, body }) => {
		const path = url.replace("https://api.github.com", "");
		const b = body ? JSON.parse(body) : null;
		calls.push(`${method} ${path}`);
		let m;
		if (path === "/repos/you/site") return json(200, { default_branch: "main", private: false, permissions: { push } });
		if ((m = path.match(/^\/repos\/you\/site\/git\/ref\/heads\/(.+)$/)) && method === "GET")
			return refs.has(m[1]) ? json(200, { object: { sha: refs.get(m[1]) } }) : json(empty ? 409 : 404, { message: "nope" });
		if (path === "/repos/you/site/contents/.nojekyll" && method === "PUT") { refs.set(b.branch, commit(new Map([[".nojekyll", "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"]]))); return json(201, {}); }
		if ((m = path.match(/^\/repos\/you\/site\/git\/commits\/(.+)$/))) return json(200, { tree: { sha: commits.get(m[1]).tree } });
		if ((m = path.match(/^\/repos\/you\/site\/git\/trees\/([^?]+)/)) && method === "GET")
			return json(200, { tree: [...trees.get(m[1])].map(([path, sha]) => ({ path, sha, type: "blob" })) });
		if (path === "/repos/you/site/git/blobs") { const s = gitSha(Buffer.from(b.content, "base64")); blobs.set(s, b.content); return json(201, { sha: s }); }
		if (path === "/repos/you/site/git/trees") {
			const files = new Map(trees.get(b.base_tree));
			for (const e of b.tree) {
				if (e.sha === null) files.delete(e.path);
				else if (e.sha) files.set(e.path, e.sha);
				else { const s = gitSha(Buffer.from(e.content)); texts.set(s, e.content); files.set(e.path, s); }
			}
			const t = id(); trees.set(t, files); return json(201, { sha: t });
		}
		if (path === "/repos/you/site/git/commits") { const c = id(); commits.set(c, { tree: b.tree, parents: b.parents }); return json(201, { sha: c }); }
		if ((m = path.match(/^\/repos\/you\/site\/git\/refs\/heads\/(.+)$/)) && method === "PATCH") { refs.set(m[1], b.sha); return json(200, {}); }
		if (path === "/repos/you/site/pages" && method === "GET") return pages ? json(200, { html_url: "https://you.github.io/site/" }) : json(404, { message: "Not Found" });
		if (path === "/repos/you/site/pages" && method === "POST") { if (!canPages) return json(403, { message: "Resource not accessible" }); pages = true; return json(201, { html_url: "https://you.github.io/site/" }); }
		return json(500, { message: `fake has no ${method} ${path}` });
	};
	const files = () => trees.get(commits.get(refs.get("main")).tree);
	const text = (path) => texts.get(files().get(path));
	return { fetch, calls, files, blobs, text };
}
