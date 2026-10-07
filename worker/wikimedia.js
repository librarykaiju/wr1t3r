// Media lookups with no key: Wikidata for the facts and Wikipedia for the
// summary and picture, used for movies and TV, games and comics when the
// keyed services (OMDb, RAWG, Comic Vine) aren't set up. Both allow calls
// from a web page, so this runs in the Worker or, with no Worker, in the page
// (src/mediahere.js).
//
// Wikidata's search can't filter by type, so results are kept by their short
// description ("2010 film by Christopher Nolan", "2017 video game").

const WD = "https://www.wikidata.org/w/api.php";
const WP = "https://en.wikipedia.org/api/rest_v1/page/summary/";

const KIND_TEST = {
	movie: /\b(film|movie|television (series|program|programme|show|film|miniseries)|tv series|web series|miniseries|sitcom|animated series|anime (television )?series|soap opera|docuseries)\b/i,
	game: /\bvideo ?game\b/i,
	comic: /\b(comic|comics|graphic novel|manga|manhwa|webcomic)\b/i,
};
const SERIES = /\b(television|tv|web|animated|anime) (series|program|programme|show)|miniseries|sitcom|soap opera|docuseries\b/i;

// Words for matching titles: "Spider-Man: Brand New Day" and "spider man
// brand new day" both -> "spider man brand new day".
export const looseTitle = (s) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// An item's English name, else its name in any language Wikidata has.
const labelOf = (labels) => labels?.en?.value || labels?.mul?.value || Object.values(labels || {})[0]?.value || "";

// A result; the year from its description ("2023 video game") helps pick
// the right box art when a remake shares the original's name.
const hit = (kind, id, title, description = "") => ({
	title, subtitle: description,
	ref: { qid: id, title, year: /\b(1[89]\d\d|20\d\d)\b/.exec(description)?.[1] || "", series: kind === "movie" && SERIES.test(description) },
});

// get(url) -> parsed JSON. The caller supplies it (the Worker adds a
// User-Agent; a page can't).
// The name search matches from the start of a title, so a title typed with
// different punctuation ("Spider-man Brand New Day") can miss; Wikidata's
// full-text search, which ignores punctuation and case, is tried next.
export async function wikiSearch(get, kind, q) {
	const qs = new URLSearchParams({ action: "wbsearchentities", search: q, language: "en", uselang: "en", type: "item", limit: "30", format: "json", origin: "*" });
	const data = await get(`${WD}?${qs}`);
	const found = (data.search || [])
		.filter((r) => KIND_TEST[kind].test(r.description || ""))
		.slice(0, 10)
		.map((r) => hit(kind, r.id, r.label || r.match?.text || r.display?.label?.value || r.id, r.description));
	if (found.length) return found;
	return wikiFullText(get, kind, q);
}

async function wikiFullText(get, kind, q) {
	const words = looseTitle(q);
	if (!words) return [];
	const qs = new URLSearchParams({ action: "query", list: "search", srsearch: words, srnamespace: "0", srlimit: "20", format: "json", origin: "*" });
	const ids = ((await get(`${WD}?${qs}`)).query?.search || []).map((r) => r.title).filter(isQid);
	if (!ids.length) return [];
	const info = new URLSearchParams({ action: "wbgetentities", ids: ids.join("|"), props: "labels|descriptions", languages: "en|mul", languagefallback: "1", format: "json", origin: "*" });
	const entities = (await get(`${WD}?${info}`)).entities || {};
	return ids
		.map((id) => ({ id, label: labelOf(entities[id]?.labels), description: entities[id]?.descriptions?.en?.value || "" }))
		.filter((r) => r.label && KIND_TEST[kind].test(r.description))
		.slice(0, 10)
		.map((r) => hit(kind, r.id, r.label, r.description));
}

const QID = /^Q\d+$/;
export const isQid = (v) => typeof v === "string" && QID.test(v);

const ids = (claims, p, max = 20) => (claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(isQid).slice(0, max);
const year = (claims) => {
	const times = (claims?.P577 || []).map((c) => c.mainsnak?.datavalue?.value?.time).filter(Boolean).sort();
	return times[0]?.match(/^[+-](\d{4})/)?.[1] || "";
};

async function labels(get, list) {
	const out = new Map();
	const unique = [...new Set(list)];
	for (let i = 0; i < unique.length; i += 50) {
		const qs = new URLSearchParams({ action: "wbgetentities", ids: unique.slice(i, i + 50).join("|"), props: "labels", languages: "en|mul", languagefallback: "1", format: "json", origin: "*" });
		const data = await get(`${WD}?${qs}`);
		for (const [id, e] of Object.entries(data.entities || {})) if (labelOf(e.labels)) out.set(id, labelOf(e.labels));
	}
	return out;
}

// "science fiction film" -> "science fiction" (the kind is already known).
const genreName = (s) => s.replace(/\s+(film|films|television series|video game|comic|comics|manga)$/i, "").trim();

// The item's claims, English title and Wikipedia summary. fallbackTitle (the
// search result's) is used when Wikidata has no name for it, so the title is
// never the bare item id. A sitelink that's only a redirect (a remake listed
// under the original game's article) gives no summary or picture: those would
// be the original's.
async function entity(get, qid, fallbackTitle = "") {
	const qs = new URLSearchParams({ action: "wbgetentities", ids: qid, props: "claims|labels|sitelinks", languages: "en|mul", languagefallback: "1", sitefilter: "enwiki", format: "json", origin: "*" });
	const e = (await get(`${WD}?${qs}`)).entities?.[qid];
	if (!e || e.missing !== undefined) throw Object.assign(new Error("Wikidata has no such item"), { status: 404 });
	const page = e.sitelinks?.enwiki?.title;
	let summary = "", image = "";
	if (page) {
		try {
			const s = await get(WP + encodeURIComponent(page.replace(/ /g, "_")));
			const landed = s.titles?.canonical || s.title || "";
			const same = !landed || landed.replace(/_/g, " ").toLowerCase() === page.replace(/_/g, " ").toLowerCase();
			if (same && s.type !== "disambiguation") {
				summary = s.extract || "";
				image = s.originalimage?.source || s.thumbnail?.source || "";
			}
		} catch {}
	}
	return { claims: e.claims || {}, title: labelOf(e.labels) || page || String(fallbackTitle || "").slice(0, 300) || qid, summary, image };
}

// The picture from the item's Wikipedia article, as the cover choice.
export async function wikiCovers(get, ref) {
	if (!isQid(ref.qid)) return [];
	const { image } = await entity(get, ref.qid, ref.title);
	return image ? [image] : [];
}

export async function wikiMovie(get, ref, today) {
	const e = await entity(get, ref.qid, ref.title);
	const c = e.claims;
	const names = await labels(get, [...ids(c, "P57"), ...ids(c, "P58"), ...ids(c, "P161", 10), ...ids(c, "P136"), ...ids(c, "P272")]);
	const list = (p, max) => ids(c, p, max).map((id) => names.get(id)).filter(Boolean);
	const series = ref.series || ids(c, "P31").includes("Q5398426");
	const common = {
		title: e.title, writers: list("P58"), studio: list("P272"), performers: list("P161", 10), genre: list("P136").map(genreName),
		streamingServices: [], shelf: [], rating: [], coverImage: e.image, summary: e.summary,
		sticky: false, publish: false, date: today, eyebrow: null,
	};
	return { fields: series ? common : { title: e.title, director: list("P57"), ...common }, year: year(c) };
}

export async function wikiGame(get, ref, cover, today) {
	const e = await entity(get, ref.qid, ref.title);
	const c = e.claims;
	const names = await labels(get, [...ids(c, "P178"), ...ids(c, "P123"), ...ids(c, "P400"), ...ids(c, "P136")]);
	const list = (p) => ids(c, p).map((id) => names.get(id)).filter(Boolean);
	return {
		fields: {
			title: e.title, developer: list("P178"), publisher: list("P123"), platform: list("P400"), genre: list("P136").map(genreName),
			status: [], rating: [], coverImage: cover || e.image, banner: "",
			description: e.summary, tags: [], sticky: false, publish: false, date: today, eyebrow: null,
		},
		year: year(c),
	};
}

export async function wikiComic(get, ref, today) {
	const e = await entity(get, ref.qid, ref.title);
	const c = e.claims;
	const writers = [...ids(c, "P50"), ...ids(c, "P170")];
	const names = await labels(get, [...writers, ...ids(c, "P110"), ...ids(c, "P123"), ...ids(c, "P179"), ...ids(c, "P136")]);
	const named = (list) => [...new Set(list.map((id) => names.get(id)).filter(Boolean))];
	const series = named(ids(c, "P179"));
	return {
		fields: {
			title: e.title, author: named(writers), artist: named(ids(c, "P110")),
			series, volume: null, format: "💬 Comic", publisher: named(ids(c, "P123"))[0] || "",
			subjects: ["Comics & Graphic Novels"], genre: ["comics"], vibesAndThemes: [], shelf: [], rating: [],
			coverImage: e.image, summary: e.summary, sticky: false, publish: false, date: today, eyebrow: null,
		},
		year: year(c),
	};
}
