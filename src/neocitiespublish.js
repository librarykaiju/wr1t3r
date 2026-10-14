// Publish to Neocities: puts the site from src/website.js on the person's
// Neocities site with their API key (Neocities > Settings > API). Neocities'
// API doesn't take calls from web pages, so they go through wr1t3r's Worker
// (worker/neocities.js), which passes them on and keeps nothing. A copy of
// wr1t3r with no Worker (GitHub Pages) can't do this.
//
// Neocities lists every file with its SHA-1, so only files that changed are
// sent, a few at a time. Pages published here last time that the site
// doesn't have now are deleted; anything else on the Neocities site is left
// alone. A free Neocities site turns some kinds of file away: those are
// reported, and the rest still goes up.

// Where Export as website keeps the key, when the person ticks Remember.
export const NEOCITIES_KEY = "wr1t3r-neocities-key";
// Whether this device has a key remembered, for the globe's Publish to Neocities.
export function hasNeocitiesKey() {
	try { return !!localStorage.getItem(NEOCITIES_KEY); } catch { return false; }
}

const enc = new TextEncoder();
const bytesOf = (v) => (typeof v === "string" ? enc.encode(v) : v);

export async function sha1(data) {
	const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", bytesOf(data)));
	return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The site's address, from Neocities' info: its own domain if it has one.
export const neocitiesUrl = (info) => (info.domain ? `https://${String(info.domain).replace(/^https?:\/\//, "").replace(/\/+$/, "")}/` : `https://${info.sitename}.neocities.org/`);

class NeocitiesError extends Error {
	constructor(message, type) { super(message); this.type = type; }
}

const NO_WORKER = "This copy of wr1t3r can't send to Neocities: it needs wr1t3r.app, or a copy on Cloudflare. Download the website instead, or publish through GitHub.";

// call(path, init) -> Response: fetch, plus whatever the Worker needs to let
// this page in.
function client(key, call) {
	return async (name, init = {}) => {
		const res = await call(`/api/neocities/${name}`, { ...init, headers: { ...(init.headers || {}), "X-Neocities-Key": key }, cache: "no-store" });
		if (!/json/i.test(res.headers.get("Content-Type") || "")) throw new NeocitiesError(NO_WORKER, "no_worker");
		const data = await res.json().catch(() => ({}));
		if (!res.ok || data.result === "error") throw new NeocitiesError(data.message || data.error || `Neocities said ${res.status}`, data.error_type || res.status);
		return data;
	};
}

const plain = (e) =>
	e.type === "invalid_auth" || e.type === 401 || e.type === 403 ? "Neocities didn't accept the API key. Copy it again from your site's Settings > API on neocities.org."
	: e.message;

// The site this key is for: { sitename, domain, url }.
export async function neocitiesSite({ key, call }) {
	if (!key?.trim()) throw new Error("Paste your Neocities API key first.");
	try {
		const info = (await client(key.trim(), call)("info")).info || {};
		if (!info.sitename) throw new Error("Neocities didn't say which site that key is for.");
		return { sitename: info.sitename, domain: info.domain || "", url: neocitiesUrl(info) };
	} catch (e) {
		if (e instanceof NeocitiesError) throw new Error(plain(e));
		throw e;
	}
}

const BATCH_FILES = 20;
const BATCH_BYTES = 8 * 1024 * 1024;
const DELETE_BATCH = 50;

// Splits files into uploads of a few at a time.
function batches(files) {
	const out = [];
	let now = [], size = 0;
	for (const f of files) {
		if (now.length && (now.length >= BATCH_FILES || size + f.data.length > BATCH_BYTES)) { out.push(now); now = []; size = 0; }
		now.push(f);
		size += f.data.length;
	}
	if (now.length) out.push(now);
	return out;
}

// files: Map(sitePath -> string | { attachment }) from buildSite.
// read(attachment) -> Blob. last: the paths this Neocities site got from
// wr1t3r last time. site: neocitiesSite's answer, if already asked.
// Returns { url, changed, deleted, paths, missing, failed: [{ path, message }] }.
export async function publishToNeocities({ key, call, files, read, last = [], site = null, progress = () => {} }) {
	if (!key?.trim()) throw new Error("Paste your Neocities API key first.");
	const nc = client(key.trim(), call);
	try {
		progress("Looking at your Neocities site…");
		site ||= await neocitiesSite({ key, call });
		const listed = await nc("list");
		const have = new Map((listed.files || []).filter((f) => !f.is_directory).map((f) => [f.path, f.sha1_hash]));

		const send = [], missing = [], unread = new Set();
		const paths = [...files.keys()];
		let done = 0;
		for (const path of paths) {
			const v = files.get(path);
			let data;
			if (typeof v === "string") data = enc.encode(v);
			else {
				try { data = new Uint8Array(await (await read(v.attachment)).arrayBuffer()); } catch { missing.push(v.attachment); unread.add(path); continue; }
			}
			if ((await sha1(data)) !== have.get(path)) send.push({ path, data });
			progress(`Checking files… ${++done} of ${paths.length}`);
		}

		// A batch Neocities turns away is sent again a file at a time, so one
		// file it won't take doesn't hold the rest back.
		const failed = [];
		const upload = async (batch) => {
			const form = new FormData();
			for (const f of batch) form.append(f.path, new Blob([f.data]), f.path.split("/").pop());
			await nc("upload", { method: "POST", body: form });
		};
		let sent = 0;
		for (const batch of batches(send)) {
			progress(`Sending to Neocities… ${sent} of ${send.length}`);
			try { await upload(batch); }
			catch (e) {
				if (!(e instanceof NeocitiesError) || e.type === "invalid_auth" || e.type === "no_worker" || e.type === 401 || e.type === 403) throw e;
				if (batch.length === 1) failed.push({ path: batch[0].path, message: e.message });
				else for (const f of batch) {
					try { await upload([f]); } catch (e2) {
						if (!(e2 instanceof NeocitiesError)) throw e2;
						failed.push({ path: f.path, message: e2.message });
					}
				}
			}
			sent += batch.length;
		}

		// Neocities won't delete index.html; a new one replaces it anyway.
		const gone = last.filter((p) => !files.has(p) && have.has(p) && p !== "index.html");
		for (let i = 0; i < gone.length; i += DELETE_BATCH) {
			progress("Removing pages you unpublished…");
			const form = new URLSearchParams();
			for (const p of gone.slice(i, i + DELETE_BATCH)) form.append("filenames[]", p);
			await nc("delete", { method: "POST", body: form });
		}

		const bad = new Set(failed.map((f) => f.path));
		return {
			url: site.url,
			site,
			changed: send.length - failed.length,
			deleted: gone.length,
			// What's ours on the site now: what went up or was there already,
			// and a file that didn't go this time but was there before.
			paths: paths.filter((p) => !unread.has(p) && (!bad.has(p) || have.has(p))),
			missing: missing.sort(),
			failed,
		};
	} catch (e) {
		if (e instanceof NeocitiesError) throw new Error(plain(e));
		throw e;
	}
}
