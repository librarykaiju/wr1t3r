// Changing a base from its toolbar: the base's YAML is read (parseYaml in
// bases.js), changed as an object and written back here, in the keys Obsidian
// uses (filters, order, sort, groupBy, columnSize, image, cardSize...). What
// Obsidian has no key for goes under the view's `wr1t3r:` key, which Obsidian
// ignores. Filters made in the menus are plain Obsidian expressions, like
// `shelf.contains("Reading")` or `pages > 300`, so Obsidian reads them as is;
// expressions this file can't take apart stay as they are, as "raw" rows.
// No DOM here (see basesview.js).

import { show, BDate, BLink } from "./bases.js";

// ---- Writing YAML -----------------------------------------------------------

// Plain scalars YAML would read as something else get double quotes.
function scalar(v) {
	if (v == null) return "null";
	if (typeof v === "boolean" || typeof v === "number") return String(v);
	if (v instanceof BDate || v instanceof BLink) v = show(v);
	const s = String(v);
	if (s === "" || /^[\s\-?:,\[\]{}#&*!|>'"%@`]|: | #|\s$|^(true|false|null|~|yes|no|on|off)$/i.test(s) || /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) || /[\n\r\t]/.test(s)) return JSON.stringify(s);
	return s;
}
const keyText = (k) => (/^[A-Za-z_][\w.-]*$/.test(k) ? k : JSON.stringify(k));
const isMap = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof BDate) && !(v instanceof BLink);
const empty = (v) => v === undefined || (Array.isArray(v) && !v.length) || (isMap(v) && !Object.keys(v).length);

// A value as block YAML, the way Obsidian writes .base files: two spaces a
// level, lists of maps as "- key: value", empty lists and maps left out.
export function writeYaml(value) {
	const out = [];
	const block = (v, ind) => {
		if (Array.isArray(v)) {
			for (const x of v) {
				if (isMap(x)) {
					const keys = Object.keys(x).filter((k) => !empty(x[k]));
					if (!keys.length) { out.push(ind + "- {}"); continue; }
					keys.forEach((k, i) => entry(k, x[k], ind + "  ", i === 0 ? ind + "- " : ind + "  "));
				} else if (Array.isArray(x)) {
					out.push(ind + "-");
					block(x, ind + "  ");
				} else out.push(ind + "- " + scalar(x));
			}
		} else if (isMap(v)) {
			for (const k of Object.keys(v)) if (!empty(v[k])) entry(k, v[k], ind, ind);
		}
	};
	const entry = (k, v, ind, lead) => {
		if (Array.isArray(v) || isMap(v)) {
			out.push(lead + keyText(k) + ":");
			block(v, ind + "  ");
		} else out.push(lead + keyText(k) + ": " + scalar(v));
	};
	block(value, "");
	return out.join("\n") + "\n";
}

// ---- Views ------------------------------------------------------------------

export const VIEW_TYPES = [
	{ type: "table", label: "Grid" },
	{ type: "cards", label: "Gallery" },
	{ type: "list", label: "List" },
	{ type: "kanban", label: "Kanban" },
	{ type: "calendar", label: "Calendar" },
	{ type: "timeline", label: "Timeline" },
];
export const viewLabel = (type) => VIEW_TYPES.find((t) => t.type === type)?.label ?? type;

// The base's views, made sure to be a list (a base with none shows one table).
export function viewsOf(cfg) {
	if (!Array.isArray(cfg.views) || !cfg.views.length) cfg.views = [{ type: "table", name: "Table" }];
	cfg.views = cfg.views.map((v) => (isMap(v) ? v : {}));
	return cfg.views;
}

// A name no other view has: "Table", "Table 2"...
export function freshName(views, want) {
	const names = new Set(views.map((v) => String(v.name ?? "")));
	if (!names.has(want)) return want;
	for (let n = 2; ; n++) if (!names.has(`${want} ${n}`)) return `${want} ${n}`;
}

// wr1t3r's own settings for a view (made when missing).
export function extra(view) {
	if (!isMap(view.wr1t3r)) view.wr1t3r = {};
	return view.wr1t3r;
}

// ---- Property ids -----------------------------------------------------------

// How a property is written in an expression: `shelf`, `note["Due date"]`,
// `file.name`, `formula.pace`.
export function propRef(id) {
	const s = String(id);
	if (/^(file|formula)\.[\w.]+$/.test(s)) return s;
	const key = s.replace(/^note\./, "");
	if (/^[A-Za-z_][\w]*$/.test(key) && !/^(file|formula|note|this|true|false|null|and|or|not|if)$/.test(key)) return key;
	return `note[${JSON.stringify(key)}]`;
}
// The other way: `note["Due date"]` -> "Due date", `note.x` -> "x".
function refId(ref) {
	const m = /^note\[("(?:[^"\\]|\\.)*")\]$/.exec(ref);
	if (m) return JSON.parse(m[1]);
	return ref.replace(/^note\./, "");
}
// Two ids for the same property ("note.x" and "x").
export const sameProp = (a, b) => String(a).replace(/^note\./, "") === String(b).replace(/^note\./, "");

// ---- Property types ---------------------------------------------------------

// What kind of values a property holds across notes: checkbox, number, date,
// list or text. Decides the conditions a filter offers and the cell editor.
export function propType(values, id = "") {
	if (/^file\.(tags|links)$/.test(id)) return "list";
	if (/^file\.(ctime|mtime)$/.test(id)) return "date";
	if (id === "file.size") return "number";
	const kinds = new Set();
	for (const v of values) {
		if (v == null || v === "") continue;
		kinds.add(Array.isArray(v) ? "list" : v instanceof BDate ? "date" : typeof v === "boolean" ? "checkbox" : typeof v === "number" ? "number" : "text");
	}
	if (kinds.has("list")) return "list";
	if (kinds.size === 1) return [...kinds][0];
	return "text";
}

// ---- Filters ----------------------------------------------------------------

// The conditions offered for each kind of property. "arg" is what the value
// box takes: text, number, date, days, or nothing.
export const CONDITIONS = {
	text: [
		{ op: "is", label: "is", arg: "text" },
		{ op: "is not", label: "is not", arg: "text" },
		{ op: "contains", label: "contains", arg: "text" },
		{ op: "lacks", label: "doesn't contain", arg: "text" },
		{ op: "empty", label: "is empty", arg: null },
		{ op: "filled", label: "is not empty", arg: null },
	],
	number: [
		{ op: "=", label: "=", arg: "number" },
		{ op: "≠", label: "≠", arg: "number" },
		{ op: "<", label: "<", arg: "number" },
		{ op: ">", label: ">", arg: "number" },
		{ op: "≤", label: "≤", arg: "number" },
		{ op: "≥", label: "≥", arg: "number" },
		{ op: "empty", label: "is empty", arg: null },
		{ op: "filled", label: "is not empty", arg: null },
	],
	date: [
		{ op: "before", label: "is before", arg: "date" },
		{ op: "after", label: "is after", arg: "date" },
		{ op: "on", label: "is on", arg: "date" },
		{ op: "last", label: "is within the last", arg: "days" },
		{ op: "next", label: "is within the next", arg: "days" },
		{ op: "empty", label: "is empty", arg: null },
		{ op: "filled", label: "is not empty", arg: null },
	],
	list: [
		{ op: "contains", label: "has", arg: "text" },
		{ op: "lacks", label: "doesn't have", arg: "text" },
		{ op: "empty", label: "is empty", arg: null },
		{ op: "filled", label: "is not empty", arg: null },
	],
	checkbox: [
		{ op: "checked", label: "is checked", arg: null },
		{ op: "unchecked", label: "is not checked", arg: null },
	],
};
export const conditionsFor = (type) => CONDITIONS[type] || CONDITIONS.text;

const NUM_OPS = { "=": "==", "≠": "!=", "<": "<", ">": ">", "≤": "<=", "≥": ">=" };
const str = (v) => JSON.stringify(String(v ?? ""));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? String(n) : "0"; };

// A filter row -> its Obsidian expression.
export function rowExpr(row) {
	if (row.raw != null) return row.raw;
	const p = propRef(row.prop);
	switch (row.op) {
		case "is": return `${p} == ${str(row.value)}`;
		case "is not": return `${p} != ${str(row.value)}`;
		case "contains": return `${p}.contains(${str(row.value)})`;
		case "lacks": return `!${p}.contains(${str(row.value)})`;
		case "empty": return `${p}.isEmpty()`;
		case "filled": return `!${p}.isEmpty()`;
		case "checked": return `${p} == true`;
		case "unchecked": return `${p} != true`;
		case "before": return `${p} < date(${str(row.value)})`;
		case "after": return `${p} > date(${str(row.value)})`;
		case "on": return `${p} == date(${str(row.value)})`;
		case "last": return `${p} >= today() - ${str(num(row.value) + "d")} && ${p} <= now()`;
		case "next": return `${p} >= today() && ${p} <= today() + ${str(num(row.value) + "d")}`;
	}
	if (NUM_OPS[row.op]) return `${p} ${NUM_OPS[row.op]} ${num(row.value)}`;
	return "true";
}

const P = String.raw`(note\["(?:[^"\\]|\\.)*"\]|[A-Za-z_][\w.]*)`;
const S = String.raw`("(?:[^"\\]|\\.)*")`;
const PATTERNS = [
	[new RegExp(`^${P}\\s*>=\\s*today\\(\\)\\s*-\\s*"(\\d+(?:\\.\\d+)?)d"\\s*&&\\s*\\1\\s*<=\\s*now\\(\\)$`), (m) => ({ op: "last", value: m[2] })],
	[new RegExp(`^${P}\\s*>=\\s*today\\(\\)\\s*&&\\s*\\1\\s*<=\\s*today\\(\\)\\s*\\+\\s*"(\\d+(?:\\.\\d+)?)d"$`), (m) => ({ op: "next", value: m[2] })],
	[new RegExp(`^${P}\\s*(<|>|==)\\s*date\\(${S}\\)$`), (m) => ({ op: { "<": "before", ">": "after", "==": "on" }[m[2]], value: JSON.parse(m[3]) })],
	[new RegExp(`^${P}\\s*==\\s*true$`), () => ({ op: "checked" })],
	[new RegExp(`^${P}\\s*!=\\s*true$`), () => ({ op: "unchecked" })],
	[new RegExp(`^${P}\\s*==\\s*${S}$`), (m) => ({ op: "is", value: JSON.parse(m[2]) })],
	[new RegExp(`^${P}\\s*!=\\s*${S}$`), (m) => ({ op: "is not", value: JSON.parse(m[2]) })],
	[new RegExp(`^${P}\\s*(==|!=|<=|>=|<|>)\\s*([-+]?\\d+(?:\\.\\d+)?)$`), (m) => ({ op: Object.keys(NUM_OPS).find((k) => NUM_OPS[k] === m[2]), value: Number(m[3]) })],
	[new RegExp(`^(!?)${P}\\.contains\\(${S}\\)$`), (m) => ({ op: m[1] ? "lacks" : "contains", value: JSON.parse(m[3]), prop: m[2] })],
	[new RegExp(`^(!?)${P}\\.isEmpty\\(\\)$`), (m) => ({ op: m[1] ? "filled" : "empty", prop: m[2] })],
];

// An expression -> a row the Filter menu can show, or { raw } when it's
// something else (it still works, and can be removed, just not edited there).
export function parseRow(expr) {
	const s = String(expr).trim();
	for (const [re, make] of PATTERNS) {
		const m = re.exec(s);
		if (!m) continue;
		const r = make(m);
		const ref = r.prop ?? m[1];
		if (/^(file\.(inFolder|hasTag)|this)\b/.test(ref)) break;
		return { prop: refId(ref), op: r.op, value: r.value ?? "" };
	}
	return { raw: s };
}

// A view's (or the base's) filters -> { mode: "and" | "or", rows }. Nested
// groups and `not:` lists are raw rows, written back as they were.
export function readFilters(filter) {
	if (filter == null) return { mode: "and", rows: [] };
	if (typeof filter === "string") return { mode: "and", rows: [parseRow(filter)] };
	if (Array.isArray(filter)) return { mode: "and", rows: filter.map(item) };
	if (isMap(filter)) {
		const keys = Object.keys(filter);
		if (keys.length === 1 && (keys[0] === "and" || keys[0] === "or") && Array.isArray(filter[keys[0]])) return { mode: keys[0], rows: filter[keys[0]].map(item) };
	}
	return { mode: "and", rows: [{ raw: filter }] };
}
const item = (f) => (typeof f === "string" ? parseRow(f) : { raw: f });

// The other way: undefined when there's nothing left, so the key goes.
export function writeFilters({ mode, rows }) {
	if (!rows.length) return undefined;
	return { [mode === "or" ? "or" : "and"]: rows.map((r) => (r.raw != null ? r.raw : rowExpr(r))) };
}

// A raw row as text, for the menu.
export function rawText(raw) {
	if (typeof raw === "string") return raw;
	return writeYaml(raw).trim().replace(/\n\s*/g, " ");
}

// ---- Source -----------------------------------------------------------------

// Where the base's notes come from: the base-wide filters that are
// file.inFolder(...) and file.hasTag(...), plus the rest, untouched.
export function readSource(filters) {
	const f = readFilters(filters);
	const out = { folders: [], tags: [], rest: [], mode: f.mode };
	for (const r of f.rows) {
		const s = r.raw == null ? rowExpr(r) : typeof r.raw === "string" ? r.raw.trim() : null;
		const folder = s && /^file\.inFolder\(("(?:[^"\\]|\\.)*")\)$/.exec(s);
		const tag = s && /^file\.hasTag\(("(?:[^"\\]|\\.)*")\)$/.exec(s);
		const folderEq = !folder && s && /^file\.folder\s*==\s*("(?:[^"\\]|\\.)*")$/.exec(s);
		if (folder && f.mode === "and") out.folders.push(JSON.parse(folder[1]));
		else if (tag && f.mode === "and") out.tags.push(JSON.parse(tag[1]));
		else if (folderEq && f.mode === "and") out.folders.push(JSON.parse(folderEq[1]));
		else out.rest.push(r);
	}
	return out;
}

// Base-wide filters for a source of folders and tags (every one must hold).
export function writeSource({ folders, tags, rest, mode }) {
	if (mode === "or" && rest.length) {
		// An "any of" filter the menus didn't make: keep it whole, add ours beside it.
		const inner = writeFilters({ mode, rows: rest });
		return writeFilters({ mode: "and", rows: [...sourceRows(folders, tags), { raw: inner }] });
	}
	return writeFilters({ mode: "and", rows: [...sourceRows(folders, tags), ...rest] });
}
const sourceRows = (folders, tags) => [
	...folders.map((f) => ({ raw: `file.inFolder(${JSON.stringify(f)})` })),
	...tags.map((t) => ({ raw: `file.hasTag(${JSON.stringify(t.replace(/^#/, ""))})` })),
];

// ---- New notes --------------------------------------------------------------

// Properties a new note needs to show up in the view: what "is" filters and
// "has" filters (in an all-of list) ask for.
export function prefill(filters) {
	const out = {};
	for (const f of filters) {
		const { mode, rows } = readFilters(f);
		if (mode !== "and") continue;
		for (const r of rows) {
			if (r.raw != null || /^(file|formula)\./.test(r.prop)) continue;
			const key = String(r.prop).replace(/^note\./, "");
			if (r.op === "is" || r.op === "on") out[key] = r.value;
			else if (r.op === "=") out[key] = Number(r.value);
			else if (r.op === "checked") out[key] = true;
			else if (r.op === "contains") out[key] = Array.isArray(out[key]) ? [...out[key], r.value] : [r.value];
		}
	}
	return out;
}

// ---- Kanban -----------------------------------------------------------------

// A card moved from lane `from` to lane `to`: the property's new value. A list
// swaps the one value (keeping the others); anything else becomes `to`. The
// "(none)" lane is "".
export function moveValue(old, from, to) {
	if (Array.isArray(old)) {
		const next = old.filter((x) => show(x) !== from);
		if (to !== "" && !next.some((x) => show(x) === to)) next.push(to);
		return next;
	}
	if (to === "") return null;
	if (typeof old === "number" && /^[-+]?\d+(\.\d+)?$/.test(to)) return Number(to);
	if (typeof old === "boolean" && /^(true|false)$/.test(to)) return to === "true";
	return to;
}

// The lanes of a board: values the notes have, in the saved order first,
// then the rest A to Z; "" is notes without a value. A list property puts a
// note in every lane it has a value for.
export function lanesFor(rows, prop, saved = []) {
	const counts = new Map();
	const add = (k) => counts.set(k, (counts.get(k) || 0) + 1);
	for (const r of rows) {
		const v = r.value(prop);
		if (Array.isArray(v)) { if (!v.length) add(""); else new Set(v.map(show)).forEach(add); }
		else add(v == null ? "" : show(v));
	}
	const order = saved.map(String).filter((k, i, a) => a.indexOf(k) === i);
	const rest = [...counts.keys()].filter((k) => !order.includes(k) && k !== "").sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
	const lanes = [...order.filter((k) => k !== ""), ...rest];
	if (counts.has("") || order.includes("")) lanes.unshift("");
	return lanes.map((key) => ({ key, count: counts.get(key) || 0 }));
}

// Which lanes a row is in.
export function laneKeys(row, prop) {
	const v = row.value(prop);
	if (Array.isArray(v)) return v.length ? [...new Set(v.map(show))] : [""];
	return [v == null ? "" : show(v)];
}

// ---- New bases --------------------------------------------------------------

// What "New base" writes: a Grid over the notes in folder (every note when
// folder is empty), as Obsidian lays out a .base. texts, the notes' text,
// pick its columns: the file name, then the properties most of them have.
export function starterBase(folder = "", texts = []) {
	const f = folder.replace(/^\/+|\/+$/g, "");
	const count = new Map();
	for (const t of texts) {
		const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t || "");
		if (!fm) continue;
		for (const m of fm[1].matchAll(/^([A-Za-z_][\w -]*?):/gm)) count.set(m[1], (count.get(m[1]) || 0) + 1);
	}
	count.delete("title");
	const props = [...count].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
	return writeYaml({
		...(f ? { filters: writeSource({ folders: [f], tags: [], rest: [], mode: "and" }) } : {}),
		views: [{ type: "table", name: "Grid", ...(props.length ? { order: ["file.name", ...props] } : {}) }],
	});
}
