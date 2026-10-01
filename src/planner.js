// The Planner: a daily note's page, set up once in a ```wr1t3r-planner block
// (usually in _templates/Daily.md). src/plannerview.js draws it as a banner
// and title, a row of health buttons, then the day's timeline beside its task
// lists. This file works out what goes in them and the text changes they make.
//
//   ```wr1t3r-planner
//   banner: "[[planner.jpg]]"   optional picture across the top
//   title: My day                optional; the day's date otherwise
//   tasks: [crit, todo]          task list cards in the right column
//   moods: [😄 Great, 🙂 Good]   the Mood button's choices (these eight otherwise)
//   exercises: [🚶 Walk, 🏃 Run] the Exercise button's choices
//   colors: {timeline: 3, crit: 5} card colors, 1-7 from the theme's rainbow
//                                (the cards' color dots set them in
//                                _templates/Daily.md, so every day shares them)
//   timeline:                    the Timeline card's entries
//     - 09:00 - 10:00 | Standup
//     - All day | Trip
//   ```
//
// The health buttons write to the day's health note ("2026-09-30 Health",
// beside the daily note, made from _templates/Daily Health.md): each log is a
// line under its heading, the same lines the Daily template's meters read,
//   ### 🍳Breakfast        - Apple, 1        (food name, servings)
//   ### 💧 Water           - 8               (fl oz)
//   ## Mood Log            - 14:32 | 🙂 Good
//   ### 🏃 Exercise        - 07:30 | 🚶 Walk | 3200 steps | 150 cal | note
// and after each one the day's totals are copied into the health note's
// properties (calories, fat_g, carbs_g, protein_g, fiber_g, hydration_oz,
// meds, mood, steps, activity_kcal) so Bases and Dataview can chart them across days.

import { parseYaml, setProperty } from "./bases.js";
import { parseFrontmatter } from "./dvpage.js";

export const PLANNER = "wr1t3r-planner";

export const MOODS = [["😄", "Great"], ["🙂", "Good"], ["😐", "Okay"], ["😴", "Tired"], ["😰", "Anxious"], ["😕", "Low"], ["😢", "Sad"], ["😠", "Irritable"]];
const DEFAULT_MOODS = MOODS.map((m) => m.join(" "));

const DEFAULT_EXERCISES = ["🚶 Walk", "🏃 Run", "🥾 Hike"];

const DEFAULTS = { tasks: ["crit", "todo"], moods: DEFAULT_MOODS, exercises: DEFAULT_EXERCISES, calories_target: 2417, water_target: 128, water_step: 8, steps_target: 7000, activity_target: 400, start: 9, end: 21 };
const NUMBERS = ["calories_target", "water_target", "water_step", "steps_target", "activity_target", "start", "end"];
const ORDER = ["banner", "title", "tasks", "moods", "exercises", "nutrition", ...NUMBERS, "colors", "timeline"];
export const CARD_COLORS = 7;

// ---- The block ---------------------------------------------------------------

export function readPlanner(code) {
	let y = null;
	try { y = parseYaml(String(code || "")); } catch {}
	const raw = y && typeof y === "object" && !Array.isArray(y) ? y : {};
	const cfg = { ...DEFAULTS, ...raw };
	const list = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : String(v).split(",")).map((s) => String(s).replace(/^#/, "").trim()).filter(Boolean);
	cfg.tasks = raw.tasks === undefined ? DEFAULTS.tasks : list(raw.tasks);
	cfg.moods = raw.moods === undefined ? DEFAULT_MOODS : list(raw.moods);
	if (!cfg.moods.length) cfg.moods = DEFAULT_MOODS;
	cfg.exercises = raw.exercises === undefined ? DEFAULT_EXERCISES : list(raw.exercises);
	if (!cfg.exercises.length) cfg.exercises = DEFAULT_EXERCISES;
	cfg.timeline = (Array.isArray(raw.timeline) ? raw.timeline : []).map((s) => String(s ?? "").trim()).filter(Boolean);
	for (const k of NUMBERS) {
		const n = Number(cfg[k]);
		cfg[k] = Number.isFinite(n) && n > 0 ? n : DEFAULTS[k];
	}
	cfg.start = Math.min(23, Math.floor(cfg.start));
	cfg.end = Math.max(cfg.start + 1, Math.min(24, Math.floor(cfg.end)));
	for (const k of ["banner", "title", "nutrition"]) cfg[k] = raw[k] == null || String(raw[k]).trim() === "" ? null : String(raw[k]).trim();
	cfg.colors = {};
	if (raw.colors && typeof raw.colors === "object" && !Array.isArray(raw.colors)) {
		for (const [k, v] of Object.entries(raw.colors)) {
			const n = Number(v);
			if (Number.isInteger(n) && n >= 1 && n <= CARD_COLORS) cfg.colors[String(k).replace(/^#/, "").toLowerCase()] = n;
		}
	}
	return cfg;
}

// A YAML scalar: plain when that reads back as the same string, else quoted.
const scalar = (v) => {
	if (typeof v === "number") return String(v);
	const s = String(v);
	const plain = s && !/^[\s\-?:,[\]{}#&*!|>'"%@`]|\s$|: |:$| #/.test(s) && !/^(true|false|null|yes|no|on|off|~|[-+]?[\d.]+)$/i.test(s);
	return plain ? s : JSON.stringify(s);
};

// The block's text: what differs from the defaults, then the timeline. Keys
// this file doesn't know are kept.
export function writePlanner(cfg) {
	const out = [];
	const same = (k) => JSON.stringify(cfg[k]) === JSON.stringify(DEFAULTS[k]) || (k === "colors" && !Object.keys(cfg[k] || {}).length);
	for (const k of [...ORDER, ...Object.keys(cfg).filter((k) => !ORDER.includes(k))]) {
		const v = cfg[k];
		if (v == null || v === "" || same(k)) continue;
		if (k === "timeline") {
			if (v.length) out.push("timeline:", ...v.map((s) => `  - ${scalar(s)}`));
		} else if (Array.isArray(v)) out.push(`${k}: [${v.map(scalar).join(", ")}]`);
		else if (k === "colors") out.push(`colors: {${Object.entries(v).map(([c, n]) => `${scalar(c)}: ${n}`).join(", ")}}`);
		else if (typeof v === "object") out.push(`${k}: ${JSON.stringify(v)}`);
		else out.push(`${k}: ${scalar(v)}`);
	}
	return out.join("\n");
}

// A card's color: this block's own, else the shared one (the Daily
// template's), else null. card: "timeline" or a task list's tag.
export function cardColor(cfg, shared, card) {
	const k = String(card).toLowerCase();
	return cfg.colors?.[k] ?? shared?.[k] ?? null;
}

// text with its first wr1t3r-planner block's settings changed by fn(cfg) ->
// the new text, or null when it has no planner block.
export function editPlannerBlock(text, fn) {
	const m = String(text).match(/(^|\n)(```wr1t3r-planner[ \t]*)(\r?\n)([\s\S]*?)(\r?\n)?```/);
	if (!m) return null;
	const nl = m[3];
	const body = writePlanner(fn(readPlanner(m[4] || "")));
	const at = m.index + m[1].length;
	const block = m[2] + nl + (body ? body.replace(/\n/g, nl) + nl : "") + "```";
	return text.slice(0, at) + block + text.slice(at + m[0].length - m[1].length);
}

// ---- The timeline ---------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");
export const clock = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const minutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

// "09:30 - 10:15 | Dentist" -> { allDay, start, end, text } (minutes from
// midnight; end null when only a start is given). An entry with no time
// ("call Sam") has start null.
// A trailing "{#039be5}" is the entry's color: its Google Calendar color,
// kept when the event is imported so the card matches the calendar.
const COLOR = /\s*\{(#[0-9a-f]{3,8})\}\s*$/i;

export function parseEntry(s) {
	let str = String(s);
	const c = str.match(COLOR);
	const color = c ? c[1].toLowerCase() : null;
	if (c) str = str.slice(0, c.index);
	const m = str.match(/^\s*(?:(\d{1,2}:\d{2})(?:\s*[-–]\s*(\d{1,2}:\d{2}))?|(all day))\s*\|?\s*(.*)$/i);
	if (!m) return { allDay: false, start: null, end: null, text: str.trim(), color };
	if (m[3]) return { allDay: true, start: null, end: null, text: m[4].trim(), color };
	return { allDay: false, start: minutes(m[1]), end: m[2] ? minutes(m[2]) : null, text: m[4].trim(), color };
}

export function entryLine({ allDay, start, end, text, color }) {
	const tag = color ? ` {${color}}` : "";
	if (allDay) return `All day | ${text}${tag}`;
	if (start == null) return text + tag;
	return `${clock(start)}${end != null ? ` - ${clock(end)}` : ""} | ${text}${tag}`;
}

// The timeline as the card shows it: all-day entries, then one row per hour
// from cfg.start to cfg.end with the entries starting in it. Entries before
// the first hour go in the first row, ones after the last in the last, and
// ones without a time after the last. Each entry keeps its index in the list.
export function timelineRows(timeline, { start, end }) {
	const allDay = [], rows = [];
	for (let h = start; h < end; h++) rows.push({ hour: h, items: [] });
	timeline.forEach((line, index) => {
		const e = { ...parseEntry(line), index };
		if (e.allDay) return allDay.push(e);
		const h = e.start == null ? end - 1 : Math.min(end - 1, Math.max(start, Math.floor(e.start / 60)));
		rows[h - start].items.push(e);
	});
	for (const r of rows) r.items.sort((a, b) => (a.start ?? 1e9) - (b.start ?? 1e9) || a.index - b.index);
	return { allDay, rows };
}

export function hourLabel(h) {
	const hr = h % 12 || 12;
	return `${hr} ${h < 12 || h === 24 ? "AM" : "PM"}`;
}

// The timeline with entry i's text replaced (removed when the text is empty),
// or, with i null, a new entry for the hour. Kept in time order.
export function setEntry(timeline, i, text, hour) {
	const list = [...timeline];
	const t = String(text).trim();
	if (i == null) {
		if (!t) return list;
		const e = parseEntry(t);
		list.push(e.start != null || e.allDay ? entryLine(e) : entryLine({ allDay: false, start: hour * 60, end: hour * 60 + 60, text: t }));
	} else if (!t) list.splice(i, 1);
	else {
		const old = parseEntry(list[i]);
		const e = parseEntry(t);
		const color = e.color || old.color; // editing the text keeps the color
		list[i] = e.start != null || e.allDay ? entryLine({ ...e, color }) : entryLine({ ...old, text: e.text, color });
	}
	return sortTimeline(list);
}

// The timeline with entry i's color set (null takes it off).
export function setEntryColor(timeline, i, color) {
	const list = [...timeline];
	if (list[i] == null) return list;
	const c = color && /^#[0-9a-f]{3,8}$/i.test(color) ? color.toLowerCase() : null;
	list[i] = entryLine({ ...parseEntry(list[i]), color: c });
	return list;
}

export function sortTimeline(list) {
	const key = (s) => { const e = parseEntry(s); return e.allDay ? -1 : e.start ?? 1e9; };
	return list.map((s, n) => ({ s, n })).sort((a, b) => key(a.s) - key(b.s) || a.n - b.n).map((x) => x.s);
}

// The timeline with calendar events added (worker/calendar.js's shape; start
// and end are RFC 3339 times, or dates for all-day events). An event already
// there (same start and title) isn't added again, but takes the event's
// color if it has none. -> { timeline, added, colored }
export function addEvents(timeline, events) {
	const list = [...timeline];
	let added = 0, colored = 0;
	for (const ev of events) {
		const title = String(ev.title || "(No title)").trim();
		let e;
		const color = /^#[0-9a-f]{3,8}$/i.test(ev.color || "") ? ev.color.toLowerCase() : null;
		if (ev.allDay) e = { allDay: true, start: null, end: null, text: title, color };
		else {
			const s = new Date(ev.start), f = new Date(ev.end);
			const start = s.getHours() * 60 + s.getMinutes();
			e = { allDay: false, start, end: start + Math.max(0, Math.round((f - s) / 60000)), text: title, color };
		}
		const at = list.findIndex((l) => { const x = parseEntry(l); return x.text === title && x.allDay === e.allDay && x.start === e.start; });
		if (at >= 0) {
			const x = parseEntry(list[at]);
			if (color && !x.color) { list[at] = entryLine({ ...x, color }); colored++; }
			continue;
		}
		list.push(entryLine(e));
		added++;
	}
	return { timeline: sortTimeline(list), added, colored };
}

// The timeline without the entry addEvents made for ev (same title, all-day
// or start time), for a calendar event deleted from wr1t3r: { timeline, removed }.
export function removeEvent(timeline, ev) {
	const title = String(ev.title || "(No title)").trim();
	let start = null;
	if (!ev.allDay) { const s = new Date(ev.start); start = s.getHours() * 60 + s.getMinutes(); }
	const keep = timeline.filter((l) => { const x = parseEntry(l); return !(x.text === title && x.allDay === !!ev.allDay && (ev.allDay || x.start === start)); });
	return { timeline: keep, removed: timeline.length - keep.length };
}

// ---- The health note -------------------------------------------------------------

export const MEALS = ["🍳Breakfast", "🥗Lunch", "🍝Dinner", "🍇Snacks"];
export const WATER = { heading: "💧 Water", parent: "Hydration Log" };
export const MOOD = { heading: "Mood Log" };
export const EXERCISE = { heading: "🏃 Exercise", parent: "Activity Log" };
// The Activity Log's older hand-kept lists: one number per line.
const STEPS_LOG = "👟 Steps", ACTIVITY_LOG = "🔥Activity";
// "🙂 Good" -> ["🙂", "Good"]; a mood without an emoji gets none.
export function moodChoice(s) {
	const m = String(s).trim().match(/^(\p{Extended_Pictographic}[\p{Extended_Pictographic}\uFE0F\u200D]*)\s*(.*)$/u);
	return m ? [m[1], m[2] || m[1]] : ["", String(s).trim()];
}

// The meal a food logged at `date` most likely belongs to.
export function mealAt(date = new Date()) {
	const h = date.getHours() + date.getMinutes() / 60;
	return h < 10.5 ? MEALS[0] : h < 15 ? MEALS[1] : h >= 16.5 && h < 21 ? MEALS[2] : MEALS[3];
}

// The daily note's health note: "…/2026-09-30.md" -> "…/2026-09-30 Health.md".
export function healthPathFor(dailyPath) {
	return String(dailyPath).replace(/\.md$/i, "") + " Health.md";
}

const norm = (s) => String(s).replace(/\s+/g, "").toLowerCase();
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

// The note's headings outside front matter and code: [{ i, level, text }].
function headings(lines) {
	const out = [];
	let i = 0;
	if (/^---\s*$/.test(lines[0] || "")) {
		const close = lines.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\s*$/.test(l));
		if (close > 0) i = close + 1;
	}
	let fence = null;
	for (; i < lines.length; i++) {
		const f = lines[i].match(/^\s*(`{3,}|~{3,})/);
		if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; continue; }
		if (fence) continue;
		const h = lines[i].match(HEADING);
		if (h) out.push({ i, level: h[1].length, text: h[2] });
	}
	return out;
}

// The lines under a heading: { head, from, to }, up to the next heading (or,
// with nested, the next one that isn't under it).
function section(lines, heading, nested = false) {
	const hs = headings(lines);
	const k = hs.findIndex((h) => norm(h.text) === norm(heading));
	if (k < 0) return null;
	const own = hs[k];
	const next = hs.slice(k + 1).find((h) => !nested || h.level <= own.level);
	return { head: own, from: own.i + 1, to: next ? next.i : lines.length };
}

// The list items under a heading: [{ line, text }] (empty "- " lines skipped).
export function itemsUnder(text, heading) {
	const lines = String(text).split(/\r?\n/);
	const s = section(lines, heading);
	if (!s) return [];
	const out = [];
	for (let i = s.from; i < s.to; i++) {
		const m = lines[i].match(/^[-*+]\s+(?!\[.\])(.*)$/);
		if (m && m[1].trim()) out.push({ line: i, text: m[1].trim() });
	}
	return out;
}

// The note with "- item" added under the heading: in place of an empty "- "
// placeholder if there is one, else after the section's last line with text.
// A missing heading is added (under `parent`, or at the end of the note).
export function addUnder(text, heading, item, { parent = null, level = parent ? 3 : 2 } = {}) {
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const line = `- ${item}`;
	const s = section(lines, heading);
	if (s) {
		for (let i = s.from; i < s.to; i++) if (/^[-*+]\s*$/.test(lines[i])) { lines[i] = line; return lines.join(nl); }
		let at = s.to;
		while (at > s.from && !lines[at - 1].trim()) at--;
		lines.splice(at, 0, line);
		return lines.join(nl);
	}
	const head = `${"#".repeat(level)} ${heading}`;
	const p = parent && section(lines, parent, true);
	if (p) {
		let at = p.to;
		while (at > p.from && !lines[at - 1].trim()) at--;
		lines.splice(at, 0, head, line);
		return lines.join(nl);
	}
	while (lines.length && !lines.at(-1).trim()) lines.pop();
	const add = [...(parent ? [`${"#".repeat(level - 1)} ${parent}`] : []), head, line];
	return [...lines, ...(lines.length ? [""] : []), ...add, ""].join(nl);
}

// The note without line i (a logged item), if it still says `expect`. An
// item that was its heading's only one is left as an empty "- " placeholder,
// as the template has it.
export function removeLine(text, i, expect) {
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	if (lines[i] == null || (expect != null && !lines[i].includes(expect))) return text;
	const alone = !/^[-*+]\s/.test(lines[i - 1] || "") && !/^[-*+]\s/.test(lines[i + 1] || "");
	if (alone) lines[i] = "- ";
	else lines.splice(i, 1);
	return lines.join(nl);
}

// ---- Food ----------------------------------------------------------------------------

// The Nutrition Database note's table -> [{ name, serving, calories, fat,
// carbs, protein, fiber, group, aliases }].
export function parseNutrition(text) {
	const rows = String(text || "").split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
	const out = [];
	for (const row of rows.slice(2)) {
		const cols = row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
		if (cols.length < 8 || !cols[0] || /^-+$/.test(cols[0])) continue;
		const [name, serving, cal, fat, carbs, protein, fiber, group, aliases = ""] = cols;
		out.push({
			name, serving, calories: parseFloat(cal) || 0, fat: parseFloat(fat) || 0, carbs: parseFloat(carbs) || 0,
			protein: parseFloat(protein) || 0, fiber: parseFloat(fiber) || 0, group,
			aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
		});
	}
	return out;
}

// The food a logged name means: its name or an alias, else (as the Daily
// template's meter does) the first name starting with it, then containing it.
export function findFood(foods, name) {
	const q = String(name).trim().toLowerCase();
	if (!q) return null;
	return foods.find((f) => f.name.toLowerCase() === q) || foods.find((f) => f.aliases.some((a) => a.toLowerCase() === q))
		|| foods.find((f) => f.name.toLowerCase().startsWith(q)) || foods.find((f) => f.name.toLowerCase().includes(q)) || null;
}

// Foods matching a search, best first: name starts with it, a word or alias
// does, then anywhere. Every word of the search has to match.
export function searchFoods(foods, query, limit = 40) {
	const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return foods.slice().sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
	const scored = [];
	for (const f of foods) {
		const name = f.name.toLowerCase(), hay = [name, ...f.aliases.map((a) => a.toLowerCase())].join(" | ");
		if (!words.every((w) => hay.includes(w))) continue;
		const q = words.join(" ");
		const score = name.startsWith(q) ? 0 : f.aliases.some((a) => a.toLowerCase().startsWith(q)) ? 1 : new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(name) ? 2 : 3;
		scored.push({ f, score });
	}
	return scored.sort((a, b) => a.score - b.score || a.f.name.localeCompare(b.f.name)).slice(0, limit).map((x) => x.f);
}

// The Nutrition Database with a row for `food` (a USDA search result) added
// after the table's last row, or unchanged if a food of that name is there.
// Pipes in text would break the table, so they become slashes.
export function addFoodRow(dbText, food) {
	if (parseNutrition(dbText).some((f) => f.name.toLowerCase() === food.name.toLowerCase())) return dbText;
	const nl = dbText.includes("\r\n") ? "\r\n" : "\n";
	const lines = dbText.split(/\r?\n/);
	const cell = (v) => String(v ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
	const row = `| ${[food.name, food.serving, food.calories, food.fat, food.carbs, food.protein, food.fiber, food.group || "Other", (food.aliases || []).join(", "), ""].map(cell).join(" | ")} |`;
	let last = -1;
	lines.forEach((l, i) => { if (l.trim().startsWith("|")) last = i; });
	if (last < 0) return dbText.replace(/(\r?\n)*$/, "") + nl + nl + "| Food | Serving Size | Calories | Fat (g) | Carbs (g) | Protein (g) | Fiber (g) | Food Group | Aliases | Servings/Container |" + nl + "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |" + nl + row + nl;
	lines.splice(last + 1, 0, row);
	return lines.join(nl);
}

// "Apple, 1.5" -> { name: "Apple", servings: 1.5 }. Names can have commas
// ("Broccoli, raw, 2"), and a note can follow the amount ("Butter, 2
// (softened, room temp)"), so the food is the longest part before a comma
// that's one of `foods` (a name or alias), as the Recipe template reads its
// ingredients; else the part before the last comma when a number follows it.
export function foodEntry(text, foods = []) {
	const s = String(text).trim();
	const known = new Set(foods.flatMap((f) => [f.name, ...f.aliases]).map((n) => n.toLowerCase()));
	for (const i of [...s.matchAll(/,/g)].map((m) => m.index).reverse()) {
		const name = s.slice(0, i).trim();
		if (!known.has(name.toLowerCase())) continue;
		const v = parseFloat(s.slice(i + 1));
		return { name, servings: Number.isFinite(v) ? v : 1 };
	}
	const m = s.match(/^(.*\S)\s*,\s*(\d*\.?\d+)\s*$/);
	return m ? { name: m[1].trim(), servings: parseFloat(m[2]) } : { name: s, servings: 1 };
}

export const foodLine = (food, servings) => `${food.name}, ${+Number(servings).toFixed(2)}`;

// ---- Water ----------------------------------------------------------------------------

const WATER_WORDS = { glass: 8, cup: 8, mug: 12, bottle: 16, liter: 33.814, litre: 33.814, l: 33.814 };

// A water entry in fl oz, read as the Daily template's meter reads it:
// "8", "16oz", "500ml", "1.5 l", "glass", "2 bottles". Null if unreadable.
export function waterOz(text) {
	const t = String(text).trim().toLowerCase();
	if (!t) return null;
	const word = (w) => (WATER_WORDS[w] != null ? w : w.endsWith("es") && WATER_WORDS[w.slice(0, -2)] != null ? w.slice(0, -2) : w.endsWith("s") && WATER_WORDS[w.slice(0, -1)] != null ? w.slice(0, -1) : w);
	if (WATER_WORDS[t] != null) return WATER_WORDS[t];
	let m = t.match(/^([\d.]+)\s+([a-z]+)$/);
	if (m && WATER_WORDS[word(m[2])] != null) return parseFloat(m[1]) * WATER_WORDS[word(m[2])];
	m = t.match(/^([\d.]+)\s*(ml|milliliters?|l|liters?|litres?|fl ?oz|oz)?$/);
	if (!m) return null;
	const v = parseFloat(m[1]), unit = (m[2] || "oz").replace(/s$/, "");
	if (unit.startsWith("m")) return v / 29.5735;
	if (unit.startsWith("l")) return v * 33.814;
	return v;
}

// ---- Mood ----------------------------------------------------------------------------

// "14:32 | 🙂 Good | slept well" -> { time, mood, note }.
export function moodEntry(text) {
	const [time, mood = "", ...rest] = String(text).split("|").map((s) => s.trim());
	return /^\d{1,2}:\d{2}$/.test(time) ? { time, mood, note: rest.join(" | ") } : { time: null, mood: time, note: [mood, ...rest].filter(Boolean).join(" | ") };
}

export function moodLine([emoji, label], note, date = new Date()) {
	return `${pad(date.getHours())}:${pad(date.getMinutes())} | ${emoji ? emoji + " " : ""}${label}${note && note.trim() ? ` | ${note.trim().replace(/\s*\n\s*/g, " ")}` : ""}`;
}

// ---- Exercise, logged by hand. The older "👟 Steps" and "🔥Activity" lists
// (one number per line) count toward the day's totals too. ---------------------

const count = (s) => { const n = parseFloat(String(s).replace(/,/g, "")); return Number.isFinite(n) && n >= 0 ? n : null; };

// "07:30 | 🚶 Walk | 3200 steps | 150 cal | by the river" -> { time, kind,
// steps, kcal, note }.
export function exerciseEntry(text) {
	const parts = String(text).split("|").map((s) => s.trim());
	const out = { time: null, kind: "", steps: null, kcal: null, note: "" };
	if (/^\d{1,2}:\d{2}$/.test(parts[0] || "")) out.time = parts.shift();
	out.kind = parts.shift() || "";
	const notes = [];
	for (const p of parts) {
		let m;
		if ((m = p.match(/^([\d,.]+)\s*steps?$/i))) out.steps = count(m[1]);
		else if ((m = p.match(/^([\d,.]+)\s*(?:k?cal(?:ories)?|kcal)$/i))) out.kcal = count(m[1]);
		else if (p) notes.push(p);
	}
	out.note = notes.join(" | ");
	return out;
}

export function exerciseLine(kind, { steps, kcal, note } = {}, date = new Date()) {
	const parts = [`${pad(date.getHours())}:${pad(date.getMinutes())}`, String(kind).trim()];
	if (count(steps)) parts.push(`${Math.round(count(steps))} steps`);
	if (count(kcal)) parts.push(`${Math.round(count(kcal))} cal`);
	if (note && note.trim()) parts.push(note.trim().replace(/\s*[\n|]\s*/g, " "));
	return parts.join(" | ");
}

// ---- The day's numbers ---------------------------------------------------------------

const round1 = (n) => Math.round(n * 10) / 10;

// What the health note holds: { meals: [{ meal, items: [{ line, text, name,
// servings, food }] }], totals, unmatched, water: [{ line, text, oz }],
// waterOz, meds, moods: [{ line, text, time, mood, note }], exists }.
export function healthDay(text, foods) {
	if (text == null) return { exists: false, meals: MEALS.map((meal) => ({ meal, items: [] })), totals: { calories: 0, fat: 0, carbs: 0, protein: 0, fiber: 0 }, unmatched: [], water: [], waterOz: 0, meds: false, moods: [], exercise: [], logged: { steps: 0, kcal: 0, any: false }, steps: 0, kcal: 0 };
	const totals = { calories: 0, fat: 0, carbs: 0, protein: 0, fiber: 0 };
	const unmatched = [];
	const meals = MEALS.map((meal) => ({
		meal,
		items: itemsUnder(text, meal).map((it) => {
			const e = foodEntry(it.text, foods);
			const food = findFood(foods, e.name);
			if (food) for (const k of Object.keys(totals)) totals[k] += food[k] * e.servings;
			else unmatched.push(e.name);
			return { ...it, ...e, food };
		}),
	}));
	const water = itemsUnder(text, WATER.heading).map((it) => ({ ...it, oz: waterOz(it.text) }));
	const fm = parseFrontmatter(text) || {};
	const exercise = itemsUnder(text, EXERCISE.heading).map((it) => ({ ...it, ...exerciseEntry(it.text) }));
	const manual = (h) => itemsUnder(text, h).map((it) => count(it.text)).filter((n) => n != null);
	const stepsLog = manual(STEPS_LOG), kcalLog = manual(ACTIVITY_LOG);
	const logged = {
		steps: exercise.reduce((s, e) => s + (e.steps || 0), 0) + stepsLog.reduce((s, n) => s + n, 0),
		kcal: exercise.reduce((s, e) => s + (e.kcal || 0), 0) + kcalLog.reduce((s, n) => s + n, 0),
		any: exercise.length + stepsLog.length + kcalLog.length > 0,
	};
	return {
		exists: true, meals, totals, unmatched, water, exercise, logged, steps: logged.steps, kcal: logged.kcal,
		waterOz: round1(water.reduce((s, w) => s + (w.oz || 0), 0)),
		meds: fm.meds === true || /^(true|yes)$/i.test(String(fm.meds ?? "")),
		moods: itemsUnder(text, MOOD.heading).map((it) => ({ ...it, ...moodEntry(it.text) })),
	};
}

// The health note with its properties set from what's logged in it: the
// food totals (once there's food, or once they've been written before),
// hydration, the latest mood, and the targets. Only changed lines move.
export function syncHealth(text, foods, { calories_target, water_target, steps_target, activity_target } = DEFAULTS) {
	const d = healthDay(text, foods);
	const fm = parseFrontmatter(text) || {};
	const want = {};
	const hasFood = d.meals.some((m) => m.items.length) || fm.calories != null && fm.calories !== "";
	if (hasFood) Object.assign(want, {
		calories: Math.round(d.totals.calories), calories_target, fat_g: round1(d.totals.fat),
		carbs_g: round1(d.totals.carbs), protein_g: round1(d.totals.protein), fiber_g: round1(d.totals.fiber),
	});
	if (d.water.length || fm.hydration_oz != null && fm.hydration_oz !== "") Object.assign(want, { hydration_oz: d.waterOz, hydration_target_oz: water_target });
	if (d.logged.any || fm.steps != null && fm.steps !== "") Object.assign(want, {
		steps: Math.round(d.steps), steps_target: steps_target ?? DEFAULTS.steps_target,
		activity_kcal: Math.round(d.kcal), activity_kcal_target: activity_target ?? DEFAULTS.activity_target,
	});
	const last = d.moods.at(-1);
	if (last || fm.mood != null) want.mood = last ? last.mood : "";
	let out = text;
	for (const [k, v] of Object.entries(want)) if (String(fm[k] ?? "") !== String(v)) out = setProperty(out, k, v === "" ? null : v);
	return out;
}

// The health note with meds flipped (true <-> false).
export function toggleMeds(text) {
	const fm = parseFrontmatter(text) || {};
	const on = fm.meds === true || /^(true|yes)$/i.test(String(fm.meds ?? ""));
	return setProperty(text, "meds", !on);
}
