// Fetches a web page for the clipper. The browser can't read other sites
// directly (CORS), so it asks the Worker. Copied from Reader's /api/fetch
// (librarykaiju/reader): only public http(s) addresses, a handful of
// redirects (each one re-checked), 15s and 5MB at most, and only for someone
// holding the token -- never an open proxy.

import { HttpError } from "./util.js";

const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const FETCH_MAX_REDIRECTS = 5;
const FETCH_HEADERS = {
	"User-Agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
	Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
};

export async function proxyFetch(raw, env) {
	const allowPrivate = env.ALLOW_PRIVATE_FETCH === "1";
	let target = checkTarget(raw, allowPrivate);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		let res;
		for (let hop = 0; ; hop++) {
			res = await fetch(target.href, { headers: FETCH_HEADERS, redirect: "manual", signal: controller.signal });
			const location = res.status >= 300 && res.status < 400 ? res.headers.get("Location") : null;
			if (!location) break;
			await res.body?.cancel();
			if (hop >= FETCH_MAX_REDIRECTS) throw new HttpError(502, "Too many redirects");
			target = checkTarget(new URL(location, target).href, allowPrivate);
		}
		if (!res.ok) {
			await res.body?.cancel();
			throw new HttpError(502, `The site answered ${res.status}`);
		}
		if (Number(res.headers.get("Content-Length")) > FETCH_MAX_BYTES) {
			await res.body?.cancel();
			throw new HttpError(413, "That page is over 5 MB");
		}
		const body = await readCapped(res.body, FETCH_MAX_BYTES);
		return new Response(body, {
			headers: {
				"Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
				"X-Final-URL": target.href,
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
				// Someone else's HTML, served from this origin: never let it run here.
				"Content-Security-Policy": "default-src 'none'; sandbox",
			},
		});
	} catch (err) {
		if (err instanceof HttpError) throw err;
		if (controller.signal.aborted) throw new HttpError(504, "The site took too long to answer");
		throw new HttpError(502, `Couldn't fetch that: ${err?.message || err}`);
	} finally {
		clearTimeout(timer);
	}
}

async function readCapped(stream, max) {
	if (!stream) return new Uint8Array(0);
	const reader = stream.getReader();
	const chunks = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel();
			throw new HttpError(413, "That page is over 5 MB");
		}
		chunks.push(value);
	}
	const out = new Uint8Array(size);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.byteLength;
	}
	return out;
}

export function checkTarget(raw, allowPrivate) {
	let u;
	try {
		u = new URL(String(raw || ""));
	} catch {
		throw new HttpError(400, "That isn't a valid URL");
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") throw new HttpError(400, "Only http and https URLs");
	if (u.username || u.password) throw new HttpError(400, "URLs with a username or password aren't allowed");
	if (!allowPrivate && isPrivateHost(u.hostname)) throw new HttpError(403, "That address is private");
	u.hash = "";
	return u;
}

// The URL parser has already normalized odd IPv4 spellings (0x7f.1,
// 2130706433, 127.1 ...) to dotted decimal and IPv6 to compressed hex.
function isPrivateHost(hostname) {
	const host = hostname.toLowerCase().replace(/\.$/, "");
	if (!host) return true;
	if (host === "localhost" || /\.(localhost|local|internal|home\.arpa)$/.test(host)) return true;
	if (host.startsWith("[")) return !isPublicIPv6(host.slice(1, -1));
	const v4 = parseIPv4(host);
	if (v4) return !isPublicIPv4(v4);
	return !host.includes("."); // single-label names only mean something on a LAN
}

function parseIPv4(s) {
	const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!m) return null;
	const parts = m.slice(1).map(Number);
	return parts.every((n) => n <= 255) ? parts : null;
}

function isPublicIPv4([a, b, c]) {
	if (a === 0 || a === 10 || a === 127) return false; // "this" network, private, loopback
	if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
	if (a === 169 && b === 254) return false; // link-local (incl. cloud metadata)
	if (a === 172 && b >= 16 && b <= 31) return false;
	if (a === 192 && b === 168) return false;
	if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
	if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
	if ((a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false;
	if (a >= 224) return false; // multicast, reserved, broadcast
	return true;
}

function parseIPv6(s) {
	s = s.split("%")[0];
	const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
	if (dotted) {
		const v4 = parseIPv4(dotted[2]);
		if (!v4) return null;
		s = dotted[1] + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
	}
	const halves = s.split("::");
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(":") : [];
	let parts = head;
	if (halves.length === 2) {
		const tail = halves[1] ? halves[1].split(":") : [];
		const fill = 8 - head.length - tail.length;
		if (fill < 1) return null;
		parts = [...head, ...Array(fill).fill("0"), ...tail];
	}
	if (parts.length !== 8 || !parts.every((x) => /^[0-9a-f]{1,4}$/i.test(x))) return null;
	return parts.map((x) => parseInt(x, 16));
}

// Allow-list: only global unicast (2000::/3), minus documentation and 6to4.
// IPv4-mapped and NAT64 addresses are judged by the IPv4 address inside.
function isPublicIPv6(s) {
	const h = parseIPv6(s);
	if (!h) return false;
	const inner = [h[6] >> 8, h[6] & 255, h[7] >> 8, h[7] & 255];
	if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return isPublicIPv4(inner);
	if (h[0] === 0x64 && h[1] === 0xff9b) return isPublicIPv4(inner);
	if ((h[0] & 0xe000) !== 0x2000) return false;
	if (h[0] === 0x2001 && h[1] === 0x0db8) return false;
	if (h[0] === 0x2002) return false;
	return true;
}
