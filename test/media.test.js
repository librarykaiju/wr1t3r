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
