// Reminders as phone and computer notifications (Web Push), sent by the
// Worker's cron so they arrive with wr1t3r closed.
//
//   GET    /api/push/key        -> {"key"} the VAPID public key the page subscribes with
//   POST   /api/push/subscribe  {subscription, device} -> {"ok"}  (a browser's PushSubscription)
//   POST   /api/push/unsubscribe {endpoint} -> {"ok"}
//   PUT    /api/reminders       {reminders: [{id, at, title, path}]} (at in ms) -> {"count"}
//   POST   /api/push/test       sends "Reminders are on" to every device -> {"sent"}
//
// Secrets: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (`npm run vapid` makes a
// pair and prints the commands), VAPID_SUBJECT optional (a mailto: or https:
// address push services can contact; defaults to the Worker's own address).
// State lives in the VAULT bucket at .wr1t3r/reminders.json, outside any note
// path, so it never shows up as a note.

import { HttpError } from "./util.js";

const STATE_KEY = ".wr1t3r/reminders.json";
const MAX_REMINDERS = 1000;
const STALE = 6 * 3600 * 1000; // a reminder this late (the Worker was down) is skipped

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

async function readState(env) {
	const o = await env.VAULT.get(STATE_KEY);
	const s = o ? await o.json().catch(() => null) : null;
	return { subscriptions: s?.subscriptions || [], reminders: s?.reminders || [], sent: s?.sent || {} };
}
const writeState = (env, s) => env.VAULT.put(STATE_KEY, JSON.stringify(s), { httpMetadata: { contentType: "application/json" } });

function needKeys(env) {
	if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new HttpError(501, "Reminders aren't set up on the Worker yet: run npm run vapid and add the two secrets it prints");
	if (!env.VAULT) throw new HttpError(501, "Reminders need the VAULT bucket");
}

export async function pushApi(request, env, url) {
	const p = url.pathname, m = request.method;
	if (!p.startsWith("/api/push/") && p !== "/api/reminders") return null;
	needKeys(env);
	if (p === "/api/push/key" && m === "GET") return { key: env.VAPID_PUBLIC_KEY };
	if (p === "/api/push/subscribe" && m === "POST") {
		const body = await request.json().catch(() => null);
		const sub = body?.subscription;
		if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new HttpError(400, "Send a push subscription");
		const s = await readState(env);
		s.subscriptions = [...s.subscriptions.filter((x) => x.endpoint !== sub.endpoint), { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, device: String(body.device || "").slice(0, 80) }].slice(-20);
		await writeState(env, s);
		return { ok: true };
	}
	if (p === "/api/push/unsubscribe" && m === "POST") {
		const body = await request.json().catch(() => null);
		const s = await readState(env);
		s.subscriptions = s.subscriptions.filter((x) => x.endpoint !== body?.endpoint);
		await writeState(env, s);
		return { ok: true };
	}
	if (p === "/api/push/test" && m === "POST") {
		const s = await readState(env);
		let sent = 0;
		for (const sub of s.subscriptions) if ((await send(env, sub, { title: "Reminders are on", body: "wr1t3r can remind you on this device." })) === "ok") sent++;
		return { sent };
	}
	if (p === "/api/reminders" && m === "PUT") {
		const body = await request.json().catch(() => null);
		if (!Array.isArray(body?.reminders)) throw new HttpError(400, "Send {reminders: [...]}");
		const list = body.reminders
			.filter((r) => r && typeof r.id === "string" && Number.isFinite(r.at))
			.slice(0, MAX_REMINDERS)
			.map((r) => ({ id: r.id.slice(0, 40), at: r.at, title: String(r.title || "Reminder").slice(0, 200), path: String(r.path || "").slice(0, 500) }));
		const s = await readState(env);
		s.reminders = list;
		const ids = new Set(list.map((r) => r.id));
		s.sent = Object.fromEntries(Object.entries(s.sent).filter(([id]) => ids.has(id)));
		await writeState(env, s);
		return { count: list.length };
	}
	return null;
}

// The cron: sends every reminder that's due and not sent yet.
export async function sendDue(env, now = Date.now()) {
	if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAULT) return;
	const s = await readState(env);
	const due = s.reminders.filter((r) => r.at <= now && !s.sent[r.id]);
	if (!due.length) return;
	const gone = new Set();
	for (const r of due) {
		s.sent[r.id] = now;
		if (now - r.at > STALE) continue;
		for (const sub of s.subscriptions) {
			if (gone.has(sub.endpoint)) continue;
			const res = await send(env, sub, { title: r.title, body: "Reminder", path: r.path, tag: r.id });
			if (res === "gone") gone.add(sub.endpoint);
		}
	}
	s.subscriptions = s.subscriptions.filter((x) => !gone.has(x.endpoint));
	await writeState(env, s);
}

// ---- Web Push (RFC 8291 encryption, RFC 8292 VAPID) -------------------------

async function vapidHeader(env, endpoint) {
	const pub = unb64u(env.VAPID_PUBLIC_KEY);
	const jwk = { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: env.VAPID_PRIVATE_KEY, ext: true };
	const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
	const aud = new URL(endpoint).origin;
	const sub = env.VAPID_SUBJECT || "mailto:wr1t3r@example.com";
	const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
	const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })));
	const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`));
	return `vapid t=${head}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

async function hkdf(salt, ikm, info, length) {
	const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
	return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

export async function encrypt(payload, p256dh, auth) {
	const uaPub = unb64u(p256dh);
	const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
	const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
	const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
	const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
	const ikm = await hkdf(unb64u(auth), shared, concat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
	const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
	const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
	const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
	const header = new Uint8Array(21);
	header.set(salt, 0);
	new DataView(header.buffer).setUint32(16, 4096);
	header[20] = asPub.length;
	return concat(header, asPub, body);
}

// "ok", "gone" (the browser dropped the subscription) or "failed".
async function send(env, sub, message) {
	try {
		const res = await fetch(sub.endpoint, {
			method: "POST",
			headers: {
				Authorization: await vapidHeader(env, sub.endpoint),
				"Content-Encoding": "aes128gcm",
				"Content-Type": "application/octet-stream",
				TTL: "86400",
				Urgency: "high",
			},
			body: await encrypt(JSON.stringify(message), sub.keys.p256dh, sub.keys.auth),
		});
		if (res.status === 404 || res.status === 410) return "gone";
		return res.ok ? "ok" : "failed";
	} catch {
		return "failed";
	}
}
