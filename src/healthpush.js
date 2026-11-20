// Apple Health into the day's health note: what the Worker's POST /api/health
// does with the numbers an iPhone Shortcut sends (steps, active energy, sleep,
// weight). Shared by the Worker and the tests.
//
// Each metric is one line in the same format the planner's buttons write
// (src/planner.js), marked "Apple Health" so a later push replaces it instead
// of adding another. The Shortcut can run as often as you like; the note ends
// up with one Apple Health line per metric, holding the latest numbers.
//
//   ### 🏃 Exercise   - ⌚ Apple Health | 8432 steps | 412 cal
//   ## 😴 Sleep       - 7.4 h | Apple Health
//   ## ⚖️ Weight      - 208.4 lb | Apple Health
//
// Lines you log by hand are left alone, and the totals count both.

import { EXERCISE, SLEEP, WEIGHT, MEALS, WATER, MOOD, itemsUnder, addUnder, exerciseEntry, healthDay, healthDayOf, healthPathFor } from "./planner.js";
import { setProperty } from "./bases.js";
import { parseFrontmatter } from "./dvpage.js";
import { findTemplate, renderTemplate, DAILY_FOLDER } from "./daily.js";
import { ownFolderIn } from "./build.js";

export const SOURCE = "Apple Health";
const KIND = "⌚ " + SOURCE;
const TAGGED = /apple\s*health/i;
const round1 = (n) => Math.round(n * 10) / 10;

// A number from a Shortcut: 8432, "8,432", "7.5", "208.4 lb" -> a number; "",
// null, junk or a negative -> null.
export function num(v) {
	if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
	const m = String(v ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
	if (!m) return null;
	const n = Number(m[0]);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

// The pushed body as clean numbers: { day, steps, kcal, sleepH, weight, unit }.
// sleep_min (what the Shortcut adds up) or sleep_h; date defaults to `today`.
export function readPush(body, today) {
	const b = body && typeof body === "object" ? body : {};
	const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date ?? "").trim()) ? String(b.date).trim() : today;
	const sleepMin = num(b.sleep_min);
	const sleepH = sleepMin != null ? sleepMin / 60 : num(b.sleep_h);
	const unit = /^k/i.test(String(b.weight_unit ?? "")) || /kg/i.test(String(b.weight ?? "")) ? "kg" : "lb";
	const out = {
		day,
		steps: num(b.steps),
		kcal: num(b.active_kcal ?? b.kcal),
		sleepH: sleepH ? round1(sleepH) : null,
		weight: num(b.weight) ? round1(num(b.weight)) : null,
		unit,
	};
	// Zero steps and zero sleep are what an empty Health query gives back; keep
	// whatever the note already has rather than writing a zero over it.
	if (!out.steps) out.steps = null;
	if (!out.kcal) out.kcal = null;
	return out;
}

export const hasData = (p) => p.steps != null || p.kcal != null || p.sleepH != null || p.weight != null;

// The note with `item` as the one Apple Health line under heading: the old
// one replaced in place, or a new one added.
function setTagged(text, heading, item, isOurs, opts) {
	const ours = itemsUnder(text, heading).find((it) => isOurs(it.text));
	if (!ours) return addUnder(text, heading, item, opts);
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	lines[ours.line] = lines[ours.line].replace(/^([-*+]\s+).*$/, `$1${item}`);
	return lines.join(nl);
}

// The health note's text with the push applied, and the totals the planner
// copies into properties (steps, activity_kcal, sleep_h, weight) brought up to
// date for what was pushed.
export function applyPush(text, p) {
	let out = text;
	if (p.steps != null || p.kcal != null) {
		// Keep the half not sent this time from the earlier push.
		const before = itemsUnder(out, EXERCISE.heading).find((it) => TAGGED.test(it.text.split("|")[0]));
		const old = before ? exerciseEntry(before.text) : {};
		const steps = p.steps ?? old.steps, kcal = p.kcal ?? old.kcal;
		const parts = [KIND];
		if (steps) parts.push(`${Math.round(steps)} steps`);
		if (kcal) parts.push(`${Math.round(kcal)} cal`);
		out = setTagged(out, EXERCISE.heading, parts.join(" | "), (t) => TAGGED.test(t.split("|")[0]), { parent: EXERCISE.parent });
	}
	if (p.sleepH != null) out = setTagged(out, SLEEP.heading, `${p.sleepH} h | ${SOURCE}`, (t) => TAGGED.test(t));
	if (p.weight != null) out = setTagged(out, WEIGHT.heading, `${p.weight} ${p.unit} | ${SOURCE}`, (t) => TAGGED.test(t));

	const d = healthDay(out, []);
	const fm = parseFrontmatter(out) || {};
	const want = {};
	if (p.steps != null || p.kcal != null) Object.assign(want, { steps: Math.round(d.steps), activity_kcal: Math.round(d.kcal) });
	if (p.sleepH != null) want.sleep_h = d.sleepHours;
	if (p.weight != null) {
		const w = d.weights.at(-1);
		Object.assign(want, { weight: w.value, weight_unit: w.unit || p.unit });
	}
	for (const [k, v] of Object.entries(want)) if (String(fm[k] ?? "") !== String(v)) out = setProperty(out, k, v);
	return out;
}

// Where the day's health note is: the one already there (any folder, any
// case), else beside where that day's daily note goes, found the way the
// page's "Log food" finds it. paths: every note in the vault.
export function healthNotePath(paths, day) {
	const have = paths.filter((p) => healthDayOf(p) === day && /(^|\/)\d{4}-\d{2}-\d{2} Health\.md$/i.test(p)).sort((a, b) => a.length - b.length)[0];
	if (have) return { path: have, exists: true };
	const tmpl = findTemplate(paths) || findTemplate(paths, "_templates/Daily Health.md");
	const root = tmpl ? tmpl.root : paths.some((p) => p.startsWith("content/")) ? "content/" : "";
	const daily = root + ownFolderIn(paths, root, DAILY_FOLDER) + day + ".md";
	const dailyHave = paths.find((p) => p.toLowerCase() === daily.toLowerCase());
	return { path: healthPathFor(dailyHave || daily), exists: false };
}

// A new health note for `day`, made the way the page makes one: from
// _templates/Daily Health.md when the vault has it (templateText), else the
// page's built-in starter.
export function newHealthNote(path, day, templateText) {
	const [y, m, dd] = day.split("-").map(Number);
	const date = new Date(y, m - 1, dd, 12);
	const title = path.split("/").pop().replace(/\.md$/i, "");
	if (templateText != null) return renderTemplate(templateText, { title, date }).text;
	return `---\ntitle: Daily Health\ndate: "${day}"\n---\n\n## Nutrition Log\n${MEALS.map((x) => `### ${x}\n- \n`).join("")}\n## ${WATER.parent}\n### ${WATER.heading}\n- \n\n## ${MOOD.heading}\n- \n`;
}
