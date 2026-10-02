// Column totals under a board's grid: the view's `summaries:` map, property
// id -> summary name, the names Obsidian Bases uses so both read the same file:
//   summaries:
//     note.price: Sum
//     note.done: Checked

import { BDate, toDate, show, showDate } from "./bases.js";

// Name -> what the menu calls it.
export const SUMMARIES = [
	["Sum", "Sum"], ["Average", "Average"], ["Median", "Median"], ["Min", "Smallest"], ["Max", "Largest"], ["Range", "Range"], ["Stddev", "Standard deviation"],
	["Earliest", "Earliest date"], ["Latest", "Latest date"],
	["Checked", "Checked"], ["Unchecked", "Unchecked"],
	["Filled", "Filled"], ["Empty", "Empty"], ["Unique", "Unique values"],
];

const blank = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
const num = (v) => {
	if (Array.isArray(v)) v = v[0];
	if (typeof v === "number") return v;
	if (typeof v === "string" && /^\s*-?[\d,]*\.?\d+\s*$/.test(v)) return Number(v.replace(/,/g, ""));
	return null;
};
const round = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

// The summary of a column's values as text, or "" when it has nothing to say.
export function summarize(name, values) {
	const nums = values.map(num).filter((n) => n != null && Number.isFinite(n));
	const dates = values.map((v) => (Array.isArray(v) ? v[0] : v)).map((v) => (v instanceof BDate ? v : typeof v === "string" ? toDate(v) : null)).filter(Boolean);
	switch (name) {
		case "Sum": return nums.length ? round(nums.reduce((a, b) => a + b, 0)) : "";
		case "Average": return nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length) : "";
		case "Median": {
			if (!nums.length) return "";
			const s = [...nums].sort((a, b) => a - b), m = s.length >> 1;
			return round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
		}
		case "Min": return nums.length ? round(Math.min(...nums)) : dates.length ? showDate(dates.reduce((a, b) => (b.ms < a.ms ? b : a))) : "";
		case "Max": return nums.length ? round(Math.max(...nums)) : dates.length ? showDate(dates.reduce((a, b) => (b.ms > a.ms ? b : a))) : "";
		case "Range": {
			if (nums.length) return round(Math.max(...nums) - Math.min(...nums));
			if (!dates.length) return "";
			const days = Math.round((Math.max(...dates.map((d) => d.ms)) - Math.min(...dates.map((d) => d.ms))) / 864e5);
			return `${days} ${days === 1 ? "day" : "days"}`;
		}
		case "Stddev": {
			if (!nums.length) return "";
			const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
			return round(Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length));
		}
		case "Earliest": return dates.length ? showDate(dates.reduce((a, b) => (b.ms < a.ms ? b : a))) : "";
		case "Latest": return dates.length ? showDate(dates.reduce((a, b) => (b.ms > a.ms ? b : a))) : "";
		case "Checked": return String(values.filter((v) => v === true).length);
		case "Unchecked": return String(values.filter((v) => v !== true).length);
		case "Filled": return String(values.filter((v) => !blank(v)).length);
		case "Empty": return String(values.filter(blank).length);
		case "Unique": return String(new Set(values.filter((v) => !blank(v)).map((v) => show(v).toLowerCase())).size);
	}
	return "";
}

// The summary name the view sets for a column, matching "price" to "note.price".
export function summaryFor(view, id, same) {
	const s = view?.summaries;
	if (!s || typeof s !== "object") return null;
	const k = Object.keys(s).find((x) => same(x, id));
	return k ? String(s[k]) : null;
}
