// Repeating tasks, written as the Tasks plugin writes them, so Obsidian
// repeats them too:
//   - [ ] Water plants 🔁 every week 📅 2026-10-03
// Ticking one adds the next copy on the line above (as Tasks does), with its
// dates moved on: the due date by the rule, other dates (start, scheduled, a
// reminder) by the same number of days. "when done" counts from the day it
// was ticked instead of the due date.

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const day = (s) => new Date(s + "T00:00:00Z");
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const RULE = /🔁️? ?([^📅⏳🛫✅➕⏫🔼🔽⏬🔺^(]*)/u;
const DATES = /([📅⏳🛫])️? ?(\d{4}-\d{2}-\d{2})/gu;
const REMIND = /\(@(\d{4}-\d{2}-\d{2})( \d{1,2}:\d{2})?\)/g;

// The rule text after 🔁 ("every week"), or null.
export function ruleOf(lineText) {
	const m = lineText.match(RULE);
	return m ? m[1].trim() || null : null;
}

// The day after `from` ("YYYY-MM-DD") that the rule lands on, or null for a
// rule it doesn't understand.
export function nextDay(rule, from) {
	const r = rule.toLowerCase().replace(/\s+when done$/, "").trim();
	const d = day(from);
	let m;
	if ((m = r.match(/^every (?:(\d+) )?(day|week|month|year)s?$/))) {
		const n = Number(m[1] || 1);
		if (m[2] === "day") d.setUTCDate(d.getUTCDate() + n);
		else if (m[2] === "week") d.setUTCDate(d.getUTCDate() + 7 * n);
		else if (m[2] === "month") {
			const want = d.getUTCDate();
			d.setUTCDate(1);
			d.setUTCMonth(d.getUTCMonth() + n);
			const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
			d.setUTCDate(Math.min(want, last));
		} else d.setUTCFullYear(d.getUTCFullYear() + n);
		return iso(d);
	}
	if (r === "every weekday") {
		do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
		return iso(d);
	}
	if ((m = r.match(/^every ((?:\w+(?:,\s*|\s+and\s+)?)+)$/))) {
		const want = m[1].split(/,\s*|\s+and\s+/).map((w) => DAYS.indexOf(w.trim()));
		if (!want.length || want.includes(-1)) return null;
		do d.setUTCDate(d.getUTCDate() + 1); while (!want.includes(d.getUTCDay()));
		return iso(d);
	}
	return null;
}

const shift = (s, days) => { const d = day(s); d.setUTCDate(d.getUTCDate() + days); return iso(d); };

// The next copy of a repeating task line (box open, done date off, dates
// moved on), or null if the line doesn't repeat.
export function nextTask(lineText, today) {
	const rule = ruleOf(lineText);
	if (!rule) return null;
	const due = lineText.match(/📅️? ?(\d{4}-\d{2}-\d{2})/u)?.[1];
	const others = [...lineText.matchAll(DATES)].map((m) => m[2]);
	const remind = [...lineText.matchAll(REMIND)].map((m) => m[1]);
	const anchor = due || others[0] || remind[0] || today;
	const next = nextDay(rule, /when done\s*$/i.test(rule) ? today : anchor);
	if (!next) return null;
	const by = Math.round((day(next) - day(anchor)) / 86400000);
	return lineText
		.replace(/(^\s*(?:>\s*)*(?:[-*+]|\d+[.)]) \[)[^\]](\])/, "$1 $2")
		.replace(/ ?✅️? ?\d{4}-\d{2}-\d{2}/gu, "")
		.replace(/\s+\^[\w-]+\s*$/, "")
		.replace(DATES, (all, mark, d) => `${mark} ${shift(d, by)}`)
		.replace(REMIND, (all, d, t) => `(@${shift(d, by)}${t || ""})`);
}
