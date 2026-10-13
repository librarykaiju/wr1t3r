// Medications: a list of what you take kept in a note of its own
// ("Medications.md", or the one the planner block names), and each dose you
// take logged in the day's health note. src/plannerview.js draws the Meds
// button and panel; main.js turns the day's doses into reminders.
//
// The list, one medicine per line (name | dose | times | days):
//   - Lisinopril | 10 mg | 08:00
//   - Vitamin D | 1 tab | 08:00, 20:00
//   - Methotrexate | 2.5 mg | 09:00 | Mon
//   - Ibuprofen | 200 mg | as needed
// The dose and the days can be left out ("- Vitamin C | 8am"). No days means
// every day; "weekdays" and "weekends" work too.
//
// The health note's log, under "## 💊 Medications":
//   - 08:12 | Lisinopril | 10 mg | for 08:00 | by Brandon
// "for 08:00" says which scheduled dose it was; a line without it (typed by
// hand, or an as-needed dose) counts toward the earliest dose not yet taken.
// "by Brandon" is who gave it, when this device has a name set.
//
// People someone looks after (the planner's people: [Mom]) each have a folder,
// People/Mom/, with their own list (People/Mom/Medications.md) and a log note a
// day (People/Mom/Meds/2026-10-13 meds.md, the same heading and lines).

export const MEDS = { heading: "💊 Medications" };
export const MEDS_NOTE = "Medications.md";

const pad = (n) => String(n).padStart(2, "0");
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const AS_NEEDED = /^(as needed|when needed|prn|as required)$/i;

// "8am", "8:30 pm", "20:00" -> "08:00" / "20:30", or null. A bare number
// ("2") isn't a time: it's more likely a dose.
export function parseTime(s) {
	const m = String(s).trim().toLowerCase().replace(/\./g, "").match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
	if (!m) return null;
	let h = Number(m[1]);
	const min = Number(m[2] || 0);
	if (m[3]) {
		if (h < 1 || h > 12) return null;
		h = (h % 12) + (m[3].startsWith("p") ? 12 : 0);
	} else if (!m[2]) return null;
	if (h > 23 || min > 59) return null;
	return `${pad(h)}:${pad(min)}`;
}

// "08:00, 20:00" -> ["08:00", "20:00"], "as needed" -> [], or null when
// it isn't a list of times.
function parseTimes(s) {
	const t = String(s).trim();
	if (AS_NEEDED.test(t)) return [];
	const parts = t.split(/\s*(?:,|\band\b|&)\s*/i).filter(Boolean);
	if (!parts.length) return null;
	const out = parts.map(parseTime);
	return out.every(Boolean) ? [...new Set(out)].sort() : null;
}

// "Mon, Thu", "weekdays", "daily" -> [1, 4], [1..5], null (every day).
export function parseDays(s) {
	const t = String(s || "").trim().toLowerCase();
	if (!t || /^(daily|every ?day|all)$/.test(t)) return null;
	if (t === "weekdays") return [1, 2, 3, 4, 5];
	if (t === "weekends") return [0, 6];
	const out = [];
	for (const w of t.split(/[\s,/&]+|\band\b/).filter(Boolean)) {
		const i = DAY_NAMES.findIndex((d) => w.startsWith(d.toLowerCase()) || (d === "Thu" && w.startsWith("thur")));
		if (i < 0) return null;
		if (!out.includes(i)) out.push(i);
	}
	return out.length ? out.sort((a, b) => a - b) : null;
}

export function daysText(days) {
	if (!days || days.length === 7) return "";
	if (days.join() === "1,2,3,4,5") return "weekdays";
	if (days.join() === "0,6") return "weekends";
	return days.map((d) => DAY_NAMES[d]).join(", ");
}

// A picture embed, ![[Lisinopril pill.jpg]] or ![](Lisinopril%20pill.jpg),
// -> the name it links to, else null.
export function photoTarget(part) {
	const wiki = /^!\[\[([^\]|]+)\]\]$/.exec(String(part).trim());
	if (wiki) return wiki[1].trim();
	const md = /^!\[[^\]]*\]\(<?([^()<>]+)>?\)$/.exec(String(part).trim());
	if (!md) return null;
	try { return decodeURIComponent(md[1].trim()); } catch { return md[1].trim(); }
}

// "2026-10-20", "10/20/26", "10/20/2026" -> "2026-10-20", or null.
export function parseDate(s) {
	const t = String(s ?? "").trim();
	let y, m, d;
	const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
	const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
	if (iso) [y, m, d] = iso.slice(1).map(Number);
	else if (us) { [m, d, y] = us.slice(1).map(Number); if (y < 100) y += 2000; }
	else return null;
	const dt = new Date(y, m - 1, d);
	return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// The parts a line can carry anywhere after the name: "from 2026-10-20" (the
// first day), "until 2026-10-24" (the last), "purpose: Prevents nausea" and
// "note: Avoid dairy 2 h before and after".
const EXTRA = [
	["from", /^from\s+(.+)$/i, parseDate],
	["until", /^until\s+(.+)$/i, parseDate],
	["purpose", /^purpose:\s*(.+)$/i, (v) => v.trim()],
	["note", /^notes?:\s*(.+)$/i, (v) => v.trim()],
];

// "Lisinopril | 10 mg | 08:00 | ![[Lisinopril pill.jpg]]" -> { name, dose,
// times, asNeeded, days, photo, from, until, purpose, note }, or null when it
// isn't a medicine line. photo and the EXTRA parts are there only when the
// line has them, wherever they sit.
export function parseMed(text) {
	const all = String(text).split("|").map((s) => s.trim());
	const at = all.findIndex((p, i) => i > 0 && photoTarget(p));
	const photo = at < 0 ? "" : all.splice(at, 1)[0];
	const extra = {};
	const parts = all.filter((p, i) => {
		if (i === 0) return true;
		for (const [key, re, read] of EXTRA) {
			const m = re.exec(p);
			const v = m && read(m[1]);
			if (v) { extra[key] = v; return false; }
		}
		return true;
	});
	const name = parts.shift();
	if (!name) return null;
	let k = parts.findIndex((p) => parseTimes(p) != null);
	const times = k < 0 ? [] : parseTimes(parts[k]);
	const dose = (k < 0 ? parts : parts.slice(0, k)).filter(Boolean).join(" ");
	const days = k < 0 ? null : parseDays(parts.slice(k + 1).join(", "));
	return { name, dose, times, asNeeded: !times.length, days, ...(photo ? { photo } : {}), ...extra };
}

export function medLine({ name, dose, times = [], days = null, photo = "", from = null, until = null, purpose = "", note = "" }) {
	const clean = (s) => String(s ?? "").replace(/\s*[|\n]\s*/g, " ").trim();
	const parts = [clean(name)];
	if (clean(dose)) parts.push(clean(dose));
	parts.push(times.length ? times.join(", ") : "as needed");
	const d = times.length ? daysText(days) : "";
	if (d) parts.push(d);
	if (parseDate(from)) parts.push(`from ${parseDate(from)}`);
	if (parseDate(until)) parts.push(`until ${parseDate(until)}`);
	if (clean(purpose)) parts.push(`purpose: ${clean(purpose)}`);
	if (clean(note)) parts.push(`note: ${clean(note)}`);
	if (photoTarget(photo)) parts.push(clean(photo));
	return parts.join(" | ");
}

// Whether a medicine is taken on day ("2026-10-20"): between its from and
// until, when it has them.
export const activeOn = (m, day) => (!m.from || day >= m.from) && (!m.until || day <= m.until);

// The list note's medicines: [{ line, name, dose, times, asNeeded, days }].
// Tasks, empty "- " lines, and anything in front matter or code are skipped.
export function parseMeds(text) {
	const lines = String(text ?? "").split(/\r?\n/);
	const out = [];
	let i = 0, fence = null;
	if (/^---\s*$/.test(lines[0] || "")) {
		const close = lines.findIndex((l, j) => j > 0 && /^(---|\.\.\.)\s*$/.test(l));
		if (close > 0) i = close + 1;
	}
	for (; i < lines.length; i++) {
		const f = lines[i].match(/^\s*(`{3,}|~{3,})/);
		if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; continue; }
		if (fence) continue;
		const m = lines[i].match(/^[-*+]\s+(?!\[.\])(.*\S)\s*$/);
		const med = m && parseMed(m[1]);
		if (med) out.push({ line: i, ...med });
	}
	return out;
}

export function newMedsNote(who = null) {
	const title = who ? `${who}'s medications` : "Medications";
	return `---\ntitle: ${who ? JSON.stringify(title) : title}\n---\n\n# ${title}\n\nOne medicine per line: name | dose | times (or "as needed") | days (leave out for every day).\n\n`;
}

// ---- People someone looks after --------------------------------------------

export const PEOPLE = "People";

// A person's name as it can go in a path and a log line, or "".
export const cleanPerson = (name) => String(name ?? "").replace(/[\\/:*?"<>|#^[\]\n]/g, "").replace(/\s+/g, " ").trim();

export const personFolder = (who) => `${PEOPLE}/${cleanPerson(who)}/`;
export const personMedsPath = (who) => personFolder(who) + MEDS_NOTE;
export const personLogPath = (who, day) => `${personFolder(who)}Meds/${day} meds.md`;

export function newMedsLog(who, day) {
	return `---\ntitle: ${JSON.stringify(`${who}'s medicines, ${day}`)}\nperson: ${JSON.stringify(who)}\ndate: "${day}"\n---\n\n## ${MEDS.heading}\n\n`;
}

// The list note with a medicine added (at the end of the list), or line i
// replaced with it.
export function putMed(text, med, i = null) {
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const line = `- ${medLine(med)}`;
	if (i != null && lines[i] != null) { lines[i] = line; return lines.join(nl); }
	const list = parseMeds(text);
	if (list.length) { lines.splice(list.at(-1).line + 1, 0, line); return lines.join(nl); }
	while (lines.length && !lines.at(-1).trim()) lines.pop();
	return [...lines, ...(lines.length ? [""] : []), line, ""].join(nl);
}

export function removeMed(text, i) {
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	if (lines[i] != null && /^[-*+]\s/.test(lines[i])) lines.splice(i, 1);
	return lines.join(nl);
}

// ---- A day's doses ----------------------------------------------------------

const weekday = (day) => new Date(day + "T12:00").getDay();

// The scheduled doses on a day ("2026-10-07"), by time: [{ name, dose, time }].
export function dosesOn(meds, day) {
	const wd = weekday(day);
	const out = [];
	for (const m of meds) {
		if (m.asNeeded || (m.days && !m.days.includes(wd)) || !activeOn(m, day)) continue;
		for (const time of m.times) out.push({ name: m.name, dose: m.dose, time, ...(m.photo ? { photo: m.photo } : {}) });
	}
	return out.sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name));
}

// "08:12 | Lisinopril | 10 mg | for 08:00" -> { time, name, dose, for }.
export function medEntry(text) {
	const parts = String(text).split("|").map((s) => s.trim());
	const out = { time: null, name: "", dose: "", for: null, by: null };
	if (/^\d{1,2}:\d{2}$/.test(parts[0] || "")) out.time = parseTime(parts.shift());
	out.name = parts.shift() || "";
	const rest = [];
	for (const p of parts) {
		const f = p.match(/^for\s+(.+)$/i);
		const by = p.match(/^by\s+(\S.*)$/i);
		if (f && parseTime(f[1])) out.for = parseTime(f[1]);
		else if (by) out.by = by[1].trim();
		else if (p) rest.push(p);
	}
	out.dose = rest.join(" ");
	return out;
}

export function medTakenLine({ name, dose }, forTime = null, date = new Date(), by = null) {
	const clean = (s) => String(s ?? "").replace(/\s*[|\n]\s*/g, " ").trim();
	return [`${pad(date.getHours())}:${pad(date.getMinutes())}`, clean(name), ...(clean(dose) ? [clean(dose)] : []), ...(forTime ? [`for ${forTime}`] : []), ...(clean(by) ? [`by ${clean(by)}`] : [])].join(" | ");
}

// Before logging name (for the scheduled dose at forTime, or as needed at
// `now`): the entry that says it's already been given, or null. A scheduled
// dose is given once it has an entry for it; an as-needed one counts as
// given when it was logged in the last `mins` minutes.
export function alreadyGiven(entries, { name, forTime = null, now = new Date(), mins = 30 }) {
	const key = (s) => String(s).trim().toLowerCase();
	const same = entries.filter((e) => key(e.name) === key(name));
	if (forTime) return same.find((e) => e.for === forTime) || null;
	const at = now.getHours() * 60 + now.getMinutes();
	const recent = same.filter((e) => e.time && at - (Number(e.time.slice(0, 2)) * 60 + Number(e.time.slice(3))) >= 0 && at - (Number(e.time.slice(0, 2)) * 60 + Number(e.time.slice(3))) < mins);
	return recent.at(-1) || null;
}

// The day's doses with what was taken for each: { doses: [{ name, dose,
// time, taken (a log entry or null) }], extra: [log entries that weren't for
// a scheduled dose], done, due }. taken: the health note's log entries ({
// line, text, time, name, dose, for }).
export function doseStatus(doses, taken) {
	const key = (s) => String(s).trim().toLowerCase();
	const out = doses.map((d) => ({ ...d, taken: null }));
	const left = [...taken];
	for (const d of out) {
		const k = left.findIndex((t) => t.for === d.time && key(t.name) === key(d.name));
		if (k >= 0) d.taken = left.splice(k, 1)[0];
	}
	for (const d of out) {
		if (d.taken) continue;
		const k = left.findIndex((t) => !t.for && key(t.name) === key(d.name));
		if (k >= 0) d.taken = left.splice(k, 1)[0];
	}
	const done = out.filter((d) => d.taken).length;
	return { doses: out, extra: left, done, due: out.length };
}

// The doses more than `grace` minutes past their time and not taken, at
// `now` on `day` (none on other days).
export function overdue(status, day, now = new Date(), grace = 60) {
	const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	if (day !== today) return [];
	const mins = now.getHours() * 60 + now.getMinutes();
	return status.doses.filter((d) => !d.taken && mins - (Number(d.time.slice(0, 2)) * 60 + Number(d.time.slice(3))) > grace);
}

// ---- Reminders ----------------------------------------------------------------

function hash(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return (h >>> 0).toString(36);
}

const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// A reminder for each dose from `from` (ms) for `days` days, skipping ones
// already taken: [{ id, at, title, path }] as src/reminders.js has them.
// takenOn(day) -> the day's log entries (as doseStatus takes them);
// pathOn(day) -> the note a reminder opens.
// who: the person they're for ("💊 Mom: Lisinopril 10 mg"), or null for you.
export function medReminders(meds, { from = Date.now(), days = 7, takenOn = () => [], pathOn = () => null, who = null } = {}) {
	const out = [];
	const start = new Date(from);
	for (let i = 0; i < days; i++) {
		const day = isoOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
		const doses = dosesOn(meds, day);
		if (!doses.length) continue;
		const st = doseStatus(doses, takenOn(day) || []);
		const [y, mo, d] = day.split("-").map(Number);
		for (const dose of st.doses) {
			if (dose.taken) continue;
			const [h, min] = dose.time.split(":").map(Number);
			const at = new Date(y, mo - 1, d, h, min).getTime();
			if (at < from) continue;
			const title = `💊 ${who ? who + ": " : ""}${dose.name}${dose.dose ? " " + dose.dose : ""}`;
			out.push({ id: hash(`med\n${who ? who + "\n" : ""}${dose.name}\n${at}`), at, title, path: pathOn(day) });
		}
	}
	return out;
}

// ---- The chart --------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}${y !== new Date().getFullYear() ? `, ${y}` : ""}`; };

// "8 mg, twice daily · Start Oct 20 · Last dose Oct 24 · Avoid dairy".
export function scheduleText(m) {
	const n = m.times.length;
	const often = m.asNeeded ? "as needed" : n === 1 ? (m.days ? "once a day" : "once daily") : n === 2 ? "twice daily" : `${n} times a day`;
	const when = m.days && !m.asNeeded ? `${often}, ${daysText(m.days)}` : often;
	return [
		m.dose ? `${m.dose}, ${when}` : when[0].toUpperCase() + when.slice(1),
		m.from && `Start ${shortDate(m.from)}`,
		m.until && `Last dose ${shortDate(m.until)}`,
		m.note,
	].filter(Boolean).join(" · ");
}

// The list as a chart for day, like the paper ones a clinic hands out: a row
// per medicine, a column per time any of them is taken (and "As needed").
// taken: the day's log entries. -> { times, rows: [{ med, schedule, active,
// cells: { "08:00": { due, given } }, given (as-needed entries) }] }.
// A cell with due is a dose on day (given: its log entry, or null); a time
// the medicine has on other days only shows as not due.
export function medChart(meds, day, taken = []) {
	const times = [...new Set(meds.flatMap((m) => m.times))].sort();
	const st = doseStatus(dosesOn(meds, day), taken);
	const key = (s) => String(s).trim().toLowerCase();
	const rows = meds.map((m) => {
		const active = activeOn(m, day);
		const cells = {};
		for (const t of m.times) {
			const d = st.doses.find((x) => x.time === t && key(x.name) === key(m.name));
			cells[t] = { due: !!d, given: d?.taken || null };
		}
		const given = m.asNeeded && active ? st.extra.filter((e) => key(e.name) === key(m.name)) : [];
		return { med: m, schedule: scheduleText(m), active, cells, given };
	});
	return { times, rows };
}
