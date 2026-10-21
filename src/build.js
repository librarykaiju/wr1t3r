// Which build this is. The product build (`npm run build:product`, sold at
// my.wr1t3r.app) has no Worker and no published site.
export const PRODUCT = (() => { try { return !!import.meta.env?.VITE_DROPBOX_ONLY; } catch { return false; } })();

// wr1t3r's own folders went by "_daily/", "_docs/" and so on before
// publish: true alone decided what goes on the website. Notebooks made then
// keep theirs: plain name -> the name it had.
const OLD_NAMES = { "Daily/": "_daily/", "Weekly/": "_weekly/", "Uploads/": "_uploads/", "Clippings/": "_clippings/", "Compiled/": "_compiled/", "Lists/": "_docs/" };

// The folder a notebook keeps one of wr1t3r's own in, under root ("content/"
// or ""): the old "_daily/" while it has notes there and none in "Daily/",
// else the plain name.
export function ownFolderIn(paths, root, plain) {
	const old = OLD_NAMES[plain];
	if (!old) return plain;
	const under = (f) => paths.some((p) => p.toLowerCase().startsWith((root + f).toLowerCase()));
	return under(old) && !under(plain) ? old : plain;
}

// The old folders a notebook still has under root, to move to their plain
// names: [{ from: "content/_daily/", name: "Daily" }].
export function oldOwnFolders(paths, root) {
	return Object.entries(OLD_NAMES)
		.filter(([, old]) => paths.some((p) => p.toLowerCase().startsWith((root + old).toLowerCase())))
		.map(([plain, old]) => ({ from: root + (paths.find((p) => p.toLowerCase().startsWith((root + old).toLowerCase())).slice(root.length, root.length + old.length)), name: plain.slice(0, -1) }));
}
