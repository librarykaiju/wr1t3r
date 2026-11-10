// Shared by the page and the Worker: what counts as a note path.
// A relative path to a .md file (or a board: src/bases.js), with no hidden folders (.obsidian, .trash)
// and nothing that could climb out of the vault.
export function isNotePath(path) {
	if (typeof path !== "string" || !path || path.length > 1000) return false;
	if (!/\.(md|board|base)$/i.test(path) || path.includes("\\") || path.includes("\0")) return false;
	return path.split("/").every((seg) => seg && seg !== ".." && !seg.startsWith("."));
}

// A board is YAML describing views of notes. New ones are .board; .base
// (Obsidian Bases, the same YAML) still opens as one.
export const BOARD_EXT = ".board";
export const isBoardPath = (path) => /\.(board|base)$/i.test(path || "");

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

// "Folder/Note (conflict 2026-11-03).md" (or "... 2026-11-03 2).md") -> the
// note it was copied from, "Folder/Note.md"; null for any other path. Sync
// and the local folder make these when both sides changed a note.
const CONFLICT = /^(.*) \(conflict (\d{4}-\d{2}-\d{2})(?: \d+)?\)(\.[^./]+)?$/;
export function conflictOf(path) {
	const m = typeof path === "string" ? path.match(CONFLICT) : null;
	return m ? m[1] + (m[3] || "") : null;
}
export const conflictDay = (path) => (typeof path === "string" ? path.match(CONFLICT)?.[2] ?? null : null);
