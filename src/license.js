// The product build's license key (Lemon Squeezy). Only a build with
// VITE_LS_STORE_ID set asks for one; everything here is inert otherwise.
//
// Each device gets a free trial from the day it's first opened. After that
// wr1t3r asks for a key. Activating one registers this device as an
// "instance" of the key, so Lemon Squeezy's activation limit caps devices.
// The key is checked again about once a week while online. A refunded or
// disabled key, or a device removed from it, goes back to asking; being
// offline never does. The notes stay in the user's own storage either way.
//
// This runs in the page, so anyone reading the code can get round it. At
// this price that's fine: it keeps honest people honest.

export const TRIAL_DAYS = 14;
export const RECHECK_DAYS = 7;
const DAY = 86400000;

// Where the License API is. A build can point it at a proxy of its own
// (VITE_LICENSE_API) if the browser can't reach Lemon Squeezy directly.
export const DEFAULT_API = "https://api.lemonsqueezy.com/v1/licenses";

// { status: "licensed" | "trial" | "ended", daysLeft } for this device.
// license: the saved { key, instance, ... } or null; trialStart: ms or null.
export function licenseState(license, trialStart, now = Date.now(), trialDays = TRIAL_DAYS) {
	if (license?.key && license?.instance) return { status: "licensed", daysLeft: null };
	const start = Number.isFinite(trialStart) ? trialStart : now;
	const daysLeft = Math.max(0, Math.ceil((start + trialDays * DAY - now) / DAY));
	return { status: daysLeft > 0 ? "trial" : "ended", daysLeft };
}

// Whether a saved license is due a check with Lemon Squeezy.
export const dueCheck = (license, now = Date.now()) => !!license && !(license.checkedAt > now - RECHECK_DAYS * DAY);

// A key as pasted: trimmed, with spaces and line breaks taken out.
export const cleanKey = (s) => String(s || "").replace(/\s+/g, "");

async function post(fetchFn, api, action, fields) {
	const res = await fetchFn(`${api}/${action}`, {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(fields).toString(),
	});
	let body = null;
	try { body = await res.json(); } catch {}
	return { status: res.status, body: body || {} };
}

// The key belongs to this product: the right store, and the right product
// when the build names one.
function ours(meta, { store, product }) {
	if (String(meta?.store_id ?? "") !== String(store)) return false;
	return !product || String(meta?.product_id ?? "") === String(product);
}

const NOT_OURS = "That key isn't for wr1t3r.";

// Activates key on this device. Resolves to the license to save, or throws
// an Error with a message to show. A network failure throws a TypeError.
export async function activateLicense(key, { fetch: fetchFn = fetch, api = DEFAULT_API, store, product, name = "wr1t3r", now = Date.now() }) {
	const k = cleanKey(key);
	if (!k) throw new Error("Paste your license key.");
	const { body } = await post(fetchFn, api, "activate", { license_key: k, instance_name: name });
	if (!body.activated) {
		const err = String(body.error || "");
		if (/limit/i.test(err)) throw new Error("That key is already on as many devices as it allows. Remove it from one (Settings > License there), then try again.");
		if (/expired|disabled|refunded|inactive/i.test(err)) throw new Error("That key is no longer active.");
		if (/not found/i.test(err)) throw new Error("That key wasn't found. Check it against your purchase email.");
		throw new Error(err ? "Lemon Squeezy says: " + err : "That key wasn't accepted.");
	}
	if (!ours(body.meta, { store, product })) {
		// Give the activation back so it doesn't use up one of their devices.
		await post(fetchFn, api, "deactivate", { license_key: k, instance_id: body.instance?.id }).catch(() => {});
		throw new Error(NOT_OURS);
	}
	return { key: k, instance: body.instance.id, name: body.meta.customer_name || "", email: body.meta.customer_email || "", checkedAt: now };
}

// Checks a saved license. Resolves to the license (with a new checkedAt) when
// it's still good, or null when Lemon Squeezy says it isn't. A network
// failure rejects, and the caller keeps the license as it was.
export async function checkLicense(license, { fetch: fetchFn = fetch, api = DEFAULT_API, store, product, now = Date.now() }) {
	const { status, body } = await post(fetchFn, api, "validate", { license_key: license.key, instance_id: license.instance });
	if (status >= 500) throw new Error("Lemon Squeezy is unavailable.");
	if (!body.valid || !ours(body.meta, { store, product })) return null;
	if (body.instance && body.instance.id !== license.instance) return null;
	return { ...license, checkedAt: now };
}

// Takes this device off the key, so it can go on another.
export async function deactivateLicense(license, { fetch: fetchFn = fetch, api = DEFAULT_API }) {
	const { body } = await post(fetchFn, api, "deactivate", { license_key: license.key, instance_id: license.instance });
	if (!body.deactivated && !/not found/i.test(String(body.error || ""))) throw new Error(body.error ? "Lemon Squeezy says: " + body.error : "Couldn't remove this device.");
}

// The key with all but its last part hidden.
export const maskKey = (key) => { const k = cleanKey(key); return k.length > 8 ? "•".repeat(8) + k.slice(-8) : k; };
