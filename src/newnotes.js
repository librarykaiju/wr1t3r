// New notes that know where they go: one command per template, each saving
// its note in that kind's folder. The log folders are the media lookups'
// (worker/media.js, MEDIA_*_FOLDER on the Worker), so a log made blank here
// and one made from a lookup land together.

export const NEW_NOTE_KINDS = [
	{ label: "New journal entry", template: "Journal", folder: "journal/", keywords: "diary entry write" },
	{ label: "New microblog post", template: "Microblog", folder: "microblog/", keywords: "post status short" },
	{ label: "New note in Notes", template: "Note", folder: "notes/", keywords: "notes seed" },
	{ label: "New catalog entry", template: "Catalog Entry", folder: "info/catalog/", keywords: "catalog bookmark link library info" },
	{ label: "New tools entry", template: "Tools Entry", folder: "info/tools/", keywords: "tool software app link info" },
	{ label: "New book log", template: "Book", folder: "logs/books/", media: "book", keywords: "reading log books" },
	{ label: "New movie log", template: "Movie", folder: "logs/movies-tv/", media: "movie", keywords: "film watching log" },
	{ label: "New TV series log", template: "Series", folder: "logs/movies-tv/", media: "movie", keywords: "show television watching log" },
	{ label: "New music log", template: "Music", folder: "logs/music/", media: "music", keywords: "album listening log" },
	{ label: "New game log", template: "Game", folder: "logs/games/", media: "game", keywords: "video game playing log" },
	{ label: "New podcast log", template: "Podcast", folder: "logs/podcasts/", media: "podcast", keywords: "listening log episode" },
];

// The kind a template (by name, "Book" or "_templates/Book.md") files into, or null.
export function kindForTemplate(template) {
	const n = String(template).split("/").pop().replace(/\.md$/i, "").toLowerCase();
	return NEW_NOTE_KINDS.find((k) => k.template.toLowerCase() === n) || null;
}

// Where a kind's notes go: the media lookup's folder for logs when the Worker
// names one, else the kind's folder under the vault root ("content/").
export function kindFolder(kind, root, mediaKinds = []) {
	const m = kind.media && mediaKinds.find((k) => k.kind === kind.media)?.folder;
	return m ? m.replace(/^\/+|\/+$/g, "") + "/" : root + kind.folder;
}

// A title as a note name: without the characters Obsidian won't allow in one.
export function noteFileName(title) {
	const n = String(title).replace(/[*"\\/<>:|?#^[\]]/g, "").replace(/\s+/g, " ").trim();
	return (n.length > 80 ? n.slice(0, 80).replace(/\s+\S*$/, "") : n) || "Untitled";
}

// folder + name + ".md", numbered ("Name 2.md") if taken (case aside).
export function freeNotePath(folder, name, paths) {
	const have = new Set(paths.map((p) => p.toLowerCase()));
	let path = `${folder}${name}.md`;
	for (let n = 2; have.has(path.toLowerCase()); n++) path = `${folder}${name} ${n}.md`;
	return path;
}
