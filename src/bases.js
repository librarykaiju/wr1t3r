// Obsidian Bases: a .base file (or a ```base block) is YAML describing views
// of notes, picked by filters and shown with some of their properties:
//
//   filters:                       # every view: all of these must hold
//     and:
//       - file.inFolder("content/logs/books")
//   formulas:
//     pace: pages / length
//   properties:
//     note.pages: { displayName: Pages }
//   views:
//     - type: table                # table, cards or list
//       name: Books
//       filters: { or: [ 'shelf.contains("Finished")', "rating" ] }
//       order: [file.name, author, pages, formula.pace]
//       sort: [{ property: pages, direction: DESC }]
//       groupBy: { property: author, direction: ASC }
//       limit: 50
//       image: note.coverImage     # cards and list
//
// This file reads that YAML, evaluates Bases' expression language over the
// notes' properties and works out each view's rows. It also writes a changed
// property back into a note's frontmatter. No DOM here (see basesview.js).

import { parseFrontmatter } from "./dvpage.js";
import { noteTags } from "./frontmatter.js";
import { noteLinks } from "./vaultlinks.js";
import { resolveNote } from "./links.js";

// ---- YAML -------------------------------------------------------------------

// The block YAML Obsidian writes for .base files: nested maps and lists,
// "- key: value" list items, quoted and plain scalars, [flow, lists] and
// {flow: maps}, | and > text blocks. Not all of YAML (no anchors or tags).
export function parseYaml(text) {
	const raw = text.split(/\r?\n/);
	const lines = [];
	for (let n = 0; n < raw.length; n++) {
		const t = raw[n].replace(/\t/g, "  ");
		const trimmed = t.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed === "---") continue;
		lines.push({ indent: t.length - t.trimStart().length, text: trimmed, n });
	}
	let i = 0;
	const isItem = (l) => l.text === "-" || l.text.startsWith("- ");
	const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'(){}[\],:#&*!|>%@`][^:"'(){}]*?)\s*:(?:\s+(.*)|\s*)$/;

	function node(minIndent) {
		if (i >= lines.length || lines[i].indent < minIndent) return null;
		return isItem(lines[i]) ? seq(lines[i].indent) : map(lines[i].indent);
	}
	function seq(ind) {
		const out = [];
		while (i < lines.length && lines[i].indent === ind && isItem(lines[i])) {
			const l = lines[i];
			const rest = l.text.slice(1).trimStart();
			if (!rest) { i++; out.push(node(ind + 1)); continue; }
			if (KEY.test(rest) && !/^["']/.test(rest)) {
				// "- key: value": a map whose keys line up with this first one.
				const col = l.indent + (l.text.length - rest.length);
				lines[i] = { ...l, indent: col, text: rest };
				out.push(map(col));
				continue;
			}
			i++;
			out.push(scalar(rest));
		}
		return out;
	}
	function map(ind) {
		const out = {};
		while (i < lines.length && lines[i].indent === ind && !isItem(lines[i])) {
			const m = KEY.exec(lines[i].text);
			const at = lines[i];
			i++;
			if (!m) continue;
			const key = unquote(m[1]);
			const v = (m[2] ?? "").replace(/\s+#.*$/, "").trim();
			if (/^[|>][-+]?$/.test(v)) {
				const body = [];
				let n = at.n + 1;
				while (i < lines.length && lines[i].indent > ind) i++;
				const end = i < lines.length ? lines[i].n : raw.length;
				for (; n < end; n++) body.push(raw[n]);
				const cut = Math.min(...body.filter((s) => s.trim()).map((s) => s.length - s.trimStart().length));
				const kept = body.map((s) => s.slice(cut)).join("\n").replace(/\s+$/, "");
				out[key] = v[0] === ">" ? kept.replace(/\n(?!\n)/g, " ") : kept;
			} else if (v) out[key] = scalar(v);
			else if (i < lines.length && (lines[i].indent > ind || (lines[i].indent === ind && isItem(lines[i])))) out[key] = node(lines[i].indent);
			else out[key] = null;
		}
		return out;
	}
	const top = node(0);
	return top ?? {};
}

function unquote(s) {
	if (/^"/.test(s)) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
	if (/^'/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
	return s.trim();
}

// Split on commas outside quotes and brackets.
function splitFlow(s) {
	const out = [];
	let cur = "", depth = 0, q = null;
	for (const ch of s) {
		if (q) { if (ch === q) q = null; }
		else if (ch === '"' || ch === "'") q = ch;
		else if ("[{(".includes(ch)) depth++;
		else if ("]})".includes(ch)) depth--;
		else if (ch === "," && !depth) { out.push(cur); cur = ""; continue; }
		cur += ch;
	}
	if (cur.trim()) out.push(cur);
	return out.map((x) => x.trim());
}

function scalar(v) {
	v = v.trim();
	if (/^"/.test(v) || /^'/.test(v)) return unquote(v);
	v = v.replace(/\s+#.*$/, "");
	if (v === "" || v === "~" || v === "null") return null;
	if (v === "true" || v === "false") return v === "true";
	if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) return Number(v);
	if (/^\[.*\]$/.test(v)) return splitFlow(v.slice(1, -1)).map(scalar);
	if (/^\{.*\}$/.test(v)) {
		const o = {};
		for (const part of splitFlow(v.slice(1, -1))) {
			const m = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:]+?)\s*:\s*(.*)$/.exec(part);
			if (m) o[unquote(m[1])] = scalar(m[2]);
		}
		return o;
	}
	return v;
}

// ---- Values -----------------------------------------------------------------

export class BDate {
	constructor(ms, dateOnly = false) { this.ms = ms; this.dateOnly = dateOnly; }
	valueOf() { return this.ms; }
	toString() { return showDate(this); }
}
export class BLink {
	constructor(path, display) { this.path = path; this.display = display; }
	toString() { return this.display; }
}
export class BImage {
	constructor(src) { this.src = src; }
	toString() { return this.src; }
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
export function toDate(v) {
	if (v instanceof BDate) return v;
	if (typeof v === "number") return new BDate(v);
	const m = DATE.exec(String(v ?? "").trim());
	if (!m) return null;
	const [, y, mo, d, h, mi, s] = m.map((x) => (x == null ? x : Number(x)));
	return new BDate(new Date(y, mo - 1, d, h || 0, mi || 0, s || 0).getTime(), h == null);
}
const pad = (n) => String(n).padStart(2, "0");
export function showDate(d, f) {
	const t = new Date(d.ms);
	if (f) return formatDate(t, f);
	const day = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
	return d.dateOnly ? day : `${day} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}
// Moment-style format strings, the common parts.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function formatDate(t, f) {
	return f.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/g, (tok, lit) => {
		if (lit != null) return lit;
		switch (tok) {
			case "YYYY": return String(t.getFullYear());
			case "YY": return String(t.getFullYear()).slice(-2);
			case "MMMM": return MONTHS[t.getMonth()];
			case "MMM": return MONTHS[t.getMonth()].slice(0, 3);
			case "MM": return pad(t.getMonth() + 1);
			case "M": return String(t.getMonth() + 1);
			case "DD": return pad(t.getDate());
			case "D": return String(t.getDate());
			case "dddd": return DAYS[t.getDay()];
			case "ddd": return DAYS[t.getDay()].slice(0, 3);
			case "HH": return pad(t.getHours());
			case "H": return String(t.getHours());
			case "hh": return pad(t.getHours() % 12 || 12);
			case "h": return String(t.getHours() % 12 || 12);
			case "mm": return pad(t.getMinutes());
			case "ss": return pad(t.getSeconds());
			case "A": return t.getHours() < 12 ? "AM" : "PM";
			case "a": return t.getHours() < 12 ? "am" : "pm";
		}
		return tok;
	});
}

// "1 week", "3d", "-2 hours" -> milliseconds, or null.
const UNIT = { y: 365 * 864e5, M: 30 * 864e5, w: 7 * 864e5, d: 864e5, h: 36e5, m: 6e4, s: 1e3 };
export function duration(s) {
	if (typeof s === "number") return s;
	const m = /^\s*([-+]?\d+(?:\.\d+)?)\s*(years?|y|months?|M|weeks?|w|days?|d|hours?|h|minutes?|min|m|seconds?|sec|s)\s*$/.exec(String(s ?? ""));
	if (!m) return null;
	let u = m[2];
	if (/^mo/.test(u) || u === "M") u = "M";
	else if (/^min/.test(u)) u = "m";
	else if (/^sec/.test(u)) u = "s";
	else u = u[0];
	return Number(m[1]) * UNIT[u];
}
function addToDate(d, ms, sign) {
	const t = new Date(d.ms);
	// Months and years move the calendar, not a fixed number of days.
	return new BDate(t.getTime() + sign * ms, d.dateOnly && ms % 864e5 === 0);
}

// A value as text, for display and for string functions.
export function show(v) {
	if (v == null) return "";
	if (Array.isArray(v)) return v.map(show).join(", ");
	if (v instanceof BDate) return showDate(v);
	if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
	if (typeof v === "object" && !(v instanceof BLink) && !(v instanceof BImage) && !v.__file) return JSON.stringify(v);
	return String(v);
}

const truthy = (v) => (Array.isArray(v) ? v.length > 0 : v instanceof BDate ? true : !!v);
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !(v instanceof BDate) && !(v instanceof BLink) && !v.__file && !Array.isArray(v) && !Object.keys(v).length);

// Comparing two values: numbers, dates (a date string counts as a date next
// to a date), links by path, text without regard to case. Empty sorts last.
export function compare(a, b) {
	if (Array.isArray(a)) a = a[0];
	if (Array.isArray(b)) b = b[0];
	if (a == null || a === "") return b == null || b === "" ? 0 : 1;
	if (b == null || b === "") return -1;
	if (a instanceof BDate || b instanceof BDate) {
		const x = toDate(a), y = toDate(b);
		if (x && y) return x.ms - y.ms;
	}
	if (typeof a === "number" && typeof b === "number") return a - b;
	if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? -1 : 1;
	return show(a).localeCompare(show(b), undefined, { numeric: true, sensitivity: "base" });
}
function equal(a, b) {
	if (a instanceof BLink || b instanceof BLink) return linkKey(a) === linkKey(b);
	if (a instanceof BDate || b instanceof BDate) { const x = toDate(a), y = toDate(b); return !!x && !!y && x.ms === y.ms; }
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
	if (a == null || b == null) return (a ?? null) === (b ?? null);
	if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b) && a !== "" && b !== "";
	return a === b;
}
const linkKey = (v) => (v instanceof BLink ? v.path.toLowerCase() : v && v.__file ? v.path.toLowerCase() : String(v ?? "").replace(/^\[\[|\]\]$/g, "").split("|")[0].toLowerCase());

// ---- Expressions ------------------------------------------------------------

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_\p{L}][\w\p{L}\p{N}]*)|(==|!=|<=|>=|&&|\|\||[-+*/%<>!().,[\]]))/uy;

export class BaseError extends Error {}

function tokenize(src) {
	const out = [];
	TOKEN.lastIndex = 0;
	while (TOKEN.lastIndex < src.length) {
		const at = TOKEN.lastIndex;
		const m = TOKEN.exec(src);
		if (!m) {
			if (!src.slice(at).trim()) break;
			throw new BaseError(`Can't read "${src.slice(at).trim().slice(0, 20)}"`);
		}
		if (m[1] != null) out.push({ t: "num", v: Number(m[1]) });
		else if (m[2] != null) out.push({ t: "str", v: m[2].slice(1, -1).replace(/\\(.)/g, "$1") });
		else if (m[3] != null) out.push({ t: "id", v: m[3] });
		else out.push({ t: "op", v: m[4] });
	}
	return out;
}

const PREC = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };
const parsed = new Map();
export function parseExpr(src) {
	src = String(src ?? "");
	if (parsed.has(src)) return parsed.get(src);
	const ts = tokenize(src);
	let i = 0;
	const peek = () => ts[i];
	const expect = (v) => { if (ts[i]?.v !== v) throw new BaseError(`Expected "${v}" in ${src}`); i++; };
	function args() {
		const out = [];
		if (peek()?.v !== ")") do out.push(expr(0)); while (peek()?.v === "," && ++i);
		expect(")");
		return out;
	}
	function primary() {
		const t = ts[i++];
		if (!t) throw new BaseError(`${src} ends early`);
		let n;
		if (t.t === "num" || t.t === "str") n = { k: "lit", v: t.v };
		else if (t.t === "id") {
			if (t.v === "true" || t.v === "false") n = { k: "lit", v: t.v === "true" };
			else if (t.v === "null") n = { k: "lit", v: null };
			else if (peek()?.v === "(") { i++; n = { k: "fn", name: t.v, args: args() }; }
			else n = { k: "id", name: t.v };
		} else if (t.v === "(") { n = expr(0); expect(")"); }
		else if (t.v === "[") {
			const items = [];
			if (peek()?.v !== "]") do items.push(expr(0)); while (peek()?.v === "," && ++i);
			expect("]");
			n = { k: "list", items };
		} else if (t.v === "!") n = { k: "not", e: unaryOperand() };
		else if (t.v === "-") n = { k: "neg", e: unaryOperand() };
		else throw new BaseError(`Unexpected "${t.v}" in ${src}`);
		return postfix(n);
	}
	function unaryOperand() { return primary(); }
	function postfix(n) {
		for (;;) {
			const t = peek();
			if (t?.v === ".") {
				i++;
				const name = ts[i++];
				if (name?.t !== "id") throw new BaseError(`Expected a name after "." in ${src}`);
				if (peek()?.v === "(") { i++; n = { k: "call", obj: n, name: name.v, args: args() }; }
				else n = { k: "get", obj: n, name: name.v };
			} else if (t?.v === "[") {
				i++;
				const key = expr(0);
				expect("]");
				n = { k: "index", obj: n, key };
			} else return n;
		}
	}
	function expr(min) {
		let left = primary();
		for (;;) {
			const t = peek();
			const p = t?.t === "op" ? PREC[t.v] : undefined;
			if (p === undefined || p <= min) return left;
			i++;
			left = { k: "bin", op: t.v, a: left, b: expr(p) };
		}
	}
	const tree = expr(0);
	if (i < ts.length) throw new BaseError(`Unexpected "${ts[i].v}" in ${src}`);
	parsed.set(src, tree);
	return tree;
}

// A note as expressions see it.
// ctx: { note: {props}, file: fileObj, formulas: {name: src}, formulaCache, this: fileObj|null, host }
function evaluate(n, ctx) {
	switch (n.k) {
		case "lit": return n.v;
		case "list": return n.items.map((x) => evaluate(x, ctx));
		case "id":
			if (n.name === "file") return ctx.file;
			if (n.name === "note") return ctx.file?.properties ?? {};
			if (n.name === "formula") return { __formulas: ctx };
			if (n.name === "this") return ctx.this ?? null;
			return prop(ctx.file?.properties, n.name);
		case "not": return !truthy(evaluate(n.e, ctx));
		case "neg": return -num(evaluate(n.e, ctx));
		case "get": return getMember(evaluate(n.obj, ctx), n.name, ctx);
		case "index": {
			const o = evaluate(n.obj, ctx), k = evaluate(n.key, ctx);
			if (Array.isArray(o)) return o[k < 0 ? o.length + k : k] ?? null;
			return getMember(o, show(k), ctx);
		}
		case "bin": return binary(n, ctx);
		case "fn": return callFunction(n.name, n.args, ctx);
		case "call": return callMethod(evaluate(n.obj, ctx), n.name, n.args.map((a) => evaluate(a, ctx)), ctx, n);
	}
	throw new BaseError("Can't work that out");
}

// A property by name, ignoring case like Obsidian's property names.
function prop(props, name) {
	if (!props) return null;
	if (name in props) return props[name];
	const lower = name.toLowerCase();
	for (const k of Object.keys(props)) if (k.toLowerCase() === lower) return props[k];
	return null;
}

function num(v) {
	if (Array.isArray(v)) v = v[0];
	if (v instanceof BDate) return v.ms;
	if (typeof v === "number") return v;
	if (typeof v === "boolean") return v ? 1 : 0;
	const n = Number(String(v ?? "").trim());
	return v == null || v === "" || Number.isNaN(n) ? null : n;
}

function binary(n, ctx) {
	if (n.op === "&&") { const a = evaluate(n.a, ctx); return truthy(a) ? evaluate(n.b, ctx) : a; }
	if (n.op === "||") { const a = evaluate(n.a, ctx); return truthy(a) ? a : evaluate(n.b, ctx); }
	const a = evaluate(n.a, ctx), b = evaluate(n.b, ctx);
	switch (n.op) {
		case "==": return equal(a, b);
		case "!=": return !equal(a, b);
		case "<": return a != null && b != null && compare(a, b) < 0;
		case ">": return a != null && b != null && compare(a, b) > 0;
		case "<=": return a != null && b != null && compare(a, b) <= 0;
		case ">=": return a != null && b != null && compare(a, b) >= 0;
	}
	// Dates and durations.
	if (a instanceof BDate && (n.op === "+" || n.op === "-")) {
		if (n.op === "-" && (b instanceof BDate || toDate(b))) return a.ms - toDate(b).ms;
		const ms = duration(b);
		if (ms != null) return addToDate(a, ms, n.op === "+" ? 1 : -1);
	}
	if (n.op === "+" && (typeof a === "string" || typeof b === "string") && (num(a) == null || num(b) == null)) return show(a) + show(b);
	if (n.op === "+" && Array.isArray(a)) return [...a, ...(Array.isArray(b) ? b : [b])];
	const x = num(a), y = num(b);
	if (x == null || y == null) return null;
	switch (n.op) {
		case "+": return x + y;
		case "-": return x - y;
		case "*": return x * y;
		case "/": return y === 0 ? null : x / y;
		case "%": return y === 0 ? null : x % y;
	}
	return null;
}

function formulaValue(ctx, name) {
	const src = ctx.formulas?.[name];
	if (src == null) return null;
	const cache = (ctx.formulaCache ??= new Map());
	if (cache.has(name)) return cache.get(name);
	cache.set(name, null); // a formula that needs itself gets nothing
	let v = null;
	try { v = evaluate(parseExpr(String(src)), ctx); } catch (e) { v = new BaseError(e.message); }
	cache.set(name, v);
	return v;
}

function getMember(o, name, ctx) {
	if (o == null) return null;
	if (o.__formulas) return formulaValue(o.__formulas, name);
	if (Array.isArray(o)) return name === "length" ? o.length : null;
	if (o instanceof BDate) {
		const t = new Date(o.ms);
		switch (name) {
			case "year": return t.getFullYear();
			case "month": return t.getMonth() + 1;
			case "day": return t.getDate();
			case "hour": return t.getHours();
			case "minute": return t.getMinutes();
			case "second": return t.getSeconds();
			case "millisecond": return t.getMilliseconds();
		}
		return null;
	}
	if (typeof o === "string") return name === "length" ? o.length : null;
	if (o instanceof BLink) return null;
	if (typeof o === "object") return name in o ? o[name] : prop(o, name);
	return null;
}

function toList(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }
const lower = (v) => show(v).toLowerCase();

function callFunction(name, argNodes, ctx) {
	const arg = (k) => (argNodes[k] ? evaluate(argNodes[k], ctx) : undefined);
	switch (name) {
		case "if": return truthy(arg(0)) ? arg(1) : argNodes.length > 2 ? arg(2) : null;
		case "now": return new BDate(Date.now());
		case "today": { const t = new Date(); return new BDate(new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime(), true); }
		case "date": return toDate(arg(0));
		case "duration": return duration(arg(0));
		case "number": return num(arg(0));
		case "string": return show(arg(0));
		case "list": { const v = arg(0); return Array.isArray(v) ? v : v == null ? [] : [v]; }
		case "link": { const v = arg(0); const path = v?.__file ? v.path : resolveIn(ctx, show(v)); return new BLink(path || show(v), argNodes.length > 1 ? show(arg(1)) : show(v?.__file ? v.name : v).replace(/\.md$/i, "")); }
		case "file": { const v = arg(0); const path = v instanceof BLink ? v.path : resolveIn(ctx, show(v)); return path ? ctx.fileFor?.(path) ?? null : null; }
		case "image": return new BImage(show(arg(0)));
		case "icon": return show(arg(0));
		case "max": { const xs = argNodes.map((_, k) => num(arg(k))).filter((x) => x != null); return xs.length ? Math.max(...xs) : null; }
		case "min": { const xs = argNodes.map((_, k) => num(arg(k))).filter((x) => x != null); return xs.length ? Math.min(...xs) : null; }
		case "escapeHTML": return show(arg(0));
	}
	throw new BaseError(`Unknown function ${name}()`);
}

function resolveIn(ctx, name) {
	const n = name.replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0];
	return ctx.resolve ? ctx.resolve(n) : null;
}

function callMethod(o, name, a, ctx, node) {
	// Methods any value has.
	switch (name) {
		case "isEmpty": return isEmpty(o);
		case "isTruthy": return truthy(o);
		case "toString": return show(o);
		case "isType": {
			const t = String(a[0] ?? "").toLowerCase();
			const is = o == null ? "null" : Array.isArray(o) ? "list" : o instanceof BDate ? "date" : o instanceof BLink ? "link" : o?.__file ? "file" : typeof o === "object" ? "object" : typeof o;
			return is === t;
		}
	}
	if (o?.__file) {
		const f = o;
		switch (name) {
			case "hasTag": return a.some((t) => { const want = String(t).replace(/^#/, "").toLowerCase(); return f.tags.some((x) => x.toLowerCase() === want || x.toLowerCase().startsWith(want + "/")); });
			case "inFolder": { const want = String(a[0] ?? "").replace(/^\/+|\/+$/g, "").toLowerCase(); return !want || f.folder.toLowerCase() === want || f.folder.toLowerCase().startsWith(want + "/"); }
			case "hasLink": { const want = a[0]?.__file ? a[0].path : a[0] instanceof BLink ? a[0].path : resolveIn(ctx, show(a[0])); return !!want && f.links.some((l) => l.path === want); }
			case "hasProperty": return prop(f.properties, String(a[0])) !== null || Object.keys(f.properties).some((k) => k.toLowerCase() === String(a[0]).toLowerCase());
			case "asLink": return new BLink(f.path, a.length ? show(a[0]) : f.name);
		}
	}
	if (o instanceof BLink && name === "linksTo") { const want = a[0]?.__file ? a[0].path : show(a[0]); return linkKey(o) === want.toLowerCase(); }
	if (o instanceof BDate) {
		switch (name) {
			case "format": return showDate(o, String(a[0] ?? "YYYY-MM-DD"));
			case "date": return new BDate(new Date(new Date(o.ms).toDateString()).getTime(), true);
			case "time": return showDate(o, "HH:mm:ss");
			case "relative": return relative(o);
			case "isEmpty": return false;
		}
	}
	if (Array.isArray(o)) {
		const tags = o === ctx.file?.tags;
		const has = (x) => o.some((y) => (tags ? lower(y).replace(/^#/, "") === lower(x).replace(/^#/, "") : equal(y, x) || linkKey(y) === linkKey(x) && linkKey(x) !== ""));
		switch (name) {
			case "contains": return has(a[0]);
			case "containsAll": return a.every(has);
			case "containsAny": return a.some(has);
			case "join": return o.map(show).join(a[0] ?? ", ");
			case "reverse": return [...o].reverse();
			case "sort": return [...o].sort(compare);
			case "unique": return o.filter((x, k) => o.findIndex((y) => equal(x, y)) === k);
			case "flat": return o.flat(Infinity);
			case "slice": return o.slice(a[0], a[1]);
			case "length": return o.length;
			case "filter": case "map": {
				const fn = node.args[0];
				const out = o.map((value, index) => evaluate(fn, { ...ctx, file: { ...ctx.file, properties: { ...(ctx.file?.properties ?? {}), value, index } } }));
				return name === "map" ? out : o.filter((_, k) => truthy(out[k]));
			}
		}
	}
	if (typeof o === "number") {
		switch (name) {
			case "round": { const p = 10 ** (a[0] ?? 0); return Math.round(o * p) / p; }
			case "ceil": return Math.ceil(o);
			case "floor": return Math.floor(o);
			case "abs": return Math.abs(o);
			case "toFixed": return o.toFixed(a[0] ?? 0);
		}
	}
	// Text methods (anything else is treated as its text).
	const s = show(o);
	switch (name) {
		case "contains": return s.toLowerCase().includes(show(a[0]).toLowerCase());
		case "containsAll": return a.every((x) => s.toLowerCase().includes(show(x).toLowerCase()));
		case "containsAny": return a.some((x) => s.toLowerCase().includes(show(x).toLowerCase()));
		case "startsWith": return s.toLowerCase().startsWith(show(a[0]).toLowerCase());
		case "endsWith": return s.toLowerCase().endsWith(show(a[0]).toLowerCase());
		case "lower": return s.toLowerCase();
		case "upper": return s.toUpperCase();
		case "title": return s.replace(/\p{L}[\p{L}'’]*/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
		case "trim": return s.trim();
		case "replace": return s.split(show(a[0])).join(show(a[1]));
		case "split": return s.split(show(a[0]));
		case "slice": return s.slice(a[0], a[1]);
		case "repeat": return s.repeat(Math.max(0, num(a[0]) || 0));
		case "reverse": return [...s].reverse().join("");
		case "length": return s.length;
	}
	throw new BaseError(`Unknown method ${name}()`);
}

function relative(d) {
	const diff = d.ms - Date.now(), abs = Math.abs(diff);
	const units = [["year", 365 * 864e5], ["month", 30 * 864e5], ["week", 7 * 864e5], ["day", 864e5], ["hour", 36e5], ["minute", 6e4]];
	for (const [u, ms] of units) {
		if (abs >= ms) { const n = Math.round(abs / ms); return diff < 0 ? `${n} ${u}${n === 1 ? "" : "s"} ago` : `in ${n} ${u}${n === 1 ? "" : "s"}`; }
	}
	return "just now";
}

// ---- Files ------------------------------------------------------------------

const fileCache = new Map(); // path -> { text, paths, file }

// What expressions see as `file` (and `note`, its properties) for one note.
export function fileFor(path, text, paths) {
	const hit = fileCache.get(path);
	if (hit && hit.text === text && hit.paths === paths) return hit.file;
	const properties = {};
	for (const [k, v] of Object.entries(parseFrontmatter(text))) properties[k] = typed(v);
	const slash = path.lastIndexOf("/");
	const base = path.slice(slash + 1);
	const dot = base.lastIndexOf(".");
	const links = [];
	for (const l of noteLinks(text)) {
		if (!l.note) continue;
		const p = resolveNote({ note: l.note, wiki: l.kind === "wiki" }, path, paths);
		if (p && !links.some((x) => x.path === p)) links.push(new BLink(p, p.split("/").pop().replace(/\.md$/i, "")));
	}
	const file = {
		__file: true,
		path,
		name: dot > 0 ? base.slice(0, dot) : base,
		basename: dot > 0 ? base.slice(0, dot) : base,
		ext: dot > 0 ? base.slice(dot + 1) : "",
		folder: slash > 0 ? path.slice(0, slash) : "",
		size: new TextEncoder().encode(text).length,
		ctime: null,
		mtime: null,
		tags: [...new Set(noteTags(text))],
		links,
		properties,
	};
	file.file = file;
	fileCache.set(path, { text, paths, file });
	return file;
}
// Date strings become dates; everything else stays as YAML gave it.
function typed(v) {
	if (Array.isArray(v)) return v.map(typed);
	if (typeof v === "string" && DATE.test(v.trim())) return toDate(v);
	return v;
}

// ---- Running a base ---------------------------------------------------------

// Does a filter (a string, or { and | or | not: [...] }) hold for this note?
export function passes(filter, ctx) {
	if (filter == null) return true;
	if (typeof filter === "string" || typeof filter === "boolean" || typeof filter === "number") {
		if (typeof filter !== "string") return truthy(filter);
		return truthy(evaluate(parseExpr(filter), ctx));
	}
	if (Array.isArray(filter)) return filter.every((f) => passes(f, ctx));
	if (filter.and) return toList(filter.and).every((f) => passes(f, ctx));
	if (filter.or) return toList(filter.or).some((f) => passes(f, ctx));
	if (filter.not) return !toList(filter.not).some((f) => passes(f, ctx));
	return true;
}

// "note.x" | "x" | "file.name" | "formula.y" -> its value for one note.
export function propertyValue(id, ctx) {
	const [head, ...rest] = String(id).split(".");
	if (head === "formula" && rest.length) return formulaValue(ctx, rest.join("."));
	if (head === "file" && rest.length) {
		const k = rest.join(".");
		if (k === "name") return new BLink(ctx.file.path, ctx.file.name);
		return getMember(ctx.file, k, ctx);
	}
	if (head === "note" && rest.length) return prop(ctx.file.properties, rest.join("."));
	return prop(ctx.file.properties, String(id));
}

// Where a note property lives in the frontmatter (null for file. and formula. ids).
export const noteKey = (id) => {
	const s = String(id);
	if (/^(file|formula)\./.test(s)) return null;
	return s.replace(/^note\./, "");
};

export function displayName(id, base) {
	const p = base.properties?.[id] ?? base.properties?.[noteKey(id) ?? ""] ?? base.properties?.["note." + id];
	if (p?.displayName) return String(p.displayName);
	const s = String(id);
	if (s === "file.name") return "file name";
	if (s.startsWith("file.")) return "file " + s.slice(5);
	return s.replace(/^(note|formula)\./, "");
}

// The base's YAML -> { views, filters, formulas, properties } or throws.
export function readBase(text) {
	const cfg = parseYaml(text);
	if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new BaseError("This base isn't YAML Obsidian would read.");
	const views = Array.isArray(cfg.views) && cfg.views.length ? cfg.views : [{ type: "table", name: "Table" }];
	return { ...cfg, views: views.map((v, i) => ({ ...v, type: String(v?.type || "table"), name: String(v?.name || `View ${i + 1}`) })) };
}

// Work out one view: { columns: [id], names: [label], groups: [{ key, rows }], total }
// where each row is { path, file, values: [value per column] }. `files` is
// [{ path, text }] of every note; thisFile is the note showing the base.
export function runView(base, viewIndex, files, { thisPath = null, sortBy = null, resolve = null } = {}) {
	const view = base.views[viewIndex] ?? base.views[0];
	const paths = files.map((f) => f.path);
	const byPath = new Map(files.map((f) => [f.path, f]));
	const fileOf = (p) => { const f = byPath.get(p); return f ? fileFor(p, f.text, paths) : null; };
	const thisFile = thisPath ? fileOf(thisPath) : null;
	const columns = toList(view.order).map(String);
	if (!columns.length) columns.push("file.name");
	const rows = [];
	const errors = new Set();
	for (const f of files) {
		if (!/\.md$/i.test(f.path)) continue;
		const file = fileFor(f.path, f.text, paths);
		const ctx = { file, formulas: base.formulas || {}, this: thisFile, resolve: (n) => resolve?.(n, f.path) ?? resolveNote({ note: n, wiki: true }, f.path, paths), fileFor: fileOf };
		try {
			if (!passes(base.filters, ctx) || !passes(view.filters, ctx)) continue;
		} catch (e) { errors.add(e.message); continue; }
		const value = (id) => { try { const v = propertyValue(id, ctx); return v instanceof BaseError ? (errors.add(v.message), null) : v; } catch (e) { errors.add(e.message); return null; } };
		rows.push({ path: f.path, file, value, values: columns.map(value) });
	}
	const sorts = sortBy ? [sortBy] : toList(view.sort).filter((s) => s && s.property);
	if (sorts.length) {
		rows.sort((a, b) => {
			for (const s of sorts) {
				const x = a.value(String(s.property)), y = b.value(String(s.property));
				const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);
				if (empty(x) || empty(y)) { if (empty(x) !== empty(y)) return empty(x) ? 1 : -1; continue; }
				const c = compare(x, y);
				if (c) return String(s.direction).toUpperCase() === "DESC" ? -c : c;
			}
			return 0;
		});
	}
	const limited = view.limit > 0 ? rows.slice(0, Number(view.limit)) : rows;
	let groups = [{ key: null, rows: limited }];
	const g = view.groupBy && (typeof view.groupBy === "string" ? { property: view.groupBy } : view.groupBy);
	if (g?.property) {
		const map = new Map();
		for (const r of limited) {
			const v = r.value(String(g.property));
			const key = show(v);
			if (!map.has(key)) map.set(key, { key, value: v, rows: [] });
			map.get(key).rows.push(r);
		}
		groups = [...map.values()].sort((a, b) => {
			const c = compare(a.value, b.value);
			return String(g.direction).toUpperCase() === "DESC" ? -c : c;
		});
	}
	return { view, columns, names: columns.map((c) => displayName(c, base)), groups, total: rows.length, errors: [...errors] };
}

// ---- Writing a property -----------------------------------------------------

// Text that YAML would read as something else (a number, true, a list...) is quoted.
const quoteIfNeeded = (s) => (/^[\s\-?:,\[\]{}#&*!|>'"%@`]|: | #|\s$|^(true|false|null|~|yes|no)$/i.test(s) || /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? JSON.stringify(s) : s);

// A value as YAML text after "key:" (with its leading space, or "" for empty).
function yamlValue(v, shape, nl) {
	if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "";
	if (Array.isArray(v)) {
		const items = v.map((x) => (typeof x === "string" ? quoteIfNeeded(x) : show(x)));
		if (shape.flow) return " [" + items.map((x) => (/[,\[\]{}]/.test(x) && !/^"/.test(x) ? JSON.stringify(x) : x)).join(", ") + "]";
		return items.map((x) => nl + shape.indent + "- " + x).join("");
	}
	if (v instanceof BDate) return " " + showDate(v);
	if (typeof v === "string") return " " + quoteIfNeeded(v);
	return " " + show(v);
}

// The note's text with property `key` set to value (null clears it): only
// that property's lines change; a missing key goes at the end of the
// frontmatter, and a note without frontmatter gets some.
export function setProperty(text, key, value) {
	const nl = text.includes("\r\n") ? "\r\n" : "\n";
	const lines = text.split(/\r?\n/);
	const hasFm = /^---[ \t]*$/.test(lines[0] ?? "");
	let close = -1;
	if (hasFm) for (let n = 1; n < lines.length; n++) if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[n])) { close = n; break; }
	const keyText = /^[\w\p{L}][\w\p{L} .-]*$/u.test(key) ? key : JSON.stringify(key);
	if (close < 0) {
		const shape = { indent: "  ", flow: false };
		return ["---", keyText + ":" + yamlValue(value, shape, "\n"), "---"].join(nl) + nl + text;
	}
	let at = -1;
	for (let n = 1; n < close; n++) {
		const m = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#-][^:]*?)\s*:(\s|$)/.exec(lines[n]);
		if (m && unquote(m[1]).toLowerCase() === key.toLowerCase()) { at = n; break; }
	}
	if (at < 0) {
		lines.splice(close, 0, keyText + ":" + yamlValue(value, { indent: "  ", flow: false }, nl));
		return lines.join(nl);
	}
	let end = at + 1;
	while (end < close && (/^\s+\S/.test(lines[end]) || /^-\s/.test(lines[end]) || !lines[end].trim())) end++;
	while (end > at + 1 && !lines[end - 1].trim()) end--;
	const head = lines[at].slice(0, lines[at].indexOf(":") + 1);
	const old = lines[at].slice(head.length).trim();
	const item = lines.slice(at + 1, end).find((l) => /^\s*-\s/.test(l));
	const shape = { flow: /^\[/.test(old), indent: item ? item.match(/^\s*/)[0] : "  " };
	lines.splice(at, end - at, head + yamlValue(value, shape, nl));
	return lines.join(nl);
}

// What someone typed into a cell -> a value shaped like the old one.
export function parseInput(input, old) {
	const s = input.trim();
	if (Array.isArray(old)) return s ? s.split(",").map((x) => x.trim()).filter(Boolean).map((x) => (/^[-+]?\d+(\.\d+)?$/.test(x) ? Number(x) : x)) : [];
	if (!s) return null;
	if (typeof old === "number" || old == null) { if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s); }
	if (old instanceof BDate) { const d = toDate(s); if (d) return d; }
	if (typeof old === "boolean" && /^(true|false)$/i.test(s)) return /^true$/i.test(s);
	return s;
}
