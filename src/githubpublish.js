// Publish to GitHub: puts the site from src/website.js into a GitHub repo as
// one commit, straight from the page (GitHub's API takes calls from browsers,
// so this needs no Worker and works on every build). The person makes a
// fine-grained token for that one repo with Contents read and write (and
// Pages read and write, so we can turn GitHub Pages on for them).
//
// Files that haven't changed aren't sent again: a git blob's id is the SHA-1
// of its bytes, so we compare with the repo's tree before uploading. Files we
// published last time and the site doesn't have now are deleted; anything
// else in the repo (a README, a CNAME) is left alone.

const API = "https://api.github.com";

// "owner/name", or a github.com address, as { owner, name }.
export function parseRepo(text) {
	const m = String(text || "").trim().replace(/\/+$/, "").replace(/\.git$/, "").match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)$/i);
	return m ? { owner: m[1], name: m[2] } : null;
}

// Where GitHub Pages puts a repo's site when it has no custom domain.
export function pagesUrl({ owner, name }) {
	const user = owner.toLowerCase();
	return name.toLowerCase() === `${user}.github.io` ? `https://${user}.github.io/` : `https://${user}.github.io/${name}/`;
}

const enc = new TextEncoder();
const bytesOf = (v) => (typeof v === "string" ? enc.encode(v) : v);

// The id git gives a file's contents.
export async function blobSha(data) {
	const bytes = bytesOf(data);
	const head = enc.encode(`blob ${bytes.length}\0`);
	const all = new Uint8Array(head.length + bytes.length);
	all.set(head);
	all.set(bytes, head.length);
	const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
	return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64(bytes) {
	let s = "";
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

class GitHubError extends Error {
	constructor(message, status) { super(message); this.status = status; }
}

function client(token, fetchFn) {
	return async (method, path, body) => {
		const res = await fetchFn(API + path, {
			method,
			headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
			body: body ? JSON.stringify(body) : undefined,
		});
		const data = res.status === 204 ? null : await res.json().catch(() => null);
		if (!res.ok) throw new GitHubError(data?.message || `GitHub said ${res.status}`, res.status);
		return data;
	};
}

const plain = (e, repo) =>
	e.status === 401 ? "GitHub didn't accept the token. Check it was copied whole and hasn't expired."
	: e.status === 404 ? `The token can't see a repo called ${repo.owner}/${repo.name}. Check the name, and that the token was made for that repo.`
	: e.status === 403 ? "The token can't write to that repo. Give it Contents: Read and write."
	: e.message;

// Runs a few at a time.
async function each(items, n, fn) {
	let i = 0;
	await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// files: Map(sitePath -> string | { attachment }) from buildSite.
// read(attachment) -> Blob. last: the paths this repo got last time.
// Returns { url, changed, deleted, paths, missing, pagesNote }.
export async function publishToGitHub({ token, repo: repoText, branch, files, read, last = [], message = "Publish from wr1t3r", progress = () => {}, fetch: fetchFn = globalThis.fetch.bind(globalThis) }) {
	const repo = parseRepo(repoText);
	if (!repo) throw new Error("Write the repo as owner/name, like you/my-site.");
	if (!token) throw new Error("Paste a GitHub token first.");
	const gh = client(token.trim(), fetchFn);
	const base = `/repos/${repo.owner}/${repo.name}`;
	try {
		progress("Looking at the repo…");
		const info = await gh("GET", base);
		if (info.permissions && !info.permissions.push) throw new GitHubError("", 403);
		branch = (branch || "").trim() || info.default_branch || "main";

		// The branch's latest commit, making the repo's first commit if it's empty.
		let head;
		try {
			head = (await gh("GET", `${base}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
		} catch (e) {
			if (e.status !== 404 && e.status !== 409) throw e;
			let from = null;
			if (e.status === 404 && info.default_branch && info.default_branch !== branch) {
				try { from = (await gh("GET", `${base}/git/ref/heads/${encodeURIComponent(info.default_branch)}`)).object.sha; } catch {}
			}
			if (from) {
				await gh("POST", `${base}/git/refs`, { ref: `refs/heads/${branch}`, sha: from });
				head = from;
			} else {
				await gh("PUT", `${base}/contents/.nojekyll`, { message: "Start the site", content: "", branch });
				head = (await gh("GET", `${base}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
			}
		}
		const treeSha = (await gh("GET", `${base}/git/commits/${head}`)).tree.sha;
		const tree = await gh("GET", `${base}/git/trees/${treeSha}?recursive=1`);
		const have = new Map(tree.tree.filter((t) => t.type === "blob").map((t) => [t.path, t.sha]));

		// .nojekyll stops GitHub Pages from hiding files whose names start with _.
		const all = new Map(files);
		if (!all.has(".nojekyll")) all.set(".nojekyll", "");
		const entries = [], missing = [], unread = new Set();
		const paths = [...all.keys()];
		let done = 0;
		await each(paths, 4, async (path) => {
			const v = all.get(path);
			let data;
			if (typeof v === "string") data = v;
			else {
				try { data = new Uint8Array(await (await read(v.attachment)).arrayBuffer()); } catch { missing.push(v.attachment); unread.add(path); return; }
			}
			if ((await blobSha(data)) !== have.get(path)) {
				if (typeof data === "string") entries.push({ path, mode: "100644", type: "blob", content: data });
				else entries.push({ path, mode: "100644", type: "blob", sha: (await gh("POST", `${base}/git/blobs`, { content: base64(data), encoding: "base64" })).sha });
			}
			progress(`Checking files… ${++done} of ${paths.length}`);
		});
		const gone = last.filter((p) => !all.has(p) && have.has(p));
		for (const path of gone) entries.push({ path, mode: "100644", type: "blob", sha: null });

		if (entries.length) {
			progress("Saving to GitHub…");
			const newTree = await gh("POST", `${base}/git/trees`, { base_tree: treeSha, tree: entries });
			const commit = await gh("POST", `${base}/git/commits`, { message, tree: newTree.sha, parents: [head] });
			await gh("PATCH", `${base}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha });
		}

		// Turn GitHub Pages on, if it isn't, for this branch.
		let url = pagesUrl(repo), pagesNote = "";
		try {
			url = (await gh("GET", `${base}/pages`)).html_url || url;
		} catch (e) {
			if (e.status !== 404) pagesNote = "Couldn't check GitHub Pages.";
			else {
				try {
					url = (await gh("POST", `${base}/pages`, { source: { branch, path: "/" } })).html_url || url;
				} catch (e2) {
					pagesNote = info.private && e2.status === 422
						? "GitHub Pages needs a public repo on a free GitHub plan. Make the repo public, or put the site somewhere else."
						: `To put it online, open the repo's Settings > Pages on github.com and choose Deploy from a branch: ${branch}, / (root).`;
				}
			}
		}
		return { url, branch, changed: entries.length - gone.length, deleted: gone.length, paths: paths.filter((p) => !unread.has(p)), missing: missing.sort(), pagesNote };
	} catch (e) {
		if (e instanceof GitHubError) throw new Error(plain(e, repo));
		throw e;
	}
}
