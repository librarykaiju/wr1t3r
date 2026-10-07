import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { splitList, duration, usDate, plainText } from "../worker/media.js";
import { frontmatter, mediaNote, mediaNoteName } from "../src/medianote.js";

crypto.subtle.timingSafeEqual ??= (a, b) => Buffer.from(a).equals(Buffer.from(b));

const call = (e, path, init = {}) =>
	worker.fetch(new Request("https://w" + path, { ...init, headers: { Authorization: "Bearer t", ...init.headers } }), e);
const post = (e, path, body) => call(e, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Answers each outside call from routes: [[test(url, init), data | Response]].
function fakeWeb(routes) {
	const seen = [];
	const real = globalThis.fetch;
	globalThis.fetch = async (url, init = {}) => {
		seen.push({ url: String(url), init });
		for (const [match, answer] of routes) {
			if (match(new URL(url), init)) return answer instanceof Response ? answer : new Response(JSON.stringify(answer));
		}
		return new Response("{}", { status: 404 });
	};
	return { seen, restore: () => (globalThis.fetch = real) };
}
const host = (h, path) => (u) => u.hostname === h && (!path || u.pathname.startsWith(path));

test("frontmatter is written the way the Obsidian plugin writes it", () => {
	const text = frontmatter({
		title: "Intro: Yes", artist: ["Death*Star"], volume: null, tags: [], draft: true, releasedOn: "2011",
		summary: 'Two\nlines "quoted"', tracks: [{ number: 1, title: "A", duration: "", featuredArtists: ["X"] }],
	});
	assert.equal(text, [
		"---",
		'title: "Intro: Yes"',
		"artist:",
		'  - "Death*Star"',
		"volume:",
		"tags:",
		"draft: true",
		'releasedOn: "2011"',
		'summary: "Two\\nlines \\"quoted\\""',
		"tracks:",
		"  - number: 1",
		"    title: A",
		"    duration:",
		"    featuredArtists:",
		"      - X",
		"---",
		"",
	].join("\n"));
	assert.equal(mediaNote({ title: "X" }, "Episode Notes"), "---\ntitle: X\n---\n\n## Episode Notes\n");
});

test("note names drop characters a file can't have", () => {
	assert.equal(mediaNoteName("Who? What: [x]#1", "2020–2022"), "Who What x1 (2020–2022)");
	assert.equal(mediaNoteName("Serial", ""), "Serial");
	assert.equal(mediaNoteName("", ""), "Untitled");
});

test("small conversions match the plugin's", () => {
	assert.deepEqual(splitList("Lana Wachowski, Lilly Wachowski and Keanu Reeves"), ["Lana Wachowski", "Lilly Wachowski", "Keanu Reeves"]);
	assert.deepEqual(splitList("N/A"), []);
	assert.equal(duration(61500), "1:02");
	assert.equal(duration(0), "");
	assert.equal(usDate("2011-04-05"), "04/05/2011");
	assert.equal(usDate("2011"), "2011");
	assert.equal(plainText("<p>Hi&nbsp;&amp; <b>bye</b></p>"), "Hi & bye");
});

test("kinds say which lookups this Worker can do, and where notes go", async () => {
	const r = await call({ WR1T3R_TOKEN: "t", OMDB_API_KEY: "k", MEDIA_BOOK_FOLDER: "/Books/" }, "/api/media/kinds");
	const kinds = Object.fromEntries((await r.json()).kinds.map((k) => [k.kind, k]));
	assert.equal(kinds.movie.ready, true);
	assert.equal(kinds.movie.folder, "content/logs/movies-tv");
	assert.equal(kinds.game.ready, true, "no key means Wikidata, not no lookups");
	assert.deepEqual(kinds.game.needs, ["RAWG_API_KEY"]);
	assert.equal(kinds.book.folder, "Books");
	assert.equal(kinds.comic.folder, "Books", "comics go with books, as in the plugin");
	assert.equal(kinds.podcast.heading, "Episode Notes");
});

test("media routes need the token and a known kind", async () => {
	const e = { WR1T3R_TOKEN: "t" };
	assert.equal((await worker.fetch(new Request("https://w/api/media/kinds"), e)).status, 401);
	assert.equal((await call(e, "/api/media/search?kind=nope&q=x")).status, 400);
});

// Wikidata and Wikipedia answers for the keyless lookups.
const wd = (routes) => fakeWeb([
	[(u) => u.hostname === "www.wikidata.org" && u.searchParams.get("action") === "wbsearchentities", routes.search],
	[(u) => u.hostname === "www.wikidata.org" && u.searchParams.get("props") === "labels", routes.labels],
	[(u) => u.hostname === "www.wikidata.org" && u.searchParams.get("action") === "wbgetentities", routes.entity],
	[host("en.wikipedia.org", "/api/rest_v1/page/summary/"), routes.summary],
]);
const item = (id) => ({ mainsnak: { datavalue: { value: { id } } } });

test("no OMDb key: movies and TV come from Wikidata and Wikipedia", async () => {
	const web = wd({
		search: { search: [
			{ id: "Q25188", label: "Inception", description: "2010 film by Christopher Nolan" },
			{ id: "Q1", label: "Inception", description: "album by someone" },
			{ id: "Q2", label: "Inception", description: "American television series" },
		] },
		entity: { entities: { Q25188: { labels: { en: { value: "Inception" } }, sitelinks: { enwiki: { title: "Inception" } }, claims: {
			P57: [item("Q25191")], P58: [item("Q25191")], P161: [item("Q38111")], P136: [item("Q471839")],
			P577: [{ mainsnak: { datavalue: { value: { time: "+2010-07-16T00:00:00Z" } } } }, { mainsnak: { datavalue: { value: { time: "+2010-07-08T00:00:00Z" } } } }],
		} } } },
		labels: { entities: { Q25191: { labels: { en: { value: "Christopher Nolan" } } }, Q38111: { labels: { en: { value: "Leonardo DiCaprio" } } }, Q471839: { labels: { en: { value: "science fiction film" } } } } },
		summary: { extract: "A 2010 science fiction action film.", originalimage: { source: "https://upload.wikimedia.org/inception.jpg" } },
	});
	try {
		const e = { WR1T3R_TOKEN: "t" };
		const found = await (await call(e, "/api/media/search?kind=movie&q=inception")).json();
		assert.deepEqual(found.results.map((r) => [r.ref.qid, r.ref.series]), [["Q25188", false], ["Q2", true]]);
		const n = await (await post(e, "/api/media/note", { kind: "movie", ref: found.results[0].ref, today: "2026-10-06" })).json();
		assert.equal(Object.keys(n.fields)[1], "director", "director first, as with OMDb");
		assert.deepEqual(n.fields.director, ["Christopher Nolan"]);
		assert.deepEqual(n.fields.performers, ["Leonardo DiCaprio"]);
		assert.deepEqual(n.fields.genre, ["science fiction"]);
		assert.equal(n.fields.coverImage, "https://upload.wikimedia.org/inception.jpg");
		assert.equal(n.fields.summary, "A 2010 science fiction action film.");
		assert.equal(n.year, "2010");
		assert.ok(web.seen.every((x) => new URL(x.url).hostname !== "www.omdbapi.com"));
	} finally { web.restore(); }
});

test("no RAWG key: games from Wikidata, the article's picture as the cover", async () => {
	const web = wd({
		search: { search: [{ id: "Q20101", label: "Hades", description: "2020 video game" }, { id: "Q3", label: "Hades", description: "Greek god" }] },
		entity: { entities: { Q20101: { labels: { en: { value: "Hades" } }, sitelinks: { enwiki: { title: "Hades (video game)" } }, claims: { P178: [item("Q7")], P400: [item("Q8"), item("Q9")] } } } },
		labels: { entities: { Q7: { labels: { en: { value: "Supergiant Games" } } }, Q8: { labels: { en: { value: "Nintendo Switch" } } }, Q9: { labels: { en: { value: "Windows" } } } } },
		summary: { extract: "Roguelike.", thumbnail: { source: "https://upload.wikimedia.org/hades.png" } },
	});
	try {
		const e = { WR1T3R_TOKEN: "t" };
		const found = await (await call(e, "/api/media/search?kind=game&q=hades")).json();
		assert.deepEqual(found.results.map((r) => r.title), ["Hades"]);
		const covers = await (await post(e, "/api/media/covers", { kind: "game", ref: found.results[0].ref })).json();
		assert.deepEqual(covers.covers, ["https://upload.wikimedia.org/hades.png"]);
		const n = await (await post(e, "/api/media/note", { kind: "game", ref: found.results[0].ref, cover: covers.covers[0], today: "2026-10-06" })).json();
		assert.deepEqual(n.fields.developer, ["Supergiant Games"]);
		assert.deepEqual(n.fields.platform, ["Nintendo Switch", "Windows"]);
		assert.equal(n.fields.coverImage, "https://upload.wikimedia.org/hades.png");
		assert.ok(web.seen.some((x) => x.url.includes("Hades_(video_game)")));
	} finally { web.restore(); }
});

test("no Comic Vine key: comics from Wikidata", async () => {
	const web = wd({
		search: { search: [{ id: "Q11", label: "Saga", description: "comic book series" }, { id: "Q12", label: "Saga", description: "long story" }] },
		entity: { entities: { Q11: { labels: { en: { value: "Saga" } }, claims: { P50: [item("Q13")], P110: [item("Q14")], P123: [item("Q15")] } } } },
		labels: { entities: { Q13: { labels: { en: { value: "Brian K. Vaughan" } } }, Q14: { labels: { en: { value: "Fiona Staples" } } }, Q15: { labels: { en: { value: "Image Comics" } } } } },
		summary: {},
	});
	try {
		const e = { WR1T3R_TOKEN: "t" };
		const found = await (await call(e, "/api/media/search?kind=comic&q=saga")).json();
		assert.equal(found.results.length, 1);
		const n = await (await post(e, "/api/media/note", { kind: "comic", ref: found.results[0].ref, today: "2026-10-06" })).json();
		assert.deepEqual([n.fields.author, n.fields.artist, n.fields.publisher, n.fields.format], [["Brian K. Vaughan"], ["Fiona Staples"], "Image Comics", ["💬Comic"]]);
		assert.equal(n.fields.summary, "", "no Wikipedia article: no summary, no request");
		assert.ok(!web.seen.some((x) => x.url.includes("wikipedia")));
	} finally { web.restore(); }
});

test("a movie: search, then its note with director first", async () => {
	const web = fakeWeb([
		[(u) => u.hostname === "www.omdbapi.com" && u.searchParams.get("s"), { Search: [
			{ Title: "The Matrix", Year: "1999", Type: "movie", imdbID: "tt0133093", Poster: "https://p/m.jpg" },
			{ Title: "The Matrix Game", Year: "2003", Type: "game", imdbID: "tt1" },
		] }],
		[(u) => u.hostname === "www.omdbapi.com" && u.searchParams.get("i"), {
			Title: "The Matrix", Year: "1999", Type: "movie", Director: "Lana Wachowski, Lilly Wachowski", Writer: "N/A",
			Actors: "Keanu Reeves", Genre: "Action, Sci-Fi", Poster: "https://p/m.jpg", Plot: "Neo.",
		}],
	]);
	try {
		const e = { WR1T3R_TOKEN: "t", OMDB_API_KEY: "k" };
		const s = await (await call(e, "/api/media/search?kind=movie&q=matrix")).json();
		assert.deepEqual(s.results.map((r) => r.title), ["The Matrix"], "only movies and series");
		assert.equal(new URL(web.seen[0].url).searchParams.get("apikey"), "k");
		const n = await (await post(e, "/api/media/note", { kind: "movie", ref: s.results[0].ref, today: "2026-09-29" })).json();
		assert.deepEqual(Object.keys(n.fields).slice(0, 3), ["title", "director", "writers"]);
		assert.deepEqual(n.fields.director, ["Lana Wachowski", "Lilly Wachowski"]);
		assert.deepEqual(n.fields.writers, []);
		assert.equal(n.fields.date, "2026-09-29");
		assert.equal(n.year, "1999");
		assert.equal((await post(e, "/api/media/note", { kind: "movie", ref: { imdbID: "../x" } })).status, 400, "ids are checked");
	} finally { web.restore(); }
});

test("a book: covers from Google and Open Library, summary, tags from Claude", async () => {
	const web = fakeWeb([
		[host("www.googleapis.com"), { items: [{ volumeInfo: { imageLinks: { thumbnail: "http://books.google.com/c?id=1&zoom=1" }, description: "From Google." } }] }],
		[host("openlibrary.org", "/works/OL1W/editions.json"), { entries: [{ covers: [7] }, { covers: [7] }, { covers: [-1] }] }],
		[host("openlibrary.org", "/works/OL1W.json"), { description: { value: "A monk and a robot." }, subjects: ["Robots, Tea", "robots", "Fiction, science fiction, general"] }],
		[host("api.anthropic.com"), { content: [{ text: '{"subjects": ["Robots -- Fiction"], "vibesAndThemes": ["Cozy"]}' }] }],
	]);
	try {
		const e = { WR1T3R_TOKEN: "t", ANTHROPIC_API_KEY: "sk" };
		const ref = { workKey: "/works/OL1W", title: "A Psalm for the Wild-Built", authors: ["Becky Chambers"], coverId: 5, year: "2021" };
		const c = await (await post(e, "/api/media/covers", { kind: "book", ref })).json();
		assert.deepEqual(c.covers, [
			"https://books.google.com/c?id=1&zoom=3",
			"https://covers.openlibrary.org/b/id/5-M.jpg",
			"https://covers.openlibrary.org/b/id/7-M.jpg",
		]);
		const n = await (await post(e, "/api/media/note", { kind: "book", ref, cover: "https://covers.openlibrary.org/b/id/5-M.jpg", today: "2026-09-29" })).json();
		assert.equal(n.fields.summary, "A monk and a robot.");
		assert.deepEqual(n.fields.subjects, ["Robots -- Fiction"]);
		assert.deepEqual(n.fields.vibesAndThemes, ["Cozy"]);
		assert.deepEqual(n.fields.genre, ["Science Fiction"]);
		assert.equal(n.fields.coverImage, "https://covers.openlibrary.org/b/id/5-M.jpg");
		assert.equal(n.year, "2021");
		const claude = web.seen.find((s) => s.url.startsWith("https://api.anthropic.com"));
		assert.equal(claude.init.headers["x-api-key"], "sk");
		const noKey = await (await post({ WR1T3R_TOKEN: "t" }, "/api/media/note", { kind: "book", ref, cover: "javascript:alert(1)" })).json();
		assert.deepEqual(noKey.fields.subjects, ["Robots", "Tea", "science fiction"], "Open Library's subjects without Claude, less \"Fiction\" and \"general\"");
		assert.deepEqual(noKey.fields.genre, ["Science Fiction"], "genres without Claude too");
		assert.equal(noKey.fields.coverImage, "", "only https covers");
	} finally { web.restore(); }
});

test("an album: tracks from the earliest release, repeated discs once", async () => {
	const id = "0c3e150e-1bf4-47bb-8526-84f84562763e";
	const tracks = [{ number: "1", title: "One", length: 61000, "artist-credit": [{ name: "Death*Star" }] }, { number: "2", title: "Two", length: 60000, "artist-credit": [{ name: "Guest" }] }];
	const web = fakeWeb([
		[host("musicbrainz.org", `/ws/2/release-group/${id}`), { title: "A New Dope", "artist-credit": [{ name: "Death*Star" }], genres: [{ name: "hip hop" }], tags: [] }],
		[host("musicbrainz.org", "/ws/2/release"), { releases: [
			{ date: "2012-01-01", media: [] },
			{ date: "2011-04-05", "text-representation": { language: "eng" }, media: [{ tracks }, { tracks }] },
		] }],
		[host("coverartarchive.org"), new Response(null, { status: 307, headers: { Location: "https://archive.org/x.jpg" } })],
	]);
	try {
		const n = await (await post({ WR1T3R_TOKEN: "t" }, "/api/media/note", { kind: "music", ref: { releaseGroupId: id, title: "A New Dope", year: "2011" } })).json();
		assert.equal(n.fields.coverImage, `https://coverartarchive.org/release-group/${id}/front-500`);
		assert.equal(n.fields.releasedOn, "04/05/2011");
		assert.equal(n.fields.language, "English");
		assert.equal(n.fields.albumDuration, "2:01");
		assert.deepEqual(n.fields.tracks, [
			{ number: 1, title: "One", duration: "1:01", featuredArtists: [] },
			{ number: 2, title: "Two", duration: "1:00", featuredArtists: ["Guest"] },
		]);
		assert.ok(web.seen.every((s) => s.init.headers["User-Agent"]), "MusicBrainz wants a User-Agent");
	} finally { web.restore(); }
});

test("a podcast needs nothing past the search", async () => {
	const web = fakeWeb([[host("itunes.apple.com"), { results: [{
		collectionName: "Serial", artistName: "This American Life", artworkUrl100: "https://a/100x100bb.jpg",
		collectionViewUrl: "https://podcasts.apple.com/serial", primaryGenreName: "News", genres: ["News", "Podcasts"],
	}] }]]);
	try {
		const e = { WR1T3R_TOKEN: "t" };
		const s = await (await call(e, "/api/media/search?kind=podcast&q=serial")).json();
		const n = await (await post(e, "/api/media/note", { kind: "podcast", ref: s.results[0].ref, today: "2026-09-29" })).json();
		assert.equal(n.fields.coverImage, "https://a/600x600bb.jpg");
		assert.deepEqual(n.fields.genre, ["News"]);
		assert.equal(n.fields.externalUrl, "https://podcasts.apple.com/serial");
		assert.equal(web.seen.length, 1);
	} finally { web.restore(); }
});

test("searches forgive punctuation and case", async () => {
	const { queryVariants, forgiving } = await import("../worker/media.js");
	assert.deepEqual(queryVariants("Spider-man: Brand New Day"), ["Spider-man: Brand New Day", "Spider man Brand New Day", "spider man brand new day"]);
	const tried = [];
	const found = await forgiving("Spider-man Brand New Day", async (v) => {
		tried.push(v);
		return v === "Spider man Brand New Day" ? [{ title: "Spider-Man 3" }, { title: "Spider-Man: Brand New Day" }] : [];
	});
	assert.deepEqual(tried, ["Spider-man Brand New Day", "Spider man Brand New Day"]);
	assert.equal(found[0].title, "Spider-Man: Brand New Day", "the exact title first");
});

test("OMDb finding nothing falls back to Wikidata's full-text search", async () => {
	const web = fakeWeb([
		[host("www.omdbapi.com"), { Response: "False", Error: "Movie not found!" }],
		[(u) => u.hostname === "www.wikidata.org" && u.searchParams.get("action") === "wbsearchentities", { search: [] }],
		[(u) => u.hostname === "www.wikidata.org" && u.searchParams.get("list") === "search", { query: { search: [{ title: "Q120" }, { title: "Q121" }] } }],
		[(u) => u.hostname === "www.wikidata.org" && u.searchParams.get("action") === "wbgetentities", { entities: {
			Q120: { labels: { en: { value: "Spider-Man: Brand New Day" } }, descriptions: { en: { value: "2026 film directed by Destin Daniel Cretton" } } },
			Q121: { labels: { en: { value: "Brand New Day" } }, descriptions: { en: { value: "song" } } },
		} }],
	]);
	try {
		const s = await (await call({ WR1T3R_TOKEN: "t", OMDB_API_KEY: "k" }, "/api/media/search?kind=movie&q=" + encodeURIComponent("Spider-man Brand New Day"))).json();
		assert.deepEqual(s.results.map((r) => [r.title, r.ref.qid, r.ref.year]), [["Spider-Man: Brand New Day", "Q120", "2026"]]);
		assert.ok(web.seen.some((x) => new URL(x.url).searchParams.get("srsearch") === "spider man brand new day"));
	} finally { web.restore(); }
});

test("MusicBrainz searches have Lucene's syntax characters escaped", async () => {
	const web = fakeWeb([[host("musicbrainz.org"), { "release-groups": [{ id: "x", title: "AC/DC: Live", "artist-credit": [] }] }]]);
	try {
		await call({ WR1T3R_TOKEN: "t" }, "/api/media/search?kind=music&q=" + encodeURIComponent("AC/DC: Live"));
		assert.equal(new URL(web.seen[0].url).searchParams.get("query"), "AC\\/DC\\: Live");
	} finally { web.restore(); }
});

test("a Wikidata game with no English name or article never gets its id as a title", async () => {
	const web = wd({
		search: { search: [{ id: "Q555", match: { text: "Resident Evil 4" }, description: "2023 video game" }] },
		entity: { entities: { Q555: { labels: {}, claims: {} } } },
		labels: { entities: {} },
		summary: {},
	});
	try {
		const e = { WR1T3R_TOKEN: "t" };
		const found = await (await call(e, "/api/media/search?kind=game&q=resident%20evil%204")).json();
		assert.equal(found.results[0].title, "Resident Evil 4");
		const n = await (await post(e, "/api/media/note", { kind: "game", ref: found.results[0].ref, today: "2026-10-07" })).json();
		assert.equal(n.fields.title, "Resident Evil 4");
	} finally { web.restore(); }
});

test("a remake whose article is a redirect to the original's doesn't take the original's picture", async () => {
	const web = wd({
		search: { search: [{ id: "Q600", label: "Link's Awakening", description: "2019 video game" }] },
		entity: { entities: { Q600: { labels: { en: { value: "Link's Awakening" } }, sitelinks: { enwiki: { title: "The Legend of Zelda: Link's Awakening (2019 video game)" } }, claims: {} } } },
		labels: { entities: {} },
		summary: { titles: { canonical: "The_Legend_of_Zelda:_Link's_Awakening" }, extract: "A 1993 game.", originalimage: { source: "https://upload.wikimedia.org/1993.png" } },
	});
	try {
		const e = { WR1T3R_TOKEN: "t" };
		const ref = (await (await call(e, "/api/media/search?kind=game&q=links%20awakening")).json()).results[0].ref;
		assert.deepEqual((await (await post(e, "/api/media/covers", { kind: "game", ref })).json()).covers, []);
		const n = await (await post(e, "/api/media/note", { kind: "game", ref, today: "2026-10-07" })).json();
		assert.equal(n.fields.coverImage, "");
		assert.equal(n.fields.description, "");
		assert.equal(n.year, "");
	} finally { web.restore(); }
});

test("a RAWG game: the chosen entry's own data, and box art for its own year", async () => {
	const web = fakeWeb([
		[host("api.rawg.io", "/api/games/2"), { name: "Resident Evil 4", released: "2023-03-24", background_image: "https://media.rawg.io/re4-2023.jpg", developers: [{ name: "Capcom" }] }],
		[host("id.twitch.tv"), { access_token: "a", expires_in: 3600 }],
		[host("api.igdb.com"), [
			{ name: "Resident Evil 4", first_release_date: Date.UTC(2005, 0, 11) / 1000, cover: { image_id: "old" } },
			{ name: "Resident Evil 4", first_release_date: Date.UTC(2023, 2, 24) / 1000, cover: { image_id: "new" } },
		]],
		[host("store.steampowered.com", "/api/storesearch/"), { items: [{ id: 1, name: "Resident Evil 4" }] }],
		[host("store.steampowered.com", "/api/appdetails"), { 1: { data: { header_image: "https://steam/re4-2005.jpg", release_date: { date: "28 Feb, 2014" } } } }],
	]);
	try {
		const e = { WR1T3R_TOKEN: "t", RAWG_API_KEY: "k", IGDB_CLIENT_ID: "i", IGDB_CLIENT_SECRET: "s" };
		const ref = { id: 2, title: "Resident Evil 4", year: "2023", thumbnailUrl: "https://media.rawg.io/re4-2023.jpg" };
		const c = (await (await post(e, "/api/media/covers", { kind: "game", ref })).json()).covers;
		assert.equal(c[0], "https://images.igdb.com/igdb/image/upload/t_cover_big/new.jpg");
		const n = await (await post(e, "/api/media/note", { kind: "game", ref, cover: c[0], today: "2026-10-07" })).json();
		assert.equal(n.fields.banner, "https://media.rawg.io/re4-2023.jpg", "Steam's is a different year's");
		assert.equal(n.year, "2023");
	} finally { web.restore(); }
});

test("an anime: AniList's details, its cover and MyAnimeList's to choose from", async () => {
	const media = {
		id: 21, idMal: 5114, title: { romaji: "Hagane no Renkinjutsushi: Fullmetal Alchemist", english: "Fullmetal Alchemist: Brotherhood" },
		startDate: { year: 2009 }, format: "TV", episodes: 64, genres: ["Action", "Adventure"], description: "Two brothers.<br>Alchemy.",
		bannerImage: "https://s4.anilist.co/banner.jpg", siteUrl: "https://anilist.co/anime/5114",
		coverImage: { extraLarge: "https://s4.anilist.co/xl.jpg", large: "https://s4.anilist.co/l.jpg", medium: "https://s4.anilist.co/m.jpg" },
		studios: { nodes: [{ name: "Bones" }] }, externalLinks: [{ site: "Crunchyroll", type: "STREAMING" }, { site: "Twitter", type: "SOCIAL" }],
		staff: { edges: [{ role: "Director", node: { name: { full: "Yasuhiro Irie" } } }, { role: "Music", node: { name: { full: "Akira Senju" } } }] },
	};
	const web = fakeWeb([
		[(u, init) => u.hostname === "graphql.anilist.co" && init.body.includes("Page("), { data: { Page: { media: [media] } } }],
		[host("graphql.anilist.co"), { data: { Media: media } }],
		[host("api.jikan.moe", "/v4/anime/5114"), { data: { images: { jpg: { large_image_url: "https://cdn.myanimelist.net/l.jpg" } } } }],
	]);
	try {
		const e = { WR1T3R_TOKEN: "t" };
		const kinds = (await (await call(e, "/api/media/kinds")).json()).kinds;
		assert.ok(kinds.every((k) => k.covers), "every kind offers covers");
		assert.equal(kinds.find((k) => k.kind === "anime").folder, "content/logs/movies-tv");
		const s = await (await call(e, "/api/media/search?kind=anime&q=fullmetal")).json();
		assert.equal(s.results[0].title, "Fullmetal Alchemist: Brotherhood");
		assert.match(s.results[0].subtitle, /TV series - 2009/);
		const c = (await (await post(e, "/api/media/covers", { kind: "anime", ref: s.results[0].ref })).json()).covers;
		assert.deepEqual(c, ["https://s4.anilist.co/xl.jpg", "https://cdn.myanimelist.net/l.jpg"]);
		const n = await (await post(e, "/api/media/note", { kind: "anime", ref: s.results[0].ref, cover: c[1], today: "2026-10-07" })).json();
		assert.deepEqual([n.fields.director, n.fields.studio, n.fields.episodes], [["Yasuhiro Irie"], ["Bones"], 64]);
		assert.ok(!("format" in n.fields), "format is for book logs only");
		assert.deepEqual(n.fields.streamingServices, ["Crunchyroll"]);
		assert.equal(n.fields.summary, "Two brothers. Alchemy.");
		assert.equal(n.fields.coverImage, "https://cdn.myanimelist.net/l.jpg");
		assert.equal(n.fields.banner, "https://s4.anilist.co/banner.jpg");
		assert.equal(n.year, "2009");
	} finally { web.restore(); }
});

test("album covers: the group's, its releases', then iTunes'", async () => {
	const id = "9c3e150e-1bf4-47bb-8526-84f84562763e", rel = "11111111-2222-3333-4444-555555555555";
	const web = fakeWeb([
		[host("musicbrainz.org", "/ws/2/release"), { releases: [{ id: rel, date: "2011", "cover-art-archive": { front: true } }, { id: "22222222-2222-3333-4444-555555555555", "cover-art-archive": { front: false } }] }],
		[host("coverartarchive.org"), new Response(null, { status: 404 })],
		[host("itunes.apple.com"), { results: [
			{ collectionName: "A New Dope (Deluxe Edition)", artistName: "Death*Star", artworkUrl100: "https://is1.mzstatic.com/a/100x100bb.jpg" },
			{ collectionName: "Another Album", artistName: "Death*Star", artworkUrl100: "https://is1.mzstatic.com/b/100x100bb.jpg" },
		] }],
	]);
	try {
		const c = (await (await post({ WR1T3R_TOKEN: "t" }, "/api/media/covers", { kind: "music", ref: { releaseGroupId: id, title: "A New Dope", artist: "Death*Star" } })).json()).covers;
		assert.deepEqual(c, [`https://coverartarchive.org/release-group/${id}/front-500`, `https://coverartarchive.org/release/${rel}/front-500`, "https://is1.mzstatic.com/a/600x600bb.jpg"],
			"the group's cover isn't checked first (slow); the picker drops pictures that don't load");
		assert.ok(!web.seen.some((x) => x.url.startsWith("https://coverartarchive.org/")), "no call to Cover Art Archive");
	} finally { web.restore(); }
});

test("covers for an existing log: search its title, take the matching result's", async () => {
	const web = fakeWeb([
		[host("musicbrainz.org", "/ws/2/release-group"), { "release-groups": [] }],
		[host("itunes.apple.com"), { results: [{ collectionName: "Kid A", artistName: "Radiohead", artworkUrl100: "https://is1.mzstatic.com/k/100x100bb.jpg" }] }],
	]);
	try {
		const r = await (await post({ WR1T3R_TOKEN: "t" }, "/api/media/findcovers", { kind: "music", title: "Kid A", creator: "Radiohead" })).json();
		assert.deepEqual(r.covers, ["https://is1.mzstatic.com/k/600x600bb.jpg"], "iTunes when MusicBrainz has no match");
		assert.equal((await post({ WR1T3R_TOKEN: "t" }, "/api/media/findcovers", { kind: "music", title: "" })).status, 400);
	} finally { web.restore(); }
});

test("a movie's covers: OMDb's poster, then iTunes' for the same title and year", async () => {
	const web = fakeWeb([
		[(u) => u.hostname === "www.omdbapi.com" && u.searchParams.get("i"), { Title: "The Matrix", Type: "movie", Poster: "https://p/m.jpg" }],
		[host("itunes.apple.com"), { results: [
			{ trackName: "The Matrix", releaseDate: "1999-03-31T08:00:00Z", artworkUrl100: "https://is1.mzstatic.com/m/100x100bb.jpg" },
			{ trackName: "The Matrix Resurrections", releaseDate: "2021-12-22T08:00:00Z", artworkUrl100: "https://is1.mzstatic.com/r/100x100bb.jpg" },
		] }],
	]);
	try {
		const c = (await (await post({ WR1T3R_TOKEN: "t", OMDB_API_KEY: "k" }, "/api/media/covers", { kind: "movie", ref: { imdbID: "tt0133093", title: "The Matrix", year: "1999" } })).json()).covers;
		assert.deepEqual(c, ["https://p/m.jpg", "https://is1.mzstatic.com/m/600x600bb.jpg"]);
	} finally { web.restore(); }
});

test("anime falls back to Wikidata when AniList can't be reached", async () => {
	const web = fakeWeb([
		[host("graphql.anilist.co"), new Response("Forbidden", { status: 403 })],
		[(u) => u.hostname === "www.wikidata.org" && u.searchParams.get("action") === "wbsearchentities", { search: [
			{ id: "Q1", label: "Frieren", description: "2023 anime television series" },
			{ id: "Q2", label: "Frieren", description: "2024 film" },
		] }],
		[(u) => u.hostname === "www.wikidata.org" && u.searchParams.get("action") === "wbgetentities", { entities: { Q1: { labels: { en: { value: "Frieren" } }, claims: {} } } }],
	]);
	try {
		const e = { WR1T3R_TOKEN: "t" };
		const s = await (await call(e, "/api/media/search?kind=anime&q=frieren")).json();
		assert.deepEqual(s.results.map((r) => r.ref.qid), ["Q1"], "anime results first");
		const n = await (await post(e, "/api/media/note", { kind: "anime", ref: s.results[0].ref, cover: "", today: "2026-10-07" })).json();
		assert.equal(n.fields.title, "Frieren");
	} finally { web.restore(); }
	const down = fakeWeb([[host("graphql.anilist.co"), new Response("Forbidden", { status: 403 })]]);
	try {
		const r = await call({ WR1T3R_TOKEN: "t" }, "/api/media/search?kind=anime&q=frieren");
		assert.equal(r.status, 502, "nothing anywhere: AniList's error is shown");
		assert.match((await r.json()).error, /graphql\.anilist\.co answered 403/);
	} finally { down.restore(); }
});

test("the page's security policy lets it reach every keyless lookup service", async () => {
	const { readFile } = await import("node:fs/promises");
	const csp = (await readFile(new URL("../public/_headers", import.meta.url), "utf8")).match(/connect-src ([^;]+)/)[1].split(/\s+/);
	const code = (await readFile(new URL("../worker/media.js", import.meta.url), "utf8")) + (await readFile(new URL("../worker/wikimedia.js", import.meta.url), "utf8"));
	// Keyed services and Steam are only ever called from the Worker.
	const workerOnly = /omdbapi|rawg|igdb|twitch|comicvine|steampowered|anthropic/;
	const hosts = [...new Set([...code.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]+)/g)].map((m) => m[1]))].filter((h) => !workerOnly.test(h) && !/^(images|media|covers|s4|cdn|is1)\./.test(h) && h !== "wr1t3r.invalid" && h !== "github.com");
	for (const h of hosts) assert.ok(csp.includes("https://" + h), `connect-src is missing https://${h}`);
});

test("a slow cover source doesn't hold up the others", async () => {
	const real = globalThis.setTimeout;
	const web = fakeWeb([
		[host("graphql.anilist.co"), { data: { Media: { coverImage: { extraLarge: "https://s4.anilist.co/xl.jpg" } } } }],
	]);
	const fetchNow = globalThis.fetch;
	globalThis.fetch = (url, init) => (new URL(url).hostname === "api.jikan.moe" ? new Promise(() => {}) : fetchNow(url, init));
	// Time runs fast for the give-up timer.
	globalThis.setTimeout = (fn, ms, ...a) => real(fn, ms >= 1000 ? 5 : ms, ...a);
	try {
		const c = (await (await post({ WR1T3R_TOKEN: "t" }, "/api/media/covers", { kind: "anime", ref: { anilistId: 1, idMal: 2 } })).json()).covers;
		assert.deepEqual(c, ["https://s4.anilist.co/xl.jpg"]);
	} finally { globalThis.setTimeout = real; globalThis.fetch = fetchNow; web.restore(); }
});
