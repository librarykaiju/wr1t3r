// RTF as markdown, for the Scrivener import (src/scrivenerimport.js): every
// Scrivener document is an .rtf file. Keeps what a writer's text carries:
// paragraphs, bold, italic, strikethrough, links, lists, headings and block
// quotes (from the stylesheet's names), footnotes, line breaks and pictures.
// Fonts, sizes, colors, spacing and indents are left behind. No DOM, so it
// runs in tests too.

// Destinations whose text isn't part of the document.
const SKIP = new Set([
	"fonttbl", "colortbl", "expandedcolortbl", "info", "generator", "listtable", "listoverridetable", "rsidtbl",
	"header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf", "themedata",
	"colorschememapping", "latentstyles", "datastore", "xmlnstbl", "mmathPr", "filetbl", "revtbl", "object",
	"nonshppict", "pn", "bkmkstart", "bkmkend", "fldtype", "datafield", "falt", "panose", "blipuid", "pgdsctbl",
	"wgrffmtfilter", "listpicture", "ftnsep", "ftnsepc", "aftnsep", "aftnsepc", "userprops", "docvar", "xe", "tc",
]);

const SYMBOLS = { emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”", emspace: " ", enspace: " ", qmspace: " " };

const CODEPAGES = { 932: "shift_jis", 936: "gbk", 949: "euc-kr", 950: "big5", 10000: "macintosh", 65001: "utf-8" };
const decoders = new Map();
function decoderFor(cp) {
	const label = CODEPAGES[cp] || (cp >= 874 && cp <= 1258 ? "windows-" + cp : "windows-1252");
	if (!decoders.has(label)) {
		let d;
		try { d = new TextDecoder(label); } catch { d = new TextDecoder("windows-1252"); }
		decoders.set(label, d);
	}
	return decoders.get(label);
}

// Text that markdown would read as formatting, escaped.
const escapeText = (s) => s.replace(/([\\*`[\]])/g, "\\$1").replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "\\_");
function escapeStart(line) {
	return line
		.replace(/^(#{1,6})(?=\s|$)/, "\\$1")
		.replace(/^([>+-])(?=\s|$)/, "\\$1")
		.replace(/^(\d+)([.)])(?=\s|$)/, "$1\\$2")
		.replace(/^(=+|-+)\s*$/, (m) => "\\" + m);
}

// Runs [{ text, b, i, s, raw }] as markdown, the marks moved off the spaces at their edges.
function renderRuns(runs) {
	let out = "", open = [], pending = "";
	const want = (r) => [r.b && "**", r.i && "*", r.s && "~~"].filter(Boolean);
	const close = (keep) => {
		let n = 0;
		while (n < open.length && n < keep.length && open[n] === keep[n]) n++;
		while (open.length > n) out += open.pop();
		return n;
	};
	for (const r of runs) {
		const text = r.raw ? r.text : escapeText(r.text);
		if (!text) continue;
		const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
		if (!m[2]) { pending += text; continue; }
		const marks = want(r);
		const same = marks.length === open.length && marks.every((x, k) => x === open[k]);
		if (same) out += pending + m[1];
		else {
			const n = close(marks);
			out += pending + m[1];
			for (const x of marks.slice(n)) { out += x; open.push(x); }
		}
		out += m[2];
		pending = m[3];
	}
	close([]);
	return out + pending;
}

// rtf: the file's text (each byte one character). Options:
//   image({ bytes, ext } | { file }) -> markdown for a picture, or "" to leave it out
//   comment(id) -> { text, footnote } for Scrivener 3's linked comments and footnotes
// -> { text, features } where features lists what was left out, for the import's report.
export function rtfToMarkdown(rtf, { image = () => "", comment = () => null } = {}) {
	rtf = String(rtf || "");
	const features = new Set();
	const styles = new Map(); // \sN -> name
	const footnotes = [];
	let cp = 1252, uc = 1;

	// Where text goes: a stack of sinks, each with its paragraphs of runs.
	const newSink = () => ({ paras: [], para: newPara() });
	const newPara = () => ({ runs: [], style: 0, list: null, level: 0 });
	let sinks = [newSink()];
	const sink = () => sinks[sinks.length - 1];

	let st = { skip: false, dest: null, b: false, i: false, s: false, style: 0, ls: 0, level: 0, uc, skipChars: 0 };
	const stack = [];
	let bytes = [];

	const emit = (text, raw = false) => {
		if (st.skip || !text) return;
		if (st.dest === "fldinst") { st.field.inst += text; return; }
		if (st.dest === "listtext") { sink().para.list = (sink().para.list || "") + text; return; }
		if (st.dest === "pict") { if (!raw) st.pict.hex += text; return; }
		if (st.dest === "nextgraphic") { st.next.name += text; return; }
		if (st.dest === "stylesheet") { if (st.styleEntry) st.styleEntry.name += text; return; }
		const p = sink().para;
		p.style = st.style; p.level = st.level;
		if (st.ls && p.list == null) p.list = "";
		const last = p.runs[p.runs.length - 1];
		if (last && !raw && !last.raw && last.b === st.b && last.i === st.i && last.s === st.s) last.text += text;
		else p.runs.push({ text, b: st.b, i: st.i, s: st.s, raw });
	};
	const flushBytes = () => {
		if (!bytes.length) return;
		const t = decoderFor(cp).decode(new Uint8Array(bytes));
		bytes = [];
		emit(t);
	};
	const endPara = () => {
		const s = sink();
		s.paras.push(s.para);
		s.para = newPara();
	};

	// A sink's paragraphs as markdown blocks.
	const blocks = (s) => {
		const paras = [...s.paras, s.para];
		const out = [];
		for (const p of paras) {
			let text = renderRuns(p.runs).replace(/[ \t\u00a0]+$/g, "").replace(/\\\n$/, "");
			const name = (styles.get(p.style) || "").toLowerCase();
			text = text.replace(/^[ \t\u00a0]+/, "").replace(/\t/g, " ");
			if (!text.trim()) { out.push(null); continue; }
			const heading = name.match(/^heading\s*(\d)/) || (name === "title" ? [0, "1"] : null);
			if (p.list != null) {
				const mark = /\d/.test(p.list) ? "1. " : "- ";
				out.push({ list: mark, text: "   ".repeat(Math.min(p.level, 6)) + mark + text });
			} else if (heading) out.push({ text: "#".repeat(Math.min(6, Math.max(1, +heading[1]))) + " " + text.replace(/\\\n/g, " ") });
			else if (/quote/.test(name)) out.push({ text: escapeStart(text).split("\n").map((l) => "> " + l).join("\n"), quote: true });
			else if (/^(\\\*[ \t]*){3,}$/.test(text)) out.push({ text: text.replace(/\\/g, "") }); // a scene break, * * *
			else out.push({ text: escapeStart(text) });
		}
		let md = "";
		let prev = null;
		for (const b of out) {
			if (!b) { prev = null; continue; }
			if (md) md += (prev && ((prev.list && prev.list === b.list) || (prev.quote && b.quote)) ? (b.quote ? "\n>\n" : "\n") : "\n\n");
			md += b.text;
			prev = b;
		}
		return md;
	};

	const addFootnote = (text) => {
		footnotes.push(text.replace(/\n{2,}/g, "\n\n    ").trim());
		return `[^${footnotes.length}]`;
	};

	const startDest = (name) => {
		if (name === "fldinst") { if (st.field) { st.dest = "fldinst"; } else st.skip = true; return; }
		if (name === "fldrslt") { if (st.field) { st.dest = null; sinks.push(newSink()); st.sinkDepth = sinks.length; st.field.result = true; } return; }
		if (name === "footnote" || name === "annotation") { sinks.push(newSink()); st.sinkDepth = sinks.length; st.note = name; st.dest = null; return; }
		if (name === "listtext" || name === "pntext") { st.dest = "listtext"; return; }
		if (name === "pict") { st.dest = "pict"; st.pict = { hex: "", kind: "" }; return; }
		if (name === "NeXTGraphic") { st.dest = "nextgraphic"; st.next = { name: "" }; return; }
		if (name === "stylesheet") { st.dest = "stylesheet"; return; }
		if (name === "field") { st.field = { inst: "", result: false }; st.fieldOwner = true; return; }
		st.skip = true;
	};

	// When a group closes: finish what it started.
	const endGroup = (g) => {
		if (g.sinkDepth && sinks.length === g.sinkDepth) {
			const inner = sinks.pop();
			const md = blocks(inner);
			if (g.note === "footnote") emitRaw(addFootnote(md));
			else if (g.note === "annotation") { if (md.trim()) emitRaw(`{>>${md.replace(/\s*\n+\s*/g, " ").replace(/<<\}/g, "<< }")}<<}`); }
			else if (g.field) g.field.md = md.replace(/\n{2,}/g, " ");
		}
		if (g.fieldOwner && g.field) {
			const f = g.field, md = f.md || "";
			const link = f.inst.match(/HYPERLINK\s+(?:\\l\s+)?"([^"]*)"/i);
			if (link && /^scrivcmt:\/\//i.test(link[1])) {
				const c = comment(link[1].replace(/^scrivcmt:\/\//i, ""));
				if (c?.footnote) emitRaw(md + addFootnote(c.text));
				else if (c && c.text.trim()) emitRaw(`{==${md || " "}==}{>>${c.text.replace(/\s*\n+\s*/g, " ").replace(/<<\}/g, "<< }")}<<}`);
				else emitRaw(md);
			} else if (link && /^(https?|mailto):/i.test(link[1]) && md.trim()) emitRaw(`[${md}](<${link[1]}>)`);
			else emitRaw(md);
		}
		if (g.dest === "pict" && g.pict && !st.skip) {
			const hex = g.pict.hex.replace(/[^0-9a-f]/gi, "");
			const ext = g.pict.kind;
			if (ext && hex.length >= 2) {
				const out = new Uint8Array(hex.length >> 1);
				for (let k = 0; k < out.length; k++) out[k] = parseInt(hex.substr(k * 2, 2), 16);
				const md = image({ bytes: out, ext });
				if (md) emitRaw(md); else features.add("a picture that couldn't be saved");
			} else features.add("a picture in a format wr1t3r can't show (left out)");
		}
		if (g.dest === "nextgraphic" && g.next && !st.skip) {
			const file = g.next.name.trim();
			const md = file ? image({ file }) : "";
			if (md) emitRaw(md); else if (file) features.add(`the picture ${file} (left out)`);
			st.afterGraphic = true;
		}
		if (g.dest === "stylesheet" && g.styleEntry && g.styleEntry !== st.styleEntry) {
			const e = g.styleEntry;
			if (e.n != null) styles.set(e.n, e.name.replace(/;\s*$/, "").trim());
		}
	};
	const emitRaw = (md) => {
		const saved = st;
		// Raw markdown goes to whatever is collecting text where the group closed.
		st = { ...st, skip: false };
		emit(md, true);
		st = saved;
	};

	const n = rtf.length;
	let i = 0;
	while (i < n) {
		const c = rtf[i];
		if (c === "{") {
			flushBytes();
			stack.push(st);
			st = { ...st, sinkDepth: 0, fieldOwner: false, note: null, star: false, afterGraphic: false };
			if (st.dest === "stylesheet") st.styleEntry = { n: 0, name: "" };
			i++;
			continue;
		}
		if (c === "}") {
			flushBytes();
			const g = st;
			st = stack.pop() || st;
			endGroup(g);
			i++;
			continue;
		}
		if (c === "\\") {
			const next = rtf[i + 1];
			if (next === "'") {
				const hex = rtf.substr(i + 2, 2);
				i += 4;
				if (st.skipChars > 0) { st.skipChars--; continue; }
				const b = parseInt(hex, 16);
				if (st.dest === "pict" || Number.isNaN(b)) continue;
				if (st.afterGraphic && b === 0xac) { st.afterGraphic = false; continue; }
				st.afterGraphic = false;
				bytes.push(b);
				continue;
			}
			flushBytes();
			if (/[a-zA-Z]/.test(next || "")) {
				const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1, i + 40));
				const word = m[1], arg = m[2] == null ? null : +m[2];
				i += 1 + m[0].length;
				st.skipChars = 0;
				if (word === "bin" && arg > 0) { i += arg; continue; }
				if (st.star && !st.dest) { if (word === "fldinst" || word === "annotation" || word === "footnote" || word === "shppict") { if (word !== "shppict") startDest(word); } else st.skip = true; st.star = false; continue; }
				if (st.skip) continue;
				if (SKIP.has(word)) { st.skip = true; continue; }
				switch (word) {
					case "ansicpg": cp = arg || 1252; break;
					case "mac": cp = 10000; break;
					case "uc": st.uc = arg ?? 1; break;
					case "u": {
						let code = arg < 0 ? arg + 65536 : arg;
						st.skipChars = st.uc;
						if (st.dest === "pict") break;
						emit(String.fromCharCode(code));
						break;
					}
					case "par": case "sect": case "page":
						if (st.dest === "stylesheet" || st.dest === "listtext") break;
						if (st.dest === "fldinst") break;
						endPara();
						break;
					case "line": emit("\\\n", true); break;
					case "tab": emit(st.dest === "listtext" ? " " : "\t"); break;
					case "pard": st.style = 0; st.ls = 0; st.level = 0; break;
					case "plain": st.b = st.i = st.s = false; break;
					case "b": st.b = arg !== 0; break;
					case "i": st.i = arg !== 0; break;
					case "strike": case "striked": st.s = arg !== 0; break;
					case "s": if (st.dest === "stylesheet") { if (st.styleEntry) st.styleEntry.n = arg; } else st.style = arg; break;
					case "cs": case "ds": case "ts": if (st.dest === "stylesheet" && st.styleEntry) st.styleEntry.n = null; break;
					case "ls": st.ls = arg; break;
					case "ilvl": st.level = arg || 0; break;
					case "chftn": break;
					case "pngblip": if (st.pict) st.pict.kind = "png"; break;
					case "jpegblip": if (st.pict) st.pict.kind = "jpg"; break;
					case "rtf": case "ansi": case "pc": case "pca": break;
					default:
						if (SYMBOLS[word]) emit(SYMBOLS[word]);
						else if (["field", "fldinst", "fldrslt", "footnote", "annotation", "listtext", "pntext", "pict", "NeXTGraphic", "stylesheet"].includes(word)) startDest(word);
				}
				continue;
			}
			// A control symbol.
			i += 2;
			if (next === "*") { st.star = true; continue; }
			if (st.skip) continue;
			if (next === "\\" || next === "{" || next === "}") emit(next);
			else if (next === "~") emit("\u00a0");
			else if (next === "_") emit("\u2011");
			else if (next === "\n" || next === "\r") { if (st.dest !== "stylesheet") endPara(); }
			continue;
		}
		if (c === "\r" || c === "\n") { i++; continue; }
		flushBytes();
		if (st.skipChars > 0) { st.skipChars--; i++; continue; }
		if (st.afterGraphic && c === "¬") { st.afterGraphic = false; i++; continue; }
		st.afterGraphic = false;
		// Plain text up to the next special character, at once.
		let j = i + 1;
		while (j < n && !"{}\\\r\n".includes(rtf[j])) j++;
		emit(rtf.slice(i, j));
		i = j;
	}
	flushBytes();
	while (sinks.length > 1) sinks.pop();
	let text = blocks(sinks[0]);
	if (footnotes.length) text += "\n\n" + footnotes.map((t, k) => `[^${k + 1}]: ${t}`).join("\n");
	return { text: text.trim(), features: [...features] };
}
