// Habits: the things you mean to do each day, listed in the Daily template's
// planner block (so every day shares them) and ticked on the daily note's
// Habits card (src/plannerview.js). One habit per line, name | goal | days:
//
//   habits:
//     - 🧘 Stretch                 ticked once a day
//     - Pushups | 3                three ticks a day
//     - Write | 500 words          done once 500 words are written that day
//     - 🏃 Run | Mon, Wed, Fri     only due on those days (weekdays, weekends too)
//
// Each tick is a line in the day's health note, under "## ✅ Habits":
//   - 07:30 | 🧘 Stretch
// Words written are counted as you type (main.js), one line per device so two
// devices writing the same day don't write over each other, under
// "## ✍️ Words written":
//   - k3x9f2 | 523
// The day's totals go in the health note's properties (habitProps) so boards
// can line days up, and a habit's streak is read back from the health notes
// (streak).

import { parseDays, daysText } from "./meds.js";

export const HABITS = { heading: "✅ Habits" };
export const WORDS = { heading: "✍️ Words written" };

const pad = (n) => String(n).padStart(2, "0");
const DAY_WORDS = /^(daily|every ?day|weekdays|weekends|((sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?[\s,/&]*(and\s+)?)+)$/i;

// "Write | 500 words | weekdays" -> { name, goal, words, days }, or null.
// goal is ticks a day (1 when left out) or, with words, words a day.
export function parseHabit(line) {
	const parts = String(line ?? "").split("|").map((s) => s.trim());
	const name = parts.shift();
	if (!name) return null;
	const h = { name, goal: 1, words: false, days: null };
	for (const p of parts) {
		let m;
		if ((m = p.match(/^(\d[\d,]*)\s*(words?)?$/i))) {
			const n = Number(m[1].replace(/,/g, ""));
			if (n > 0) { h.goal = n; h.words = !!m[2]; }
		} else if (DAY_WORDS.test(p)) h.days = parseDays(p);
	}
	return h;
}

export function habitLine(h) {
	const parts = [String(h.name).replace(/\|/g, " ").trim()];
	if (h.words) parts.push(`${h.goal} words`);
	else if (h.goal > 1) parts.push(String(h.goal));
	const d = daysText(h.days);
	if (d) parts.push(d);
	return parts.join(" | ");
}

// The planner block's habits: list (strings) -> habits, duplicates by name dropped.
export function readHabits(list) {
	const out = [];
	for (const s of Array.isArray(list) ? list : []) {
		const h = parseHabit(s);
		if (h && !out.some((x) => key(x.name) === key(h.name))) out.push(h);
	}
	return out;
}

const key = (name) => String(name).trim().toLowerCase();

// "Pushups" and "💪 Pushups" are the same habit in the log, so an emoji added
// later doesn't lose the ticks before it.
const bare = (name) => key(name).replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, "");
export const sameHabit = (a, b) => bare(a) === bare(b);

// "07:30 | Stretch" -> { time, name }. A line with no time is a tick too.
export function habitEntry(text) {
	const parts = String(text).split("|").map((s) => s.trim());
	const time = /^\d{1,2}:\d{2}$/.test(parts[0] || "") ? parts.shift() : null;
	return { time, name: parts.join(" | ") };
}

export function habitTickLine(name, date = new Date()) {
	return `${pad(date.getHours())}:${pad(date.getMinutes())} | ${String(name).replace(/\|/g, " ").trim()}`;
}

// "k3x9f2 | 523" -> { device, words }, or null.
export function wordsEntry(text) {
	const m = String(text).match(/^\s*([^|]+?)\s*\|\s*(\d[\d,]*)\s*(?:words?)?\s*$/i);
	return m ? { device: m[1], words: Number(m[2].replace(/,/g, "")) } : null;
}

// A day's habit log: ticks (from habitEntry) and word lines -> { counts: Map
// of bare name -> ticks, words }.
export function dayOf(ticks = [], words = []) {
	const counts = new Map();
	for (const t of ticks) {
		const k = bare(t.name);
		if (k) counts.set(k, (counts.get(k) || 0) + 1);
	}
	return { counts, words: words.reduce((n, w) => n + (w?.words || 0), 0) };
}

// "2026-10-08" -> 0..6 (Sunday 0).
const weekday = (day) => new Date(day + "T12:00").getDay();
export const dueOn = (h, day) => !h.days || h.days.includes(weekday(day));

// How far along a habit is on a day: { n, goal, done }.
export function progress(h, d) {
	const n = h.words ? d?.words || 0 : d?.counts.get(bare(h.name)) || 0;
	return { n, goal: h.goal, done: n >= h.goal };
}

// "🧘 Stretch" -> "stretch", "Write 500 words!" -> "write_500_words".
export function slug(name) {
	return bare(name).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "habit";
}

// The properties a day's health note gets: habit_<name> (ticks, or words for
// a words habit), habits_done and habits_due (of the habits due that day),
// and words_written when any were counted.
export function habitProps(habits, d, day) {
	const out = {};
	let done = 0, due = 0;
	for (const h of habits) {
		const p = progress(h, d);
		if (p.n || dueOn(h, day)) out["habit_" + slug(h.name)] = p.n;
		if (!dueOn(h, day)) continue;
		due++;
		if (p.done) done++;
	}
	if (habits.length) Object.assign(out, { habits_done: done, habits_due: due });
	if (d?.words) out.words_written = d.words;
	return out;
}

export function addDays(day, n) {
	const d = new Date(day + "T12:00");
	d.setDate(d.getDate() + n);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A habit's record, read back from the days' logs (days: Map of
// "YYYY-MM-DD" -> dayOf(...); a missing day had nothing done):
//   current  due days in a row done, up to today (today not done yet
//            doesn't break it)
//   best     the longest run in the days given
//   done, due  in the last 30 days, from the first day it was ever done
//   grid     the last `weeks` weeks, Sunday first: [{ day, state }] with
//            state "done", "missed", "off" (not due), "today" (due, not
//            done yet), "before" (before it was first done) or "future"
export function streak(h, days, today, { weeks = 12 } = {}) {
	const isDone = (day) => progress(h, days.get(day)).done;
	const known = [...days.keys()].filter((d) => d <= today && isDone(d)).sort();
	const first = known[0] || today;
	let current = 0;
	for (let day = today; day >= first; day = addDays(day, -1)) {
		if (!dueOn(h, day)) continue;
		if (isDone(day)) current++;
		else if (day !== today) break;
	}
	let best = 0, run = 0;
	for (let day = first; day <= today; day = addDays(day, 1)) {
		if (!dueOn(h, day)) continue;
		if (isDone(day)) best = Math.max(best, ++run);
		else if (day !== today) run = 0;
	}
	let done = 0, due = 0;
	for (let i = 0; i < 30; i++) {
		const day = addDays(today, -i);
		if (day < first) break;
		if (!dueOn(h, day)) continue;
		if (isDone(day)) { done++; due++; }
		else if (day !== today) due++;
	}
	const grid = [];
	const start = addDays(today, -(weeks - 1) * 7 - weekday(today));
	for (let i = 0; i < weeks * 7; i++) {
		const day = addDays(start, i);
		const state = day > today ? "future" : day < first ? "before" : !dueOn(h, day) ? "off" : isDone(day) ? "done" : day === today ? "today" : "missed";
		grid.push({ day, state });
	}
	return { current, best, done, due, grid };
}

// For a stats tile (src/homeview.js): today's count and the longest current
// streak, with a bar per day for the last two weeks (habits done that day).
export function habitsGlance(habits, days, today) {
	if (!habits.length) return null;
	const due = habits.filter((h) => dueOn(h, today));
	const doneToday = due.filter((h) => progress(h, days.get(today)).done).length;
	const runs = habits.map((h) => ({ h, s: streak(h, days, today, { weeks: 1 }) }));
	const top = runs.sort((a, b) => b.s.current - a.s.current)[0];
	const bars = [];
	for (let i = 13; i >= 0; i--) {
		const day = addDays(today, -i);
		bars.push({ label: new Date(day + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }), count: habits.filter((h) => dueOn(h, day) && progress(h, days.get(day)).done).length });
	}
	const done30 = runs.reduce((n, r) => n + r.s.done, 0), due30 = runs.reduce((n, r) => n + r.s.due, 0);
	return {
		kind: "habits",
		done: doneToday,
		label: `of ${due.length} habit${due.length === 1 ? "" : "s"} done today`,
		extras: [
			...(top && top.s.current ? [{ n: `🔥${top.s.current}`, label: "", title: `${top.h.name}: ${top.s.current} day${top.s.current === 1 ? "" : "s"} in a row` }] : []),
			...(due30 ? [{ n: Math.round((done30 / due30) * 100) + "%", label: "last 30 days" }] : []),
		],
		bars,
		pie: null,
	};
}
