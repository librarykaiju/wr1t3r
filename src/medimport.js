// Medicines into a medicine list from a spreadsheet: a CSV, or an Excel
// workbook's first sheet (.xlsx, read with JSZip). The header row's columns
// are matched by name, so their order and any extra columns don't matter:
//   name     Medicine, Medication, Name, Drug
//   dose     Dose, Strength, Dosage, Amount
//   times    Times, Time, When, Schedule, Frequency ("8am, 8pm", "twice
//            daily", "BID", "as needed")
//   days     Days ("Mon, Thu", "weekdays"; empty for every day)
//   from     Start, Start date, From, First day
//   until    End, End date, Stop, Until, Last dose, Last day
//   purpose  Purpose, Reason, Indication, For
//   note     Notes, Comments, Instructions, Schedule and comments
// A clinic chart's layout works too: a column headed by a time ("8am",
// "20:00") with an X (or anything but a dash) where the medicine is taken
// then, and an "As needed" column. A medicine already on the list (same name)
// is left as it is, and so is a repeat further down the file.

import { parseCsv } from "./storygraph.js";
import { parseTime, parseDays, parseDate, parseMeds, putMed } from "./meds.js";

const COLUMNS = {
	name: /^(medicine|medicines|medication|medications|med|meds|name|drug|medicine name|medication name|drug name)$/,
	dose: /^(dose|doses|strength|dosage|amount)$/,
	times: /^(times?|when|schedule|frequency|how often|time of day)$/,
	days: /^(days?|days of the week)$/,
	from: /^(start|start date|from|first day|begin|started)$/,
	until: /^(end|end date|stop|stop date|until|last dose|last day)$/,
	purpose: /^(purpose|reason|indication|for|used for|what it s for)$/,
	note: /^(notes?|comments?|instructions|directions|schedule and comments|special instructions)$/,
	prn: /^(as needed|prn|when needed)$/,
};

const norm = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9: ]/g, " ").replace(/\s+/g, " ").trim();

const pad = (n) => String(n).padStart(2, "0");

// Excel keeps times as a fraction of a day and dates as days since 1899-12-30.
const excelTime = (v) => { const n = Number(v); if (!(String(v).trim() !== "" && n >= 0 && n < 1)) return null; const m = Math.round(n * 1440); return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`; };
const excelDate = (v) => { const n = Number(v); if (!(n > 20000 && n < 80000)) return null; const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const dateOf = (v) => parseDate(v) || excelDate(v) || parseDate(String(v).replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, "$1-$2-$3"));
const timeOf = (v) => parseTime(v) || excelTime(v);

// How often -> times of day, for schedules written in words.
const OFTEN = [
	[/^(as needed|when needed|prn|as required|if needed)\b/, []],
	[/^(once (a )?daily|once a day|daily|every day|qd|od|1x( a)? day|every morning|in the morning|qam)$/, ["08:00"]],
	[/^(at bedtime|bedtime|every night|nightly|qhs|hs|in the evening|every evening|qpm)$/, ["21:00"]],
	[/^(twice (a )?daily|twice a day|two times a day|2x( a)? day|bid|b i d|every 12 hours|q12h)$/, ["08:00", "20:00"]],
	[/^(three times (a )?(day|daily)|3x( a)? day|tid|t i d|every 8 hours|q8h)$/, ["08:00", "14:00", "20:00"]],
	[/^(four times (a )?(day|daily)|4x( a)? day|qid|q i d|every 6 hours|q6h)$/, ["08:00", "12:00", "16:00", "20:00"]],
];

// A schedule cell -> { times, asNeeded } or null when it can't be read.
export function readSchedule(v) {
	const t = String(v ?? "").trim();
	if (!t) return null;
	const list = t.split(/\s*(?:,|;|\band\b|&|\/)\s*/i).filter(Boolean).map(timeOf);
	if (list.length && list.every(Boolean)) return { times: [...new Set(list)].sort(), asNeeded: false };
	const w = norm(t).replace(/\./g, "");
	for (const [re, times] of OFTEN) if (re.test(w)) return { times, asNeeded: !times.length };
	return null;
}

const MARK = /^(-|–|—|no|n|0|false)$/i;

// Rows (arrays of cells, the first holding the headers somewhere in the first
// ten rows) -> { meds: [{ name, dose, times, days, from, until, purpose,
// note }], skipped }. Throws when no row has a medicine-name column.
export function readMedRows(rows) {
	let h = -1, at = {}, timeCols = [];
	for (let i = 0; i < Math.min(rows.length, 10) && h < 0; i++) {
		const found = {}, tc = [];
		rows[i].forEach((cell, j) => {
			const n = norm(cell);
			for (const [k, re] of Object.entries(COLUMNS)) if (found[k] == null && re.test(n)) { found[k] = j; return; }
			const t = timeOf(String(cell ?? "").trim());
			if (t && String(cell ?? "").trim()) tc.push([j, t]);
		});
		if (found.name != null) { h = i; at = found; timeCols = tc; }
	}
	if (h < 0) throw new Error("That sheet needs a header row with a Medicine (or Name) column.");
	const meds = [];
	let skipped = 0;
	for (const r of rows.slice(h + 1)) {
		const get = (k) => (at[k] == null ? "" : String(r[at[k]] ?? "").trim());
		const name = get("name").replace(/\|/g, "/").replace(/\s+/g, " ");
		if (!name) { if (r.some((c) => String(c ?? "").trim())) skipped++; continue; }
		const notes = [get("note")];
		let times = timeCols.filter(([j]) => { const c = String(r[j] ?? "").trim(); return c && !MARK.test(c); }).map(([, t]) => t);
		let asNeeded = !!get("prn") && !MARK.test(get("prn"));
		if (!times.length && get("times")) {
			const s = readSchedule(get("times"));
			if (s) { times = s.times; asNeeded = asNeeded || s.asNeeded; }
			else notes.unshift(get("times"));
		}
		const days = times.length && get("days") ? parseDays(get("days")) : null;
		if (times.length && get("days") && !days) notes.push(get("days"));
		// "Metformin 500 mg" in the name column, with no dose column of its own.
		const split = !get("dose") && /^(.*?\D)\s+(\d[\d.,/]*\s*(?:mg|mcg|µg|g|ml|iu|units?|%|tabs?|tablets?|caps?|capsules?|puffs?|drops?)\b.*)$/i.exec(name);
		meds.push({
			name: split ? split[1] : name, dose: split ? split[2] : get("dose"), times: [...new Set(times)].sort(), days,
			from: dateOf(get("from")), until: dateOf(get("until")),
			purpose: get("purpose"), note: notes.filter(Boolean).join("; "),
		});
	}
	return { meds, skipped };
}

// The list with the medicines it doesn't have yet: { text, added, already }.
export function addMeds(listText, meds) {
	const have = new Set(parseMeds(listText).map((m) => m.name.toLowerCase()));
	let text = listText, added = 0, already = 0;
	for (const m of meds) {
		const key = m.name.toLowerCase();
		if (have.has(key)) { already++; continue; }
		have.add(key);
		text = putMed(text, m);
		added++;
	}
	return { text, added, already };
}

// ---- Reading the file ---------------------------------------------------------

const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");
const colIndex = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

// A worksheet's XML (and the workbook's shared strings) -> rows of cells.
export function sheetRows(sheetXml, sharedXml = "") {
	const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
	const rows = [];
	for (const rm of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
		const row = [];
		for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
			const attrs = cm[1], body = cm[2] || "";
			const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
			const type = /\bt="(\w+)"/.exec(attrs)?.[1];
			const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
			let value = "";
			if (type === "s") value = shared[Number(v)] ?? "";
			else if (type === "inlineStr") value = texts(body);
			else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
			else if (v != null) value = unxml(v);
			row[ref ? colIndex(ref) : row.length] = value;
		}
		rows.push(Array.from(row, (c) => c ?? ""));
	}
	return rows;
}

// A .csv or .xlsx File -> rows.
export async function fileRows(file) {
	if (!/\.xlsx$/i.test(file.name)) {
		if (/\.(xls|numbers|ods)$/i.test(file.name)) throw new Error("Save it as .xlsx or .csv first (File > Save As, or Export in Numbers).");
		return parseCsv(await file.text());
	}
	const { default: JSZip } = await import("jszip");
	const zip = await JSZip.loadAsync(file);
	const read = (p) => zip.file(p)?.async("string") ?? Promise.resolve("");
	const book = await read("xl/workbook.xml");
	const rels = await read("xl/_rels/workbook.xml.rels");
	const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(book)?.[1];
	const target = rid && new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
		|| new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];
	const path = target ? (target.startsWith("/") ? target.slice(1) : "xl/" + target) : "xl/worksheets/sheet1.xml";
	const sheet = await read(path);
	if (!sheet) throw new Error("Couldn't find the first sheet in that workbook.");
	return sheetRows(sheet, await read("xl/sharedStrings.xml"));
}
