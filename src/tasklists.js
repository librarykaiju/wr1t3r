// Master task lists, Emergent Task Planner style: every task tagged #crit (the
// Critical Tasks List) or #todo (the To Do's List) across the vault, in one
// list. A ```wr1t3r-tasks block shows one, set up by a few YAML keys that the
// block's menu writes, so nobody writes query code:
//
//   ```wr1t3r-tasks
//   list: crit        crit, todo, or any other tag
//   day: note         note: in a daily note, only that day's tasks; all: every task
//   show: open        open, all or done
//   group: none       none, note or due
//   sort: due         due, note or text
//   ```
//
// A day's tasks are the ones due that day, done that day, or written in that
// day's daily note, and (on today's note) open tasks that are overdue. The
// tasks stay where they're written; ticking one in any view ticks its line,
// and a task added from a view goes into the list's own note ("Critical Tasks
// List", "To Do's List"), due that day when the view is a day's. This file
// works out the lists; src/tasklistview.js draws them.

import { parseYaml } from "./bases.js";
import { listItems } from "./dvpage.js";

export const TASKS_BLOCK = "wr1t3r-tasks";
export const LIST_NAMES = { crit: "Critical Tasks List", todo: "To Do's List" };
export const listName = (tag) => LIST_NAMES[tag.toLowerCase()] || `#${tag}`;

const CHOICES = { day: ["note", "all"], show: ["open", "all", "done"], group: ["none", "note", "due"], sort: ["due", "note", "text"] };
const DEFAULTS = { list: "crit", day: "note", show: "open", group: "none", sort: "due" };
const ORDER = ["list", "title", "day", "show", "group", "sort", "inbox"];

// The block's settings, with defaults for anything missing or unknown.
export function readConfig(code) {
	let y = null;
	try { y = parseYaml(String(code || "")); } catch {}
	const cfg = { ...DEFAULTS, ...(y && typeof y === "object" && !Array.isArray(y) ? y : {}) };
	cfg.list = String(cfg.list ?? DEFAULTS.list).replace(/^#/, "").trim() || DEFAULTS.list;
	for (const [k, ok] of Object.entries(CHOICES)) if (!ok.includes(String(cfg[k]).toLowerCase())) cfg[k] = DEFAULTS[k]; else cfg[k] = String(cfg[k]).toLowerCase();
	if (cfg.title != null) cfg.title = String(cfg.title).trim() || null;
	if (cfg.inbox != null) cfg.inbox = String(cfg.inbox).trim() || null;
	return cfg;
}

// The block's text for cfg: the list, and any setting that isn't the default.
// Keys this file doesn't know are kept.
export function writeConfig(cfg) {
	const keys = [...ORDER.filter((k) => cfg[k] != null && cfg[k] !== "" && (k === "list" || cfg[k] !== DEFAULTS[k])), ...Object.keys(cfg).filter((k) => !ORDER.includes(k) && cfg[k] != null)];
	return keys.map((k) => `${k}: ${/^[\w.-]+$/.test(String(cfg[k])) && typeof cfg[k] !== "object" ? cfg[k] : JSON.stringify(cfg[k])}`).join("\n");
}

// "2026-09-30" from a daily note's name ("2026-09-30" or "2026.09.30"), or null.
export function noteDay(path) {
	const m = String(path || "").split("/").pop().replace(/\.md$/i, "").match(/^(\d{4})[-.](\d{2})[-.](\d{2})$/);
	return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const SKIP = /(^|\/)_(templates|clippings|uploads)\//i;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const tagRe = (tag) => new RegExp(`(^|\\s)#${escape(tag)}(?:/[^\\s#]*)?(?=$|[\\s.,;:!?)])`, "i");

// Every task with the tag in the given notes ({ path: text }):
// [{ path, line, text, status, done, due, doneOn }]. Cached per note text.
const cache = new Map();
export function tasksTagged(notes, tag) {
	const re = tagRe(tag);
	const out = [];
	for (const [path, text] of Object.entries(notes)) {
		if (SKIP.test(path) || !/\.md$/i.test(path) || text == null || !text.includes("#")) continue;
		let hit = cache.get(path);
		if (!hit || hit.text !== text) {
			hit = { text, items: listItems(text).filter((l) => l.task) };
			cache.set(path, hit);
		}
		for (const it of hit.items) {
			if (!re.test(it.text)) continue;
			out.push({
				path, line: it.line, text: it.text, status: it.status, done: /^[xX]$/.test(it.status || ""),
				due: it.text.match(/📅️? ?(\d{4}-\d{2}-\d{2})/u)?.[1] ?? null,
				doneOn: it.text.match(/✅ ?(\d{4}-\d{2}-\d{2})/u)?.[1] ?? null,
			});
		}
	}
	return out;
}

// Whether a task is one of `day`'s ("YYYY-MM-DD"): due, done or written that
// day, or (when the day is today) still open and overdue.
export function onDay(t, day, today) {
	if (t.due === day || t.doneOn === day || noteDay(t.path) === day) return true;
	return day === today && !t.done && !!t.due && t.due < day;
}

// The list a block shows: { title, day, groups: [{ label, tasks }], count }.
export function taskList(notes, cfg, { path, today }) {
	const day = cfg.day === "note" ? noteDay(path) : null;
	let tasks = tasksTagged(notes, cfg.list);
	if (day) tasks = tasks.filter((t) => onDay(t, day, today));
	if (cfg.show === "open") tasks = tasks.filter((t) => !t.done);
	else if (cfg.show === "done") tasks = tasks.filter((t) => t.done);
	const name = (p) => p.split("/").pop().replace(/\.md$/i, "");
	const by = {
		due: (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || name(a.path).localeCompare(name(b.path)) || a.line - b.line,
		note: (a, b) => name(a.path).localeCompare(name(b.path)) || a.line - b.line,
		text: (a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: "base" }),
	}[cfg.sort];
	// Open tasks above done ones, then the chosen order.
	tasks.sort((a, b) => a.done - b.done || by(a, b));
	let groups = [{ label: null, tasks }];
	if (cfg.group !== "none") {
		const key = (t) => (cfg.group === "note" ? name(t.path) : t.due ? (t.due < today && !t.done ? "Overdue" : t.due === today ? "Today" : t.due) : "No due date");
		const map = new Map();
		for (const t of tasks) { const k = key(t); if (!map.has(k)) map.set(k, []); map.get(k).push(t); }
		groups = [...map].map(([label, list]) => ({ label, tasks: list }));
		if (cfg.group === "due") {
			const rank = (l) => (l === "Overdue" ? "0" : l === "Today" ? "1" : l === "No due date" ? "9" : "2" + l);
			groups.sort((a, b) => rank(a.label).localeCompare(rank(b.label)));
		}
	}
	return { title: cfg.title || listName(cfg.list), day, groups, count: tasks.length };
}

// A task's text as the list shows it: without the list's own tag and the
// dates it shows beside it.
export function shownText(text, tag) {
	return text.replace(new RegExp(`(^|\\s)#${escape(tag)}(?=$|[\\s.,;:!?)])`, "gi"), "$1").replace(/\s*📅️? ?\d{4}-\d{2}-\d{2}/gu, "").replace(/\s*✅ ?\d{4}-\d{2}-\d{2}/gu, "").replace(/\s{2,}/g, " ").trim();
}

// The line a task added from a view gets: "- [ ] text #tag 📅 day".
export function newTaskLine(text, tag, day) {
	const t = text.trim().replace(/^[-*+]\s+(\[.\]\s+)?/, "");
	const tagged = tagRe(tag).test(t) ? t : `${t} #${tag}`;
	return `- [ ] ${tagged}${day && !/📅/u.test(t) ? ` 📅 ${day}` : ""}`;
}

// The list's note with a new task added at the end.
export function appendTask(noteText, line) {
	const nl = noteText.includes("\r\n") ? "\r\n" : "\n";
	const body = noteText.replace(/(\r?\n)+$/, "");
	return (body ? body + nl : "") + line + nl;
}
