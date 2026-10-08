// Stats for a folder of logs (books, films and TV, games, music, podcasts):
// what's finished each month, ratings, and the genres, moods, formats and
// people that come up most, worked out from the notes' properties. Nothing
// is fetched; src/mediastatsview.js draws it.
//
// A log's state comes from its shelf: (or status:) property: "Finished",
// "Read", "Watched" and the like count as done, "Currently Reading" and the
// like as in progress, "TBR" as planned, "DNF" as dropped. A log with no
// shelf at all counts as done, since a music log, say, has none. The day it
// was finished is finished:, else date: (the day the note was made).

import { parseFrontmatter } from "./dvpage.js";
import { setProperty } from "./bases.js";

// StoryGraph-style pace, kept apart from the other moods: "Fast-paced".
const PACE = /paced$/i;

// What each kind of log shows, beyond the counts and ratings. fields: the
// properties to rank, with the heading to show them under. amount: a number
// property added up per month (pages read).
export const STAT_KINDS = {
	book: {
		noun: ["book", "books"], done: "Read", current: "Reading", planned: "To read",
		amount: { key: "pages", noun: "pages" },
		fields: [["genre", "Genres"], ["vibesAndThemes", "Moods", (v) => !PACE.test(v)], ["vibesAndThemes", "Pace", (v) => PACE.test(v)], ["format", "Format"], ["author", "Authors"], ["subjects", "Subjects"]],
	},
	movie: {
		noun: ["title", "titles"], done: "Watched", current: "Watching", planned: "To watch",
		fields: [["genre", "Genres"], ["director", "Directors"], ["streamingServices", "Where"], ["studio", "Studios"]],
	},
	game: {
		noun: ["game", "games"], done: "Finished", current: "Playing", planned: "To play",
		fields: [["genre", "Genres"], ["platform", "Platforms"], ["developer", "Developers"]],
	},
	music: {
		noun: ["release", "releases"], done: "Logged", current: "Listening", planned: "To hear",
		fields: [["genre", "Genres"], ["artist", "Artists"], ["language", "Languages"]],
	},
	podcast: {
		noun: ["podcast", "podcasts"], done: "Finished", current: "Listening", planned: "To hear",
		fields: [["genre", "Genres"], ["creator", "Creators"]],
	},
	other: {
		noun: ["note", "notes"], done: "Finished", current: "In progress", planned: "Planned",
		fields: [["genre", "Genres"], ["tags", "Tags"]],
	},
};

const DONE = /^(finished|read|watched|played|completed?|beaten|listened|done|seen)$/;
const CURRENT = /^(currently[ -]?(reading|watching|playing|listening)|reading|watching|playing|listening|in progress|started)$/;
const PLANNED = /^(tbr|to[ -]?(read|watch|play|listen)|want[ -]?to[ -]?(read|watch|play)|wishlist|backlog|planned|queued?|up next)$/;
const DROPPED = /^(dnf|did not finish|abandoned|dropped|quit|gave up)$/;
const PAUSED = /^(paused|on hold|shelved)$/;

const first = (v) => (Array.isArray(v) ? v.find((x) => x != null && String(x).trim() !== "") : v);
const clean = (v) => String(v ?? "").replace(/[^\p{L}\p{N} -]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();

// "done" | "current" | "planned" | "dropped" | "paused" | "other" | null (no shelf).
export function stateOf(props) {
	const raw = first(props.shelf) ?? first(props.status);
	if (raw == null || String(raw).trim() === "") return null;
	const s = clean(raw);
	if (DONE.test(s)) return "done";
	if (CURRENT.test(s)) return "current";
	if (PLANNED.test(s)) return "planned";
	if (DROPPED.test(s)) return "dropped";
	if (PAUSED.test(s)) return "paused";
	return "other";
}

// A rating out of 5: "⭐⭐⭐⭐" (or ★, with ½), "4", "4/5", "9.3" (out of 10), or null.
export function ratingOf(v) {
	const r = first(v);
	if (r == null) return null;
	const s = String(r).trim();
	const stars = (s.match(/⭐|★/g) || []).length;
	if (stars) return Math.min(5, stars + (/½/.test(s) ? 0.5 : 0));
	const m = /^(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?$/.exec(s);
	if (!m) return null;
	const n = Number(m[1]), out = m[2] ? Number(m[2]) : n > 5 ? 10 : 5;
	if (!out || n < 0 || n > out) return null;
	return Math.round((n / out) * 5 * 2) / 2;
}

const DAY = /^(\d{4}-\d{2}-\d{2})/;
const dayOf = (v) => {
	const m = DAY.exec(String(first(v) ?? "").trim());
	return m ? m[1] : null;
};

// The values of a list-or-text property, cleaned of emoji and blanks:
// "📘 Book" -> ["Book"]; "Fantasy, Horror" stays one value.
export function valuesOf(v) {
	const list = Array.isArray(v) ? v : v == null ? [] : [v];
	return list.map((x) => String(x ?? "").replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1").replace(/^[^\p{L}\p{N}]+/u, "").trim()).filter(Boolean);
}

// One log as the stats need it.
export function readLog(path, text) {
	const props = parseFrontmatter(text);
	const pages = Number(first(props.pages));
	return {
		path,
		title: String(first(props.title) ?? path.split("/").pop().replace(/\.md$/i, "")),
		state: stateOf(props) ?? "done",
		finished: dayOf(props.finished) ?? dayOf(props.dateRead) ?? dayOf(props.date),
		rating: ratingOf(props.rating),
		pages: Number.isFinite(pages) && pages > 0 ? pages : null,
		cover: String(first(props.coverImage) ?? first(props.cover) ?? "") || null,
		props,
	};
}

// Which kind a folder's logs are: from the logs' own properties, by majority.
export function kindOf(logs) {
	const votes = { book: 0, movie: 0, game: 0, music: 0, podcast: 0 };
	for (const { props: p } of logs) {
		if (p.author !== undefined || p.vibesAndThemes !== undefined) votes.book++;
		else if (p.platform !== undefined || p.developer !== undefined) votes.game++;
		else if (p.artist !== undefined || p.tracks !== undefined || p.albumDuration !== undefined) votes.music++;
		else if (p.director !== undefined || p.streamingServices !== undefined || p.performers !== undefined) votes.movie++;
		else if (p.creator !== undefined) votes.podcast++;
	}
	const [kind, n] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
	return n ? kind : "other";
}

// Whether a folder's notes look like logs: most of them have a rating: or
// shelf:/status: property.
export const looksLikeLogs = (logs) => logs.length > 0 && logs.filter((l) => "rating" in l.props || "shelf" in l.props || "status" in l.props).length * 2 >= logs.length;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The years with anything finished, newest first.
export const yearsOf = (logs) => [...new Set(logs.filter((l) => l.state === "done" && l.finished).map((l) => l.finished.slice(0, 4)))].sort().reverse();

// Everything the stats page shows for year ("2026") or "all".
export function stats(logs, kind, year = "all") {
	const k = STAT_KINDS[kind] || STAT_KINDS.other;
	const inRange = (l) => year === "all" || l.finished?.startsWith(year);
	const done = logs.filter((l) => l.state === "done" && inRange(l));
	const amountOf = (l) => (k.amount ? Number(l.props[k.amount.key]) || l[k.amount.key] || 0 : 0);

	// Finished per month in a year; per year over all time.
	let periods;
	if (year === "all") {
		const ys = yearsOf(logs).reverse();
		periods = ys.map((y) => ({ label: y, key: y }));
	} else periods = MONTHS.map((label, i) => ({ label, key: `${year}-${String(i + 1).padStart(2, "0")}` }));
	const timeline = periods.map((p) => {
		const these = done.filter((l) => l.finished?.startsWith(p.key));
		return { label: p.label, count: these.length, amount: these.reduce((s, l) => s + amountOf(l), 0) };
	});

	const rated = done.filter((l) => l.rating != null);
	const ratings = [1, 2, 3, 4, 5].map((stars) => ({ stars, count: rated.filter((l) => Math.ceil(l.rating) === stars).length }));

	const fields = k.fields.map(([key, label, keep = () => true]) => {
		const vals = (l) => valuesOf(l.props[key]).filter(keep);
		const counts = new Map();
		for (const l of done) for (const v of new Set(vals(l).map((x) => x.toLowerCase()))) counts.set(v, (counts.get(v) || 0) + 1);
		// Show each value the way it's first written.
		const spelled = new Map();
		for (const l of done) for (const v of vals(l)) if (!spelled.has(v.toLowerCase())) spelled.set(v.toLowerCase(), v);
		const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([v, n]) => ({ value: spelled.get(v), count: n }));
		return { key, label, top, total: counts.size };
	}).filter((f) => f.top.length);

	const current = logs.filter((l) => l.state === "current");
	const best = rated.filter((l) => l.rating >= 5).sort((a, b) => (b.finished || "").localeCompare(a.finished || ""));
	return {
		kind, labels: k, year,
		done: done.length,
		amount: k.amount ? done.reduce((s, l) => s + amountOf(l), 0) : null,
		average: rated.length ? Math.round((rated.reduce((s, l) => s + l.rating, 0) / rated.length) * 10) / 10 : null,
		rated: rated.length,
		current, best,
		planned: logs.filter((l) => l.state === "planned").length,
		dropped: logs.filter((l) => l.state === "dropped" && inRange(l)).length,
		timeline, ratings, fields,
	};
}

// The few numbers a stats tile shows at a glance (src/homeview.js): what's
// finished this year (all time when nothing is yet), a couple of totals, and
// finished per month up to this one (per year for all time, the last 12).
// today: "2026-10-08".
export function glance(logs, today) {
	if (!logs.length) return null;
	const thisYear = today.slice(0, 4), month = Number(today.slice(5, 7));
	const kind = kindOf(logs);
	const year = yearsOf(logs).includes(thisYear) ? thisYear : "all";
	const s = stats(logs, kind, year);
	const L = s.labels;
	const extras = [];
	if (s.amount) extras.push({ n: s.amount, label: L.amount.noun });
	if (s.average != null) extras.push({ n: s.average.toFixed(1) + "★", label: "", title: `Average rating out of 5, from ${s.rated} rated` });
	if (s.current.length) extras.push({ n: s.current.length, label: L.current.toLowerCase() });
	const bars = (year === "all" ? s.timeline.slice(-12) : s.timeline.slice(0, month))
		.map((t) => ({ label: t.label, count: t.count }));
	return {
		kind, year,
		done: s.done,
		label: `${s.done === 1 ? L.noun[0] : L.noun[1]} ${L.done.toLowerCase()} ${year === "all" ? "all time" : "in " + year}`,
		extras: extras.slice(0, 2),
		bars: bars.length > 1 ? bars : [],
	};
}

// The note's new text with finished: set to today, when this edit moved its
// shelf/status to a done value and it has no finished: yet; else null. Only
// for logs (notes with a rating: property), so a story scene's "done" status
// is left alone.
export function stampFinished(before, after, today) {
	if (before == null || after == null || before === after) return null;
	const a = parseFrontmatter(after);
	if (!("rating" in a) || stateOf(a) !== "done" || (a.finished != null && String(a.finished).trim() !== "")) return null;
	if (stateOf(parseFrontmatter(before)) === "done") return null;
	return setProperty(after, "finished", today);
}
