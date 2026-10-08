import test from "node:test";
import assert from "node:assert/strict";
import { bookmarklet, readPayload, MAX_PAYLOAD } from "../src/clippayload.js";

const b64url = (bytes) => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function deflate(text) {
	return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
}

test("a compressed clip reads back", async () => {
	const json = JSON.stringify({ u: "https://example.com/a", h: "<html><body><p>Héllo ✓</p></body></html>", s: 1 });
	const page = await readPayload("z" + b64url(await deflate(json)));
	assert.deepEqual(page, { url: "https://example.com/a", html: "<html><body><p>Héllo ✓</p></body></html>", selection: true });
});

test("an uncompressed clip reads back", async () => {
	const page = await readPayload("j" + b64url(new TextEncoder().encode(JSON.stringify({ u: "http://x.org/", h: "<p>x</p>", s: 0 }))));
	assert.equal(page.url, "http://x.org/");
	assert.equal(page.selection, false);
});

test("anything else is refused", async () => {
	await assert.rejects(readPayload("x123"));
	await assert.rejects(readPayload("j" + b64url(new TextEncoder().encode(JSON.stringify({ u: "javascript:alert(1)", h: "" })))));
	await assert.rejects(readPayload("zAAAA"));
});

test("the bookmarklet is one javascript: address that opens this wr1t3r", () => {
	const b = bookmarklet("https://my.wr1t3r.app");
	assert.match(b, /^javascript:/);
	assert.doesNotMatch(b, /\s/);
	const code = decodeURIComponent(b.slice("javascript:".length));
	assert.ok(code.includes('"https://my.wr1t3r.app"'));
	assert.ok(code.includes(String(MAX_PAYLOAD)));
	new Function(code); // parses
});
