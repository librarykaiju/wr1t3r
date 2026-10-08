// The product build's license key (Polar). Only a build with
// VITE_POLAR_ORG_ID set asks for one; everything here is inert otherwise.
//
// Each device gets a free trial from the day it's first opened. After that
// wr1t3r asks for a key. Activating one registers this device as an
// "activation" of the key, so the license key benefit's activation limit
// caps devices. The key is checked again about once a week while online. A
// revoked or disabled key, or a device removed from it, goes back to asking;
// being offline never does. The notes stay in the user's own storage either way.
//
// This runs in the page, so anyone reading the code can get round it. At
// this price that's fine: it keeps honest people honest.

export const TRIAL_DAYS = 14;
export const RECHECK_DAYS = 7;
const DAY = 86400000;

// Where Polar's customer-portal license key API is. These calls need no token
// and take requests from any site. A build can point them elsewhere
// (VITE_LICENSE_API), such as https://sandbox-api.polar.sh/v1/customer-portal/license-keys
// to try it with Polar's sandbox.
export const DEFAULT_API = "https://api.polar.sh/v1/customer-portal/license-keys";

// { status: "licensed" | "trial" | "ended", daysLeft } for this device.
// license: the saved { key, instance, ... } or null; trialStart: ms or null.
// instance is the Polar activation's id.
export function licenseState(license, trialStart, now = Date.now(), trialDays = TRIAL_DAYS) {
	if (license?.key && license?.instance) return { status: "licensed", daysLeft: null };
	const start = Number.isFinite(trialStart) ? trialStart : now;
	const daysLeft = Math.max(0, Math.ceil((start + trialDays * DAY - now) / DAY));
	return { status: daysLeft > 0 ? "trial" : "ended", daysLeft };
}

// Whether a saved license is due a check with Polar.
export const dueCheck = (license, now = Date.now()) => !!license && !(license.checkedAt > now - RECHECK_DAYS * DAY);

// A key as pasted: trimmed, with spaces and line breaks taken out.
export const cleanKey = (s) => String(s || "").replace(/\s+/g, "");

async function post(fetchFn, api, action, fields) {
	const res = await fetchFn(`${api}/${action}`, {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify(fields),
	});
	let body = null;
	try { body = await res.json(); } catch {}
	return { status: res.status, body: body || {} };
}

// Polar's reason, when it gives one as text.
const detail = (body) => (typeof body.detail === "string" ? body.detail : "");

// The key is for this product's license key benefit, when the build names
// one. (The organization is checked by Polar: a key from another one isn't found.)
const ours = (key, benefit) => !benefit || String(key?.benefit_id ?? "") === String(benefit);

const NOT_OURS = "That key isn't for wr1t3r.";

// Activates key on this device. Resolves to the license to save, or throws
// an Error with a message to show. A network failure throws a TypeError.
export async function activateLicense(key, { fetch: fetchFn = fetch, api = DEFAULT_API, org, benefit, name = "wr1t3r", now = Date.now() }) {
	const k = cleanKey(key);
	if (!k) throw new Error("Paste your license key.");
	const { status, body } = await post(fetchFn, api, "activate", { key: k, organization_id: org, label: name });
	if (status !== 200 || !body.id) {
		const why = detail(body);
		if (status === 404) throw new Error("That key wasn't found. Check it against the one in your Polar purchases.");
		if (status === 403 && /supports \d+ activation|limit/i.test(why)) throw new Error("That key is already on as many devices as it allows. Remove it from one (Settings > License there), then try again.");
		if (status === 403 && /expired|revoked|disabled|no longer active/i.test(why)) throw new Error("That key is no longer active.");
		if (status === 429 || status >= 500) throw new Error("Polar is unavailable. Try again in a minute.");
		throw new Error(why ? "Polar says: " + why : "That key wasn't accepted.");
	}
	const lk = body.license_key || {};
	if (!ours(lk, benefit)) {
		// Give the activation back so it doesn't use up one of their devices.
		await post(fetchFn, api, "deactivate", { key: k, organization_id: org, activation_id: body.id }).catch(() => {});
		throw new Error(NOT_OURS);
	}
	return { key: k, instance: body.id, name: lk.customer?.name || "", email: lk.customer?.email || "", checkedAt: now };
}

// Checks a saved license. Resolves to the license (with a new checkedAt) when
// it's still good, or null when Polar says it isn't. A network failure or
// Polar being down rejects, and the caller keeps the license as it was.
export async function checkLicense(license, { fetch: fetchFn = fetch, api = DEFAULT_API, org, benefit, now = Date.now() }) {
	const { status, body } = await post(fetchFn, api, "validate", { key: license.key, organization_id: org, activation_id: license.instance });
	if (status === 429 || status >= 500) throw new Error("Polar is unavailable.");
	if (status !== 200 || body.status !== "granted" || !ours(body, benefit)) return null;
	if (body.activation?.id !== license.instance) return null;
	return { ...license, checkedAt: now };
}

// Takes this device off the key, so it can go on another.
export async function deactivateLicense(license, { fetch: fetchFn = fetch, api = DEFAULT_API, org }) {
	const { status, body } = await post(fetchFn, api, "deactivate", { key: license.key, organization_id: org, activation_id: license.instance });
	if (status === 204 || status === 200 || status === 404) return; // 404: already gone
	const why = detail(body);
	throw new Error(why ? "Polar says: " + why : "Couldn't remove this device.");
}

// The key with all but its last part hidden.
export const maskKey = (key) => { const k = cleanKey(key); return k.length > 8 ? "•".repeat(8) + k.slice(-8) : k; };
