// Searchable pictures and PDFs: the text the Worker read from them
// (worker/ocr.js), and which ones still need reading. Turned on per device
// from the palette; while on, new pictures and PDFs are read after each sync.

import { attachmentType } from "./paths.js";

export const READABLE = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
const KEY = "wr1t3r-ocr";

export const ocrOn = () => { try { return localStorage.getItem(KEY) === "on"; } catch { return false; } };
export const setOcrOn = (on) => { try { on ? localStorage.setItem(KEY, "on") : localStorage.removeItem(KEY); } catch {} };

// The attachments ({path, version}) not read yet, or changed since.
export function unread(attachments, index) {
	return attachments.filter((f) => READABLE.has(attachmentType(f.path)) && index[f.path]?.version !== f.version);
}

// What search looks through: [{ path, text, file: true }] for attachments
// still in the vault that have text.
export function readFiles(attachments, index) {
	const here = new Set(attachments.map((f) => f.path));
	return Object.entries(index)
		.filter(([p, e]) => here.has(p) && e?.text)
		.map(([path, e]) => ({ path, text: e.text, file: true }));
}
