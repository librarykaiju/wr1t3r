// The Stats view of a folder of logs (src/mediastats.js works out the
// numbers): tiles for the totals, finished per month (or per year), ratings,
// the genres, moods and people that come up most, and covers for what's in
// progress and what got five stars. Plain HTML bars, so it follows the theme
// and works offline.
//
// host: { folder, logs() -> [readLog(...)], year(), setYear(y), open(path) }

import { stats, yearsOf, kindOf } from "./mediastats.js";

const el = (tag, className, text) => {
	const e = document.createElement(tag);
	if (className) e.className = className;
	if (text != null) e.textContent = text;
	return e;
};
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const fmt = (n) => Number(n).toLocaleString();
const plural = ([one, many], n) => (n === 1 ? one : many);

export function drawStats(body, host) {
	const logs = host.logs();
	const kind = kindOf(logs);
	const years = yearsOf(logs);
	let year = host.year();
	if (year !== "all" && !years.includes(year)) year = years[0] || "all";
	const s = stats(logs, kind, year);
	const L = s.labels;

	const page = el("div", "stats");
	const head = el("div", "stats-head");
	const choose = el("div", "seg stats-years");
	choose.setAttribute("role", "group");
	choose.setAttribute("aria-label", "Show stats for");
	for (const y of ["all", ...years]) {
		const b = el("button", null, y === "all" ? "All time" : y);
		b.type = "button";
		b.setAttribute("aria-pressed", String(y === year));
		b.addEventListener("click", () => { host.setYear(y); drawStats(body, host); });
		choose.append(b);
	}
	head.append(choose);
	page.append(head);

	if (!logs.length) {
		page.append(el("p", "stats-empty", "No logs in this folder yet."));
		return body.replaceChildren(page);
	}

	// The totals.
	const tiles = el("div", "stats-tiles");
	const tile = (n, label, title) => {
		const t = el("div", "stats-tile");
		t.append(el("span", "n", n), el("span", "l", label));
		if (title) t.title = title;
		tiles.append(t);
	};
	tile(fmt(s.done), `${plural(L.noun, s.done)} ${L.done.toLowerCase()}`);
	if (s.amount != null && s.amount) tile(fmt(s.amount), L.amount.noun, "From each log's pages property");
	if (s.average != null) tile(s.average.toFixed(1), "average rating", `Out of 5, from ${s.rated} rated`);
	if (s.current.length) tile(fmt(s.current.length), L.current.toLowerCase() + " now");
	if (s.planned) tile(fmt(s.planned), L.planned.toLowerCase());
	if (s.dropped) tile(fmt(s.dropped), "didn't finish");
	page.append(tiles);

	const grid = el("div", "stats-grid");
	const card = (title, wide) => {
		const c = el("section", "stats-card" + (wide ? " wide" : ""));
		c.append(el("h3", null, title));
		grid.append(c);
		return c;
	};

	// Finished over time.
	if (s.timeline.length) {
		const per = year === "all" ? "per year" : "per month";
		columns(card(`${cap(L.noun[1])} ${L.done.toLowerCase()} ${per}`, true), s.timeline.map((t) => ({ label: t.label, value: t.count, title: `${t.count} ${plural(L.noun, t.count)}` })), 6);
		if (s.amount) columns(card(`${cap(L.amount.noun)} ${per}`, true), s.timeline.map((t) => ({ label: t.label, value: t.amount, title: `${fmt(t.amount)} ${L.amount.noun}` })), 2);
	}

	// Ratings, five stars at the top.
	if (s.rated) bars(card("Ratings"), [...s.ratings].reverse().map((r) => ({ label: "★".repeat(r.stars), value: r.count })), 3, "stars");

	// The properties that come up most.
	s.fields.forEach((f, i) => {
		const c = card(f.label);
		bars(c, f.top.map((t) => ({ label: t.value, value: t.count })), (i % 7) + 1);
		if (f.total > f.top.length) c.append(el("p", "stats-more", `and ${f.total - f.top.length} more`));
	});
	page.append(grid);

	// Covers: in progress, then five stars.
	const shelf = (title, list) => {
		if (!list.length) return;
		const c = el("section", "stats-card wide");
		c.append(el("h3", null, title));
		const row = el("div", "stats-covers");
		for (const l of list.slice(0, 24)) {
			const b = el("button", "stats-cover");
			b.type = "button";
			b.title = l.title;
			if (l.cover && /^https?:\/\//.test(l.cover)) {
				const img = el("img");
				img.src = l.cover;
				img.alt = "";
				img.loading = "lazy";
				img.referrerPolicy = "no-referrer";
				img.addEventListener("error", () => img.replaceWith(el("span", "stats-cover-text", l.title)));
				b.append(img);
			} else b.append(el("span", "stats-cover-text", l.title));
			b.addEventListener("click", () => host.open(l.path));
			row.append(b);
		}
		c.append(row);
		page.append(c);
	};
	shelf(L.current + " now", s.current);
	shelf(year === "all" ? "Five stars" : `Five stars in ${year}`, s.best);

	body.replaceChildren(page);
}

// A column chart: one column per period, its count on top.
function columns(card, items, color) {
	const max = Math.max(1, ...items.map((i) => i.value));
	const chart = el("div", "stats-cols");
	chart.style.setProperty("--bc", `var(--f${color})`);
	for (const it of items) {
		const col = el("div", "stats-col");
		col.title = it.title;
		const bar = el("div", "bar");
		bar.style.height = `${(it.value / max) * 100}%`;
		const v = el("span", "v", it.value ? fmt(it.value) : "");
		const wrap = el("div", "barwrap");
		wrap.append(v, bar);
		col.append(wrap, el("span", "lab", it.label));
		chart.append(col);
	}
	card.append(chart);
}

// A horizontal bar chart: label, bar, count.
function bars(card, items, color, extra = "") {
	const max = Math.max(1, ...items.map((i) => i.value));
	const list = el("div", "stats-bars" + (extra ? " " + extra : ""));
	list.style.setProperty("--bc", `var(--f${color})`);
	for (const it of items) {
		const row = el("div", "stats-bar");
		const track = el("span", "track");
		const fill = el("span", "fill");
		fill.style.width = `${(it.value / max) * 100}%`;
		track.append(fill);
		row.append(el("span", "lab", it.label), track, el("span", "v", fmt(it.value)));
		list.append(row);
	}
	card.append(list);
}
