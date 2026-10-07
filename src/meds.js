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
//   - 08:12 | Lisinopril | 10 mg | for 08:00
// "for 08:00" says which scheduled dose it was; a line without it (typed by
// hand, or an as-needed dose) counts toward the earliest dose not yet taken.

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

// "Lisinopril | 10 mg | 08:00" -> { name, dose, times, asNeeded, days }, or
// null when it isn't a medicine line.
export function parseMed(text) {
	const parts = String(text).split("|").map((s) => s.trim());
	const name = parts.shift();
	if (!name) return null;
	let k = parts.findIndex((p) => parseTimes(p) != null);
	const times = k < 0 ? [] : parseTimes(parts[k]);
	const dose = (k < 0 ? parts : parts.slice(0, k)).filter(Boolean).join(" ");
	const days = k < 0 ? null : parseDays(parts.slice(k + 1).join(", "));
	return { name, dose, times, asNeeded: !times.length, days };
}

export function medLine({ name, dose, times = [], days = null }) {
	const clean = (s) => String(s ?? "").replace(/\s*[|\n]\s*/g, " ").trim();
	const parts = [clean(name)];
	if (clean(dose)) parts.push(clean(dose));
	parts.push(times.length ? times.join(", ") : "as needed");
	const d = times.length ? daysText(days) : "";
	if (d) parts.push(d);
	return parts.join(" | ");
}

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

export function newMedsNote() {
	return "---\ntitle: Medications\n---\n\n# Medications\n\nOne medicine per line: name | dose | times (or \"as needed\") | days (leave out for every day).\n\n";
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
		if (m.asNeeded || (m.days && !m.days.includes(wd))) continue;
		for (const time of m.times) out.push({ name: m.name, dose: m.dose, time });
	}
	return out.sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name));
}

// "08:12 | Lisinopril | 10 mg | for 08:00" -> { time, name, dose, for }.
export function medEntry(text) {
	const parts = String(text).split("|").map((s) => s.trim());
	const out = { time: null, name: "", dose: "", for: null };
	if (/^\d{1,2}:\d{2}$/.test(parts[0] || "")) out.time = parseTime(parts.shift());
	out.name = parts.shift() || "";
	const rest = [];
	for (const p of parts) {
		const f = p.match(/^for\s+(.+)$/i);
		if (f && parseTime(f[1])) out.for = parseTime(f[1]);
		else if (p) rest.push(p);
	}
	out.dose = rest.join(" ");
	return out;
}

export function medTakenLine({ name, dose }, forTime = null, date = new Date()) {
	const clean = (s) => String(s ?? "").replace(/\s*[|\n]\s*/g, " ").trim();
	return [`${pad(date.getHours())}:${pad(date.getMinutes())}`, clean(name), ...(clean(dose) ? [clean(dose)] : []), ...(forTime ? [`for ${forTime}`] : [])].join(" | ");
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
export function medReminders(meds, { from = Date.now(), days = 7, takenOn = () => [], pathOn = () => null } = {}) {
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
			const title = `💊 ${dose.name}${dose.dose ? " " + dose.dose : ""}`;
			out.push({ id: hash(`med\n${dose.name}\n${at}`), at, title, path: pathOn(day) });
		}
	}
	return out;
}
