// Nextcloud Files as the place notes live: one of the storage kinds in
// src/storage.js, next to the Worker, Dropbox and Google Drive.
//
// The page talks to the person's own Nextcloud over WebDAV, so no server of
// ours is involved. Browsers only allow that when the server sends CORS
// headers, which a stock Nextcloud doesn't: its admin installs the
// WebAppPassword app and adds this page's address to it (or adds the headers
// in their web server). connectNextcloud() tells those cases apart so the
// sign-in screen can say which one it is.
//
// Sign-in is a username plus an app password pasted from Nextcloud's
// Settings > Security. Nextcloud's own sign-in flow (Login Flow v2) is
// refused from a browser, and WebAppPassword's pop-up passwords last a day.
//
// Versions. A Nextcloud ETag only changes when a second has passed since the
// last write, so the ETag alone can miss a change. Every write sends
// OC-Checksum: SHA1:<hash>, which Nextcloud stores, and a file's version is
// "etag|size|sha1". Another app's write clears or replaces the checksum, so
// the listing sees it even inside that second.
//
// Everything Nextcloud-specific (the /remote.php/dav/files/<user>/ path) is
// in davHome(); the rest is plain WebDAV, so ownCloud works too.

import { isNotePath, isAttachmentPath, attachmentType } from "./paths.js";
import { AuthError } from "./api.js";

const CREDS = "wr1t3r-nextcloud";
const PARALLEL = 6;
// Even when the notebook folder's ETag hasn't moved, list everything this often.
const FULL_EVERY = 10 * 60000;
export const DEFAULT_FOLDER = "wr1t3r";

const local = () => globalThis.localStorage;
const readCreds = () => {
	try { return JSON.parse(local().getItem(CREDS) || "null"); } catch { return null; }
};
const writeCreds = (v) => {
	try { v == null ? local().removeItem(CREDS) : local().setItem(CREDS, JSON.stringify(v)); } catch {}
};

export const nextcloudCreds = readCreds;
export const nextcloudSignedIn = () => !!(readCreds()?.server && readCreds()?.password);
export const forgetNextcloud = () => writeCreds(null);

// Why connecting failed, for the sign-in screen:
//   insecure  an http:// address from an https:// page (the browser blocks it)
//   blocked   no answer the page may read: the server isn't allowing wr1t3r yet
//             (WebAppPassword), or the address is wrong or offline
//   password  the server answered and refused the username or app password
//   address   the server answered, but it isn't a Nextcloud at that address
//   folder    the notebook folder couldn't be made
export class NextcloudError extends Error {
	constructor(reason, message) {
		super(message);
		this.reason = reason;
	}
}

// What someone pasted, as the address Nextcloud lives at: "cloud.example.com",
// "https://example.com/nextcloud/index.php/apps/files" -> "https://example.com/nextcloud".
export function serverAddress(input) {
	let s = String(input || "").trim();
	if (!s) return "";
	if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
	let u;
	try { u = new URL(s); } catch { return ""; }
	if (u.protocol !== "https:" && u.protocol !== "http:") return "";
	const path = u.pathname.replace(/\/(index\.php|remote\.php|apps|login|settings|s)(\/.*)?$/i, "").replace(/\/+$/, "");
	return u.origin + path;
}

// "/wr1t3r/" -> "wr1t3r"; a name that could climb out is refused.
export function folderName(input) {
	const segs = String(input ?? "").split(/[\\/]+/).map((s) => s.trim()).filter(Boolean);
	if (!segs.length) return DEFAULT_FOLDER;
	if (segs.some((s) => s === "." || s === "..")) throw new NextcloudError("folder", "The folder name can't contain . or .. on their own.");
	return segs.join("/");
}

// Each segment encoded, so a # or ? in a note's name stays part of the name.
export const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

const davHome = (c) => `${c.server}/remote.php/dav/files/${encodeURIComponent(c.uid || c.user)}/`;

const basic = (user, password) => "Basic " + btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${password}`)));

// ---- reading WebDAV's XML -------------------------------------------------
// A few elements from a multistatus, with any namespace prefix. Regular
// expressions rather than DOMParser so the same code runs under node --test.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const unescapeXml = (s) =>
	s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
		e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m,
	);
export const elements = (name, s) => [...s.matchAll(new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, "gi"))].map((m) => m[1]);
export const element = (name, s) => elements(name, s)[0];
export const text = (name, s) => {
	const v = element(name, s);
	return v == null ? null : unescapeXml(v.trim());
};

// [{href, etag, size, folder, sha1}] for each <response>, from its 200 propstat.
export function parseMultistatus(xml) {
	return elements("response", xml).map((r) => {
		const out = { href: text("href", r) || "", etag: "", size: 0, folder: false, sha1: "" };
		for (const ps of elements("propstat", r)) {
			if (!/\s200\s/.test(" " + (text("status", ps) || "") + " ")) continue;
			const prop = element("prop", ps) || "";
			out.etag = cleanEtag(text("getetag", prop) || "");
			out.size = Number(text("getcontentlength", prop)) || 0;
			out.folder = /<(?:[\w.-]+:)?collection\s*\/?>/i.test(element("resourcetype", prop) || "");
			out.sha1 = (/SHA1:([0-9a-f]{40})/i.exec(element("checksums", prop) || "")?.[1] || "").toLowerCase();
		}
		return out;
	});
}

export const cleanEtag = (e) => String(e || "").trim().replace(/^W\//, "").replace(/^"|"$/g, "");
const versionOf = (etag, size, sha1) => `${etag}|${size}|${sha1 || ""}`;
const etagOfVersion = (v) => String(v).split("|")[0];

async function sha1(bytes) {
	const d = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
	return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PROPS = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><d:getetag/><d:getcontentlength/><d:resourcetype/><oc:checksums/></d:prop></d:propfind>';
const PRINCIPAL = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';

// Runs fn over items, a few at a time, keeping order.
async function pool(items, fn) {
	const out = new Array(items.length);
	let i = 0;
	const next = async () => {
		while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
	};
	await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, next));
	return out;
}

// One request with the app password. A 401 is an AuthError, so the page stops
// syncing at once: Nextcloud slows down an address that keeps sending a bad
// password. A fetch that throws (no CORS headers, wrong address, offline) is
// marked blocked.
export function requester({ creds, get, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
	return async function call(method, url, { headers = {}, body, depth } = {}) {
		const c = creds();
		if (!c?.server || !c?.password) throw new AuthError("Not signed in to Nextcloud");
		for (let tries = 0; ; tries++) {
			let res;
			try {
				res = await get(url, {
					method,
					headers: {
						Authorization: basic(c.user, c.password),
						// Keeps Nextcloud from asking the browser to show its own password box.
						"X-Requested-With": "XMLHttpRequest",
						...(depth != null ? { Depth: String(depth) } : {}),
						...(typeof body === "string" ? { "Content-Type": "application/xml; charset=utf-8" } : {}),
						...headers,
					},
					body,
					cache: "no-store",
					credentials: "omit",
				});
			} catch (e) {
				throw Object.assign(new NextcloudError("blocked", "Couldn't reach your Nextcloud"), { cause: e });
			}
			if (res.status === 401) throw new AuthError("Nextcloud didn't accept the app password");
			if ((res.status === 429 || res.status === 503) && tries < 3) {
				await wait(Math.min(10, Number(res.headers.get("Retry-After")) || 2 ** tries) * 1000);
				continue;
			}
			return res;
		}
	};
}

export const fail = async (res, what) => {
	const t = await res.text().catch(() => "");
	const msg = /<(?:[\w.-]+:)?message[^>]*>([\s\S]*?)</i.exec(t)?.[1]?.trim();
	return Object.assign(new Error(`Nextcloud: ${what} failed (${msg ? unescapeXml(msg) : "HTTP " + res.status})`), { status: res.status });
};

// The storage. creds, get, wait and now are swappable for tests.
export function nextcloudStorage({ creds = readCreds, get = (...a) => fetch(...a), wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
	const call = requester({ creds, get, wait });
	const folderSegs = () => folderName(creds()?.folder).split("/");
	const home = () => davHome(creds());
	const rootUrl = () => home() + encodePath(folderSegs().join("/")) + "/";
	const fileUrl = (path) => rootUrl() + encodePath(path);
	const made = new Set(); // folders known to exist, by URL
	let cache = null; // {tag, at, files: [{path, version, size}], byPath}

	// The notebook-relative path of an href, or null if it's outside the notebook.
	const relative = (href) => {
		let p;
		try { p = new URL(href, rootUrl()).pathname; } catch { return null; }
		const dec = (s) => s.split("/").map((x) => { try { return decodeURIComponent(x); } catch { return x; } }).join("/");
		const root = dec(new URL(rootUrl()).pathname);
		p = dec(p);
		if (!p.startsWith(root)) return null;
		return p.slice(root.length).replace(/\/+$/, "");
	};

	async function propfind(url, depth, body = PROPS) {
		const res = await call("PROPFIND", url, { depth, body });
		if (res.status === 207) return { status: 207, entries: parseMultistatus(await res.text()) };
		return { status: res.status, res };
	}

	// This file's version now, or null if it isn't there.
	async function stat(path) {
		const r = await propfind(fileUrl(path), 0);
		if (r.status === 404) return null;
		if (r.status !== 207) throw await fail(r.res, "Checking " + path);
		const e = r.entries[0];
		return e && !e.folder ? { version: versionOf(e.etag, e.size, e.sha1), size: e.size } : null;
	}

	// Makes the notebook folder and dir inside it, top down. MKCOL answers 405
	// for a folder that's already there.
	async function makeFolders(dir) {
		const segs = [...folderSegs(), ...(dir ? dir.split("/") : [])];
		let url = home();
		for (const s of segs) {
			url += encodeURIComponent(s) + "/";
			if (made.has(url)) continue;
			const res = await call("MKCOL", url);
			if (!(res.ok || res.status === 405)) throw await fail(res, "Making the folder " + s);
			made.add(url);
		}
	}

	const parentOf = (path) => path.split("/").slice(0, -1).join("/");

	// PUT with the given condition; makes missing folders and tries once more.
	// Nextcloud answers 404 for a missing folder (409 in the WebDAV spec).
	async function put(path, body, condition, sum) {
		const headers = { "Content-Type": "application/octet-stream", "OC-Checksum": "SHA1:" + sum, ...condition };
		let res = await call("PUT", fileUrl(path), { headers, body });
		if (res.status === 404 || res.status === 409) {
			await makeFolders(parentOf(path));
			res = await call("PUT", fileUrl(path), { headers, body });
		}
		cache = null;
		return res;
	}

	// Every file in the notebook. One small request when nothing has changed:
	// the notebook folder's ETag moves whenever anything inside it does.
	async function everything() {
		const top = await propfind(rootUrl(), 0);
		if (top.status === 404) { cache = null; return []; } // not made yet: the first write makes it
		if (top.status !== 207) throw await fail(top.res, "Listing the notebook");
		const tag = top.entries[0]?.etag || "";
		if (cache && tag && cache.tag === tag && now() - cache.at < FULL_EVERY) return cache.files;
		const entries = await walk();
		const files = [];
		for (const e of entries) {
			if (e.folder) continue;
			const path = relative(e.href);
			if (path) files.push({ path, version: versionOf(e.etag, e.size, e.sha1), size: e.size, etag: e.etag });
		}
		files.sort((a, b) => (a.path < b.path ? -1 : 1));
		cache = { tag, at: now(), files: files.map(({ etag, ...f }) => f), byPath: new Map(files.map((f) => [f.path, f])) };
		return cache.files;
	}

	// The whole tree in one request where the server allows it; folder by
	// folder where it doesn't. Hidden folders (.obsidian, .trash) are skipped.
	async function walk() {
		const all = await propfind(rootUrl(), "infinity");
		if (all.status === 207) return all.entries;
		const out = [];
		const queue = [rootUrl()];
		while (queue.length) {
			const url = queue.shift();
			const r = await propfind(url, 1);
			if (r.status === 404) continue;
			if (r.status !== 207) throw await fail(r.res, "Listing the notebook");
			const self = relative(url);
			for (const e of r.entries) {
				const p = relative(e.href);
				if (p == null || p === self) continue;
				if (!e.folder) out.push(e);
				else if (!p.split("/").pop().startsWith(".")) queue.push(rootUrl() + encodePath(p) + "/");
			}
		}
		return out;
	}

	async function download(path) {
		const res = await call("GET", fileUrl(path));
		if (res.status === 404) return null;
		if (!res.ok) throw await fail(res, "Reading " + path);
		return { etag: cleanEtag(res.headers.get("ETag")), bytes: new Uint8Array(await res.arrayBuffer()) };
	}

	// The version for bytes just read: the listing's when the file hasn't
	// moved since it was taken, so the next sync agrees with it. Otherwise
	// it's worked out from the bytes, which matches what Nextcloud lists for a
	// file wr1t3r wrote; for one another app wrote, the next sync reads it
	// once more and then agrees.
	async function readVersion(path, f) {
		const listed = cache?.byPath.get(path);
		if (listed && (!f.etag || f.etag === listed.etag) && listed.size === f.bytes.length) return listed.version;
		return versionOf(f.etag, f.bytes.length, await sha1(f.bytes));
	}

	return {
		async check() {
			const r = await propfind(rootUrl(), 0);
			if (r.status === 404) return makeFolders("");
			if (r.status !== 207) throw await fail(r.res, "Opening the notebook folder");
		},
		async list() {
			return (await everything()).filter((f) => isNotePath(f.path));
		},
		async attachments() {
			return (await everything()).filter((f) => isAttachmentPath(f.path));
		},
		async read(paths) {
			return pool(paths, async (path) => {
				const f = isNotePath(path) && (await download(path));
				return f ? { path, version: await readVersion(path, f), bytes: f.bytes } : { path, missing: true };
			});
		},
		async write(path, bytes, expected) {
			if (!isNotePath(path)) throw new Error("Not a note path: " + path);
			const sum = await sha1(bytes);
			const res = await put(path, bytes, expected ? { "If-Match": `"${etagOfVersion(expected)}"` } : { "If-None-Match": "*" }, sum);
			if (res.status === 412) return { ok: false, version: (await stat(path))?.version ?? null };
			if (!res.ok) throw await fail(res, "Saving " + path);
			const etag = cleanEtag(res.headers.get("ETag"));
			return { ok: true, version: etag ? versionOf(etag, bytes.length, sum) : (await stat(path))?.version };
		},
		async remove(path, expected) {
			const res = await call("DELETE", fileUrl(path), { headers: { "If-Match": `"${etagOfVersion(expected)}"` } });
			cache = null;
			if (res.ok || res.status === 404) return { ok: true };
			if (res.status !== 412) throw await fail(res, "Deleting " + path);
			const cur = await stat(path);
			return cur ? { ok: false, version: cur.version } : { ok: true };
		},
		async attachment(path) {
			const f = isAttachmentPath(path) && (await download(path));
			if (!f) throw new Error("No such attachment");
			return new Blob([f.bytes], { type: attachmentType(path) });
		},
		async uploadAttachment(path, blob) {
			if (!isAttachmentPath(path)) throw new Error("Not an attachment path: " + path);
			const bytes = new Uint8Array(await blob.arrayBuffer());
			const sum = await sha1(bytes);
			const res = await put(path, bytes, { "If-None-Match": "*" }, sum);
			if (res.status === 412) return false;
			if (!res.ok) throw await fail(res, "Uploading " + path);
			const etag = cleanEtag(res.headers.get("ETag"));
			return { path, version: etag ? versionOf(etag, bytes.length, sum) : (await stat(path))?.version, size: bytes.length };
		},
	};
}

// Signs in from the sign-in screen: finds the account (findAccount, below),
// makes the notebook folder, and keeps the details on this device. Throws a
// NextcloudError saying what went wrong.
export async function connectNextcloud({ server, user, password, folder, get = (...a) => fetch(...a), pageProtocol = globalThis.location?.protocol, save = writeCreds } = {}) {
	const c = { ...(await findAccount({ server, user, password, get, pageProtocol, folder: folderName(folder) })) };
	try {
		await nextcloudStorage({ creds: () => c, get }).check();
	} catch (e) {
		if (e instanceof NextcloudError || e instanceof AuthError) throw e;
		throw new NextcloudError("folder", `Couldn't open or make the folder ${c.folder}: ${e.message}`);
	}
	save(c);
	return c;
}

// Finds the server, checks the app password and learns the account's user ID
// (Nextcloud accepts an email to sign in, but its DAV paths use the ID):
// {server, user, uid, password}, plus anything in extra. Throws a
// NextcloudError saying what went wrong. The calendar connects with this too.
export async function findAccount({ server, user, password, get = (...a) => fetch(...a), pageProtocol = globalThis.location?.protocol, ...extra } = {}) {
	const address = serverAddress(server);
	if (!address) throw new NextcloudError("address", "Enter your Nextcloud's address, like cloud.example.com.");
	if (pageProtocol === "https:" && address.startsWith("http://")) throw new NextcloudError("insecure", "Use your Nextcloud's https:// address. Browsers block an http:// server from a secure page.");
	user = String(user || "").trim();
	password = String(password || "").replace(/\s+/g, "");
	if (!user || !password) throw new NextcloudError("password", "Enter your Nextcloud username and an app password.");
	const c = { server: address, user, uid: "", password, ...extra };
	const call = requester({ creds: () => c, get });

	let res;
	try {
		res = await call("PROPFIND", address + "/remote.php/dav/", { depth: 0, body: PRINCIPAL });
	} catch (e) {
		if (e instanceof AuthError) throw new NextcloudError("password", "Nextcloud didn't accept that username and app password.");
		throw e;
	}
	if (res.status !== 207) throw new NextcloudError("address", `That address answered, but not like a Nextcloud (HTTP ${res.status}). Check it's the address you open Nextcloud at.`);
	const principal = text("href", element("current-user-principal", await res.text()) || "") || "";
	const id = principal.replace(/\/+$/, "").split("/").pop();
	try { c.uid = id ? decodeURIComponent(id) : user; } catch { c.uid = user; }
	return c;
}
