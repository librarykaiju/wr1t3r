export function toBase64(bytes) {
	let s = "";
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

export function fromBase64(b64) {
	const s = atob(b64.replace(/\s+/g, ""));
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

export class HttpError extends Error {
	constructor(status, message, extra = {}) {
		super(message);
		this.status = status;
		this.extra = extra;
	}
}
