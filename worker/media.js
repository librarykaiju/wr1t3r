// Media notes: movie/TV, book, music, game, comic and podcast notes filled in
// from free APIs. A port of the Media Notes Obsidian plugin
// (w3bz1n3 .obsidian/plugins/media-notes-lite), with the same lookups and the
// same properties, so a note made here matches one made in Obsidian. The
// lookups run here rather than in the page because most of these APIs don't
// allow browser calls (CORS) and the keys stay out of the page.
//
//   GET  /api/media/kinds                 -> {kinds: [{kind, label, folder, heading, covers, ready, needs}]}
//   GET  /api/media/search?kind=&q=       -> {results: [{title, subtitle, thumbnailUrl, ref}]}
//   POST /api/media/covers {kind, ref}    -> {covers: [url, ...]} (the cover choices)
//   POST /api/media/findcovers {kind, title, creator, year}
//                                         -> {covers: [url, ...]} for a log that
//                                            already exists (no result picked)
//   POST /api/media/note {kind, ref, cover, today}
//                                         -> {fields, year} (the note's properties, in order)
//
// ref is whatever search returned for the chosen result, handed back as is.
//
// Settings (all optional; a kind whose key is missing looks things up in
// Wikidata and Wikipedia instead, see worker/wikimedia.js):
//   OMDB_API_KEY          movies and TV (free at omdbapi.com/apikey.aspx)
//   RAWG_API_KEY          games (free at rawg.io/apidocs)
//   IGDB_CLIENT_ID, IGDB_CLIENT_SECRET
//                         games: box art as a cover option (a Twitch app,
//                         dev.twitch.tv/console/apps)
//   COMICVINE_API_KEY     comics (free at comicvine.gamespot.com/api)
//   ANTHROPIC_API_KEY     books: subject headings and vibe tags from the summary
//   MEDIA_MOVIE_FOLDER, MEDIA_BOOK_FOLDER, MEDIA_MUSIC_FOLDER, MEDIA_GAME_FOLDER,
//   MEDIA_PODCAST_FOLDER  where new notes go (vault paths; comics go with books)
// Books (Open Library), music (MusicBrainz, Cover Art Archive, iTunes), anime
// (AniList, with MyAnimeList's art through Jikan) and podcasts (iTunes) need
// no key. Movie and TV posters also come from iTunes when it has the title.
//
// With no Worker (a Dropbox device), the page runs this same code itself
// (src/mediahere.js) with no keys, so it only calls services that allow it.

import { HttpError } from "./util.js";
import { genresFromSubjects, JUNK_SUBJECT } from "./genres.js";
import { wikiSearch, wikiCovers, wikiMovie, wikiGame, wikiComic, isQid, looseTitle } from "./wikimedia.js";

// In a page, a User-Agent header can't be set and would only cost a preflight.
const inPage = typeof document !== "undefined";

const KINDS = {
	movie: { label: "Movie or TV", folder: "MEDIA_MOVIE_FOLDER", dflt: "content/logs/movies-tv", needs: ["OMDB_API_KEY"] },
	anime: { label: "Anime", folder: "MEDIA_MOVIE_FOLDER", dflt: "content/logs/movies-tv", needs: [] },
	book: { label: "Book", folder: "MEDIA_BOOK_FOLDER", dflt: "content/logs/books", needs: [] },
	music: { label: "Music", folder: "MEDIA_MUSIC_FOLDER", dflt: "content/logs/music", needs: [] },
	game: { label: "Game", folder: "MEDIA_GAME_FOLDER", dflt: "content/logs/games", needs: ["RAWG_API_KEY"] },
	comic: { label: "Comic", folder: "MEDIA_BOOK_FOLDER", dflt: "content/logs/books", needs: ["COMICVINE_API_KEY"] },
	podcast: { label: "Podcast", folder: "MEDIA_PODCAST_FOLDER", dflt: "content/logs/podcasts", needs: [], heading: "Episode Notes" },
};

export async function mediaApi(request, env, url) {
	if (!url.pathname.startsWith("/api/media/")) return null;
	const p = url.pathname, m = request.method;
	if (p === "/api/media/kinds" && m === "GET") {
		return {
			kinds: Object.entries(KINDS).map(([kind, k]) => ({
				kind, label: k.label,
				folder: String(env[k.folder] || k.dflt).trim().replace(/^\/+|\/+$/g, ""),
				heading: k.heading || "Notes",
				// Every kind offers a choice of covers before the note is made.
				covers: true,
				// Every kind works; a missing key means Wikidata instead.
				ready: true,
				needs: k.needs.filter((n) => !env[n]),
			})),
		};
	}
	const body = m === "POST" ? await request.json().catch(() => null) : null;
	const kind = m === "POST" ? body?.kind : url.searchParams.get("kind");
	const k = KINDS[kind];
	if (!k) throw new HttpError(400, "kind: one of " + Object.keys(KINDS).join(", "));

	if (p === "/api/media/search" && m === "GET") {
		const q = (url.searchParams.get("q") || "").trim().slice(0, 200);
		if (!q) throw new HttpError(400, "q: what to search for");
		return { results: await SEARCH[kind](env, q) };
	}
	if (p === "/api/media/findcovers" && m === "POST") {
		const title = str(body?.title, 300).trim();
		if (!title) throw new HttpError(400, "title: the log's title");
		return { covers: await findCovers(env, kind, title, str(body?.creator, 200).trim(), str(body?.year, 10).trim()) };
	}
	const ref = body?.ref;
	if (!ref || typeof ref !== "object") throw new HttpError(400, "ref: a search result's ref");
	if (p === "/api/media/covers" && m === "POST") return { covers: await COVERS[kind](env, ref) };
	if (p === "/api/media/note" && m === "POST") {
		const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today || "") ? body.today : new Date().toISOString().slice(0, 10);
		// No cover sent (an older page): the first of the kind's choices.
		const cover = "cover" in body ? httpsUrl(body.cover) : null;
		return NOTE[kind](env, ref, { cover, today });
	}
	return null;
}

// ---- helpers ---------------------------------------------------------------------

const UA = "wr1t3r-media-notes/1.0 (https://github.com/librarykaiju/wr1t3r)";

async function getJSON(u, init = {}) {
	const res = await fetch(u, { ...init, headers: { ...(inPage ? {} : { "User-Agent": UA }), Accept: "application/json", ...init.headers } });
	if (!res.ok) {
		await res.body?.cancel();
		throw Object.assign(new HttpError(502, `${new URL(u).hostname} answered ${res.status}`), { upstream: res.status });
	}
	return res.json();
}

// Swallows a lookup's failure, for the optional extras (covers, summaries).
const quietly = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };

// The same, giving up after ms: cover choices come from several services at
// once, and one slow one (Cover Art Archive and Jikan can take many seconds)
// shouldn't hold up the rest.
const COVER_WAIT = 6000;
const soon = (fn, fallback, ms = COVER_WAIT) => Promise.race([quietly(fn, fallback), new Promise((r) => setTimeout(() => r(fallback), ms))]);

function httpsUrl(v) {
	if (typeof v !== "string" || !v) return "";
	try { const u = new URL(v); return u.protocol === "https:" ? u.href : ""; } catch { return ""; }
}
const str = (v, max = 500) => (typeof v === "string" ? v.slice(0, max) : v == null ? "" : String(v).slice(0, max));
function need(ok, what) {
	if (!ok) throw new HttpError(400, "ref: bad " + what);
}

// A search as typed, then without its punctuation, then as bare lowercase
// words: "Spider-man Brand New Day" finds "Spider-Man: Brand New Day" on
// services that match punctuation strictly.
export function queryVariants(q) {
	const plain = q.replace(/[^\p{L}\p{N}'’]+/gu, " ").replace(/\s+/g, " ").trim();
	return [...new Set([q.trim(), plain, looseTitle(q)])].filter(Boolean);
}

// Runs find(query) for each variant until one finds something; results whose
// title matches what was typed (punctuation and case aside) come first.
export async function forgiving(q, find) {
	for (const v of queryVariants(q)) {
		const found = await find(v);
		if (found.length) {
			const want = looseTitle(q);
			return [...found].sort((a, b) => (looseTitle(b.title) === want) - (looseTitle(a.title) === want));
		}
	}
	return [];
}

// MusicBrainz reads its search as Lucene, where - : ! and the like are syntax.
const lucene = (q) => q.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");

// "A, B and C" -> ["A", "B", "C"]; OMDb's "N/A" -> [].
export function splitList(s) {
	return !s || s === "N/A" ? [] : s.split(/,| and /i).map((x) => x.trim()).filter(Boolean);
}

// ---- movies and TV (OMDb) ------------------------------------------------------------

async function omdb(env, params) {
	const data = await getJSON("https://www.omdbapi.com/?" + new URLSearchParams({ apikey: env.OMDB_API_KEY, ...params }));
	if (data.Response === "False") {
		if (data.Error === "Movie not found!") return null;
		throw new HttpError(502, "OMDb: " + (data.Error || "unknown error"));
	}
	return data;
}

// A film's or show's poster from iTunes, matched by title (and year when
// it's known).
async function itunesPoster(title, year = "", series = false) {
	return soon(async () => {
		const data = await getJSON("https://itunes.apple.com/search?" + new URLSearchParams(series
			? { term: title, media: "tvShow", entity: "tvSeason", limit: "15" }
			: { term: title, media: "movie", entity: "movie", limit: "15" }));
		const want = looseTitle(title);
		return (data.results || [])
			.filter((r) => looseTitle(series ? r.artistName : r.trackName) === want && (series || !year || !r.releaseDate || r.releaseDate.startsWith(year)))
			.map((r) => bigArtwork(r.artworkUrl100)).filter(Boolean).slice(0, 3);
	}, []);
}

// ---- anime (AniList; MyAnimeList's art through Jikan) ----------------------------------

async function anilist(query, variables) {
	const data = await getJSON("https://graphql.anilist.co", {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }),
	});
	if (!data?.data && data?.errors?.length) throw new HttpError(502, "AniList: " + (data.errors[0].message || "unknown error"));
	return data;
}

// Anime from Wikidata, for when AniList can't be reached or finds nothing:
// films and series whose description says they're anime or animated first.
async function wikiAnime(q) {
	const found = await forgiving(q, (v) => wikiSearch(getJSON, "movie", v));
	const anime = found.filter((r) => /\banime\b|\banimated\b/i.test(r.subtitle || ""));
	return anime.length ? anime : found;
}
const ANIME_FIELDS = "id idMal title { romaji english } startDate { year } format episodes coverImage { extraLarge large medium }";

async function malCover(idMal) {
	if (!Number.isInteger(idMal)) return [];
	return soon(async () => {
		const img = (await getJSON(`https://api.jikan.moe/v4/anime/${idMal}`)).data?.images;
		return [img?.webp?.large_image_url, img?.jpg?.large_image_url].map(httpsUrl).filter(Boolean).slice(0, 1);
	}, []);
}

const animeTitle = (t) => t?.english || t?.romaji || "";
const FORMAT_NAMES = { TV: "TV series", TV_SHORT: "TV short", MOVIE: "Movie", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music video" };

// ---- books (Open Library, Google Books; Claude for tags) -------------------------------

const textOf = (d) => (typeof d === "string" ? d : d?.value ?? "");

function bigGoogleCover(u) {
	const s = u.replace(/^http:/, "https:");
	return /[?&]zoom=\d/.test(s) ? s.replace(/zoom=\d/, "zoom=3") : `${s}&zoom=3`;
}

function googleBooks(title, author, max) {
	const q = [`intitle:${title}`];
	if (author) q.push(`inauthor:${author}`);
	return getJSON("https://www.googleapis.com/books/v1/volumes?" + new URLSearchParams({ q: q.join(" "), maxResults: String(max) }));
}

function editions(workKey) {
	return getJSON(`https://openlibrary.org${workKey}/editions.json?limit=20`);
}

// Subject strings split on commas, first spelling of each kept.
function uniqueSubjects(list) {
	const seen = new Set(), out = [];
	for (const s of list) for (const part of String(s).split(",")) {
		const t = part.trim();
		if (t && !JUNK_SUBJECT.test(t) && !/^[a-z_]+:/i.test(t) && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
	}
	return out;
}

const TAG_MODEL = "claude-haiku-4-5-20251001";

async function bookTags(env, title, author, summary) {
	const none = { subjects: [], vibesAndThemes: [] };
	if (!env.ANTHROPIC_API_KEY || !summary) return none;
	const prompt = `Book: "${title}"${author ? ` by ${author}` : ""}

Description:
${summary}

Give two things back:

1. "subjects": 3-6 real Library of Congress Subject Headings (LCSH) that would actually be assigned to this book -- genuine LCSH terms in their standard form (e.g. "Fantasy fiction", "Robots -- Fiction", "Human-robot relations -- Fiction"), not invented categories.

2. "vibesAndThemes": at most 2 short tags each (title case, up to 10 total, no category labels) for: Mood/Tone (emotional tone/atmosphere), Style (prose/writing style), Characters (archetypes/dynamics), Storyline (plot shape/tropes), Pacing (e.g. "Slow Burn", "Fast-Paced").

Respond with ONLY a JSON object: {"subjects": [...], "vibesAndThemes": [...]}. No other text.`;
	return quietly(async () => {
		const data = await getJSON("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
			body: JSON.stringify({ model: TAG_MODEL, max_tokens: 768, messages: [{ role: "user", content: prompt }] }),
		});
		const out = JSON.parse((data.content?.[0]?.text || "").trim());
		return {
			subjects: Array.isArray(out.subjects) ? out.subjects.map(String) : [],
			vibesAndThemes: Array.isArray(out.vibesAndThemes) ? out.vibesAndThemes.map(String) : [],
		};
	}, none);
}

function bookRef(ref) {
	need(/^\/works\/OL\d+W$/.test(ref.workKey || ""), "workKey");
	return {
		workKey: ref.workKey,
		title: str(ref.title),
		authors: Array.isArray(ref.authors) ? ref.authors.slice(0, 10).map((a) => str(a, 200)) : [],
		coverId: Number.isInteger(ref.coverId) && ref.coverId > 0 ? ref.coverId : null,
		pages: Number.isInteger(ref.pages) && ref.pages > 0 && ref.pages < 100000 ? ref.pages : null,
	};
}

// ---- music (MusicBrainz, Cover Art Archive) ------------------------------------------

// MusicBrainz allows about one request a second per client.
const MB_GAP = 1100;
let mbNext = 0;

async function mb(path, params, attempt = 0) {
	const now = Date.now(), at = Math.max(now, mbNext);
	mbNext = at + MB_GAP;
	if (at > now) await new Promise((r) => setTimeout(r, at - now));
	const res = await fetch(`https://musicbrainz.org/ws/2/${path}?` + new URLSearchParams({ fmt: "json", ...params }), {
		headers: inPage ? { Accept: "application/json" } : { "User-Agent": UA, Accept: "application/json" },
	});
	if (res.status === 503 && attempt < 2) {
		await res.body?.cancel();
		await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
		return mb(path, params, attempt + 1);
	}
	if (!res.ok) {
		await res.body?.cancel();
		throw new HttpError(502, res.status === 503 ? "MusicBrainz is rate-limiting requests. Wait a moment and try again." : `MusicBrainz request failed (${res.status})`);
	}
	return res.json();
}

const names = (credit) => (credit || []).map((c) => c.name).filter(Boolean);

export function duration(ms) {
	if (!ms || ms <= 0) return "";
	const s = Math.round(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// "2011-04-05" -> "04/05/2011"; partial dates stay as they are.
export function usDate(d) {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
	return m ? `${m[2]}/${m[3]}/${m[1]}` : d || "";
}

function languageName(code) {
	if (!code) return "";
	try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code; } catch { return code; }
}

// The release group's front cover from Cover Art Archive, if it has one
// (it redirects to it). For the cover picker it isn't checked first: asking
// Cover Art Archive is slow, and the picker leaves out pictures that don't load.
async function groupCover(id, { check = true } = {}) {
	const u = `https://coverartarchive.org/release-group/${id}/front-500`;
	if (!check) return u;
	return soon(async () => {
		// A page can't see a redirect, so it asks for the list of images instead.
		if (inPage) return ((await getJSON(`https://coverartarchive.org/release-group/${id}`)).images || []).some((i) => i.front) ? u : "";
		const res = await fetch(u, { method: "HEAD", redirect: "manual", headers: { "User-Agent": UA } });
		await res.body?.cancel();
		return res.ok || (res.status >= 300 && res.status < 400) ? u : "";
	}, "");
}

// An album's artwork from iTunes: the album whose name starts with the title
// (iTunes adds " - Single", "(Deluxe Edition)"), by that artist if one's given.
async function itunesAlbum(title, artist = "") {
	return soon(async () => {
		const data = await getJSON("https://itunes.apple.com/search?" + new URLSearchParams({ term: [artist, title].filter(Boolean).join(" "), media: "music", entity: "album", limit: "15" }));
		const want = looseTitle(title), who = looseTitle(artist);
		return (data.results || [])
			.filter((r) => looseTitle(r.collectionName).startsWith(want) && (!who || looseTitle(r.artistName).includes(who) || who.includes(looseTitle(r.artistName))))
			.map((r) => bigArtwork(r.artworkUrl100)).filter(Boolean).slice(0, 3);
	}, []);
}

// An album's cover choices: the release group's own front cover, then the
// fronts of its releases (many groups have art only on one release, which is
// why some notes came out with none), then iTunes'.
async function albumCovers(id, releases, title, artist, { check = true } = {}) {
	const [list, group, itunes] = await Promise.all([releases, groupCover(id, { check }), itunesAlbum(title, artist)]);
	const fronts = (list || []).filter((r) => r["cover-art-archive"]?.front && UUID.test(r.id || "")).slice(0, 4)
		.map((r) => `https://coverartarchive.org/release/${r.id}/front-500`);
	return [...new Set([group, ...fronts, ...itunes].filter(Boolean))].slice(0, 8);
}

// Discs with the same track list (a deluxe reissue's copy of disc 1) count once.
function distinctMedia(media) {
	const seen = new Set();
	return media.filter((m) => {
		const key = JSON.stringify((m.tracks || []).map((t) => [t.title, t.length]));
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

// A release group's official releases, kept for a few minutes, since the
// cover choice and the note both need them and MusicBrainz is slow to ask.
const releaseCache = new Map();
async function releasesOf(groupId) {
	const hit = releaseCache.get(groupId);
	if (hit && hit.at > Date.now() - 5 * 60000) return hit.list;
	const list = (await mb("release", { "release-group": groupId, inc: "recordings+artist-credits+media", status: "official", limit: "25" })).releases || [];
	releaseCache.set(groupId, { at: Date.now(), list });
	if (releaseCache.size > 20) releaseCache.delete(releaseCache.keys().next().value);
	return list;
}

const earliest = (r) => (r.length ? r.reduce((best, x) => (x.date ? (best.date ? (x.date < best.date ? x : best) : x) : best), r[0]) : null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- games (RAWG, IGDB, Steam) -----------------------------------------------------------

const rawg = (env, path, params = {}) => getJSON(`https://api.rawg.io/api${path}?` + new URLSearchParams({ key: env.RAWG_API_KEY, ...params }));

let twitch = null; // {key, token, expires} -- lives as long as the isolate

async function igdb(env, endpoint, query) {
	if (!(twitch?.key === env.IGDB_CLIENT_ID && twitch.expires > Date.now() + 60000)) {
		const qs = new URLSearchParams({ client_id: env.IGDB_CLIENT_ID, client_secret: env.IGDB_CLIENT_SECRET, grant_type: "client_credentials" });
		const t = await getJSON("https://id.twitch.tv/oauth2/token?" + qs, { method: "POST" });
		twitch = { key: env.IGDB_CLIENT_ID, token: t.access_token, expires: Date.now() + t.expires_in * 1000 };
	}
	return getJSON(`https://api.igdb.com/v4/${endpoint}`, {
		method: "POST",
		headers: { "Client-ID": env.IGDB_CLIENT_ID, Authorization: `Bearer ${twitch.token}`, "Content-Type": "text/plain" },
		body: query,
	});
}

// IGDB's box art for the game: up to three, the release closest to year
// first, so a remake gets its own box and not the original's.
async function boxArt(env, title, year) {
	if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return [];
	return quietly(async () => {
		const found = (await igdb(env, "games", `search "${title.replace(/"/g, '\\"')}"; fields name,first_release_date,cover.image_id; limit 10;`)) || [];
		const withCover = found.filter((g) => g.cover?.image_id);
		const want = looseTitle(title);
		const yearOf = (g) => (g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : Infinity);
		const score = (g) => (looseTitle(g.name) === want ? 0 : 10000) + (year ? Math.abs(yearOf(g) - Number(year)) : 0);
		withCover.sort((a, b) => score(a) - score(b));
		return withCover.slice(0, 3).map((g) => `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`);
	}, []);
}

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// The game's Steam header image, when Steam has a game by exactly that name.
// With a year, a same-named game from another year (the original of a remake)
// isn't used. Steam doesn't answer pages (CORS), so only the Worker asks.
async function steamBanner(title, year = "") {
	if (inPage) return "";
	return quietly(async () => {
		const found = await getJSON(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&cc=us&l=en`);
		const hits = (found.items || []).filter((i) => squash(i.name) === squash(title)).slice(0, 3);
		for (const hit of hits) {
			const d = (await getJSON(`https://store.steampowered.com/api/appdetails?appids=${hit.id}`))?.[hit.id]?.data;
			const img = typeof d?.header_image === "string" ? d.header_image : "";
			const y = /\b(\d{4})\b/.exec(d?.release_date?.date || "")?.[1];
			if (img && (!year || !y || y === String(year))) return img;
		}
		return "";
	}, "");
}

// ---- comics (Comic Vine) -----------------------------------------------------------------

async function comicVine(env, path, params) {
	const data = await getJSON(`https://comicvine.gamespot.com/api${path}?` + new URLSearchParams({ api_key: env.COMICVINE_API_KEY, format: "json", ...params }));
	if (data.error && data.error !== "OK") throw new HttpError(502, "Comic Vine: " + data.error);
	return data;
}

const issueTitle = (volume, number, name) => {
	const t = number ? `${volume} #${number}` : volume;
	return name ? `${t}: ${name}` : t;
};

const creditsFor = (credits, role) =>
	(credits || []).filter((c) => (c.role || "").toLowerCase().split(",").map((r) => r.trim()).includes(role)).map((c) => c.name);

export function plainText(html) {
	if (!html) return "";
	return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

// ---- podcasts (iTunes) -------------------------------------------------------------------

const bigArtwork = (u) => (u ? u.replace(/\d+x\d+bb\.(jpg|png)$/i, "600x600bb.$1") : "");

function podcastGenres(primary, genres) {
	const g = (genres || []).filter((x) => x && x.toLowerCase() !== "podcasts");
	return g.length ? g : primary ? [primary] : ["Podcasts"];
}

// ---- the three calls, per kind -------------------------------------------------------

const SEARCH = {
	// A keyed service that finds nothing hands over to Wikidata, which has
	// most films, shows, games and comics too.
	async movie(env, q) {
		const wiki = () => forgiving(q, (v) => wikiSearch(getJSON, "movie", v));
		if (!env.OMDB_API_KEY) return wiki();
		const found = await forgiving(q, async (v) => ((await omdb(env, { s: v }))?.Search || []).filter((r) => r.Type === "movie" || r.Type === "series").map((r) => ({
			title: r.Title, subtitle: `${r.Year} - ${r.Type}`,
			thumbnailUrl: r.Poster !== "N/A" ? r.Poster : undefined,
			ref: { imdbID: r.imdbID, title: r.Title, year: /^\d{4}/.exec(r.Year || "")?.[0] || "", series: r.Type === "series" },
		})));
		return found.length ? found : wiki();
	},
	async anime(env, q) {
		let failed = null;
		const found = await forgiving(q, async (v) => {
			const data = await anilist(`query ($q: String) { Page(perPage: 10) { media(search: $q, type: ANIME, sort: SEARCH_MATCH) { ${ANIME_FIELDS} } } }`, { q: v });
			return (data.data?.Page?.media || []).map((a) => ({
				title: animeTitle(a.title),
				subtitle: [a.title?.english && a.title.romaji !== a.title.english ? a.title.romaji : "", FORMAT_NAMES[a.format] || "", a.startDate?.year].filter(Boolean).join(" - "),
				thumbnailUrl: a.coverImage?.medium || undefined,
				ref: { anilistId: a.id, idMal: Number.isInteger(a.idMal) ? a.idMal : null, title: animeTitle(a.title), year: a.startDate?.year ? String(a.startDate.year) : "" },
			}));
		}).catch((e) => { failed = e; return []; });
		if (found.length) return found;
		const wiki = await quietly(() => wikiAnime(q), []);
		if (!wiki.length && failed) throw failed;
		return wiki;
	},
	async book(env, q) {
		return forgiving(q, async (v) => {
			const data = await getJSON("https://openlibrary.org/search.json?" + new URLSearchParams({ q: v, fields: "title,author_name,first_publish_year,cover_i,key,number_of_pages_median", limit: "10" }));
			return (data.docs || []).map((d) => ({
				title: d.title,
				subtitle: [d.author_name?.join(", "), d.first_publish_year].filter(Boolean).join(" - "),
				thumbnailUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : undefined,
				ref: { workKey: d.key, title: d.title, authors: d.author_name || [], coverId: d.cover_i, year: d.first_publish_year ? String(d.first_publish_year) : "", pages: d.number_of_pages_median || null },
			}));
		});
	},
	async music(env, q) {
		return forgiving(q, async (v) => {
			const data = await mb("release-group", { query: lucene(v), limit: "10" });
			return (data["release-groups"] || []).map((g) => {
				const year = g["first-release-date"]?.slice(0, 4) || "";
				return {
					title: g.title,
					subtitle: [(g["artist-credit"] || []).map((a) => a.name).join(""), g["primary-type"], year].filter(Boolean).join(" - "),
					ref: { releaseGroupId: g.id, title: g.title, year, artist: (g["artist-credit"] || []).map((a) => a.name + (a.joinphrase || "")).join("").trim() },
				};
			});
		});
	},
	async game(env, q) {
		const wiki = () => forgiving(q, (v) => wikiSearch(getJSON, "game", v));
		if (!env.RAWG_API_KEY) return wiki();
		const found = await forgiving(q, async (v) => ((await rawg(env, "/games", { search: v, page_size: "10" })).results || []).map((g) => ({
			title: g.name, subtitle: g.released?.slice(0, 4) || "", thumbnailUrl: g.background_image || undefined,
			ref: { id: g.id, title: g.name, year: g.released?.slice(0, 4) || "", thumbnailUrl: g.background_image || "" },
		})));
		return found.length ? found : wiki();
	},
	async comic(env, q) {
		const wiki = () => forgiving(q, (v) => wikiSearch(getJSON, "comic", v));
		if (!env.COMICVINE_API_KEY) return wiki();
		const found = await forgiving(q, async (v) => ((await comicVine(env, "/search/", { resources: "issue", query: v, field_list: "id,name,issue_number,cover_date,image,volume", limit: "10" })).results || []).map((i) => ({
			title: issueTitle(i.volume?.name || "", i.issue_number, i.name),
			subtitle: i.cover_date ? i.cover_date.slice(0, 4) : "",
			thumbnailUrl: i.image?.small_url,
			ref: { issueId: i.id },
		})));
		return found.length ? found : wiki();
	},
	async podcast(env, q) {
		return forgiving(q, async (v) => {
			const data = await getJSON("https://itunes.apple.com/search?" + new URLSearchParams({ term: v, media: "podcast", entity: "podcast", limit: "10" }));
			return (data.results || []).map((p) => ({
				title: p.collectionName || "", subtitle: p.artistName || "", thumbnailUrl: p.artworkUrl100,
				ref: {
					title: p.collectionName || "", creator: p.artistName || "",
					artworkUrl: bigArtwork(p.artworkUrl600 || p.artworkUrl100), collectionViewUrl: p.collectionViewUrl || "",
					genre: podcastGenres(p.primaryGenreName, p.genres),
				},
			}));
		});
	},
};

const COVERS = {
	// The poster OMDb or Wikipedia has, then iTunes' for the same title.
	async movie(env, ref) {
		const title = str(ref.title), year = str(ref.year, 10);
		const imdb = /^tt\d+$/.test(ref.imdbID || "") && env.OMDB_API_KEY;
		const [own, more] = await Promise.all([
			isQid(ref.qid) ? soon(() => wikiCovers(getJSON, ref), [])
				: imdb ? soon(async () => { const t = await omdb(env, { i: ref.imdbID }); return t?.Poster && t.Poster !== "N/A" ? [t.Poster] : []; }, [])
				: [],
			title ? itunesPoster(title, year, !!ref.series) : [],
		]);
		return [...new Set([...own.map(httpsUrl), ...more].filter(Boolean))];
	},
	// AniList's cover, then MyAnimeList's.
	async anime(env, ref) {
		if (isQid(ref.qid)) return COVERS.movie(env, { ...ref, series: true });
		need(Number.isInteger(ref.anilistId), "anilistId");
		const [own, mal] = await Promise.all([
			soon(async () => {
				const a = (await anilist(`query ($id: Int) { Media(id: $id, type: ANIME) { ${ANIME_FIELDS} } }`, { id: ref.anilistId })).data?.Media;
				return [a?.coverImage?.extraLarge, a?.coverImage?.large].map(httpsUrl).filter(Boolean).slice(0, 1);
			}, []),
			malCover(ref.idMal),
		]);
		return [...new Set([...own, ...mal])];
	},
	async music(env, ref) {
		need(UUID.test(ref.releaseGroupId || ""), "releaseGroupId");
		return albumCovers(ref.releaseGroupId, soon(() => releasesOf(ref.releaseGroupId), []), str(ref.title), str(ref.artist), { check: false });
	},
	async comic(env, ref) {
		if (isQid(ref.qid)) return soon(() => wikiCovers(getJSON, ref), []);
		need(Number.isInteger(ref.issueId), "issueId");
		const i = (await comicVine(env, `/issue/4000-${ref.issueId}/`, { field_list: "image" })).results;
		return [...new Set([i?.image?.original_url, i?.image?.medium_url].map(httpsUrl).filter(Boolean))].slice(0, 1);
	},
	// The artwork that came with the search result.
	async podcast(env, ref) {
		const art = httpsUrl(ref.artworkUrl);
		return art ? [art] : [];
	},
	// Google Books' covers first (they tend to be the sharpest), then the
	// search hit's own Open Library cover, then its other editions'.
	async book(env, ref) {
		const b = bookRef(ref);
		const [google, others] = await Promise.all([
			soon(async () => ((await googleBooks(b.title, b.authors[0], 5)).items || [])
				.map((i) => i.volumeInfo?.imageLinks?.thumbnail || i.volumeInfo?.imageLinks?.smallThumbnail).filter(Boolean).map(bigGoogleCover), []),
			soon(async () => [...new Set(((await editions(b.workKey)).entries || []).map((e) => e.covers?.[0]).filter((c) => typeof c === "number" && c > 0))]
				.map((c) => `https://covers.openlibrary.org/b/id/${c}-M.jpg`), []),
		]);
		const own = b.coverId ? [`https://covers.openlibrary.org/b/id/${b.coverId}-M.jpg`] : [];
		return [...new Set([...google, ...own, ...others])].slice(0, 8);
	},
	// IGDB's box art when it's set up, then RAWG's screenshot (for the
	// chosen game's own id) or the Wikipedia article's picture.
	async game(env, ref) {
		const title = str(ref.title), year = str(ref.year, 10);
		if (isQid(ref.qid)) {
			const [art, wiki] = await Promise.all([soon(() => boxArt(env, title, year), []), soon(() => wikiCovers(getJSON, ref), [])]);
			return [...new Set([...art, ...wiki])];
		}
		need(Number.isInteger(ref.id), "id");
		const art = await soon(() => boxArt(env, title, year), []);
		return [...new Set([...art, httpsUrl(ref.thumbnailUrl)].filter(Boolean))];
	},
};

const NOTE = {
	async movie(env, ref, { cover, today }) {
		if (isQid(ref.qid)) return wikiMovie(getJSON, ref, cover, today);
		need(/^tt\d+$/.test(ref.imdbID || ""), "imdbID");
		const t = await omdb(env, { i: ref.imdbID, plot: "full" });
		if (!t) throw new HttpError(404, "OMDb has no such title");
		const common = {
			title: t.Title, writers: splitList(t.Writer), studio: [], performers: splitList(t.Actors), genre: splitList(t.Genre),
			streamingServices: [], shelf: [], rating: [],
			coverImage: cover ?? (t.Poster && t.Poster !== "N/A" ? t.Poster : ""),
			summary: t.Plot && t.Plot !== "N/A" ? t.Plot : "",
			sticky: false, publish: false, date: today, eyebrow: null,
		};
		const fields = t.Type === "series" ? common : { title: common.title, director: splitList(t.Director), ...common };
		return { fields, year: t.Year };
	},
	async anime(env, ref, { cover, today }) {
		if (isQid(ref.qid)) return wikiMovie(getJSON, ref, cover, today);
		need(Number.isInteger(ref.anilistId), "anilistId");
		const a = (await anilist(`query ($id: Int) { Media(id: $id, type: ANIME) {
			title { romaji english } startDate { year } episodes genres description(asHtml: false) bannerImage siteUrl
			studios(isMain: true) { nodes { name } } externalLinks { site type }
			staff(perPage: 25) { edges { role node { name { full } } } }
		} }`, { id: ref.anilistId })).data?.Media;
		if (!a) throw new HttpError(404, "AniList has no such anime");
		const staff = (role) => [...new Set((a.staff?.edges || []).filter((e) => e.role === role).map((e) => e.node?.name?.full).filter(Boolean))];
		return {
			fields: {
				title: animeTitle(a.title) || str(ref.title),
				originalTitle: a.title?.english && a.title.romaji !== a.title.english ? a.title.romaji : null,
				director: staff("Director"), studio: (a.studios?.nodes || []).map((n) => n.name).filter(Boolean),
				genre: a.genres || [], episodes: Number.isInteger(a.episodes) ? a.episodes : null,
				streamingServices: [...new Set((a.externalLinks || []).filter((l) => l.type === "STREAMING").map((l) => l.site))],
				shelf: [], rating: [], coverImage: cover ?? "", banner: httpsUrl(a.bannerImage),
				summary: plainText(a.description), externalUrl: httpsUrl(a.siteUrl),
				sticky: false, publish: false, date: today, eyebrow: null,
			},
			year: a.startDate?.year ? String(a.startDate.year) : str(ref.year, 10),
		};
	},
	async book(env, ref, { cover, today }) {
		const b = bookRef(ref);
		let summary = "", olSubjects = [], allSubjects = [];
		await quietly(async () => {
			const w = await getJSON(`https://openlibrary.org${b.workKey}.json`);
			summary = textOf(w.description);
			allSubjects = (w.subjects || []).map(String);
			olSubjects = uniqueSubjects(allSubjects).slice(0, 15);
		});
		if (!summary) summary = await quietly(async () => ((await editions(b.workKey)).entries || []).map((e) => textOf(e.description)).find(Boolean) || "", "");
		if (!summary) summary = await quietly(async () => (await googleBooks(b.title, b.authors[0], 1)).items?.[0]?.volumeInfo?.description || "", "");
		const tags = await bookTags(env, b.title, b.authors[0], summary);
		return {
			fields: {
				title: b.title, author: b.authors, series: [], volume: null, format: [], pages: b.pages,
				subjects: tags.subjects.length ? tags.subjects : olSubjects,
				genre: genresFromSubjects([...tags.subjects, ...allSubjects]), vibesAndThemes: tags.vibesAndThemes, shelf: [], rating: [],
				coverImage: cover ?? "", summary, sticky: false, publish: false, date: today, eyebrow: null,
			},
			year: str(ref.year, 10),
		};
	},
	async music(env, ref, { cover }) {
		need(UUID.test(ref.releaseGroupId || ""), "releaseGroupId");
		const id = ref.releaseGroupId;
		const [group, releases] = await Promise.all([
			mb(`release-group/${id}`, { inc: "genres+tags+artist-credits" }),
			releasesOf(id),
		]);
		const release = earliest(releases);
		const coverImage = cover ?? (await albumCovers(id, releases, group.title || str(ref.title), names(group["artist-credit"]).join(", ")))[0] ?? "";
		const artist = names(group["artist-credit"]);
		const media = distinctMedia(release?.media || []);
		const all = media.flatMap((m) => m.tracks || []);
		const tracks = all.map((t, i) => {
			const who = names(t["artist-credit"]);
			const n = t.number || String(i + 1);
			return {
				number: /^\d+$/.test(n) ? Number(n) : n,
				title: t.title,
				duration: duration(t.length),
				featuredArtists: who.length && who.join("|") !== artist.join("|") ? who : [],
			};
		});
		return {
			fields: {
				title: group.title || str(ref.title), artist, coverImage,
				genre: (group.genres || []).map((g) => g.name),
				language: languageName(release?.["text-representation"]?.language),
				releasedOn: usDate(release?.date),
				albumDuration: duration(all.reduce((s, t) => s + (t.length || 0), 0)) || null,
				tracks, tags: (group.tags || []).map((t) => t.name), rating: [], sticky: null, publish: false, eyebrow: null,
			},
			year: release?.date?.slice(0, 4) || str(ref.year, 10),
		};
	},
	async game(env, ref, { cover, today }) {
		if (isQid(ref.qid)) {
			const [made, banner] = await Promise.all([wikiGame(getJSON, ref, cover, today), steamBanner(str(ref.title), str(ref.year, 10))]);
			if (!made.fields.banner) made.fields.banner = banner;
			return made;
		}
		need(Number.isInteger(ref.id), "id");
		// Everything from the chosen game's own RAWG entry (a remake's, not
		// the original's); Steam's banner only when its year agrees.
		const [g, steam] = await Promise.all([rawg(env, `/games/${ref.id}`), steamBanner(str(ref.title), str(ref.year, 10))]);
		const banner = steam || httpsUrl(g.background_image);
		return {
			fields: {
				title: g.name,
				developer: (g.developers || []).map((d) => d.name),
				publisher: (g.publishers || []).map((d) => d.name),
				platform: (g.platforms || []).map((d) => d.platform.name),
				genre: (g.genres || []).map((d) => d.name),
				status: [], rating: [], coverImage: cover ?? "", banner,
				description: g.description_raw || "", tags: [], sticky: false, publish: false, date: today, eyebrow: null,
			},
			year: g.released?.slice(0, 4) || "",
		};
	},
	async comic(env, ref, { cover, today }) {
		if (isQid(ref.qid)) return wikiComic(getJSON, ref, cover, today);
		need(Number.isInteger(ref.issueId), "issueId");
		const i = (await comicVine(env, `/issue/4000-${ref.issueId}/`, { field_list: "name,issue_number,cover_date,description,deck,image,volume,person_credits" })).results;
		const volume = i.volume?.name || "";
		const publisher = Number.isInteger(i.volume?.id)
			? await quietly(async () => (await comicVine(env, `/volume/4050-${i.volume.id}/`, { field_list: "publisher" })).results.publisher?.name || "", "")
			: "";
		return {
			fields: {
				title: issueTitle(volume, i.issue_number, i.name),
				author: creditsFor(i.person_credits, "writer"),
				artist: [...new Set(["penciler", "artist"].flatMap((r) => creditsFor(i.person_credits, r)))],
				series: volume ? [volume] : [], volume: i.issue_number || null,
				format: ["💬Comic"], publisher, subjects: ["Comics & Graphic Novels"], genre: ["comics"],
				vibesAndThemes: [], shelf: [], rating: [],
				coverImage: cover ?? (i.image?.original_url || i.image?.medium_url || ""),
				summary: plainText(i.description), sticky: false, publish: false, date: today, eyebrow: plainText(i.deck) || null,
			},
			year: i.cover_date ? i.cover_date.slice(0, 4) : "",
		};
	},
	// Everything a podcast note needs came with the search result.
	async podcast(env, ref, { cover, today }) {
		return {
			fields: {
				title: str(ref.title), creator: str(ref.creator),
				genre: Array.isArray(ref.genre) ? ref.genre.slice(0, 10).map((g) => str(g, 100)) : [],
				shelf: [], rating: [], coverImage: cover ?? httpsUrl(ref.artworkUrl), externalUrl: httpsUrl(ref.collectionViewUrl),
				summary: "", sticky: false, publish: false, date: today, eyebrow: null,
			},
			year: "",
		};
	},
};

// Covers for a log that already exists: its kind's search, by title (and
// creator for music, where titles repeat), the result whose title matches
// (punctuation aside; the year when it's known), then that result's covers.
// Music tries iTunes by itself when MusicBrainz finds no match.
export async function findCovers(env, kind, title, creator = "", year = "") {
	const results = await quietly(() => SEARCH[kind](env, kind === "music" && creator ? `${title} ${creator}` : title), []);
	const want = looseTitle(title);
	const same = results.filter((r) => looseTitle(r.title) === want);
	const best = same.find((r) => year && (r.ref?.year === year || r.subtitle?.includes(year))) || same[0];
	// Music's first choice may be used without anyone looking (Fill missing
	// music covers), so the release group's cover is checked here.
	const covers = !best ? []
		: kind === "music" ? await quietly(() => albumCovers(best.ref.releaseGroupId, soon(() => releasesOf(best.ref.releaseGroupId), []), str(best.ref.title), str(best.ref.artist)), [])
		: await quietly(() => COVERS[kind](env, best.ref), []);
	if (!covers.length && kind === "music") return itunesAlbum(title, creator);
	return covers;
}
