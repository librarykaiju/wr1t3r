// Which build this is. The product build (`npm run build:product`, sold at
// my.wr1t3r.app) has no Worker and no published site.
export const PRODUCT = (() => { try { return !!import.meta.env?.VITE_DROPBOX_ONLY; } catch { return false; } })();

// wr1t3r's own folders went by "_daily/", "_docs/" and so on before
// publish: true alone decided what goes on the website, and by "Daily/",
// "Lists/"... in the product build. Notebooks made then keep theirs: plain
// name -> [the underscore name, the capitalized name].
const OLD_NAMES = {
	"daily/": ["_daily/", "Daily/"],
	"weekly/": ["_weekly/", "Weekly/"],
	"uploads/": ["_uploads/", "Uploads/"],
	"clippings/": ["_clippings/", "Clippings/"],
	"compiled/": ["_compiled/", "Compiled/"],
	"docs/": ["_docs/", "Lists/"],
};

// The exact name of the folder under root that a notebook has for f, or null.
// "Daily/" and "daily/" are told apart: some places notes sync to aren't.
function has(paths, root, f) {
	const at = paths.find((p) => p.startsWith(root + f));
	return at ? f : null;
}
const hasAnyCase = (paths, root, f) => {
	const at = paths.find((p) => p.toLowerCase().startsWith((root + f).toLowerCase()));
	return at ? at.slice(root.length, root.length + f.length) : null;
};

// The folder a notebook keeps one of wr1t3r's own in, under root ("content/"
// or ""): the plain "daily/" if it has one, else an older "_daily/" or
// "Daily/" it still has notes in, else the plain name.
export function ownFolderIn(paths, root, plain) {
	const older = OLD_NAMES[plain];
	if (!older) return plain;
	if (has(paths, root, plain)) return plain;
	for (const f of older) if (has(paths, root, f)) return f;
	return hasAnyCase(paths, root, plain) || plain;
}

// The old folders a notebook still has under root, to move to their plain
// names: [{ from: "content/_daily/", name: "daily" }]. The product build's
// names stay in the product build, where they've always been; elsewhere
// "Daily/" moves only when caseSafe: where notes sync to tells "Daily" from
// "daily" (not Dropbox, not a folder on this computer), so moving it can't
// delete it. "Lists/" -> "docs/" is more than a change of case.
export function oldOwnFolders(paths, root, caseSafe = false, product = PRODUCT) {
	const out = [];
	for (const [plain, older] of Object.entries(OLD_NAMES)) {
		for (const [i, f] of older.entries()) {
			if (i === 1 && (product || (!caseSafe && f.toLowerCase() === plain))) continue;
			const name = i === 0 ? hasAnyCase(paths, root, f) : has(paths, root, f);
			if (name) out.push({ from: root + name, name: plain.slice(0, -1) });
		}
	}
	return out;
}
