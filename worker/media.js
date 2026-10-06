// Media notes: movie/TV, book, music, game, comic and podcast notes filled in
// from free APIs. A port of the Media Notes Obsidian plugin
// (w3bz1n3 .obsidian/plugins/media-notes-lite), with the same lookups and the
// same properties, so a note made here matches one made in Obsidian. The
// lookups run here rather than in the page because most of these APIs don't
// allow browser calls (CORS) and the keys stay out of the page.
//
//   GET  /api/media/kinds                 -> {kinds: [{kind, label, folder, heading, covers, ready, needs}]}
//   GET  /api/media/search?kind=&q=       -> {results: [{title, subtitle, thumbnailUrl, ref}]}
//   POST /api/media/covers {kind, ref}    -> {covers: [url, ...]} (books and games)
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
// Books (Open Library), music (MusicBrainz) and podcasts (iTunes) need no key.
//
// With no Worker (a Dropbox device), the page runs this same code itself
// (src/mediahere.js) with no keys, so it only calls services that allow it.

import { HttpError } from "./util.js";
import { wikiSearch, wikiCovers, wikiMovie, wikiGame, wikiComic, isQid } from "./wikimedia.js";

// In a page, a User-Agent header can't be set and would only cost a preflight.
const inPage = typeof document !== "undefined";

const KINDS = {
	movie: { label: "Movie or TV", folder: "MEDIA_MOVIE_FOLDER", dflt: "content/logs/movies-tv", needs: ["OMDB_API_KEY"] },
	book: { label: "Book", folder: "MEDIA_BOOK_FOLDER", dflt: "content/logs/books", needs: [], covers: true },
	music: { label: "Music", folder: "MEDIA_MUSIC_FOLDER", dflt: "content/logs/music", needs: [] },
	game: { label: "Game", folder: "MEDIA_GAME_FOLDER", dflt: "content/logs/games", needs: ["RAWG_API_KEY"], covers: true },
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
				covers: !!k.covers,
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
	const ref = body?.ref;
	if (!ref || typeof ref !== "object") throw new HttpError(400, "ref: a search result's ref");
	if (p === "/api/media/covers" && m === "POST") {
		if (!k.covers) throw new HttpError(400, `${k.label} notes have no cover choice`);
		return { covers: await COVERS[kind](env, ref) };
	}
	if (p === "/api/media/note" && m === "POST") {
		const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today || "") ? body.today : new Date().toISOString().slice(0, 10);
		const cover = httpsUrl(body.cover);
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

function httpsUrl(v) {
	if (typeof v !== "string" || !v) return "";
	try { const u = new URL(v); return u.protocol === "https:" ? u.href : ""; } catch { return ""; }
}
const str = (v, max = 500) => (typeof v === "string" ? v.slice(0, max) : v == null ? "" : String(v).slice(0, max));
function need(ok, what) {
	if (!ok) throw new HttpError(400, "ref: bad " + what);
}

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
		if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
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

// The front cover's address, if Cover Art Archive has one (it redirects to it).
async function albumCover(id) {
	const u = `https://coverartarchive.org/release-group/${id}/front-500`;
	return quietly(async () => {
		// A page can't see a redirect, so it asks for the list of images instead.
		if (inPage) return ((await getJSON(`https://coverartarchive.org/release-group/${id}`)).images || []).some((i) => i.front) ? u : "";
		const res = await fetch(u, { method: "HEAD", redirect: "manual", headers: { "User-Agent": UA } });
		return res.ok || (res.status >= 300 && res.status < 400) ? u : "";
	}, "");
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

async function earliestRelease(groupId) {
	const r = (await mb("release", { "release-group": groupId, inc: "recordings+artist-credits+media", status: "official", limit: "25" })).releases || [];
	if (!r.length) return null;
	return r.reduce((best, x) => (x.date ? (best.date ? (x.date < best.date ? x : best) : x) : best), r[0]);
}

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

// IGDB's box art for the game, the release closest to year first.
async function boxArt(env, title, year) {
	if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) return null;
	return quietly(async () => {
		const found = (await igdb(env, "games", `search "${title.replace(/"/g, '\\"')}"; fields name,first_release_date,cover.image_id; limit 10;`)) || [];
		const withCover = found.filter((g) => g.cover?.image_id);
		if (!withCover.length) return null;
		if (year) {
			const y = Number(year);
			const yearOf = (g) => (g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : Infinity);
			withCover.sort((a, b) => Math.abs(yearOf(a) - y) - Math.abs(yearOf(b) - y));
		}
		return `https://images.igdb.com/igdb/image/upload/t_cover_big/${withCover[0].cover.image_id}.jpg`;
	}, null);
}

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// The game's Steam header image, when Steam has a game by exactly that name.
async function steamBanner(title) {
	return quietly(async () => {
		const found = await getJSON(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&cc=us&l=en`);
		const hit = (found.items || []).find((i) => squash(i.name) === squash(title));
		if (!hit) return "";
		const d = await getJSON(`https://store.steampowered.com/api/appdetails?appids=${hit.id}`);
		const img = d?.[hit.id]?.data?.header_image;
		return typeof img === "string" ? img : "";
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
	async movie(env, q) {
		if (!env.OMDB_API_KEY) return wikiSearch(getJSON, "movie", q);
		const data = await omdb(env, { s: q });
		return (data?.Search || []).filter((r) => r.Type === "movie" || r.Type === "series").map((r) => ({
			title: r.Title, subtitle: `${r.Year} - ${r.Type}`,
			thumbnailUrl: r.Poster !== "N/A" ? r.Poster : undefined,
			ref: { imdbID: r.imdbID },
		}));
	},
	async book(env, q) {
		const data = await getJSON("https://openlibrary.org/search.json?" + new URLSearchParams({ q, fields: "title,author_name,first_publish_year,cover_i,key", limit: "10" }));
		return (data.docs || []).map((d) => ({
			title: d.title,
			subtitle: [d.author_name?.join(", "), d.first_publish_year].filter(Boolean).join(" - "),
			thumbnailUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : undefined,
			ref: { workKey: d.key, title: d.title, authors: d.author_name || [], coverId: d.cover_i, year: d.first_publish_year ? String(d.first_publish_year) : "" },
		}));
	},
	async music(env, q) {
		const data = await mb("release-group", { query: q, limit: "10" });
		return (data["release-groups"] || []).map((g) => {
			const year = g["first-release-date"]?.slice(0, 4) || "";
			return {
				title: g.title,
				subtitle: [(g["artist-credit"] || []).map((a) => a.name).join(""), g["primary-type"], year].filter(Boolean).join(" - "),
				ref: { releaseGroupId: g.id, title: g.title, year },
			};
		});
	},
	async game(env, q) {
		if (!env.RAWG_API_KEY) return wikiSearch(getJSON, "game", q);
		const data = await rawg(env, "/games", { search: q, page_size: "10" });
		return (data.results || []).map((g) => ({
			title: g.name, subtitle: g.released?.slice(0, 4) || "", thumbnailUrl: g.background_image || undefined,
			ref: { id: g.id, title: g.name, year: g.released?.slice(0, 4) || "", thumbnailUrl: g.background_image || "" },
		}));
	},
	async comic(env, q) {
		if (!env.COMICVINE_API_KEY) return wikiSearch(getJSON, "comic", q);
		const data = await comicVine(env, "/search/", { resources: "issue", query: q, field_list: "id,name,issue_number,cover_date,image,volume", limit: "10" });
		return (data.results || []).map((i) => ({
			title: issueTitle(i.volume?.name || "", i.issue_number, i.name),
			subtitle: i.cover_date ? i.cover_date.slice(0, 4) : "",
			thumbnailUrl: i.image?.small_url,
			ref: { issueId: i.id },
		}));
	},
	async podcast(env, q) {
		const data = await getJSON("https://itunes.apple.com/search?" + new URLSearchParams({ term: q, media: "podcast", entity: "podcast", limit: "10" }));
		return (data.results || []).map((p) => ({
			title: p.collectionName || "", subtitle: p.artistName || "", thumbnailUrl: p.artworkUrl100,
			ref: {
				title: p.collectionName || "", creator: p.artistName || "",
				artworkUrl: bigArtwork(p.artworkUrl600 || p.artworkUrl100), collectionViewUrl: p.collectionViewUrl || "",
				genre: podcastGenres(p.primaryGenreName, p.genres),
			},
		}));
	},
};

const COVERS = {
	// Google Books' covers first (they tend to be the sharpest), then the
	// search hit's own Open Library cover, then its other editions'.
	async book(env, ref) {
		const b = bookRef(ref);
		const [google, others] = await Promise.all([
			quietly(async () => ((await googleBooks(b.title, b.authors[0], 5)).items || [])
				.map((i) => i.volumeInfo?.imageLinks?.thumbnail || i.volumeInfo?.imageLinks?.smallThumbnail).filter(Boolean).map(bigGoogleCover), []),
			quietly(async () => [...new Set(((await editions(b.workKey)).entries || []).map((e) => e.covers?.[0]).filter((c) => typeof c === "number" && c > 0))]
				.map((c) => `https://covers.openlibrary.org/b/id/${c}-M.jpg`), []),
		]);
		const own = b.coverId ? [`https://covers.openlibrary.org/b/id/${b.coverId}-M.jpg`] : [];
		return [...new Set([...google, ...own, ...others])].slice(0, 8);
	},
	// IGDB's box art when it's set up, then RAWG's screenshot.
	async game(env, ref) {
		if (isQid(ref.qid)) return quietly(() => wikiCovers(getJSON, ref), []);
		need(Number.isInteger(ref.id), "id");
		const art = await boxArt(env, str(ref.title), str(ref.year));
		const shot = httpsUrl(ref.thumbnailUrl);
		return [art, shot].filter(Boolean).filter((u, i, a) => a.indexOf(u) === i);
	},
};

const NOTE = {
	async movie(env, ref, { today }) {
		if (isQid(ref.qid)) return wikiMovie(getJSON, ref, today);
		need(/^tt\d+$/.test(ref.imdbID || ""), "imdbID");
		const t = await omdb(env, { i: ref.imdbID, plot: "full" });
		if (!t) throw new HttpError(404, "OMDb has no such title");
		const common = {
			title: t.Title, writers: splitList(t.Writer), studio: [], performers: splitList(t.Actors), genre: splitList(t.Genre),
			streamingServices: [], shelf: [], rating: [],
			coverImage: t.Poster && t.Poster !== "N/A" ? t.Poster : "",
			summary: t.Plot && t.Plot !== "N/A" ? t.Plot : "",
			sticky: false, publish: false, date: today, eyebrow: null,
		};
		const fields = t.Type === "series" ? common : { title: common.title, director: splitList(t.Director), ...common };
		return { fields, year: t.Year };
	},
	async book(env, ref, { cover, today }) {
		const b = bookRef(ref);
		let summary = "", olSubjects = [];
		await quietly(async () => {
			const w = await getJSON(`https://openlibrary.org${b.workKey}.json`);
			summary = textOf(w.description);
			olSubjects = uniqueSubjects(w.subjects || []).slice(0, 15);
		});
		if (!summary) summary = await quietly(async () => ((await editions(b.workKey)).entries || []).map((e) => textOf(e.description)).find(Boolean) || "", "");
		if (!summary) summary = await quietly(async () => (await googleBooks(b.title, b.authors[0], 1)).items?.[0]?.volumeInfo?.description || "", "");
		const tags = await bookTags(env, b.title, b.authors[0], summary);
		return {
			fields: {
				title: b.title, author: b.authors, series: [], volume: null, format: [],
				subjects: tags.subjects.length ? tags.subjects : olSubjects,
				genre: [], vibesAndThemes: tags.vibesAndThemes, shelf: [], rating: [],
				coverImage: cover, summary, sticky: false, publish: false, date: today, eyebrow: null,
			},
			year: str(ref.year, 10),
		};
	},
	async music(env, ref) {
		need(UUID.test(ref.releaseGroupId || ""), "releaseGroupId");
		const id = ref.releaseGroupId;
		const [group, release, coverImage] = await Promise.all([
			mb(`release-group/${id}`, { inc: "genres+tags+artist-credits" }),
			earliestRelease(id),
			albumCover(id),
		]);
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
		if (isQid(ref.qid)) return wikiGame(getJSON, ref, cover, today);
		need(Number.isInteger(ref.id), "id");
		const [g, banner] = await Promise.all([rawg(env, `/games/${ref.id}`), steamBanner(str(ref.title))]);
		return {
			fields: {
				title: g.name,
				developer: (g.developers || []).map((d) => d.name),
				publisher: (g.publishers || []).map((d) => d.name),
				platform: (g.platforms || []).map((d) => d.platform.name),
				genre: (g.genres || []).map((d) => d.name),
				status: [], rating: [], coverImage: cover, banner,
				description: g.description_raw || "", tags: [], sticky: false, publish: false, date: today, eyebrow: null,
			},
			year: g.released?.slice(0, 4) || "",
		};
	},
	async comic(env, ref, { today }) {
		if (isQid(ref.qid)) return wikiComic(getJSON, ref, today);
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
				format: "💬 Comic", publisher, subjects: ["Comics & Graphic Novels"], genre: ["comics"],
				vibesAndThemes: [], shelf: [], rating: [],
				coverImage: i.image?.original_url || i.image?.medium_url || "",
				summary: plainText(i.description), sticky: false, publish: false, date: today, eyebrow: plainText(i.deck) || null,
			},
			year: i.cover_date ? i.cover_date.slice(0, 4) : "",
		};
	},
	// Everything a podcast note needs came with the search result.
	async podcast(env, ref, { today }) {
		return {
			fields: {
				title: str(ref.title), creator: str(ref.creator),
				genre: Array.isArray(ref.genre) ? ref.genre.slice(0, 10).map((g) => str(g, 100)) : [],
				shelf: [], rating: [], coverImage: httpsUrl(ref.artworkUrl), externalUrl: httpsUrl(ref.collectionViewUrl),
				summary: "", sticky: false, publish: false, date: today, eyebrow: null,
			},
			year: "",
		};
	},
};
