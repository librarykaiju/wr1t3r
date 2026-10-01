// Master task lists, Emergent Task Planner style: every task tagged #crit (the
// Critical Tasks List) or #todo (the To Do's List) across the vault, in one
// list. A ```wr1t3r-tasks block shows one, set up by a few YAML keys that the
// block's menu writes, so nobody writes query code:
//
//   ```wr1t3r-tasks
//   list: crit        a tag (crit, todo or any other: shopping, wishlist…), or
//                     several: [crit, todo] (or "crit+todo") in one card
//   day: note         note: in a daily note, only that day's items; all: every
//                     item (the default for lists other than crit and todo)
//   show: open        open, all or done
//   group: none       none, list, note or due (list when there are several)
//   sort: due         due, note or text
//   layout: grouped   grouped, or columns: several lists side by side
//   color: 3          the card's color, 1-7 from the theme's rainbow
//
// Any tag is a list: "- [ ] coffee filters #shopping" in any note is on the
// Shopping list, whose own note (_docs/Shopping.md) takes items added from
// the card.
//   ```
//
// A day's tasks are the ones due that day, done that day, or written in that
// day's daily note, and (on today's note) open tasks that are overdue. The
// tasks stay where they're written; ticking one in any view ticks its line,
// and a task added from a view goes into the list's own note ("Critical
// Tasks List", "To Do's List", made in _docs/), due that day when the view
// is a day's. This file
// works out the lists; src/tasklistview.js draws them.

import { parseYaml } from "./bases.js";
import { listItems } from "./dvpage.js";

export const TASKS_BLOCK = "wr1t3r-tasks";
export const LIST_NAMES = { crit: "Critical Tasks", todo: "To Do's" };
// The task lists; date filters and due dates are theirs by default.
export const TASK_TAGS = ["crit", "todo"];
// A list's name: the two task lists' own, else the tag in words
// ("shopping" -> "Shopping", "wish-list" -> "Wish list", "work/errands" -> "Errands").
export function listName(tag) {
	const t = String(tag || "").replace(/^#/, "");
	if (LIST_NAMES[t.toLowerCase()]) return LIST_NAMES[t.toLowerCase()];
	const w = t.split("/").pop().replace(/[-_]+/g, " ").trim();
	return w ? w[0].toUpperCase() + w.slice(1) : "List";
}
// The tag for a list called name ("Wish list" -> "wish-list").
export const tagFor = (name) => String(name || "").trim().replace(/^#/, "").toLowerCase().replace(/[^\p{L}\p{N}/_-]+/gu, "-").replace(/^-+|-+$/g, "");

const CHOICES = { day: ["note", "all"], show: ["open", "all", "done"], group: ["none", "list", "note", "due"], sort: ["due", "note", "text"], layout: ["grouped", "columns"] };
const DEFAULTS = { list: "crit", day: "note", show: "open", group: "none", sort: "due", layout: "grouped" };
const ORDER = ["list", "title", "day", "show", "group", "sort", "layout", "color", "inbox"];

// The tags a list setting names: "crit", "crit+todo", "crit, todo" or [crit, todo].
export function listTags(v) {
	const parts = Array.isArray(v) ? v : String(v ?? "").split(/[,+\s]+/);
	const out = [];
	for (const p of parts) {
		const t = String(p ?? "").replace(/^#/, "").trim();
		if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
	}
	return out;
}

// The defaults that depend on the lists: grouped by list when there are
// several, and every item (not a day's) unless one of them is a task list.
function defaultsFor(lists) {
	return { ...DEFAULTS, group: lists.length > 1 ? "list" : "none", day: lists.some((t) => TASK_TAGS.includes(t.toLowerCase())) ? "note" : "all" };
}

// The block's settings, with defaults for anything missing or unknown.
export function readConfig(code) {
	let y = null;
	try { y = parseYaml(String(code || "")); } catch {}
	const raw = y && typeof y === "object" && !Array.isArray(y) ? y : {};
	// lists: every tag shown; list: the first (where new items go by default).
	let lists = listTags(raw.list ?? DEFAULTS.list);
	if (!lists.length) lists = [DEFAULTS.list];
	const defs = defaultsFor(lists);
	const cfg = { ...defs, ...raw, lists, list: lists[0] };
	for (const [k, ok] of Object.entries(CHOICES)) if (!ok.includes(String(cfg[k]).toLowerCase())) cfg[k] = defs[k]; else cfg[k] = String(cfg[k]).toLowerCase();
	const color = Number(cfg.color);
	cfg.color = Number.isInteger(color) && color >= 1 && color <= 7 ? color : null;
	if (cfg.title != null) cfg.title = String(cfg.title).trim() || null;
	if (cfg.inbox != null) cfg.inbox = String(cfg.inbox).trim() || null;
	return cfg;
}

// The block's text for cfg: the list, and any setting that isn't the default.
// Keys this file doesn't know are kept.
export function writeConfig(cfg) {
	const lists = cfg.lists?.length ? cfg.lists : listTags(cfg.list);
	const defs = defaultsFor(lists);
	const out = { ...cfg, list: lists.length > 1 ? lists : lists[0] };
	delete out.lists;
	const keys = [...ORDER.filter((k) => out[k] != null && out[k] !== "" && (k === "list" || out[k] !== defs[k])), ...Object.keys(out).filter((k) => !ORDER.includes(k) && out[k] != null)];
	const word = (x) => (/^[\p{L}\p{N}_./-]+$/u.test(String(x)) ? x : JSON.stringify(x));
	return keys.map((k) => `${k}: ${Array.isArray(out[k]) ? `[${out[k].map(word).join(", ")}]` : typeof out[k] === "object" ? JSON.stringify(out[k]) : word(out[k])}`).join("\n");
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

// The tags on the vault's checkbox items, most used first: the lists there
// are. [{ tag, count }].
export function itemTags(notes) {
	const count = new Map();
	for (const [path, text] of Object.entries(notes)) {
		if (SKIP.test(path) || !/\.md$/i.test(path) || text == null || !text.includes("#")) continue;
		let hit = cache.get(path);
		if (!hit || hit.text !== text) { hit = { text, items: listItems(text).filter((l) => l.task) }; cache.set(path, hit); }
		for (const it of hit.items) {
			for (const m of it.text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-][\p{L}\p{N}_/-]*)/gu)) {
				const t = m[1].split("/")[0];
				if (/^\d+$/.test(t)) continue;
				const k = t.toLowerCase();
				count.set(k, (count.get(k) || 0) + 1);
			}
		}
	}
	return [...count].sort((a, b) => b[1] - a[1]).map(([tag, n]) => ({ tag, count: n }));
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
	const lists = cfg.lists?.length ? cfg.lists : listTags(cfg.list);
	// Each item once, under the first of the card's lists it's tagged with.
	const seen = new Set();
	let tasks = [];
	for (const tag of lists) {
		for (const t of tasksTagged(notes, tag)) {
			const id = t.path + "\0" + t.line;
			if (seen.has(id)) continue;
			seen.add(id);
			tasks.push({ ...t, tag });
		}
	}
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
		const key = (t) => (cfg.group === "list" ? t.tag : cfg.group === "note" ? name(t.path) : t.due ? (t.due < today && !t.done ? "Overdue" : t.due === today ? "Today" : t.due) : "No due date");
		const map = new Map();
		for (const t of tasks) { const k = key(t); if (!map.has(k)) map.set(k, []); map.get(k).push(t); }
		groups = [...map].map(([label, list]) => (cfg.group === "list" ? { label: listName(label), tag: label, tasks: list } : { label, tasks: list }));
		// Every list gets its group, empty or not, in the card's order.
		if (cfg.group === "list") groups = lists.map((tag) => groups.find((g) => g.tag === tag) || { label: listName(tag), tag, tasks: [] });
		if (cfg.group === "due") {
			const rank = (l) => (l === "Overdue" ? "0" : l === "Today" ? "1" : l === "No due date" ? "9" : "2" + l);
			groups.sort((a, b) => rank(a.label).localeCompare(rank(b.label)));
		}
	}
	return { title: cfg.title || (lists.length > 1 ? (lists.every((t) => TASK_TAGS.includes(t.toLowerCase())) ? "Tasks" : lists.map(listName).join(" & ")) : listName(lists[0])), day, groups, count: tasks.length, lists };
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
