import { test } from "node:test";
import assert from "node:assert/strict";
import { licenseState, dueCheck, activateLicense, checkLicense, deactivateLicense, cleanKey, maskKey } from "../src/license.js";

const DAY = 86400000;
const KEY = "38b1460a-5104-4067-a91d-77b872934d51";

// A stand-in for the License API: keys -> { store, product, status, limit, instances }.
function fakeLemon(keys) {
	const calls = [];
	let n = 0;
	const meta = (k) => ({ store_id: k.store, product_id: k.product, customer_name: "Ada", customer_email: "ada@example.com" });
	const fetchFn = async (url, init) => {
		const action = url.split("/").pop();
		const f = Object.fromEntries(new URLSearchParams(init.body));
		calls.push([action, f]);
		const k = keys[f.license_key];
		const json = (o, status = 200) => ({ status, json: async () => o });
		if (!k) return json({ [action === "validate" ? "valid" : action === "activate" ? "activated" : "deactivated"]: false, error: "license_key not found." }, 404);
		if (action === "activate") {
			if (k.status !== "active") return json({ activated: false, error: `This license key is ${k.status}.` }, 400);
			if (k.instances.length >= k.limit) return json({ activated: false, error: "This license key has reached the activation limit." }, 400);
			const id = "inst-" + ++n;
			k.instances.push(id);
			return json({ activated: true, error: null, instance: { id, name: f.instance_name }, meta: meta(k) });
		}
		if (action === "validate") {
			const has = k.instances.includes(f.instance_id);
			if (!has) return json({ valid: false, error: "license_key instance not found.", meta: meta(k) }, 404);
			return json({ valid: k.status === "active", error: null, instance: { id: f.instance_id }, meta: meta(k) });
		}
		if (action === "deactivate") {
			const at = k.instances.indexOf(f.instance_id);
			if (at < 0) return json({ deactivated: false, error: "license_key instance not found." }, 404);
			k.instances.splice(at, 1);
			return json({ deactivated: true, error: null, meta: meta(k) });
		}
	};
	return { fetch: fetchFn, calls };
}

test("a device gets a trial, then needs a key", () => {
	const t0 = Date.UTC(2026, 9, 1);
	assert.deepEqual(licenseState(null, null, t0), { status: "trial", daysLeft: 14 });
	assert.deepEqual(licenseState(null, t0, t0 + 13.5 * DAY), { status: "trial", daysLeft: 1 });
	assert.deepEqual(licenseState(null, t0, t0 + 14 * DAY), { status: "ended", daysLeft: 0 });
	assert.equal(licenseState({ key: KEY, instance: "i" }, t0, t0 + 400 * DAY).status, "licensed");
});

test("a saved license is checked about once a week", () => {
	const now = Date.UTC(2026, 9, 10);
	assert.equal(dueCheck(null, now), false);
	assert.equal(dueCheck({ checkedAt: now - 2 * DAY }, now), false);
	assert.equal(dueCheck({ checkedAt: now - 8 * DAY }, now), true);
	assert.equal(dueCheck({}, now), true);
});

test("activating a good key saves it with its instance", async () => {
	const lemon = fakeLemon({ [KEY]: { store: 7, product: 9, status: "active", limit: 3, instances: [] } });
	const lic = await activateLicense(` ${KEY}\n`, { fetch: lemon.fetch, store: "7", product: "9", name: "wr1t3r on iPhone", now: 5 });
	assert.deepEqual(lic, { key: KEY, instance: "inst-1", name: "Ada", email: "ada@example.com", checkedAt: 5 });
	assert.equal(lemon.calls[0][1].instance_name, "wr1t3r on iPhone");
});

test("activation errors say what to do", async () => {
	const lemon = fakeLemon({
		full: { store: 7, status: "active", limit: 1, instances: ["x"] },
		gone: { store: 7, status: "disabled", limit: 3, instances: [] },
	});
	const opts = { fetch: lemon.fetch, store: 7 };
	await assert.rejects(activateLicense("", opts), /Paste your license key/);
	await assert.rejects(activateLicense("full", opts), /as many devices as it allows/);
	await assert.rejects(activateLicense("gone", opts), /no longer active/);
	await assert.rejects(activateLicense("nope", opts), /wasn.t found/);
});

test("a key from another store or product is turned down, and its activation given back", async () => {
	const keys = { other: { store: 1, status: "active", limit: 3, instances: [] }, wrongProduct: { store: 7, product: 2, status: "active", limit: 3, instances: [] } };
	const lemon = fakeLemon(keys);
	await assert.rejects(activateLicense("other", { fetch: lemon.fetch, store: 7 }), /isn't for wr1t3r/);
	assert.deepEqual(keys.other.instances, []);
	await assert.rejects(activateLicense("wrongProduct", { fetch: lemon.fetch, store: 7, product: 9 }), /isn't for wr1t3r/);
	// No product named in the build: any product in the store will do.
	assert.ok(await activateLicense("wrongProduct", { fetch: lemon.fetch, store: 7 }));
});

test("checking keeps a good license, drops a refunded or removed one, and leaves it alone offline", async () => {
	const keys = { [KEY]: { store: 7, status: "active", limit: 3, instances: [] } };
	const lemon = fakeLemon(keys);
	const opts = { fetch: lemon.fetch, store: 7 };
	const lic = await activateLicense(KEY, { ...opts, now: 1 });
	assert.equal((await checkLicense(lic, { ...opts, now: 99 })).checkedAt, 99);
	keys[KEY].status = "refunded";
	assert.equal(await checkLicense(lic, opts), null);
	keys[KEY].status = "active";
	keys[KEY].instances = [];
	assert.equal(await checkLicense(lic, opts), null);
	await assert.rejects(checkLicense(lic, { ...opts, fetch: async () => { throw new TypeError("Failed to fetch"); } }), TypeError);
	await assert.rejects(checkLicense(lic, { ...opts, fetch: async () => ({ status: 503, json: async () => ({}) }) }), /unavailable/);
});

test("removing this device frees the activation", async () => {
	const keys = { [KEY]: { store: 7, status: "active", limit: 1, instances: [] } };
	const lemon = fakeLemon(keys);
	const opts = { fetch: lemon.fetch, store: 7 };
	const lic = await activateLicense(KEY, opts);
	await assert.rejects(activateLicense(KEY, opts), /as many devices/);
	await deactivateLicense(lic, opts);
	assert.deepEqual(keys[KEY].instances, []);
	await deactivateLicense(lic, opts); // already gone: fine
	assert.ok(await activateLicense(KEY, opts));
});

test("keys are cleaned and masked", () => {
	assert.equal(cleanKey(" ab cd\n"), "abcd");
	assert.equal(maskKey(KEY), "••••••••72934d51");
});
