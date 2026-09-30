// Pictures pasted or dropped into a note: where they go in the vault, what
// they're called and how the note links to them, following Obsidian's own
// settings (.obsidian/app.json, read through the Worker) so a picture added
// here lands where Obsidian would have put it:
//   attachmentFolderPath  "/" or unset: the vault root; "./": next to the
//                         note; "./sub": a folder inside the note's folder;
//                         anything else: that folder from the vault root
//   useMarkdownLinks      ![](path) instead of ![[name]]
//   newLinkFormat         "shortest" (default), "relative" or "absolute"

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif", "image/bmp": "bmp" };

export const pictureExt = (type) => EXT[type] || null;

const dirOf = (path) => path.slice(0, path.lastIndexOf("/") + 1);

// The folder (ending in "/", or "" for the root) a picture for notePath goes in.
export function pictureFolder(setting, notePath) {
	const s = String(setting ?? "/").trim();
	const clean = (f) => f.split("/").filter((seg) => seg && seg !== "." && seg !== "..").join("/");
	if (!s || s === "/") return "";
	if (s === "." || s === "./") return dirOf(notePath);
	const rel = s.startsWith("./") ? dirOf(notePath) + clean(s.slice(2)) : clean(s);
	return rel ? rel + "/" : "";
}

const pad = (n) => String(n).padStart(2, "0");

// Obsidian's name for a pasted picture: "Pasted image 20260930142501.png".
// A dropped file keeps its own name.
export function pictureName(file, date = new Date()) {
	const ext = pictureExt(file.type) || "png";
	const own = (file.name || "").replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
	if (own && !/^image\.\w+$/i.test(own)) return /\.\w+$/.test(own) ? own : own + "." + ext;
	const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
	return `Pasted image ${stamp}.${ext}`;
}

// path, or "name 1.png", "name 2.png"... if it's taken (case ignored).
export function freePath(path, taken) {
	const lower = new Set([...taken].map((p) => p.toLowerCase()));
	if (!lower.has(path.toLowerCase())) return path;
	const dot = path.lastIndexOf(".");
	for (let i = 1; ; i++) {
		const p = `${path.slice(0, dot)} ${i}${path.slice(dot)}`;
		if (!lower.has(p.toLowerCase())) return p;
	}
}

function relative(from, to) {
	const a = dirOf(from).split("/").filter(Boolean);
	const b = to.split("/");
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
	return "../".repeat(a.length - i) + b.slice(i).join("/");
}

// The text that shows the picture at path in the note at notePath. others:
// every attachment path in the vault (for "shortest", a bare name only when
// no other file has it).
export function pictureLink(path, notePath, settings = {}, others = []) {
	const name = path.split("/").pop();
	const format = settings.newLinkFormat || "shortest";
	const clash = others.some((p) => p !== path && p.split("/").pop().toLowerCase() === name.toLowerCase());
	const target = format === "absolute" ? path : format === "relative" ? relative(notePath, path) : clash ? path : name;
	if (settings.useMarkdownLinks) return `![](${target.split("/").map(encodeURIComponent).join("/")})`;
	return `![[${target}]]`;
}
