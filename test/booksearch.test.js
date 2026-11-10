import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/api.js";

// The page asks Apple Books itself; the Worker is told not to.
test("book search: Apple from the page, Open Library from the Worker, merged", async () => {
	const store = { "wr1t3r-token": "t" };
	globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem() {}, removeItem() {} };
	const real = globalThis.fetch, seen = [];
	let worker = () => new Response(JSON.stringify({ results: [{ title: "Calamity", subtitle: "Brandon Sanderson", ref: { workKey: "/works/OL9W", title: "Calamity", authors: ["Brandon Sanderson"] } }] }));
	let apple = () => new Response(JSON.stringify({ results: [{ trackName: "The Calamities", artistName: "Chuck Wendig", releaseDate: "2026-08-18T07:00:00Z" }] }));
	globalThis.fetch = async (url) => {
		const u = new URL(url, "https://w");
		seen.push(u);
		return u.hostname === "itunes.apple.com" ? apple() : worker();
	};
	try {
		const r = await api.mediaSearch("book", "The Calamities Chuck Wendig");
		assert.deepEqual(r.map((x) => x.title), ["The Calamities", "Calamity"]);
		assert.equal(seen.find((u) => u.pathname === "/api/media/search").searchParams.get("apple"), "page");

		apple = () => new Response("{}", { status: 429 });
		assert.deepEqual((await api.mediaSearch("book", "Calamity")).map((x) => x.title), ["Calamity"], "Apple turning us away still shows Open Library's");

		worker = () => new Response(JSON.stringify({ results: [] }));
		await assert.rejects(api.mediaSearch("book", "Calamities"), /429/, "nothing found and a source failed: say so");

		worker = () => new Response("{}", { status: 401 });
		apple = () => new Response(JSON.stringify({ results: [{ trackName: "X", artistName: "Y" }] }));
		await assert.rejects(api.mediaSearch("book", "X"), /token/, "signed out still shows");
	} finally { globalThis.fetch = real; delete globalThis.localStorage; }
});
