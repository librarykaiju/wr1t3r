// Table rows as board rows: a view with `wr1t3r: { tableRows: ... }` shows one
// row per row of a table in each note, instead of one row per note. This reads
// the tables out of a note's text. No DOM here (see bases.js, basesview.js).
//
//   tableRows: true        the first table in each note
//   tableRows: 2           the second table
//   tableRows: Spending    the table under the heading "Spending"

import { cells } from "./table.js";
import { readCell } from "./formula.js";

const FM = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$|^\s*\|\s*:?-+:?\s*\|\s*$/;
const FENCE = /^\s*(```|~~~)/;
// A row that adds up the others ("Total", "Sum", "Grand total") isn't a record
// of its own; counting it would double every sum.
const TOTAL = /^(\*\*|__)?\s*(grand\s+)?(totals?|sum|subtotal)\s*:?\s*(\*\*|__)?$/i;

const plain = (s) => String(s).replace(/\\([\\`*_{}[\]()#+\-.!|~=$])/g, "$1").replace(/(\*\*|__|\*|_|==|`)/g, "").trim();

// Every table in a note's text, in order: [{ heading, headers, rows }] where
// rows are arrays of cell text (empty cells ""). Tables in code blocks and in
// the frontmatter don't count.
export function tablesIn(text) {
	const body = text.replace(FM, "");
	const lines = body.split(/\r?\n/);
	const out = [];
	let heading = "", fence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (FENCE.test(line)) { fence = !fence; continue; }
		if (fence) continue;
		const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
		if (h) { heading = plain(h[1]); continue; }
		if (!line.includes("|") || !DELIM.test(lines[i + 1] ?? "")) continue;
		const headers = cells(line).map(plain);
		const rows = [];
		let j = i + 2;
		for (; j < lines.length && lines[j].includes("|") && lines[j].trim(); j++) {
			const r = cells(lines[j]);
			rows.push(headers.map((_, c) => r[c] ?? ""));
		}
		out.push({ heading, headers, rows });
		i = j - 1;
	}
	return out;
}

// The table a view reads (see the top), or null.
export function pickTable(tables, which) {
	if (which === true || which == null || which === "") return tables[0] ?? null;
	if (typeof which === "number" || /^\d+$/.test(String(which))) return tables[Number(which) - 1] ?? null;
	const want = String(which).trim().toLowerCase();
	return tables.find((t) => t.heading.toLowerCase() === want) ?? null;
}

// A table cell as a value: a number ("$1,200.50" is 1200.5), true/false, text,
// or null when empty. Dates stay text for bases.js to type.
export function cellValue(text) {
	const { v } = readCell(text);
	return v === "" ? null : v;
}

// The table's rows as records, { header: value }, leaving out empty rows and
// rows that total the others. Duplicate headers keep the first. -> { headers, rows }
export function tableRecords(text, which) {
	const t = pickTable(tablesIn(text), which);
	if (!t) return null;
	const seen = new Set();
	const keep = t.headers.map((h) => {
		const k = h.toLowerCase();
		if (!h || seen.has(k)) return false;
		seen.add(k);
		return true;
	});
	const headers = t.headers.filter((_, c) => keep[c]);
	const rows = [];
	for (const r of t.rows) {
		if (r.every((c) => !c.trim())) continue;
		if (TOTAL.test(plain(r[0]))) continue;
		const rec = {};
		t.headers.forEach((h, c) => { if (keep[c]) rec[h] = cellValue(r[c]); });
		rows.push(rec);
	}
	return { headers, rows };
}
