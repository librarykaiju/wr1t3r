// Dataview's query language (```dataview blocks): LIST, TABLE and TASK
// queries with FROM, WHERE, SORT, GROUP BY, FLATTEN and LIMIT, over the page
// objects of src/dvpage.js. It's an interpreter for the query text, so nothing
// from a note is run as code; results are plain values the editor draws.

// ---- values -----------------------------------------------------------------

export class DQLDate {
	constructor(ms, dateOnly = false) { this.ms = ms; this.dateOnly = dateOnly; }
	valueOf() { return this.ms; }
	static parse(s) {
		const m = String(s).trim().match(/^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
		if (!m) return null;
		return new DQLDate(new Date(+m[1], +m[2] - 1, +(m[3] || 1), +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime(), !m[4]);
	}
}
export class DQLDuration { constructor(ms) { this.ms = ms; } valueOf() { return this.ms; } }
export class DQLLink {
	constructor(path, display) { this.path = path; this.display = display; }
	get name() { return this.display || String(this.path).split("/").pop().replace(/\.md$/i, ""); }
}

const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const DAY = 864e5;
const UNITS = { ms: 1, millisecond: 1, s: 1e3, sec: 1e3, second: 1e3, m: 6e4, min: 6e4, minute: 6e4, h: 36e5, hr: 36e5, hour: 36e5, d: DAY, day: DAY, w: 7 * DAY, wk: 7 * DAY, week: 7 * DAY, mo: 30 * DAY, month: 30 * DAY, y: 365 * DAY, yr: 365 * DAY, year: 365 * DAY };

// Frontmatter values as Dataview types them.
export function typed(v) {
	if (typeof v === "string") {
		const t = v.trim();
		if (ISO.test(t)) return DQLDate.parse(t);
		const l = t.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/);
		if (l) return new DQLLink(l[1], l[2]);
		return v;
	}
	if (Array.isArray(v)) return v.map(typed);
	return v;
}

function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return new DQLDate(d.getTime(), true); }

function duration(s) {
	let ms = 0, hit = false;
	for (const m of String(s).matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/gi)) {
		const u = UNITS[m[2].toLowerCase().replace(/s$/, "")] ?? UNITS[m[2].toLowerCase()];
		if (u == null) continue;
		ms += +m[1] * u;
		hit = true;
	}
	return hit ? new DQLDuration(ms) : null;
}

function toDate(v) {
	if (v instanceof DQLDate) return v;
	if (v == null) return null;
	const s = String(v).trim().toLowerCase();
	const t = today();
	if (s === "today") return t;
	if (s === "now") return new DQLDate(Date.now());
	if (s === "tomorrow") return new DQLDate(t.ms + DAY, true);
	if (s === "yesterday") return new DQLDate(t.ms - DAY, true);
	const d = new Date(t.ms);
	if (s === "sow") { d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return new DQLDate(d.getTime(), true); }
	if (s === "eow") { d.setDate(d.getDate() + (6 - ((d.getDay() + 6) % 7))); return new DQLDate(d.getTime(), true); }
	if (s === "som") { d.setDate(1); return new DQLDate(d.getTime(), true); }
	if (s === "eom") { d.setMonth(d.getMonth() + 1, 0); return new DQLDate(d.getTime(), true); }
	if (s === "soy") { d.setMonth(0, 1); return new DQLDate(d.getTime(), true); }
	if (s === "eoy") { d.setMonth(11, 31); return new DQLDate(d.getTime(), true); }
	if (v instanceof DQLLink) { const m = v.name.match(/\d{4}-\d{2}-\d{2}/); return m ? DQLDate.parse(m[0]) : null; }
	return DQLDate.parse(s);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n) => String(n).padStart(2, "0");
export function formatDate(v, f = v.dateOnly ? "MMMM d, yyyy" : "h:mm a - MMMM d, yyyy") {
	const d = new Date(v.ms);
	const map = { yyyy: d.getFullYear(), yy: pad(d.getFullYear() % 100), MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3), MM: pad(d.getMonth() + 1), M: d.getMonth() + 1,
		dd: pad(d.getDate()), d: d.getDate(), cccc: DAYS[d.getDay()], ccc: DAYS[d.getDay()].slice(0, 3), EEEE: DAYS[d.getDay()], EEE: DAYS[d.getDay()].slice(0, 3),
		HH: pad(d.getHours()), H: d.getHours(), hh: pad(d.getHours() % 12 || 12), h: d.getHours() % 12 || 12, mm: pad(d.getMinutes()), ss: pad(d.getSeconds()), a: d.getHours() < 12 ? "AM" : "PM" };
	return f.replace(/'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|cccc|ccc|EEEE|EEE|HH|H|hh|h|mm|ss|a/g, (t, lit) => (lit != null ? lit : String(map[t])));
}

// How a value reads in a result.
export function show(v) {
	if (v == null) return "-";
	if (v instanceof DQLDate) return formatDate(v);
	if (v instanceof DQLDuration) {
		const days = v.ms / DAY;
		return Number.isInteger(days) ? `${days} day${days === 1 ? "" : "s"}` : `${Math.round(v.ms / 36e5)} hours`;
	}
	if (v instanceof DQLLink) return v.name;
	if (Array.isArray(v)) return v.map(show).join(", ");
	if (typeof v === "object") return Object.entries(v).map(([k, x]) => `${k}: ${show(x)}`).join(", ");
	return String(v);
}

export function compare(a, b) {
	if (a == null && b == null) return 0;
	if (a == null) return -1;
	if (b == null) return 1;
	if (a instanceof DQLLink) a = a.name;
	if (b instanceof DQLLink) b = b.name;
	if ((a instanceof DQLDate || a instanceof DQLDuration) && typeof b === "string") b = a instanceof DQLDate ? toDate(b) ?? b : duration(b) ?? b;
	if ((b instanceof DQLDate || b instanceof DQLDuration) && typeof a === "string") a = b instanceof DQLDate ? toDate(a) ?? a : duration(a) ?? a;
	if (typeof a === "boolean" || typeof b === "boolean") return Number(a) - Number(b);
	if ((typeof a === "number" || a instanceof DQLDate || a instanceof DQLDuration) && (typeof b === "number" || b instanceof DQLDate || b instanceof DQLDuration)) return +a - +b;
	if (Array.isArray(a) && Array.isArray(b)) {
		for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = compare(a[i], b[i]); if (c) return c; }
		return a.length - b.length;
	}
	return String(a).localeCompare(String(b), undefined, { numeric: true });
}
const equal = (a, b) => compare(a, b) === 0;
const truthy = (v) => !(v == null || v === false || v === 0 || v === "" || (Array.isArray(v) && !v.length));

// ---- tokens and parsing -------------------------------------------------------

const KEYWORDS = new Set(["TABLE", "LIST", "TASK", "CALENDAR", "FROM", "WHERE", "SORT", "LIMIT", "GROUP", "FLATTEN", "BY", "AS", "ASC", "DESC", "ASCENDING", "DESCENDING", "WITHOUT", "ID", "AND", "OR"]);

function tokenize(text) {
	const out = [];
	const re = /\s+|\/\/[^\n]*|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\[\[[^\]]*\]\])|(#[\p{L}\p{N}_\/-]+)|(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?(?![\d-]))|(\d+(?:\.\d+)?)|(!=|<=|>=|&&|\|\||[=<>+\-*\/%(),.\[\]!&|])|([\p{L}_][\p{L}\p{N}_-]*)/uy;
	let pos = 0;
	while (pos < text.length) {
		re.lastIndex = pos;
		const m = re.exec(text);
		if (!m) throw new Error(`Can't read the query at “${text.slice(pos, pos + 12)}”`);
		pos = re.lastIndex;
		if (m[1] != null || m[2] != null) out.push({ t: "str", v: (m[1] ?? m[2]).replace(/\\(.)/g, "$1") });
		else if (m[3]) out.push({ t: "link", v: m[3].slice(2, -2) });
		else if (m[4]) out.push({ t: "tag", v: m[4] });
		else if (m[5]) out.push({ t: "date", v: m[5] });
		else if (m[6]) out.push({ t: "num", v: Number(m[6]) });
		else if (m[7]) out.push({ t: "op", v: m[7] });
		else if (m[8]) {
			// Identifiers with dashes ("hydration-oz") are field names, but "a - b" is subtraction.
			out.push({ t: KEYWORDS.has(m[8].toUpperCase()) ? "kw" : "id", v: m[8], raw: m[8] });
		}
	}
	return out;
}

class Parser {
	constructor(tokens) { this.tk = tokens; this.i = 0; }
	peek(o = 0) { return this.tk[this.i + o]; }
	next() { return this.tk[this.i++]; }
	isKw(...w) { const t = this.peek(); return t && t.t === "kw" && w.includes(t.v.toUpperCase()); }
	isOp(v) { const t = this.peek(); return t && t.t === "op" && t.v === v; }
	expectOp(v) { if (!this.isOp(v)) throw new Error(`Expected “${v}”`); this.i++; }
	done() { return this.i >= this.tk.length; }

	query() {
		const head = this.next();
		if (!head || head.t !== "kw" || !["TABLE", "LIST", "TASK"].includes(head.v.toUpperCase())) throw new Error("A query starts with TABLE, LIST or TASK.");
		const q = { type: head.v.toUpperCase(), fields: [], withoutId: false, from: null, steps: [] };
		if (this.isKw("WITHOUT")) { this.i++; if (!this.isKw("ID")) throw new Error("Expected ID after WITHOUT"); this.i++; q.withoutId = true; }
		const clause = () => this.isKw("FROM", "WHERE", "SORT", "LIMIT", "GROUP", "FLATTEN");
		if (q.type === "TABLE") {
			while (!this.done() && !clause()) {
				const e = this.expr();
				let name = e.src;
				if (this.isKw("AS")) { this.i++; const n = this.next(); name = n.v; }
				q.fields.push({ e, name });
				if (this.isOp(",")) this.i++;
				else break;
			}
		} else if (q.type === "LIST" && !this.done() && !clause()) {
			q.fields.push({ e: this.expr(), name: "" });
		}
		while (!this.done()) {
			const kw = this.next();
			if (!kw || kw.t !== "kw") throw new Error(`Unexpected “${kw?.v}”`);
			const K = kw.v.toUpperCase();
			if (K === "FROM") q.from = this.source();
			else if (K === "WHERE") q.steps.push({ k: "where", e: this.expr() });
			else if (K === "LIMIT") { const n = this.next(); q.steps.push({ k: "limit", n: n?.v | 0 }); }
			else if (K === "SORT") {
				const keys = [];
				do {
					if (this.isOp(",")) this.i++;
					const e = this.expr();
					let desc = false;
					if (this.isKw("ASC", "ASCENDING")) this.i++;
					else if (this.isKw("DESC", "DESCENDING")) { this.i++; desc = true; }
					keys.push({ e, desc });
				} while (this.isOp(","));
				q.steps.push({ k: "sort", keys });
			} else if (K === "GROUP" || K === "FLATTEN") {
				if (K === "GROUP") { if (!this.isKw("BY")) throw new Error("Expected BY after GROUP"); this.i++; }
				const e = this.expr();
				let name = e.src;
				if (this.isKw("AS")) { this.i++; name = this.next().v; }
				q.steps.push({ k: K === "GROUP" ? "group" : "flatten", e, name });
			} else throw new Error(`Unexpected ${kw.v}`);
		}
		return q;
	}

	// FROM "folder" and #tag or -[[note]] ...
	source() {
		const or = () => {
			let l = and();
			while (this.isKw("OR") || this.isOp("|") || this.isOp("||")) { this.i++; const r = and(); const a = l; l = { k: "or", a, b: r }; }
			return l;
		};
		const and = () => {
			let l = atom();
			while (this.isKw("AND") || this.isOp("&") || this.isOp("&&")) { this.i++; const r = atom(); const a = l; l = { k: "and", a, b: r }; }
			return l;
		};
		const atom = () => {
			const t = this.next();
			if (!t) throw new Error("FROM needs a folder, #tag or [[link]]");
			if (t.t === "op" && (t.v === "-" || t.v === "!")) return { k: "not", a: atom() };
			if (t.t === "op" && t.v === "(") { const e = or(); this.expectOp(")"); return e; }
			if (t.t === "str") return { k: "folder", v: t.v };
			if (t.t === "tag") return { k: "tag", v: t.v };
			if (t.t === "link") return { k: "in", v: t.v };
			if (t.t === "id" && t.v.toLowerCase() === "outgoing") { this.expectOp("("); const l = this.next(); this.expectOp(")"); return { k: "out", v: l.v }; }
			throw new Error(`FROM doesn't understand “${t.v}”`);
		};
		return or();
	}

	expr() { const start = this.i; const e = this.or(); e.src = this.tk.slice(start, this.i).map((t) => (t.t === "str" ? JSON.stringify(t.v) : t.t === "link" ? `[[${t.v}]]` : t.raw ?? t.v)).join(" ").replace(/ \. /g, ".").replace(/ \( /g, "(").replace(/ \)/g, ")"); return e; }
	or() { let l = this.and(); while (this.isKw("OR") || this.isOp("|") || this.isOp("||")) { this.i++; l = { k: "or", a: l, b: this.and() }; } return l; }
	and() { let l = this.cmp(); while (this.isKw("AND") || this.isOp("&") || this.isOp("&&")) { this.i++; l = { k: "and", a: l, b: this.cmp() }; } return l; }
	cmp() {
		let l = this.add();
		while (this.peek()?.t === "op" && ["=", "!=", "<", ">", "<=", ">="].includes(this.peek().v)) { const op = this.next().v; l = { k: "bin", op, a: l, b: this.add() }; }
		return l;
	}
	add() { let l = this.mul(); while (this.isOp("+") || this.isOp("-")) { const op = this.next().v; l = { k: "bin", op, a: l, b: this.mul() }; } return l; }
	mul() { let l = this.unary(); while (this.isOp("*") || this.isOp("/") || this.isOp("%")) { const op = this.next().v; l = { k: "bin", op, a: l, b: this.unary() }; } return l; }
	unary() {
		if (this.isOp("-")) { this.i++; return { k: "neg", a: this.unary() }; }
		if (this.isOp("!")) { this.i++; return { k: "not", a: this.unary() }; }
		return this.postfix();
	}
	postfix() {
		let e = this.primary();
		for (;;) {
			if (this.isOp(".")) { this.i++; const n = this.next(); e = { k: "field", of: e, name: n.v }; }
			else if (this.isOp("[")) { this.i++; const idx = this.expr(); this.expectOp("]"); e = { k: "index", of: e, idx }; }
			else if (this.isOp("(") && e.k === "var") {
				this.i++;
				// dur(1 day 2 hours) takes bare words.
				if (e.name.toLowerCase() === "dur" && this.peek()?.t === "num" && this.peek(1)?.t === "id") {
					const parts = [];
					while (!this.done() && !this.isOp(")")) parts.push(this.next().v);
					this.expectOp(")");
					e = { k: "call", fn: "dur", args: [{ k: "lit", v: parts.join(" ") }] };
					continue;
				}
				const args = [];
				while (!this.isOp(")")) { args.push(this.expr()); if (this.isOp(",")) this.i++; else break; }
				this.expectOp(")");
				e = { k: "call", fn: e.name.toLowerCase(), args };
			} else return e;
		}
	}
	primary() {
		const t = this.next();
		if (!t) throw new Error("The query ends too early.");
		if (t.t === "num") return { k: "lit", v: t.v };
		if (t.t === "date") return { k: "lit", v: DQLDate.parse(t.v) };
		if (t.t === "str") return { k: "lit", v: t.v };
		if (t.t === "link") { const [p, d] = t.v.split("|"); return { k: "link", v: p.split("#")[0], d }; }
		if (t.t === "tag") return { k: "lit", v: t.v };
		if (t.t === "op" && t.v === "(") { const e = this.expr(); this.expectOp(")"); return e; }
		if (t.t === "op" && t.v === "[") {
			const items = [];
			while (!this.isOp("]")) { items.push(this.expr()); if (this.isOp(",")) this.i++; else break; }
			this.expectOp("]");
			return { k: "list", items };
		}
		if (t.t === "id" || t.t === "kw") {
			const low = t.v.toLowerCase();
			if (low === "true" || low === "false") return { k: "lit", v: low === "true" };
			if (low === "null") return { k: "lit", v: null };
			return { k: "var", name: t.v };
		}
		throw new Error(`Unexpected “${t.v}”`);
	}
}

export function parseQuery(text) {
	const p = new Parser(tokenize(text.trim()));
	return p.query();
}

// ---- evaluation ----------------------------------------------------------------

function field(obj, name) {
	if (obj == null) return null;
	if (Array.isArray(obj)) return obj.flatMap((x) => { const v = field(x, name); return v == null ? [] : Array.isArray(v) ? v : [v]; });
	if (obj instanceof DQLDate) {
		const d = new Date(obj.ms);
		return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), weekday: d.getDay() || 7 }[name] ?? null;
	}
	if (obj instanceof DQLLink) return name === "path" ? obj.path : name === "name" ? obj.name : null;
	if (typeof obj !== "object") return null;
	if (name in obj) return obj[name];
	const want = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-");
	for (const k of Object.keys(obj)) if (k.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-") === want) return obj[k];
	return null;
}

const FUNCS = {
	date: (a, b) => (b != null && typeof a === "string" ? DQLDate.parse(a) : toDate(a)),
	dur: (a) => (a instanceof DQLDuration ? a : duration(a)),
	number: (a) => { const m = String(a ?? "").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; },
	string: (a) => show(a),
	link: (a, d) => new DQLLink(String(a), d),
	list: (...a) => a,
	contains: (a, b) => (Array.isArray(a) ? a.some((x) => equal(x, b) || (typeof x === "string" && typeof b === "string" && x === b)) : a == null ? false : typeof a === "object" && !(a instanceof DQLLink) ? b in a : show(a).includes(show(b))),
	icontains: (a, b) => (Array.isArray(a) ? a.some((x) => show(x).toLowerCase() === show(b).toLowerCase()) : show(a).toLowerCase().includes(show(b).toLowerCase())),
	econtains: (a, b) => (Array.isArray(a) ? a.some((x) => equal(x, b)) : show(a).includes(show(b))),
	containsword: (a, b) => new RegExp(`(^|[^\\p{L}\\p{N}])${show(b).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(show(a)),
	length: (a) => (a == null ? 0 : Array.isArray(a) ? a.length : typeof a === "object" ? Object.keys(a).length : String(a).length),
	lower: (a) => (a == null ? null : String(a).toLowerCase()),
	upper: (a) => (a == null ? null : String(a).toUpperCase()),
	default: (a, b) => (a == null ? b : a),
	choice: (c, a, b) => (truthy(c) ? a : b),
	round: (a, n = 0) => (a == null ? null : Math.round(a * 10 ** n) / 10 ** n),
	floor: (a) => (a == null ? null : Math.floor(a)),
	ceil: (a) => (a == null ? null : Math.ceil(a)),
	abs: (a) => (a == null ? null : Math.abs(a)),
	min: (...a) => { const l = a.flat().filter((x) => x != null); return l.length ? l.reduce((x, y) => (compare(x, y) <= 0 ? x : y)) : null; },
	max: (...a) => { const l = a.flat().filter((x) => x != null); return l.length ? l.reduce((x, y) => (compare(x, y) >= 0 ? x : y)) : null; },
	sum: (a) => (Array.isArray(a) ? a.reduce((s, x) => s + (Number(x) || 0), 0) : a),
	average: (a) => (Array.isArray(a) && a.length ? FUNCS.sum(a) / a.length : null),
	startswith: (a, b) => show(a).startsWith(show(b)),
	endswith: (a, b) => show(a).endsWith(show(b)),
	replace: (a, b, c) => (a == null ? null : String(a).split(String(b)).join(String(c))),
	regextest: (p, s) => { try { return new RegExp(p).test(show(s)); } catch { return false; } },
	regexmatch: (p, s) => { try { return new RegExp(`^(?:${p})$`).test(show(s)); } catch { return false; } },
	split: (a, sep) => (a == null ? [] : String(a).split(new RegExp(sep))),
	join: (a, sep = ", ") => (Array.isArray(a) ? a.map(show).join(sep) : show(a)),
	flat: (a) => (Array.isArray(a) ? a.flat() : a),
	reverse: (a) => (Array.isArray(a) ? [...a].reverse() : a),
	sort: (a) => (Array.isArray(a) ? [...a].sort(compare) : a),
	nonnull: (...a) => a.flat().filter((x) => x != null),
	all: (...a) => a.flat().every(truthy),
	any: (...a) => a.flat().some(truthy),
	none: (...a) => !a.flat().some(truthy),
	typeof: (a) => (a == null ? "null" : a instanceof DQLDate ? "date" : a instanceof DQLDuration ? "duration" : a instanceof DQLLink ? "link" : Array.isArray(a) ? "array" : typeof a === "object" ? "object" : typeof a),
	dateformat: (d, f) => { const x = toDate(d); return x ? formatDate(x, String(f)) : null; },
	striptime: (d) => { const x = toDate(d); if (!x) return null; const j = new Date(x.ms); j.setHours(0, 0, 0, 0); return new DQLDate(j.getTime(), true); },
	truncate: (a, n, suffix = "...") => { const s = show(a); return s.length > n ? s.slice(0, n - suffix.length) + suffix : s; },
	padleft: (a, n, c = " ") => show(a).padStart(n, c),
	padright: (a, n, c = " ") => show(a).padEnd(n, c),
	meta: (l) => (l instanceof DQLLink ? { path: l.path, display: l.display ?? null, type: "file" } : null),
	extract: (o, ...keys) => Object.fromEntries(keys.map((k) => [k, field(o, k)])),
	object: (...a) => { const o = {}; for (let i = 0; i + 1 < a.length; i += 2) o[a[i]] = a[i + 1]; return o; },
};

function arith(op, a, b) {
	if (a == null || b == null) return null;
	if (op === "+") {
		if (a instanceof DQLDate && (b instanceof DQLDuration || typeof b === "string")) return new DQLDate(a.ms + +(b instanceof DQLDuration ? b : duration(b) ?? 0), a.dateOnly);
		if (a instanceof DQLDuration && b instanceof DQLDuration) return new DQLDuration(a.ms + b.ms);
		if (typeof a === "string" || typeof b === "string") return show(a) + show(b);
		if (Array.isArray(a)) return a.concat(b);
		return +a + +b;
	}
	if (op === "-") {
		if (a instanceof DQLDate && b instanceof DQLDate) return new DQLDuration(a.ms - b.ms);
		if (a instanceof DQLDate) return new DQLDate(a.ms - +(b instanceof DQLDuration ? b : duration(b) ?? 0), a.dateOnly);
		if (a instanceof DQLDuration && b instanceof DQLDuration) return new DQLDuration(a.ms - b.ms);
		return +a - +b;
	}
	if (op === "*") { if (a instanceof DQLDuration) return new DQLDuration(a.ms * b); if (typeof a === "string") return a.repeat(b); return a * b; }
	if (op === "/") { if (a instanceof DQLDuration && typeof b === "number") return new DQLDuration(a.ms / b); return b === 0 ? null : a / b; }
	if (op === "%") return a % b;
	return null;
}

function evaluate(e, ctx) {
	switch (e.k) {
		case "lit": return e.v;
		case "link": return new DQLLink(ctx.resolve(e.v) || e.v, e.d);
		case "list": return e.items.map((x) => evaluate(x, ctx));
		case "var": {
			const low = e.name.toLowerCase();
			if (low === "this") return ctx.current;
			if (low in ctx.row && ctx.row[low] !== undefined && low !== e.name) return ctx.row[low];
			const v = field(ctx.row, e.name);
			if (v == null && FUNCS[low] == null && low === "rows" && ctx.row.rows) return ctx.row.rows;
			return v;
		}
		case "field": return field(evaluate(e.of, ctx), e.name);
		case "index": {
			const o = evaluate(e.of, ctx), i = evaluate(e.idx, ctx);
			if (Array.isArray(o) && typeof i === "number") return o[i < 0 ? o.length + i : i] ?? null;
			return field(o, String(i));
		}
		case "call": {
			const f = FUNCS[e.fn];
			if (!f) throw new Error(`Dataview function ${e.fn}() isn't supported in wr1t3r.`);
			return f(...e.args.map((a) => evaluate(a, ctx)));
		}
		case "neg": { const v = evaluate(e.a, ctx); return v instanceof DQLDuration ? new DQLDuration(-v.ms) : v == null ? null : -v; }
		case "not": return !truthy(evaluate(e.a, ctx));
		case "and": return truthy(evaluate(e.a, ctx)) && truthy(evaluate(e.b, ctx));
		case "or": return truthy(evaluate(e.a, ctx)) || truthy(evaluate(e.b, ctx));
		case "bin": {
			const a = evaluate(e.a, ctx), b = evaluate(e.b, ctx);
			switch (e.op) {
				case "=": return equal(a, b);
				case "!=": return !equal(a, b);
				case "<": return a != null && b != null && compare(a, b) < 0;
				case ">": return a != null && b != null && compare(a, b) > 0;
				case "<=": return a != null && b != null && compare(a, b) <= 0;
				case ">=": return a != null && b != null && compare(a, b) >= 0;
				default: return arith(e.op, a, b);
			}
		}
	}
	return null;
}

// ---- pages and running ----------------------------------------------------------

// A page as queries see it: typed fields, file.link/day/tags/tasks/outlinks/inlinks.
export function queryPage(p) {
	const out = {};
	for (const [k, v] of Object.entries(p)) if (k !== "file") out[k] = typed(v);
	const f = p.file;
	const day = f.name.match(/(\d{4})[-.](\d{2})[-.](\d{2})/);
	const link = new DQLLink(f.path);
	const task = (l) => ({ ...l, path: f.path, link, checked: l.task ? l.status !== " " : false, fullyCompleted: l.completed });
	out.file = {
		...f,
		link,
		day: day ? DQLDate.parse(`${day[1]}-${day[2]}-${day[3]}`) : (typed(p.date) instanceof DQLDate ? typed(p.date) : null),
		tags: f.tags,
		etags: f.tags,
		lists: f.lists.map(task),
		tasks: f.tasks.map(task),
		outlinks: (f.outlinks || []).map((x) => new DQLLink(x)),
		inlinks: (f.inlinks || []).map((x) => new DQLLink(x)),
		frontmatter: f.frontmatter,
	};
	return out;
}

function sourceTest(src, current, resolve) {
	if (!src) return () => true;
	switch (src.k) {
		case "and": { const a = sourceTest(src.a, current, resolve), b = sourceTest(src.b, current, resolve); return (p) => a(p) && b(p); }
		case "or": { const a = sourceTest(src.a, current, resolve), b = sourceTest(src.b, current, resolve); return (p) => a(p) || b(p); }
		case "not": { const a = sourceTest(src.a, current, resolve); return (p) => !a(p); }
		case "folder": {
			const f = src.v.replace(/^\/+|\/+$/g, "").toLowerCase();
			return (p) => { const path = p.file.path.toLowerCase(); return !f || path === f + ".md" || path === f || path.startsWith(f + "/"); };
		}
		case "tag": {
			const tag = src.v.toLowerCase();
			return (p) => p.file.tags.some((x) => { x = String(x).toLowerCase(); return x === tag || x.startsWith(tag + "/"); });
		}
		case "in": {
			const target = src.v ? resolve(src.v) : current?.file.path;
			return (p) => p.file.outlinks.some((l) => l.path === target);
		}
		case "out": {
			const target = src.v ? resolve(src.v) : current?.file.path;
			return (p, all) => { const from = all.get(target); return !!from && from.file.outlinks.some((l) => l.path === p.file.path); };
		}
	}
	return () => false;
}

// Runs query text over pages ({ path: page from dvpage.js }) for the note at
// currentPath. resolve(name) finds a note's path. Returns
// { type, headers, rows: [[cells]] } for TABLE, { type, items: [{ link, value }] }
// for LIST, { type, groups: [{ link, tasks }] } for TASK, where cells are values
// (use show() or draw links). Throws with a readable message on bad queries.
export function runQuery(text, pages, currentPath, resolve = () => null, limit = 1000) {
	const q = parseQuery(text);
	const all = new Map(Object.entries(pages).map(([k, p]) => [k, queryPage(p)]));
	const current = all.get(currentPath) || null;
	const keep = sourceTest(q.from, current, resolve);
	let rows = [...all.values()].filter((p) => keep(p, all));
	if (q.type === "TASK") rows = rows.flatMap((p) => p.file.tasks.map((t) => ({ ...t, file: p.file, __page: p })));
	let grouped = false;
	const ctxFor = (row) => ({ row, current, resolve });
	for (const s of q.steps) {
		if (s.k === "where") rows = rows.filter((r) => truthy(evaluate(s.e, ctxFor(r))));
		else if (s.k === "limit") rows = rows.slice(0, s.n);
		else if (s.k === "sort") {
			const keyed = rows.map((r) => ({ r, ks: s.keys.map((k) => evaluate(k.e, ctxFor(r))) }));
			keyed.sort((a, b) => { for (let i = 0; i < s.keys.length; i++) { const c = compare(a.ks[i], b.ks[i]); if (c) return s.keys[i].desc ? -c : c; } return 0; });
			rows = keyed.map((x) => x.r);
		} else if (s.k === "flatten") {
			rows = rows.flatMap((r) => {
				const v = evaluate(s.e, ctxFor(r));
				const list = Array.isArray(v) ? v : [v];
				return list.map((x) => ({ ...r, [s.name]: x }));
			});
		} else if (s.k === "group") {
			const m = new Map();
			for (const r of rows) {
				const k = evaluate(s.e, ctxFor(r));
				const id = k instanceof DQLDate ? "d" + k.ms : k instanceof DQLLink ? "l" + k.path : JSON.stringify(k);
				if (!m.has(id)) m.set(id, { key: k, rows: [] });
				m.get(id).rows.push(r);
			}
			rows = [...m.values()].map((g) => ({ key: g.key, [s.name]: g.key, rows: g.rows }));
			grouped = true;
		}
	}
	rows = rows.slice(0, limit);
	if (q.type === "TABLE") {
		const headers = [...(q.withoutId ? [] : [grouped ? "Group" : "File"]), ...q.fields.map((f) => f.name)];
		return {
			type: "TABLE",
			headers,
			rows: rows.map((r) => [...(q.withoutId ? [] : [grouped ? r.key : r.file.link]), ...q.fields.map((f) => evaluate(f.e, ctxFor(r)))]),
		};
	}
	if (q.type === "LIST") {
		return {
			type: "LIST",
			items: rows.map((r) => ({
				link: q.withoutId ? null : grouped ? r.key : r.file.link,
				value: q.fields[0] ? evaluate(q.fields[0].e, ctxFor(r)) : grouped ? r.rows.map((x) => x.file?.link ?? x) : undefined,
			})),
		};
	}
	// TASK: tasks under the note they're in.
	const groups = new Map();
	for (const t of rows) {
		const key = grouped ? JSON.stringify(show(t.key)) : t.path;
		if (!groups.has(key)) groups.set(key, { link: grouped ? t.key : t.link, tasks: [] });
		groups.get(key).tasks.push(...(grouped ? t.rows : [t]));
	}
	return { type: "TASK", groups: [...groups.values()] };
}
