import { test } from "node:test";
import assert from "node:assert/strict";
import { licenseState, dueCheck, activateLicense, checkLicense, deactivateLicense, cleanKey, maskKey } from "../src/license.js";

const DAY = 86400000;
const KEY = "38b1460a-5104-4067-a91d-77b872934d51";

// A stand-in for Polar's license key API: keys -> { org, benefit, status, limit, activations }.
function fakePolar(keys) {
	const calls = [];
	let n = 0;
	const json = (o, status = 200) => ({ status, json: async () => o });
	const err = (status, error, detail) => json({ error, detail }, status);
	const granted = (key, k) => ({ key, benefit_id: k.benefit, status: k.status, limit_activations: k.limit, customer: { name: "Ada", email: "ada@example.com" } });
	const fetchFn = async (url, init) => {
		const action = url.split("/").pop();
		const f = JSON.parse(init.body);
		calls.push([action, f]);
		const k = keys[f.key];
		if (!k || k.org !== f.organization_id) return err(404, "ResourceNotFound", "License key not found.");
		if (action === "activate") {
			if (k.status !== "granted") return err(403, "NotPermitted", "License key is no longer active.");
			if (k.activations.length >= k.limit) return err(403, "NotPermitted", `License key only supports ${k.limit} activations.`);
			const id = "act-" + ++n;
			k.activations.push(id);
			return json({ id, label: f.label, license_key: granted(f.key, k) });
		}
		if (action === "validate") {
			if (f.activation_id && !k.activations.includes(f.activation_id)) return err(404, "ResourceNotFound", "License key activation not found.");
			return json({ ...granted(f.key, k), activation: f.activation_id ? { id: f.activation_id } : undefined });
		}
		if (action === "deactivate") {
			const at = k.activations.indexOf(f.activation_id);
			if (at < 0) return err(404, "ResourceNotFound", "License key activation not found.");
			k.activations.splice(at, 1);
			return { status: 204, json: async () => { throw new SyntaxError("no body"); } };
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
	const polar = fakePolar({ [KEY]: { org: "o1", benefit: "b9", status: "granted", limit: 3, activations: [] } });
	const lic = await activateLicense(` ${KEY}\n`, { fetch: polar.fetch, org: "o1", benefit: "b9", name: "wr1t3r on iPhone", now: 5 });
	assert.deepEqual(lic, { key: KEY, instance: "act-1", name: "Ada", email: "ada@example.com", checkedAt: 5 });
	assert.equal(polar.calls[0][1].label, "wr1t3r on iPhone");
});

test("activation errors say what to do", async () => {
	const polar = fakePolar({
		full: { org: "o1", status: "granted", limit: 1, activations: ["x"] },
		gone: { org: "o1", status: "disabled", limit: 3, activations: [] },
	});
	const opts = { fetch: polar.fetch, org: "o1" };
	await assert.rejects(activateLicense("", opts), /Paste your license key/);
	await assert.rejects(activateLicense("full", opts), /as many devices as it allows/);
	await assert.rejects(activateLicense("gone", opts), /no longer active/);
	await assert.rejects(activateLicense("nope", opts), /wasn.t found/);
	await assert.rejects(activateLicense("x", { ...opts, fetch: async () => ({ status: 502, json: async () => ({}) }) }), /Polar is unavailable/);
});

test("a key for another product is turned down, and its activation given back", async () => {
	const keys = { other: { org: "o2", status: "granted", limit: 3, activations: [] }, wrongBenefit: { org: "o1", benefit: "b2", status: "granted", limit: 3, activations: [] } };
	const polar = fakePolar(keys);
	// Another organization's key: Polar doesn't find it.
	await assert.rejects(activateLicense("other", { fetch: polar.fetch, org: "o1" }), /wasn.t found/);
	await assert.rejects(activateLicense("wrongBenefit", { fetch: polar.fetch, org: "o1", benefit: "b9" }), /isn't for wr1t3r/);
	assert.deepEqual(keys.wrongBenefit.activations, []);
	// No benefit named in the build: any key from the organization will do.
	assert.ok(await activateLicense("wrongBenefit", { fetch: polar.fetch, org: "o1" }));
});

test("checking keeps a good license, drops a revoked or removed one, and leaves it alone offline", async () => {
	const keys = { [KEY]: { org: "o1", status: "granted", limit: 3, activations: [] } };
	const polar = fakePolar(keys);
	const opts = { fetch: polar.fetch, org: "o1" };
	const lic = await activateLicense(KEY, { ...opts, now: 1 });
	assert.equal((await checkLicense(lic, { ...opts, now: 99 })).checkedAt, 99);
	keys[KEY].status = "revoked";
	assert.equal(await checkLicense(lic, opts), null);
	keys[KEY].status = "granted";
	keys[KEY].activations = [];
	assert.equal(await checkLicense(lic, opts), null);
	await assert.rejects(checkLicense(lic, { ...opts, fetch: async () => { throw new TypeError("Failed to fetch"); } }), TypeError);
	await assert.rejects(checkLicense(lic, { ...opts, fetch: async () => ({ status: 503, json: async () => ({}) }) }), /unavailable/);
});

test("removing this device frees the activation", async () => {
	const keys = { [KEY]: { org: "o1", status: "granted", limit: 1, activations: [] } };
	const polar = fakePolar(keys);
	const opts = { fetch: polar.fetch, org: "o1" };
	const lic = await activateLicense(KEY, opts);
	await assert.rejects(activateLicense(KEY, opts), /as many devices/);
	await deactivateLicense(lic, opts);
	assert.deepEqual(keys[KEY].activations, []);
	await deactivateLicense(lic, opts); // already gone: fine
	assert.ok(await activateLicense(KEY, opts));
});

test("keys are cleaned and masked", () => {
	assert.equal(cleanKey(" ab cd\n"), "abcd");
	assert.equal(maskKey(KEY), "••••••••72934d51");
});
