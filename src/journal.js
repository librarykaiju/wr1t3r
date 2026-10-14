// Looking back over the journal: On this day (entries from today's date in
// earlier years), the mood, sleep, exercise and weight logged in the health
// notes over a stretch of days, and the weekly, monthly and year reviews made
// from both.
// Everything here works on note text, so the paid app and the Worker build
// read the same notebook the same way.

import { parseFrontmatter } from "./dvpage.js";
import { stripFrontmatter } from "./count.js";
import { isArchived } from "./search.js";
import { readLog } from "./mediastats.js";
import { addDays, progress, dueOn } from "./habits.js";
import { moodChoice } from "./planner.js";

const pad = (n) => String(n).padStart(2, "0");
const SKIP = /(^|\/)(_templates|_wr1t3r|_?clippings|_?uploads)\//i;
const DATED = /^(\d{4})[-.](\d{2})[-.](\d{2})(?:$|[\s_-])/;
const DAY = /^(\d{4}-\d{2}-\d{2})/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const short = (day) => { const d = new Date(day + "T12:00"); return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`; };
const fileName = (path) => String(path).split("/").pop().replace(/\.md$/i, "");
const isHealth = (path) => / Health$/i.test(fileName(path));
const inJournal = (path) => /(^|\/)journal[^/]*\//i.test(path);
const isDaily = (path) => /^\d{4}[-.]\d{2}[-.]\d{2}$/.test(fileName(path));

// The day a note is a journal entry for, or null: a note named by its date
// (a daily note, "2024-05-03 Lake trip" from Day One), else one in a journal
// folder by its date: property. Health notes, templates, wr1t3r's own
// folders, clippings and uploads, and
// archived notes aren't entries.
export function entryDay(path, text) {
	if (!/\.md$/i.test(path) || SKIP.test(path) || isHealth(path)) return null;
	if (text != null && isArchived(text)) return null;
	const m = fileName(path).match(DATED);
	if (m) return `${m[1]}-${m[2]}-${m[3]}`;
	if (!inJournal(path) || text == null) return null;
	const d = parseFrontmatter(text).date;
	return DAY.exec(String(Array.isArray(d) ? d[0] : d ?? "").trim())?.[1] ?? null;
}

// The first words of a note that are its own: no properties, headings,
// code or planner blocks, embeds or comments. "" when there are none (a
// daily note with nothing written under its planner).
export function snippet(text, max = 140) {
	const body = stripFrontmatter(String(text ?? "")).replace(/%%[\s\S]*?%%/g, "").replace(/<!--[\s\S]*?-->/g, "");
	let fence = null;
	const words = [];
	for (const raw of body.split(/\r?\n/)) {
		const f = raw.match(/^\s*(`{3,}|~{3,})/);
		if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; continue; }
		if (fence) continue;
		const line = raw.trim()
			.replace(/^#{1,6}\s.*$/, "")
			.replace(/^>\s*\[![^\]]*\][+-]?\s*/, "")
			.replace(/^(?:>\s*)+/, "")
			.replace(/^(?:[-*+]|\d+[.)])\s+(?:\[.\]\s*)?/, "")
			.replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, "")
			.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
			.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/[*_`~=]+/g, "")
			.replace(/^-{3,}$/, "")
			.trim();
		if (!line) continue;
		words.push(line);
		if (words.join(" ").length >= max) break;
	}
	const s = words.join(" ").replace(/\s+/g, " ");
	return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, "") + "…" : s;
}

// A note's title: its title: property, else its name without a leading
// date ("2024-05-03 Lake trip" -> "Lake trip"; a bare date stays).
export function titleOf(path, text) {
	const t = text != null ? parseFrontmatter(text).title : null;
	const s = String(Array.isArray(t) ? t[0] ?? "" : t ?? "").trim();
	return s || fileName(path).replace(/^\d{4}[-.]\d{2}[-.]\d{2}[\s_-]+(?=\S)/, "");
}

// Every journal entry in notes ([{ path, text }]) -> [{ path, day, title,
// snippet, daily }]. A daily note counts only when something is written in
// it, so empty planner pages don't fill the list.
export function entries(notes) {
	const out = [];
	for (const n of notes) {
		const day = entryDay(n.path, n.text);
		if (!day) continue;
		const s = snippet(n.text);
		const daily = isDaily(n.path);
		if (daily && !s) continue;
		out.push({ path: n.path, day, title: titleOf(n.path, n.text), snippet: s, daily });
	}
	return out;
}

// On this day: the entries from today's month and day in earlier years,
// newest first -> [{ ...entry, years }] (years ago). February 29th's entries
// show on the 28th in other years.
export function onThisDay(list, today) {
	const [y, md] = [today.slice(0, 4), today.slice(5)];
	const leap = (n) => (n % 4 === 0 && n % 100 !== 0) || n % 400 === 0;
	const days = md === "02-28" && !leap(Number(y)) ? ["02-28", "02-29"] : [md];
	return list
		.filter((e) => e.day.slice(0, 4) < y && days.includes(e.day.slice(5)))
		.map((e) => ({ ...e, years: Number(y) - Number(e.day.slice(0, 4)) }))
		.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.daily - b.daily || a.path.localeCompare(b.path)));
}

export const yearsAgo = (n) => (n === 1 ? "1 year ago" : `${n} years ago`);

// ---- Mood, sleep, exercise and weight ------------------------------------------

// One day's mood, sleep, exercise and weight from src/planner.js healthDay():
// { mood ([emoji, label] of the last mood logged, or null), moods (every one),
// sleep (hours, or null), active (any exercise logged), steps (the day's
// steps, or null when none were logged), weight ({ value, unit } or null) }.
export function dayHealth(h) {
	const moods = (h?.moods || []).map((m) => moodChoice(m.mood)).filter((m) => m[1]);
	const w = h?.weights?.at(-1);
	return {
		mood: moods.at(-1) || null,
		moods,
		sleep: h?.sleep?.length && h.sleepHours > 0 ? h.sleepHours : null,
		active: !!h?.logged?.any,
		steps: h?.logged?.steps > 0 ? h.logged.steps : null,
		weight: w && w.value != null ? { value: w.value, unit: w.unit || null } : null,
	};
}

const round1 = (n) => Math.round(n * 10) / 10;
const avg = (xs) => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const moodKey = (m) => m[1].toLowerCase();

// The days from..to (both "YYYY-MM-DD") of days (Map day -> dayHealth())
// -> { days: [{ day, ...dayHealth }], moods: [{ emoji, label, n }] most
// logged first (each day's last mood), sleep: { avg, nights }, exercise: {
// active (days with exercise logged), steps (average on the days with steps),
// stepDays } or null, weight: {
// first, last, change, unit, n (days weighed) } or null, byMood: [{ emoji, label, sleep,
// nights }] (average sleep on the days of each mood, two nights or more) }.
export function trends(days, from, to) {
	const list = [];
	for (let d = from; d <= to; d = addDays(d, 1)) list.push({ day: d, ...(days.get(d) || dayHealth(null)) });
	const tally = new Map();
	for (const d of list) {
		if (!d.mood) continue;
		const k = moodKey(d.mood), t = tally.get(k) || { emoji: d.mood[0], label: d.mood[1], n: 0, sleeps: [] };
		t.n++;
		if (d.sleep != null) t.sleeps.push(d.sleep);
		tally.set(k, t);
	}
	const nights = list.filter((d) => d.sleep != null).map((d) => d.sleep);
	const weights = list.filter((d) => d.weight);
	const active = list.filter((d) => d.active).length, steps = list.filter((d) => d.steps != null).map((d) => d.steps);
	const unit = weights.at(-1)?.weight.unit || weights[0]?.weight.unit || null;
	return {
		days: list,
		moods: [...tally.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).map(({ emoji, label, n }) => ({ emoji, label, n })),
		sleep: { avg: avg(nights), nights: nights.length },
		exercise: active ? { active, steps: steps.length ? Math.round(avg(steps)) : null, stepDays: steps.length } : null,
		weight: weights.length ? { first: weights[0].weight.value, last: weights.at(-1).weight.value, change: round1(weights.at(-1).weight.value - weights[0].weight.value), unit, n: weights.length } : null,
		byMood: [...tally.values()].filter((t) => t.sleeps.length >= 2).map((t) => ({ emoji: t.emoji, label: t.label, sleep: avg(t.sleeps), nights: t.sleeps.length })).sort((a, b) => b.sleep - a.sleep),
	};
}

// A line chart's points for one of trends().days' numbers ("sleep", "steps"
// or "weight"): each day's, each week's average or each month's (by), leaving
// out stretches with nothing logged -> [{ label, value, title }].
export function series(days, key, by = "day") {
	const val = (d) => (key === "weight" ? d.weight?.value : d[key]);
	const groups = new Map();
	for (const d of days) {
		const v = val(d);
		if (v == null) continue;
		const k = by === "month" ? d.day.slice(0, 7) : by === "week" ? addDays(d.day, -((new Date(d.day + "T12:00").getDay() + 6) % 7)) : d.day;
		(groups.get(k) || groups.set(k, []).get(k)).push(v);
	}
	return [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, vs]) => {
		const value = key === "steps" ? Math.round(avg(vs)) : avg(vs);
		const label = by === "month" ? MONTHS[Number(k.slice(5)) - 1].slice(0, 3) : short(k);
		const what = by === "month" ? `${MONTHS[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}` : by === "week" ? `Week of ${short(k)}` : short(k);
		return { label, value, title: `${what}: ${key === "steps" ? value.toLocaleString() : value}${key === "sleep" ? " h" : key === "steps" ? " steps" : ""}${vs.length > 1 ? ` (average of ${vs.length})` : ""}` };
	});
}

// ---- Reviews -------------------------------------------------------------------

// The week (Monday to Sunday, ISO numbered), month or year around a day ->
// { kind, from, to, name ("2026-W42 Review"), title ("Week of October 12,
// 2026"), word ("week") }.
export function period(kind, day) {
	const d = new Date(day + "T12:00");
	if (kind === "month") {
		const from = `${day.slice(0, 7)}-01`;
		const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
		return { kind, from, to: `${day.slice(0, 7)}-${pad(last)}`, name: `${day.slice(0, 7)} Review`, title: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, word: "month" };
	}
	if (kind === "year") {
		const y = day.slice(0, 4);
		return { kind, from: `${y}-01-01`, to: `${y}-12-31`, name: `${y} Review`, title: `${y}`, word: "year" };
	}
	const from = addDays(day, -((d.getDay() + 6) % 7));
	const to = addDays(from, 6);
	// The ISO week: the one its Thursday falls in.
	const thu = new Date(addDays(from, 3) + "T12:00");
	const week = Math.floor(Math.round((thu - new Date(thu.getFullYear(), 0, 1, 12)) / 864e5) / 7) + 1;
	const f = new Date(from + "T12:00");
	return { kind: "week", from, to, name: `${thu.getFullYear()}-W${pad(week)} Review`, title: `Week of ${MONTHS[f.getMonth()]} ${f.getDate()}, ${f.getFullYear()}`, word: "week" };
}

const QUESTIONS = {
	week: ["What went well this week?", "What was hard?", "What did I learn?", "What do I want next week to look like?"],
	month: ["What stood out this month?", "What was hard?", "What am I proud of?", "What do I want to change next month?"],
	year: ["What were the highlights of the year?", "What was hard, and how did I get through it?", "What did I learn?", "What do I want the next year to hold?"],
};

// A wiki link the way Obsidian writes one: the note's name alone when no
// other note shares it (names: how many notes have each name, lower case),
// else its path.
const linkTo = (path, title, names) => {
	const name = fileName(path);
	const target = (names.get(name.toLowerCase()) || 0) > 1 ? path.replace(/\.md$/i, "") : name;
	return title && title !== name ? `[[${target}|${title.replace(/[|\]]/g, " ")}]]` : `[[${target}]]`;
};
const num = (n) => Number(n).toLocaleString("en-US");

// A review note for period p: its properties, the numbers (entries, words
// written, habits, mood, sleep, weight, what was finished), the entries and
// logs as links, then the questions (or the notebook's own Review template's
// body, when it has one). notes: [{ path, text }]; days: Map day ->
// healthDay() of the health notes; habits: src/habits.js readHabits();
// today: habits count only the days up to it.
export function reviewNote(p, { notes, days, habits = [], template = null, today = p.to }) {
	const inRange = (d) => d && d >= p.from && d <= p.to;
	const list = entries(notes).filter((e) => inRange(e.day)).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.path.localeCompare(b.path)));
	const health = new Map([...days].filter(([d]) => inRange(d)).map(([d, h]) => [d, dayHealth(h)]));
	const t = trends(health, p.from, p.to);
	const words = [...days].filter(([d]) => inRange(d)).reduce((n, [, h]) => n + (h?.habits?.words || 0), 0);
	const done = notes
		.filter((n) => !SKIP.test(n.path) && /\.md$/i.test(n.path) && /^(finished|dateRead)\s*:/im.test(n.text?.match(/^---[\s\S]*?\n---/)?.[0] || ""))
		.map((n) => readLog(n.path, n.text))
		.filter((l) => l.state === "done" && inRange(l.finished))
		.sort((a, b) => (a.finished < b.finished ? -1 : 1));

	const names = new Map();
	for (const n of notes) { const k = fileName(n.path).toLowerCase(); names.set(k, (names.get(k) || 0) + 1); }
	const out = ["---", `title: "${p.title.replace(/"/g, "'")} review"`, `date: ${p.to}`, `period: ${p.kind}`, `from: ${p.from}`, `to: ${p.to}`, "tags: [review]", "---", ""];
	const nums = [];
	nums.push(`- **Entries:** ${list.length}`);
	if (words) nums.push(`- **Words written:** ${num(words)}`);
	if (habits.length) {
		for (const h of habits) {
			let n = 0, due = 0;
			for (let d = p.from; d <= p.to && d <= today; d = addDays(d, 1)) {
				if (!dueOn(h, d)) continue;
				due++;
				if (progress(h, days.get(d)?.habits).done) n++;
			}
			if (due) nums.push(`- **${h.name}:** ${n} of ${due} days`);
		}
	}
	if (t.moods.length) nums.push(`- **Mood:** ${t.moods.map((m) => `${m.emoji ? m.emoji + " " : ""}${m.label} ×${m.n}`).join(", ")}`);
	if (t.sleep.avg != null) nums.push(`- **Sleep:** ${t.sleep.avg} h a night on average (${t.sleep.nights} night${t.sleep.nights === 1 ? "" : "s"} logged)`);
	if (t.weight) {
		const u = t.weight.unit ? " " + t.weight.unit : "";
		nums.push(`- **Weight:** ${t.weight.n > 1 ? `${t.weight.first} → ${t.weight.last}${u} (${t.weight.change > 0 ? "+" : ""}${t.weight.change})` : t.weight.last + u}`);
	}
	if (done.length) nums.push(`- **Finished:** ${done.length}`);
	out.push(`## This ${p.word} in numbers`, "", ...nums, "");
	if (list.length) {
		out.push("## Entries", "");
		for (const e of list) out.push(`- ${short(e.day)}: ${linkTo(e.path, e.title, names)}${e.daily && e.snippet ? ` — ${e.snippet}` : ""}`);
		out.push("");
	}
	if (done.length) {
		out.push("## Finished", "");
		for (const l of done) out.push(`- ${short(l.finished)}: ${linkTo(l.path, l.title, names)}${l.rating != null ? ` ${"★".repeat(Math.floor(l.rating))}${l.rating % 1 ? "½" : ""}` : ""}`);
		out.push("");
	}
	const own = template != null ? stripFrontmatter(template).replace(/^\s+/, "") : null;
	if (own) out.push(own.replace(/\s*$/, ""), "");
	else for (const q of QUESTIONS[p.kind]) out.push(`## ${q}`, "", "");
	return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}
