// Shared by the page and the Worker: what counts as a note path.
// A relative path to a .md file (or a .base file: Obsidian Bases, src/bases.js), with no hidden folders (.obsidian, .trash)
// and nothing that could climb out of the vault.
export function isNotePath(path) {
	if (typeof path !== "string" || !path || path.length > 1000) return false;
	if (!/\.(md|base)$/i.test(path) || path.includes("\\") || path.includes("\0")) return false;
	return path.split("/").every((seg) => seg && seg !== ".." && !seg.startsWith("."));
}

// Attachments wr1t3r shows (read-only): images, PDFs, audio and video, by extension.
export const ATTACHMENT_TYPES = {
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml",
	pdf: "application/pdf",
	mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac",
	mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
};

export function attachmentType(path) {
	const ext = String(path).split(".").pop().toLowerCase();
	return ATTACHMENT_TYPES[ext] || null;
}

export function isAttachmentPath(path) {
	if (typeof path !== "string" || !path || path.length > 1000 || !attachmentType(path)) return false;
	if (path.includes("\\") || path.includes("\0")) return false;
	return path.split("/").every((seg) => seg && seg !== ".." && !seg.startsWith("."));
}
