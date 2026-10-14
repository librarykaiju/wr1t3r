// The weekly note: one note per week ("2026-W42.md" in _weekly/), Monday to
// Sunday. Its ```wr1t3r-week block draws the week ahead (src/weekview.js):
// each day's calendar events and the tasks due that day, wherever they're
// written. Plans added on a day go into the weekly note itself as tasks due
// that day, under "## Plans", so they show on the day like any other task.
// At the week's end "Reflect & recover" adds the week in numbers (the week
// review's, src/journal.js) and questions for looking back and resting up.
// This file works on note text only; weekview.js draws it.

import { period, reviewNote } from "./journal.js";
import { listItems } from "./dvpage.js";
import { addDays } from "./habits.js";
import { ownFolderName } from "./build.js";

export const WEEK_BLOCK = "wr1t3r-week";
export const WEEKLY_FOLDER = ownFolderName("_weekly/");
export const PLANS = "Plans";
export const REFLECT = "Reflect & recover";

const pad = (n) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NAME = /^(\d{4})-W(\d{2})$/;

// The week a day ("YYYY-MM-DD") falls in: { name: "2026-W42", from (the
// Monday), to (the Sunday), days: the seven days, title: "Oct 12 – 18, 2026" }.
export function weekOf(day) {
	const p = period("week", day);
	const name = p.name.replace(/ Review$/, "");
	const days = Array.from({ length: 7 }, (_, i) => addDays(p.from, i));
	return { name, from: p.from, to: p.to, days, title: rangeTitle(p.from, p.to) };
}

function rangeTitle(from, to) {
	const a = new Date(from + "T12:00"), b = new Date(to + "T12:00");
	const right = a.getMonth() === b.getMonth() ? `${b.getDate()}` : `${MONTHS[b.getMonth()]} ${b.getDate()}`;
	return `${MONTHS[a.getMonth()]} ${a.getDate()} – ${right}, ${b.getFullYear()}`;
}

// The Monday of an ISO week name ("2026-W42"), or null.
export function weekStart(name) {
	const m = NAME.exec(String(name || "").trim());
	if (!m) return null;
	const w = Number(m[2]);
	if (w < 1 || w > 53) return null;
	// Week 1 is the one with January 4th in it.
	const jan4 = new Date(Number(m[1]), 0, 4, 12);
	const mon1 = addDays(`${m[1]}-01-04`, -((jan4.getDay() + 6) % 7));
	const from = addDays(mon1, 7 * (w - 1));
	return weekOf(from).name === m[0] ? from : null;
}

// The Monday of the week a weekly note is for (by its name), or null.
export function noteWeek(path) {
	return weekStart(String(path || "").split("/").pop().replace(/\.md$/i, ""));
}

export const weeklyPath = (root, day) => `${root}${WEEKLY_FOLDER}${weekOf(day).name}.md`;

// A new weekly note's text.
export function weekNote(day) {
	const w = weekOf(day);
	return [
		"---", `title: "Week of ${w.title}"`, `week: ${w.name}`, `from: ${w.from}`, `to: ${w.to}`, "tags: [weekly]", "---", "",
		"```" + WEEK_BLOCK, "```", "",
		"## This week's focus", "- ", "",
		`## ${PLANS}`, "",
		"## Notes", "", "",
	].join("\n");
}

const SKIP = /(^|\/)_(templates|clippings|uploads)\//i;
const DUE = /📅️? ?(\d{4}-\d{2}-\d{2})/u;
const DONE = /✅ ?(\d{4}-\d{2}-\d{2})/u;
const cache = new Map(); // path -> { text, items }

// Every task with a due date from `from` to `to`, plus open ones due before
// `from` (overdue): [{ path, line, text, done, due }]. notes: { path: text }.
export function datedTasks(notes, from, to) {
	const out = [];
	for (const [path, text] of Object.entries(notes)) {
		if (SKIP.test(path) || !/\.md$/i.test(path) || text == null || !text.includes("📅")) continue;
		let hit = cache.get(path);
		if (!hit || hit.text !== text) {
			hit = { text, items: listItems(text).filter((l) => l.task && DUE.test(l.text)) };
			cache.set(path, hit);
		}
		for (const it of hit.items) {
			const due = it.text.match(DUE)[1];
			const done = /^[xX]$/.test(it.status || "");
			if (due > to || (due < from && done)) continue;
			out.push({ path, line: it.line, text: it.text, done, due, doneOn: it.text.match(DONE)?.[1] ?? null });
		}
	}
	return out.sort((a, b) => a.due.localeCompare(b.due) || a.done - b.done || a.path.localeCompare(b.path) || a.line - b.line);
}

// The tasks to show on each of the week's days: Map day -> tasks. Overdue
// open tasks go on today when today is in the week.
export function tasksByDay(tasks, days, today) {
	const map = new Map(days.map((d) => [d, []]));
	for (const t of tasks) {
		if (map.has(t.due)) map.get(t.due).push(t);
		else if (!t.done && t.due < days[0] && map.has(today)) map.get(today).push({ ...t, overdue: true });
	}
	for (const [d, list] of map) if (d === today) list.sort((a, b) => !!b.overdue - !!a.overdue);
	return map;
}

// A task as the week shows it: without its dates, tags kept.
export const taskLabel = (text) => text.replace(/\s*📅️? ?\d{4}-\d{2}-\d{2}/gu, "").replace(/\s*✅ ?\d{4}-\d{2}-\d{2}/gu, "").replace(/\s+\^[\w-]+\s*$/, "").replace(/\s{2,}/g, " ").trim();

// The note's text with a plan added: "- [ ] text 📅 day" at the end of its
// "## Plans" section (made above "## Notes", or at the end, if missing).
export function addPlan(text, day, what) {
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const item = `- [ ] ${String(what).replace(/\s+/g, " ").trim()} 📅 ${day}`;
	const lines = text.split(/\r?\n/);
	const at = lines.findIndex((l) => new RegExp(`^##\\s+${PLANS}\\s*$`, "i").test(l));
	if (at < 0) {
		const notes = lines.findIndex((l) => /^##\s+Notes\s*$/i.test(l));
		if (notes >= 0) lines.splice(notes, 0, `## ${PLANS}`, item, "");
		else {
			while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
			lines.push("", `## ${PLANS}`, item, "");
		}
		return lines.join(nl);
	}
	// After the section's last non-blank line, before the next heading.
	let end = at + 1;
	while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
	let last = end - 1;
	while (last > at && !lines[last].trim()) last--;
	lines.splice(last + 1, 0, item);
	return lines.join(nl);
}

export const hasReflect = (text) => /^##\s+Reflect & recover\s*$/im.test(String(text || ""));

const QUESTIONS = [
	"## Reflect", "",
	"### What went well?", "", "",
	"### What was hard?", "", "",
	"### What did I learn?", "", "",
	"## Recover", "",
	"### How rested do I feel? (1–5)", "", "",
	"### What drained me?", "", "",
	"### What can I drop, move or ask for help with next week?", "", "",
	"### One thing just for me next week", "", "",
].join("\n");

// The "## Reflect & recover" section for the week starting `from`: the
// week review's numbers, entries and finished logs (one heading level down),
// then the reflect and recover questions. opts: reviewNote()'s.
export function reflectSection(from, opts) {
	const p = period("week", from);
	const body = reviewNote(p, { ...opts, template: QUESTIONS })
		.replace(/^---[\s\S]*?\n---\n/, "")
		.replace(/^(#{2,5}) /gm, "#$1 ")
		.replace(/^\s+/, "");
	return `## ${REFLECT}\n\n${body}`;
}

// The note's text with the section put at its end.
export function addReflect(text, section) {
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	return text.replace(/\s*$/, "") + nl + nl + section.replace(/\n/g, nl).replace(/\s*$/, "") + nl;
}
