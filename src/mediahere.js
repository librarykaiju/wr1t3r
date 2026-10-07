// Media lookups with no Worker: the page runs the Worker's own media code
// (worker/media.js) itself, with no keys, so books come from Open Library,
// music from MusicBrainz, anime from AniList, podcasts from iTunes, and movies, TV, games and
// comics from Wikidata and Wikipedia. Same calls and answers as src/api.js's
// media* methods.

import { mediaApi } from "../worker/media.js";

const ENV = {};

async function run(path, body) {
	const url = new URL(path, "https://wr1t3r.invalid");
	const req = new Request(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
	try {
		return await mediaApi(req, ENV, url);
	} catch (e) {
		throw Object.assign(new Error(e.message), { status: e.status });
	}
}

export const mediaHere = {
	// The Worker's default folders are under content/ (a site's notes folder);
	// a notebook without a Worker keeps its logs at the top.
	async mediaKinds() { return (await run("/api/media/kinds")).kinds.map((k) => ({ ...k, folder: k.folder.replace(/^content\//, "") })); },
	async mediaSearch(kind, q) { return (await run("/api/media/search?" + new URLSearchParams({ kind, q }))).results; },
	async mediaCovers(kind, ref) { return (await run("/api/media/covers", { kind, ref })).covers; },
	async mediaFindCovers(kind, title, creator = "", year = "") { return (await run("/api/media/findcovers", { kind, title, creator, year })).covers; },
	async mediaNote(kind, ref, cover, today) { return run("/api/media/note", { kind, ref, cover, today }); },
};
