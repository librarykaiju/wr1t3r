import test from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "../worker/push.js";

const b64u = (b) => Buffer.from(b).toString("base64url");
const enc = new TextEncoder();
async function hkdf(salt, ikm, info, len) {
	const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
	return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}

// Decrypts the way a browser does (RFC 8291), to prove the Worker's message reads back.
test("push messages decrypt on the receiving side", async () => {
	const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
	const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
	const auth = crypto.getRandomValues(new Uint8Array(16));
	const msg = await encrypt('{"title":"Call Sam"}', b64u(uaPub), b64u(auth));
	const salt = msg.slice(0, 16), idlen = msg[20], asPub = msg.slice(21, 21 + idlen), body = msg.slice(21 + idlen);
	const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
	const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
	const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPub, ...asPub]);
	const ikm = await hkdf(auth, shared, info, 32);
	const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
	const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
	const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
	const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, body));
	assert.equal(plain.at(-1), 2);
	assert.equal(new TextDecoder().decode(plain.slice(0, -1)), '{"title":"Call Sam"}');
});
