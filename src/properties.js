// The properties box's model (src/frontmatter.js draws it): a note's
// top-level properties as rows, each with a type, and the edits that change
// them. Every edit rewrites only the lines of the property it's about, so the
// rest of the frontmatter (other keys, their order, comments) stays as typed.
//
// Types, as Obsidian names them: text, list, number, checkbox, date,
// datetime, plus tags (the tags property, always) and yaml (anything the box
// can't edit: nested maps, multi-line strings, Templater code; edited as text
// through the box's </> button). A type chosen from a property's menu applies
// to that name in every note (types: { key: type }); without one, the type is
// read from the value.

export const TYPES = ["text", "list", "number", "checkbox", "date", "datetime"];
export const TYPE_LABELS = { text: "Text", list: "List", number: "Number", checkbox: "Checkbox", date: "Date", datetime: "Date & time", tags: "Tags", yaml: "YAML" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?$/;
const NUMBER = /^-?(\d+\.?\d*|\.\d+)$/;
const BOOL = /^(true|false)$/i;
export const DATE_KEY = /(^|[_ -])(date|day|created|updated|modified|due|published|start|end)([_ -]|$)|date$/i;
const KEY_LINE = /^([^\s#\-][^:]*?)[ \t]*:(?:[ \t]+(.*?)|[ \t]*)$/;
export const isTagsKey = (key) => /^tags?$/.test(key);

// A YAML scalar as written -> { value, quote }.
export function unquote(raw) {
	const r = raw.trim();
	if (/^".*"$/.test(r)) { try { return { value: JSON.parse(r), quote: '"' }; } catch { return { value: r.slice(1, -1), quote: '"' }; } }
	if (/^'.*'$/.test(r)) return { value: r.slice(1, -1).replace(/''/g, "'"), quote: "'" };
	return { value: r, quote: "" };
}

// A text value as YAML, in the quotes it had, or in double quotes when bare
// text would read as something else (a number, true/false, a date, a list...).
export function scalarText(value, quote = "", type = "text") {
	if (value === "") return quote ? quote + quote : "";
	if (quote === "'") return "'" + value.replace(/'/g, "''") + "'";
	if (quote === '"') return JSON.stringify(value);
	const special = /^[\s\-?:,\[\]{}#&*!|>'"%@`]|: | #|\s$/.test(value);
	const misread = type === "text" && (BOOL.test(value) || NUMBER.test(value) || DATE.test(value) || DATETIME.test(value) || /^(null|~|yes|no|on|off)$/i.test(value));
	return special || misread ? JSON.stringify(value) : value;
}

// A list item as YAML (flow: inside [a, b], where commas need quotes too).
export function itemText(text, flow = false) {
	return /^[\s\-?:,\[\]{}#&*!|>'"%@`]|: | #|\s$/.test(text) || (flow && /[,\[\]{}]/.test(text)) ? JSON.stringify(text) : text;
}

// "a, 'b, c', "d"" -> ["a", " 'b, c'", ' "d"'].
function splitFlow(text) {
	const out = [];
	let cur = "", q = null;
	for (const ch of text) {
		if (q) { if (ch === q) q = null; cur += ch; }
		else if (ch === '"' || ch === "'") { q = ch; cur += ch; }
		else if (ch === ",") { out.push(cur); cur = ""; }
		else cur += ch;
	}
	out.push(cur);
	return out;
}
const cleanItem = (t) => unquote(t).value.trim();
const cleanTag = (t) => cleanItem(t).replace(/^#/, "").trim();

// The note's properties: [{ key, first, last, from, to, raw, kind, value,
// quote, items, form, indent, type, inferred, mismatch }]. first/last are line
// numbers, from/to the offsets of the whole property (its first line's start
// to its last line's end). kind: "scalar", "list" (block "- " items, or flow
// [a, b]) or "yaml". doc: a CodeMirror Text; fm: { open, close } line numbers.
export function readRows(doc, fm, types = {}) {
	const rows = [];
	for (let n = fm.open + 1; n < fm.close; n++) {
		const line = doc.line(n);
		const m = line.text.match(KEY_LINE);
		if (!m) continue;
		const key = m[1], raw = m[2] || "";
		let last = n;
		while (last + 1 < fm.close && (/^\s/.test(doc.line(last + 1).text) || /^-(\s|$)/.test(doc.line(last + 1).text) || !doc.line(last + 1).text.trim())) last++;
		while (last > n && !doc.line(last).text.trim()) last--;
		const kids = [];
		for (let i = n + 1; i <= last; i++) kids.push(doc.line(i).text);
		const row = { key, first: n, last, from: line.from, to: doc.line(last).to, raw, kind: "scalar", value: "", quote: "", items: [], form: null, indent: "  " };
		const tags = isTagsKey(key);
		if (raw.includes("<%") || kids.some((k) => k.includes("<%"))) row.kind = "yaml";
		else if (kids.length) {
			const items = kids.filter((k) => k.trim()).map((k) => k.match(/^(\s*)-(?:\s+(.*))?$/));
			if (!raw && items.every(Boolean)) {
				row.kind = "list"; row.form = "block"; row.indent = items[0]?.[1] ?? "  ";
				row.items = items.map((x) => (tags ? cleanTag : cleanItem)(x[2] || "")).filter(Boolean);
			} else row.kind = "yaml";
		} else if (/^\[.*\]$/.test(raw.trim())) {
			row.kind = "list"; row.form = "flow";
			const inner = raw.trim().slice(1, -1);
			row.items = inner.trim() ? splitFlow(inner).map(tags ? cleanTag : cleanItem).filter(Boolean) : [];
		} else if (/^[|>{&*!]/.test(raw.trim())) row.kind = "yaml";
		else if (tags && raw.trim()) {
			// tags: a, b  or  tags: a b
			row.kind = "list"; row.form = raw.includes(",") ? "comma" : "space";
			row.items = (raw.includes(",") ? splitFlow(raw) : raw.split(/\s+/)).map(cleanTag).filter(Boolean);
		} else Object.assign(row, unquote(raw));
		row.inferred = tags ? "tags" : inferType(row);
		row.type = tags || row.kind === "yaml" ? row.inferred : chooseType(row, types[key]);
		row.mismatch = !!types[key] && !tags && row.kind !== "yaml" && !fits(row, types[key]);
		rows.push(row);
		n = last;
	}
	return rows;
}

function inferType(row) {
	if (row.kind === "yaml") return "yaml";
	if (row.kind === "list") return "list";
	const v = row.value;
	if (!row.quote && BOOL.test(v)) return "checkbox";
	if (DATE.test(v)) return "date";
	if (DATETIME.test(v)) return "datetime";
	if (!row.quote && NUMBER.test(v)) return "number";
	if (!v && DATE_KEY.test(row.key)) return "date";
	return "text";
}

// Whether a property's value can be shown as type.
function fits(row, type) {
	if (row.kind === "yaml") return false;
	if (type === "list") return true; // a single value shows as one item
	if (row.kind === "list") return false;
	const v = row.value;
	if (!v) return true;
	if (type === "checkbox") return BOOL.test(v);
	if (type === "number") return NUMBER.test(v);
	if (type === "date") return DATE.test(v);
	if (type === "datetime") return DATETIME.test(v) || DATE.test(v);
	return true;
}
const chooseType = (row, chosen) => (chosen && TYPES.includes(chosen) && fits(row, chosen) ? chosen : row.inferred);

// A row's values as a list (a scalar is one item, split at commas for text).
export function itemsOf(row) {
	if (row.kind === "list") return row.items;
	if (!row.value) return [];
	return row.inferred === "text" ? row.value.split(/\s*,\s*/).filter(Boolean) : [row.value];
}

// The property's lines rewritten as type with value (a string, a boolean for
// checkboxes, an array for lists). Keeps the row's quotes and list form.
export function rowText(row, type, value) {
	const k = row.key + ":";
	if (type === "list" || type === "tags") {
		const items = value;
		if (row.form === "flow") return `${k} [${items.map((x) => itemText(x, true)).join(", ")}]`;
		if (row.form === "comma") return items.length ? `${k} ${items.join(", ")}` : k;
		if (row.form === "space") return items.length ? `${k} ${items.join(" ")}` : k;
		return [k, ...items.map((x) => `${row.indent || "  "}- ${itemText(x)}`)].join("\n");
	}
	if (type === "checkbox") {
		const word = value ? "true" : "false";
		const v = row.value || "";
		return `${k} ${/^[A-Z]{2}/.test(v) ? word.toUpperCase() : /^[A-Z]/.test(v) ? word[0].toUpperCase() + word.slice(1) : word}`;
	}
	let v = String(value ?? "");
	if (type === "datetime" && v) {
		if (/^\d{4}-\d{2}-\d{2} /.test(row.value)) v = v.replace("T", " ");
		if (/:\d{2}:\d{2}$/.test(row.value) && /T?\d{2}:\d{2}$/.test(v) && !/:\d{2}:\d{2}$/.test(v)) v += ":00";
	}
	if (type === "number") return v ? `${k} ${NUMBER.test(v) ? v : JSON.stringify(v)}` : k;
	if (type === "date" || type === "datetime") return v || row.quote ? `${k} ${row.quote}${v}${row.quote}` : k;
	const text = scalarText(v, row.quote, "text");
	return text ? `${k} ${text}` : k;
}

// The change that sets a row's value: { from, to, insert }.
export const setEdit = (row, value) => ({ from: row.from, to: row.to, insert: rowText(row, row.type, value) });

// The change that converts a row to another type, carrying its value over:
// text "a, b" -> list [a, b]; a list -> text "a, b"; anything -> a checkbox
// (true when it read as yes); dates keep what fits.
export function convertEdit(row, type) {
	const items = itemsOf(row);
	const one = row.kind === "list" ? items.join(", ") : row.value;
	let value;
	if (type === "list") value = items;
	else if (type === "checkbox") value = /^(true|yes|y|1|on|x|done)$/i.test(one.trim());
	else if (type === "number") value = NUMBER.test(one.trim()) ? one.trim() : "";
	else if (type === "date") value = DATE.test(one) ? one : DATETIME.test(one) ? one.slice(0, 10) : one;
	else if (type === "datetime") value = DATETIME.test(one) ? one : DATE.test(one) ? one + "T00:00" : one;
	else value = one;
	const shaped = { ...row, form: type === "list" && row.form !== "flow" ? "block" : row.form, quote: type === "text" && row.inferred !== "text" ? "" : row.quote };
	if (type !== "list" && row.kind === "list") shaped.quote = "";
	if (type === "checkbox" && !BOOL.test(row.value)) shaped.value = "";
	return { from: row.from, to: row.to, insert: rowText(shaped, type, value) };
}

// The change that removes a property (its lines and their line break).
export function removeEdit(doc, row) {
	const end = doc.line(row.last);
	return { from: row.from, to: Math.min(end.to + 1, doc.length), insert: "" };
}

// The change that renames a property.
export function renameEdit(doc, row, key) {
	const line = doc.line(row.first);
	return { from: line.from, to: line.from + line.text.indexOf(":"), insert: key };
}

// A property's first text for a new property of type.
export function newRowText(key, type) {
	if (type === "checkbox") return `${key}: false`;
	return `${key}:`;
}

// The change that adds a property: above the closing fence, or as a new
// frontmatter block at the top of a note without one.
export function addEdit(doc, fm, key, type) {
	const text = newRowText(key, type);
	if (fm) return { from: doc.line(fm.close).from, to: doc.line(fm.close).from, insert: text + "\n" };
	return { from: 0, to: 0, insert: "---\n" + text + "\n---\n" };
}

// Whether key can be a new property's name in a note that has these rows.
export function keyProblem(key, rows, except = null) {
	if (!key) return "Give it a name";
	if (/[:\n]|^[\s#\-]|\s$/.test(key)) return "Names can't have a colon or start with a space, # or -";
	if (rows.some((r) => r.key === key && r.key !== except)) return `This note already has “${key}”`;
	return null;
}

// The property types note (_wr1t3r/Property Types.md): its ```json block ->
// { key: type }, and back.
export function readTypes(text) {
	const m = (text || "").match(/```json[ \t]*\n([\s\S]*?)\n```/);
	if (!m) return {};
	try {
		const out = {};
		for (const [k, v] of Object.entries(JSON.parse(m[1]) || {})) if (TYPES.includes(v)) out[k] = v;
		return out;
	} catch { return {}; }
}
export function writeTypes(text, types) {
	const sorted = Object.fromEntries(Object.entries(types).sort(([a], [b]) => a.localeCompare(b)));
	const block = "```json\n" + JSON.stringify(sorted, null, "\t") + "\n```";
	if (text && /```json[ \t]*\n[\s\S]*?\n```/.test(text)) return text.replace(/```json[ \t]*\n[\s\S]*?\n```/, block);
	return "Property types for wr1t3r's properties box: each property name and its type (text, list, number, checkbox, date or datetime), the same in every note. Change them from a property's name in the box.\n\n" + block + "\n";
}

// Properties most notes keep as lists (`subjects:` then "- Games" lines, or
// [a, b]), as { name: "list" }. A note whose property is still empty takes
// this as its type, so a value typed into it is saved as a list too, the way
// the rest of the vault has it.
export function listKeys(texts) {
	const count = new Map(); // key -> [lists, scalars]
	for (const text of texts) {
		const fm = text?.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/)?.[1];
		if (!fm) continue;
		const lines = fm.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const m = lines[i].match(/^([^\s#:][^:]*?):[ \t]*(.*)$/);
			if (!m) continue;
			const value = m[2].replace(/\s+#.*$/, "").trim();
			let list;
			if (value.startsWith("[")) list = value !== "[]";
			else if (value) list = false;
			else if (/^\s*- /.test(lines[i + 1] || "")) list = true;
			else continue; // empty: says nothing
			const c = count.get(m[1]) || [0, 0];
			c[list ? 0 : 1]++;
			count.set(m[1], c);
		}
	}
	const out = {};
	for (const [key, [lists, scalars]] of count) if (lists > scalars) out[key] = "list";
	return out;
}
