// Spreadsheet formulas for markdown tables. A table keeps its formulas in one
// HTML comment right under it, so Obsidian and the site show the table as the
// plain numbers wr1t3r last worked out, and hide the formulas:
//
//   | Item | Cost | Qty | Total |
//   | ---- | ---- | --- | ----- |
//   | Pens | $2   | 3   | $6.00 |
//   | Sum  |      |     | $6.00 |
//   <!-- wr1t3r formulas: D = B*C; D3 = SUM(D:D) -->
//
// Row 1 is the header, row 2 the first row under it; column A is the first
// column. "D3 = ..." is one cell. "D = B*C" is the whole column: every row
// but the header works it out with its own row's B and C, except rows with a
// formula of their own ("D5 =" with nothing after it keeps a typed value).
// B:B is column B's rows (not the header, not the cell asking).
// Nothing here touches the DOM; tablecalc.js and tablegrid.js use it.

const MARK = /^\s*<!--\s*wr1t3r formulas:\s*([\s\S]*?)\s*-->\s*$/;

export const colName = (c) => (c >= 26 ? colName(Math.floor(c / 26) - 1) : "") + String.fromCharCode(65 + (c % 26));
export const colIndex = (s) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const cellName = (row, col) => colName(col) + (row + 1); // row/col from 0

// Split on ";" outside "strings".
function splitList(s) {
	const out = [];
	let cur = "", q = false;
	for (const ch of s) {
		if (ch === '"') q = !q;
		if (ch === ";" && !q) { out.push(cur); cur = ""; continue; }
		cur += ch;
	}
	out.push(cur);
	return out.map((x) => x.trim()).filter(Boolean);
}

// The formula comment line -> Map("D" | "D3" -> "B*C"), or null if it isn't one.
export function readFormulas(line) {
	const m = MARK.exec(line ?? "");
	if (!m) return null;
	const map = new Map();
	for (const part of splitList(m[1])) {
		const eq = /^\$?([A-Za-z]{1,3})\$?(\d*)\s*=([\s\S]*)$/.exec(part);
		if (eq) map.set(eq[1].toUpperCase() + eq[2], eq[3].trim());
	}
	return map;
}

export function writeFormulas(map) {
	if (!map.size) return null;
	const parts = [...map].map(([k, f]) => (f ? `${k} = ${f.replace(/-->/g, "- ->")}` : `${k} =`));
	return `<!-- wr1t3r formulas: ${parts.join("; ")} -->`;
}

// ---- Parsing --------------------------------------------------------------

const TOKEN = /\s*(?:(\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+)|("(?:[^"]|"")*")|(#[A-Z/0-9]+[!?]?)|(\$?[A-Za-z]{1,3}\$?\d+|\$?[A-Za-z]{1,3}\b(?!\s*\())|([A-Za-z_][A-Za-z0-9_.]*)|(<>|<=|>=|[-+*/^&%=<>(),:]))/y;

export function tokens(src) {
	const out = [];
	TOKEN.lastIndex = 0;
	let m;
	while (TOKEN.lastIndex < src.length) {
		const at = TOKEN.lastIndex;
		if (!(m = TOKEN.exec(src))) {
			if (/^\s*$/.test(src.slice(at))) break;
			throw new FormulaError("#ERROR!", `Can't read "${src.slice(at).trim()}"`);
		}
		const start = m.index + m[0].length - m[0].trimStart().length;
		if (m[1] != null) out.push({ t: "num", v: Number(m[1]), at: start, end: TOKEN.lastIndex });
		else if (m[2] != null) out.push({ t: "str", v: m[2].slice(1, -1).replace(/""/g, '"'), at: start, end: TOKEN.lastIndex });
		else if (m[3] != null) out.push({ t: "err", v: m[3], at: start, end: TOKEN.lastIndex });
		else if (m[4] != null) {
			const r = /^\$?([A-Za-z]{1,3})\$?(\d*)$/.exec(m[4]);
			const word = m[4].toUpperCase();
			if (!r[2] && (word === "TRUE" || word === "FALSE")) out.push({ t: "bool", v: word === "TRUE", at: start, end: TOKEN.lastIndex });
			else out.push({ t: "ref", col: colIndex(r[1]), row: r[2] ? Number(r[2]) - 1 : null, at: start, end: TOKEN.lastIndex });
		} else if (m[5] != null) {
			const word = m[5].toUpperCase();
			if (word === "TRUE" || word === "FALSE") out.push({ t: "bool", v: word === "TRUE", at: start, end: TOKEN.lastIndex });
			else out.push({ t: "name", v: word, at: start, end: TOKEN.lastIndex });
		} else out.push({ t: "op", v: m[6], at: start, end: TOKEN.lastIndex });
	}
	return out;
}

export class FormulaError extends Error {
	constructor(code, message) { super(message || code); this.code = code; }
}

// Pratt parser. Lowest to highest: comparisons, &, + -, * /, ^, unary -, %.
const BIN = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

export function parse(src) {
	const ts = tokens(src.replace(/^\s*=/, ""));
	let i = 0;
	const peek = () => ts[i];
	const next = () => ts[i++];
	const expect = (v) => {
		const t = next();
		if (!t || t.v !== v) throw new FormulaError("#ERROR!", `Expected "${v}"`);
	};
	function primary() {
		const t = next();
		if (!t) throw new FormulaError("#ERROR!", "Formula ends early");
		if (t.t === "num" || t.t === "str" || t.t === "bool") return { k: "lit", v: t.v };
		if (t.t === "err") return { k: "lit", v: new FormulaError(t.v) };
		if (t.t === "ref") {
			if (peek()?.v === ":") {
				next();
				const e = next();
				if (e?.t !== "ref") throw new FormulaError("#ERROR!", "A range needs two cells, like B2:B5");
				return { k: "range", a: t, b: e };
			}
			return { k: "ref", r: t };
		}
		if (t.t === "name") {
			if (peek()?.v !== "(") throw new FormulaError("#NAME?", `Unknown name ${t.v}`);
			next();
			const args = [];
			if (peek()?.v !== ")") {
				do args.push(expr(0)); while (peek()?.v === "," && next());
			}
			expect(")");
			return { k: "call", f: t.v, args };
		}
		if (t.v === "(") { const e = expr(0); expect(")"); return e; }
		if (t.v === "-" || t.v === "+") return { k: "neg", sign: t.v, e: expr(5.5) };
		throw new FormulaError("#ERROR!", `Unexpected "${t.v}"`);
	}
	function expr(min) {
		let left = primary();
		for (;;) {
			const t = peek();
			if (t?.v === "%") { next(); left = { k: "pct", e: left }; continue; }
			const p = t?.t === "op" ? BIN[t.v] : undefined;
			if (p === undefined || p <= min) break;
			next();
			left = { k: "bin", op: t.v, a: left, b: expr(t.v === "^" ? p - 0.1 : p) };
		}
		return left;
	}
	const tree = expr(0);
	if (i < ts.length) throw new FormulaError("#ERROR!", `Unexpected "${ts[i].v}"`);
	return tree;
}

// Does the formula only use bare columns (B*C), so it fits a whole column?
export function isColumnFormula(src) {
	try {
		const ts = tokens(src.replace(/^\s*=/, ""));
		const refs = ts.filter((t) => t.t === "ref");
		return refs.some((t) => t.row == null) && refs.every((t) => t.row == null);
	} catch { return false; }
}

// ---- Cell text <-> values ---------------------------------------------------

// A typed cell -> number (with how it was written), text, or null when empty.
// Lenient like a spreadsheet: "$1,200.50", "15%", "**42**", "-3".
export function readCell(text) {
	let t = (text ?? "").trim();
	const wrap = /^(\*\*|__|\*|_|==|`)(.+)\1$/.exec(t);
	if (wrap) t = wrap[2].trim();
	t = t.replace(/\\([\\`*_{}[\]()#+\-.!|~=$])/g, "$1");
	if (!t) return { v: null };
	const m = /^([-+]?)\s*([$€£¥])?\s*([-+]?)(\d{1,3}(?:,\d{3})+|\d+)?(\.\d+)?\s*(%)?$/.exec(t);
	if (m && (m[4] || m[5]) && !(m[1] && m[3])) {
		const sign = (m[1] || m[3]) === "-" ? -1 : 1;
		const n = sign * Number((m[4] || "0").replace(/,/g, "") + (m[5] || "")) / (m[6] ? 100 : 1);
		return { v: n, fmt: { cur: m[2] || "", dec: m[5] ? m[5].length - 1 : 0, commas: !!(m[4] && m[4].includes(",")), pct: !!m[6] } };
	}
	if (/^(true|false)$/i.test(t)) return { v: /^true$/i.test(t) };
	return { v: t };
}

const round = (n, d) => Math.round((n + Number.EPSILON * Math.sign(n)) * 10 ** d) / 10 ** d;
function commas(s) {
	const [a, b] = s.split(".");
	return a.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (b != null ? "." + b : "");
}

// A result -> the cell text written into the table. Numbers borrow the look of
// the cells they came from: currency with two decimals, percentages, commas.
export function showValue(v, fmt = {}) {
	if (v instanceof FormulaError) return "\\" + v.code; // "\#DIV/0!", so it isn't read as a #tag
	if (v == null) return "";
	if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
	if (typeof v === "string") return v.replace(/\|/g, "\\|").replace(/\n/g, " ");
	if (!Number.isFinite(v)) return "\\#NUM!";
	const neg = v < 0 ? "-" : "";
	let n = Math.abs(v), s;
	if (fmt.cur) s = n.toFixed(2);
	else if (fmt.pct) {
		n *= 100;
		s = String(round(n, Math.max(fmt.dec || 0, 1)));
		return neg + (fmt.commas ? commas(s) : s) + "%";
	} else {
		const d = fmt.dec || 0, most = Math.max(d, 2);
		s = round(n, most).toFixed(most);
		// Trailing zeros go, down to as many decimals as the cells it came from had.
		while (s.includes(".") && s.split(".")[1].length > d && s.endsWith("0")) s = s.slice(0, -1);
		if (s.endsWith(".")) s = s.slice(0, -1);
	}
	if (fmt.commas || (fmt.cur && n >= 1000)) s = commas(s);
	return neg + (fmt.cur || "") + s;
}

// ---- Evaluation -------------------------------------------------------------

// Work out every formula in a table. rows[0] is the header; returns new rows
// with formula cells filled in, and `errors` (cell name -> message) for the
// cells whose formula can't be read.
export function recalc(rows, formulas) {
	const nRows = rows.length, nCols = Math.max(0, ...rows.map((r) => r.length));
	const cellF = new Map(), colF = new Map(), errors = new Map();
	for (const [key, src] of formulas) {
		const m = /^([A-Z]{1,3})(\d*)$/.exec(key);
		if (!m) continue;
		const c = colIndex(m[1]);
		if (m[2]) cellF.set(`${Number(m[2]) - 1},${c}`, src);
		else colF.set(c, src);
	}
	const formulaAt = (r, c) => {
		if (r < 1 || r >= nRows || c >= nCols) return null;
		const own = cellF.get(`${r},${c}`);
		if (own !== undefined) return own || null; // "D5 =" keeps a typed value
		return colF.get(c) ?? null;
	};
	// Are all the cells a column formula reads from its own row empty?
	const rowIsBlank = (src, r) => {
		let ts;
		try { ts = tokens(src); } catch { return false; }
		const own = ts.filter((t, i) => t.t === "ref" && t.row == null && ts[i - 1]?.v !== ":" && ts[i + 1]?.v !== ":");
		return own.length > 0 && own.every((t) => formulaAt(r, t.col) == null && readCell(rows[r]?.[t.col]).v == null);
	};
	const trees = new Map();
	const treeOf = (src) => {
		if (!trees.has(src)) {
			try { trees.set(src, parse(src)); } catch (e) { trees.set(src, e instanceof FormulaError ? e : new FormulaError("#ERROR!", e.message)); }
		}
		return trees.get(src);
	};
	const done = new Map(); // "r,c" -> { v, fmt }
	const busy = new Set();

	function cell(r, c) {
		if (r < 0 || c < 0 || r >= nRows || c >= nCols) return { v: new FormulaError("#REF!") };
		const key = `${r},${c}`;
		if (done.has(key)) return done.get(key);
		const src = formulaAt(r, c);
		if (src == null) return readCell(rows[r]?.[c]);
		if (busy.has(key)) return { v: new FormulaError("#CIRC!") };
		busy.add(key);
		const tree = treeOf(src);
		const fmt = {};
		let v;
		if (tree instanceof FormulaError) { v = tree; errors.set(cellName(r, c), tree.message); }
		else if (cellF.get(key) === undefined && rowIsBlank(src, r)) v = null; // a column formula on an empty row stays empty
		else {
			try { v = scalar(evaluate(tree, { r, c, fmt })); }
			catch (e) { v = e instanceof FormulaError ? e : new FormulaError("#ERROR!", e.message); }
		}
		busy.delete(key);
		const out = { v, fmt };
		done.set(key, out);
		return out;
	}

	const note = (ctx, got) => {
		if (!got.fmt || typeof got.v !== "number") return;
		const f = ctx.fmt, g = got.fmt;
		if (g.cur && !f.cur) f.cur = g.cur;
		f.dec = Math.max(f.dec || 0, g.dec || 0);
		if (g.commas) f.commas = true;
		if (g.pct && f.pct === undefined) f.pct = true;
		if (!g.pct && !g.cur) f.plain = true;
	};

	function evaluate(n, ctx) {
		switch (n.k) {
			case "lit": return n.v;
			case "ref": {
				const got = cell(n.r.row ?? ctx.r, n.r.col);
				note(ctx, got);
				return got.v;
			}
			case "range": {
				const { a, b } = n;
				const whole = a.row == null || b.row == null;
				const r0 = whole ? 1 : Math.min(a.row, b.row), r1 = whole ? nRows - 1 : Math.max(a.row, b.row);
				const c0 = Math.min(a.col, b.col), c1 = Math.max(a.col, b.col);
				if (c1 >= nCols || r1 >= nRows) throw new FormulaError("#REF!");
				const vals = [];
				for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
					if (r === ctx.r && c === ctx.c) continue;
					const got = cell(r, c);
					note(ctx, got);
					vals.push(got.v);
				}
				return { range: vals };
			}
			case "neg": { const v = num(evaluate(n.e, ctx)); return n.sign === "-" ? -v : v; }
			case "pct": return num(evaluate(n.e, ctx)) / 100;
			case "bin": {
				const a = scalar(evaluate(n.a, ctx)), b = scalar(evaluate(n.b, ctx));
				if (a instanceof FormulaError) throw a;
				if (b instanceof FormulaError) throw b;
				switch (n.op) {
					case "+": return num(a) + num(b);
					case "-": return num(a) - num(b);
					case "*": return num(a) * num(b);
					case "/": { const d = num(b); if (d === 0) throw new FormulaError("#DIV/0!"); return num(a) / d; }
					case "^": return num(a) ** num(b);
					case "&": ctx.fmt.text = true; return text(a) + text(b);
					default: return compare(a, b, n.op);
				}
			}
			case "call": {
				const fn = FUNCS[n.f];
				if (!fn) throw new FormulaError("#NAME?", `Unknown function ${n.f}`);
				if (fn.lazy) return fn((i) => (n.args[i] ? evaluate(n.args[i], ctx) : undefined), n.args.length, ctx);
				return fn(n.args.map((a) => evaluate(a, ctx)), ctx);
			}
		}
		throw new FormulaError("#ERROR!");
	}

	const out = rows.map((row) => Array.from({ length: nCols }, (_, c) => row[c] ?? ""));
	for (let r = 1; r < nRows; r++) for (let c = 0; c < nCols; c++) {
		if (formulaAt(r, c) == null) continue;
		const { v, fmt } = cell(r, c);
		const look = fmt.text ? {} : { ...fmt, pct: fmt.pct && !fmt.plain && !fmt.cur };
		out[r][c] = showValue(v, look);
	}
	return { rows: out, errors };
}

// ---- Values and functions ---------------------------------------------------

function scalar(v) {
	if (v && v.range) {
		if (v.range.length === 1) return v.range[0];
		throw new FormulaError("#VALUE!", "A range can only go inside a function like SUM");
	}
	return v;
}
function num(v) {
	v = scalar(v);
	if (v instanceof FormulaError) throw v;
	if (v == null || v === "") return 0;
	if (typeof v === "boolean") return v ? 1 : 0;
	if (typeof v === "number") return v;
	const read = readCell(v).v;
	if (typeof read === "number") return read;
	throw new FormulaError("#VALUE!", `"${v}" isn't a number`);
}
function text(v) {
	v = scalar(v);
	if (v instanceof FormulaError) throw v;
	if (v == null) return "";
	if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
	if (typeof v === "number") return showValue(v);
	return v;
}
function truthy(v) {
	v = scalar(v);
	if (v instanceof FormulaError) throw v;
	if (typeof v === "string") {
		if (/^true$/i.test(v)) return true;
		if (/^false$/i.test(v) || v === "") return false;
		throw new FormulaError("#VALUE!");
	}
	return !!v;
}
function compare(a, b, op) {
	let x = a ?? "", y = b ?? "";
	if (typeof x === "string" && typeof y === "string") { x = x.toLowerCase(); y = y.toLowerCase(); }
	else if (typeof x !== typeof y) {
		if (x === "" ) x = typeof y === "number" ? 0 : "";
		if (y === "") y = typeof x === "number" ? 0 : "";
	}
	switch (op) {
		case "=": return x === y;
		case "<>": return x !== y;
		case "<": return x < y;
		case ">": return x > y;
		case "<=": return x <= y;
		case ">=": return x >= y;
	}
}
// Every value in the arguments, ranges opened up.
function flat(args) {
	const out = [];
	for (const a of args) {
		if (a && a.range) out.push(...a.range.map((v) => ({ v, inRange: true })));
		else out.push({ v: a, inRange: false });
	}
	return out;
}
// Numbers for SUM and friends: typed numbers count, text and blanks in a range don't.
function numbers(args) {
	const out = [];
	for (const { v, inRange } of flat(args)) {
		if (v instanceof FormulaError) throw v;
		if (typeof v === "number") out.push(v);
		else if (!inRange && v != null) out.push(num(v));
	}
	return out;
}
function criteria(c) {
	c = scalar(c);
	if (typeof c === "number") return (v) => v === c;
	const m = /^(<>|<=|>=|=|<|>)?(.*)$/.exec(String(c ?? ""));
	const op = m[1] || "=";
	const want = readCell(m[2]).v;
	return (v) => {
		if (v instanceof FormulaError) return false;
		if (typeof want === "number") return typeof v === "number" && compare(v, want, op);
		return compare(typeof v === "string" ? v : v == null ? "" : text(v), want == null ? "" : String(want), op);
	};
}
function rangeOf(a) {
	if (a && a.range) return a.range;
	return [scalar(a)];
}
const need = (args, n) => { if (args.length < n) throw new FormulaError("#ERROR!", "Missing an argument"); };

const FUNCS = {
	SUM: (a) => numbers(a).reduce((s, x) => s + x, 0),
	PRODUCT: (a) => numbers(a).reduce((s, x) => s * x, 1),
	AVERAGE: (a) => { const n = numbers(a); if (!n.length) throw new FormulaError("#DIV/0!"); return n.reduce((s, x) => s + x, 0) / n.length; },
	MIN: (a) => { const n = numbers(a); return n.length ? Math.min(...n) : 0; },
	MAX: (a) => { const n = numbers(a); return n.length ? Math.max(...n) : 0; },
	MEDIAN: (a) => {
		const n = numbers(a).sort((x, y) => x - y);
		if (!n.length) throw new FormulaError("#NUM!");
		const h = n.length >> 1;
		return n.length % 2 ? n[h] : (n[h - 1] + n[h]) / 2;
	},
	COUNT: (a) => flat(a).filter(({ v }) => typeof v === "number").length,
	COUNTA: (a) => flat(a).filter(({ v }) => v != null && v !== "").length,
	COUNTBLANK: (a) => flat(a).filter(({ v }) => v == null || v === "").length,
	ROUND: (a) => { need(a, 1); return round(num(a[0]), a[1] === undefined ? 0 : num(a[1])); },
	ROUNDUP: (a) => { need(a, 1); const p = 10 ** (a[1] === undefined ? 0 : num(a[1])), x = num(a[0]); return Math.sign(x) * Math.ceil(Math.abs(x) * p - 1e-9) / p; },
	ROUNDDOWN: (a) => { need(a, 1); const p = 10 ** (a[1] === undefined ? 0 : num(a[1])), x = num(a[0]); return Math.sign(x) * Math.floor(Math.abs(x) * p + 1e-9) / p; },
	INT: (a) => { need(a, 1); return Math.floor(num(a[0])); },
	ABS: (a) => { need(a, 1); return Math.abs(num(a[0])); },
	SQRT: (a) => { need(a, 1); const x = num(a[0]); if (x < 0) throw new FormulaError("#NUM!"); return Math.sqrt(x); },
	POWER: (a) => { need(a, 2); return num(a[0]) ** num(a[1]); },
	MOD: (a) => { need(a, 2); const d = num(a[1]); if (d === 0) throw new FormulaError("#DIV/0!"); const x = num(a[0]); return x - d * Math.floor(x / d); },
	IF: Object.assign((arg, n) => {
		if (n < 2) throw new FormulaError("#ERROR!", "IF needs a test and a value");
		return truthy(arg(0)) ? arg(1) : n > 2 ? arg(2) : false;
	}, { lazy: true }),
	IFERROR: Object.assign((arg) => {
		try { const v = scalar(arg(0)); if (v instanceof FormulaError) throw v; return v; }
		catch (e) { if (e instanceof FormulaError) return arg(1) ?? ""; throw e; }
	}, { lazy: true }),
	AND: (a) => flat(a).every(({ v }) => truthy(v)),
	OR: (a) => flat(a).some(({ v }) => truthy(v)),
	NOT: (a) => { need(a, 1); return !truthy(a[0]); },
	CONCAT: (a, ctx) => { ctx.fmt.text = true; return flat(a).map(({ v }) => text(v)).join(""); },
	LEN: (a) => { need(a, 1); return text(a[0]).length; },
	UPPER: (a, ctx) => { need(a, 1); ctx.fmt.text = true; return text(a[0]).toUpperCase(); },
	LOWER: (a, ctx) => { need(a, 1); ctx.fmt.text = true; return text(a[0]).toLowerCase(); },
	TRIM: (a, ctx) => { need(a, 1); ctx.fmt.text = true; return text(a[0]).trim().replace(/\s+/g, " "); },
	SUMIF: (a) => {
		need(a, 2);
		const test = criteria(a[1]), where = rangeOf(a[0]), what = a[2] === undefined ? where : rangeOf(a[2]);
		return where.reduce((s, v, i) => (test(v) && typeof what[i] === "number" ? s + what[i] : s), 0);
	},
	COUNTIF: (a) => { need(a, 2); const test = criteria(a[1]); return rangeOf(a[0]).filter((v) => test(v)).length; },
	AVERAGEIF: (a) => {
		need(a, 2);
		const test = criteria(a[1]), where = rangeOf(a[0]), what = a[2] === undefined ? where : rangeOf(a[2]);
		const n = where.map((v, i) => (test(v) && typeof what[i] === "number" ? what[i] : null)).filter((x) => x != null);
		if (!n.length) throw new FormulaError("#DIV/0!");
		return n.reduce((s, x) => s + x, 0) / n.length;
	},
};
FUNCS.AVG = FUNCS.MEAN = FUNCS.AVERAGE;
FUNCS.CONCATENATE = FUNCS.CONCAT;
export const functionNames = Object.keys(FUNCS).sort();

// ---- Moving rows and columns ------------------------------------------------

// Rows or columns were added (delta > 0) or removed (delta < 0) at index `at`
// (from 0; rows count the header as 0). References and keys follow the cells
// they pointed at, like a spreadsheet; a reference to a removed cell becomes
// #REF!. Returns a new Map.
export function shiftFormulas(formulas, axis, at, delta) {
	const moveIdx = (i) => {
		if (i < at) return i;
		if (delta > 0) return i + delta;
		return i < at - delta ? null : i + delta; // removed, or slides up
	};
	const out = new Map();
	for (const [key, src] of formulas) {
		const m = /^([A-Z]{1,3})(\d*)$/.exec(key);
		let c = colIndex(m[1]), r = m[2] ? Number(m[2]) - 1 : null;
		if (axis === "col") c = moveIdx(c);
		else if (r != null) r = moveIdx(r);
		if (c == null || (m[2] && r == null)) continue; // its cell or column is gone
		out.set(colName(c) + (r == null ? "" : r + 1), shiftSource(src, axis, at, delta, moveIdx));
	}
	return out;
}

function shiftSource(src, axis, at, delta, moveIdx) {
	let ts;
	try { ts = tokens(src); } catch { return src; }
	let out = "", last = 0;
	const refText = (row, col) => colName(col) + (row == null ? "" : row + 1);
	for (let i = 0; i < ts.length; i++) {
		const t = ts[i];
		if (t.t !== "ref") continue;
		const range = ts[i + 1]?.v === ":" && ts[i + 2]?.t === "ref";
		const pieces = range ? [t, ts[i + 2]] : [t];
		const moved = pieces.map((p, k) => {
			const idx = axis === "col" ? p.col : p.row;
			if (idx == null) return { row: p.row, col: p.col };
			let n = moveIdx(idx);
			if (n == null && range && delta < 0) n = k === 0 ? at : at - 1; // the range shrinks
			return n == null ? null : axis === "col" ? { row: p.row, col: n } : { row: n, col: p.col };
		});
		const end = range ? ts[i + 2].end : t.end;
		out += src.slice(last, t.at);
		const bad = moved.some((p) => p == null || (axis === "col" ? p.col < 0 : p.row != null && p.row < 0)) ||
			(range && (axis === "col" ? moved[0].col > moved[1].col : moved[0].row != null && moved[1].row != null && moved[0].row > moved[1].row));
		out += bad ? "#REF!" : moved.map((p) => refText(p.row, p.col)).join(":");
		last = end;
		if (range) i += 2;
	}
	return out + src.slice(last);
}
