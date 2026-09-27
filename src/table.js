// Markdown (GFM) tables in the editor: Tab and Shift-Tab move between cells
// and line the columns up, Enter at the end of a row adds a row, and a few
// slash commands add or remove rows and columns. Nothing reformats a table
// unless you use one of these keys or commands, so saves stay byte-faithful.

import { syntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { Decoration, ViewPlugin } from "@codemirror/view";

const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

// Cells of one row, split on "|" that aren't escaped or inside `code`.
export function cells(line) {
	const out = [];
	let cur = "", code = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === "\\" && line[i + 1] === "|") { cur += "\\|"; i++; continue; }
		if (ch === "`") code = !code;
		if (ch === "|" && !code) { out.push(cur); cur = ""; continue; }
		cur += ch;
	}
	out.push(cur);
	const t = line.trim();
	if (t.startsWith("|")) out.shift();
	if (t.endsWith("|") && !t.endsWith("\\|") && out.length > 1) out.pop();
	return out.map((c) => c.trim());
}

const align = (d) => (/^:-+:$/.test(d) ? "center" : /-:$/.test(d) ? "right" : /^:/.test(d) ? "left" : "");
const width = (s) => [...s].length;

// Lines of a table -> the same table with every column padded to one width.
// Rows with fewer cells get empty ones; the delimiter row keeps its alignment.
export function format(lines) {
	const rows = lines.map(cells);
	const n = Math.max(...rows.map((r) => r.length));
	const aligns = Array.from({ length: n }, (_, i) => align(rows[1]?.[i] || ""));
	const body = rows.map((r, ri) => (ri === 1 ? null : Array.from({ length: n }, (_, i) => r[i] ?? "")));
	const widths = aligns.map((_, i) => Math.max(3, ...body.filter(Boolean).map((r) => width(r[i]))));
	const pad = (s, w, a) => {
		const gap = w - width(s);
		if (a === "right") return " ".repeat(gap) + s;
		if (a === "center") return " ".repeat(gap >> 1) + s + " ".repeat(gap - (gap >> 1));
		return s + " ".repeat(gap);
	};
	return rows.map((_, ri) => {
		if (ri === 1) {
			return "| " + widths.map((w, i) => {
				const a = aligns[i];
				const dashes = "-".repeat(w - (a === "center" ? 2 : a ? 1 : 0));
				return a === "center" ? `:${dashes}:` : a === "right" ? `${dashes}:` : a === "left" ? `:${dashes}` : dashes;
			}).join(" | ") + " |";
		}
		return "| " + body[ri].map((c, i) => pad(c, widths[i], aligns[i])).join(" | ") + " |";
	});
}

// Which cell of a row the column `col` (offset in the line) is in.
export function cellIndex(line, col) {
	const before = line.slice(0, col);
	const n = cells(before + "x").length - 1; // cells fully before the cursor
	return Math.max(0, n);
}

// Offset of the start of cell i's text in a formatted row ("| a | b |").
export function cellStart(line, i) {
	let seen = -1, code = false;
	for (let k = 0; k < line.length; k++) {
		const ch = line[k];
		if (ch === "\\") { k++; continue; }
		if (ch === "`") code = !code;
		if (ch === "|" && !code && ++seen === i) {
			let s = k + 1;
			while (line[s] === " ") s++;
			// An empty cell: just inside it, not at its far end.
			if (line[s] === "|" || s >= line.length) s = Math.min(k + 2, s);
			return s;
		}
	}
	return line.length;
}

// The table around pos: {from, to, lines, row} (row = line index within it),
// or null. Uses the syntax tree, then checks the delimiter row itself.
export function tableAt(state, pos) {
	let node = syntaxTree(state).resolveInner(pos, -1);
	while (node && node.name !== "Table") node = node.parent;
	if (!node) {
		const n2 = syntaxTree(state).resolveInner(pos, 1);
		for (node = n2; node && node.name !== "Table"; node = node.parent);
	}
	if (!node) return null;
	const first = state.doc.lineAt(node.from), last = state.doc.lineAt(node.to);
	const lines = [];
	for (let l = first.number; l <= last.number; l++) lines.push(state.doc.line(l).text);
	if (lines.length < 2 || !DELIM.test(lines[1])) return null;
	return { from: first.from, to: last.to, lines, row: state.doc.lineAt(pos).number - first.number, firstLine: first.number };
}

// Replace the table with new lines and put the cursor in cell (row, cell).
function rewrite(view, t, lines, row, cell) {
	const nl = view.state.lineBreak;
	const text = lines.join(nl);
	let at = t.from;
	for (let r = 0; r < row; r++) at += lines[r].length + nl.length;
	at += cellStart(lines[row], cell);
	view.dispatch({ changes: { from: t.from, to: t.to, insert: text }, selection: EditorSelection.cursor(at), scrollIntoView: true, userEvent: "input.table" });
	return true;
}

function current(view) {
	const { state } = view;
	if (!state.selection.main.empty) return null;
	const pos = state.selection.main.head;
	const t = tableAt(state, pos);
	if (!t) return null;
	const line = state.doc.lineAt(pos);
	// Past a row's last "|" counts as its last cell.
	const cell = Math.min(cellIndex(line.text, pos - line.from), Math.max(0, cells(line.text).length - 1));
	return { t, cell, pos, line };
}

export function nextCell(view) {
	const c = current(view);
	if (!c) return false;
	const { t } = c;
	const n = Math.max(...t.lines.map((l) => cells(l).length));
	let row = t.row === 1 ? 2 : t.row, cell = t.row === 1 ? 0 : c.cell + 1;
	let lines = t.lines;
	if (cell >= n) { cell = 0; row++; if (row === 1) row = 2; }
	if (row >= lines.length) lines = [...lines, "|" + " |".repeat(n)];
	return rewrite(view, t, format(lines), row, cell);
}

export function prevCell(view) {
	const c = current(view);
	if (!c) return false;
	const { t } = c;
	const n = Math.max(...t.lines.map((l) => cells(l).length));
	let row = t.row, cell = c.cell - 1;
	if (cell < 0) { row = row === 2 ? 0 : row - 1; cell = n - 1; }
	if (row < 0) { row = 0; cell = 0; }
	if (row === 1) row = 0;
	return rewrite(view, t, format(t.lines), row, cell);
}

// Enter at the end of a row: a new empty row below it.
export function newRow(view) {
	const c = current(view);
	if (!c || c.pos !== c.line.to) return false;
	return addRow(view);
}

export function addRow(view) {
	const c = current(view);
	if (!c) return false;
	const { t } = c;
	const n = Math.max(...t.lines.map((l) => cells(l).length));
	const at = Math.max(t.row, 1) + 1;
	const lines = [...t.lines.slice(0, at), "|" + " |".repeat(n), ...t.lines.slice(at)];
	return rewrite(view, t, format(lines), at, 0);
}

export function addColumn(view) {
	const c = current(view);
	if (!c) return false;
	const { t, cell } = c;
	const lines = t.lines.map((l, ri) => {
		const r = cells(l);
		r.splice(cell + 1, 0, ri === 1 ? "---" : ri === 0 ? "Column" : "");
		return "| " + r.join(" | ") + " |";
	});
	return rewrite(view, t, format(lines), t.row, cell + 1);
}

export function deleteRow(view) {
	const c = current(view);
	if (!c || c.t.row < 2) return false; // the header and delimiter rows stay
	const { t } = c;
	const lines = t.lines.filter((_, i) => i !== t.row);
	return rewrite(view, t, format(lines), Math.min(t.row, lines.length - 1), 0);
}

export function deleteColumn(view) {
	const c = current(view);
	if (!c) return false;
	const { t, cell } = c;
	if (Math.max(...t.lines.map((l) => cells(l).length)) < 2) return false;
	const lines = t.lines.map((l) => {
		const r = cells(l);
		r.splice(cell, 1);
		return "| " + r.join(" | ") + " |";
	});
	return rewrite(view, t, format(lines), t.row === 1 ? 0 : t.row, Math.max(0, cell - 1));
}

export function formatTable(view) {
	const c = current(view);
	if (!c) return false;
	return rewrite(view, c.t, format(c.t.lines), c.t.row === 1 ? 0 : c.t.row, c.cell);
}

export const inTable = (state) => state.selection.main.empty && !!tableAt(state, state.selection.main.head);

// Keys, for the editor's keymap (ahead of the defaults).
export const tableKeymap = [
	{ key: "Tab", run: nextCell, shift: prevCell },
	{ key: "Enter", run: newRow },
];

// Tables are drawn in the monospace font so columns line up; the header row
// is bold and the dashes row faint.
const lineDeco = (cls) => Decoration.line({ class: cls });
export const tableStyle = ViewPlugin.define((view) => {
	const build = (v) => {
		const ranges = [];
		for (const { from, to } of v.visibleRanges) {
			syntaxTree(v.state).iterate({
				from, to,
				enter(n) {
					if (n.name !== "Table") return;
					const first = v.state.doc.lineAt(n.from).number, last = v.state.doc.lineAt(n.to).number;
					for (let l = first; l <= last; l++) {
						const line = v.state.doc.line(l);
						const cls = l === first ? "md-table md-table-head" : l === first + 1 ? "md-table md-table-delim" : "md-table";
						ranges.push(lineDeco(cls).range(line.from));
					}
					return false;
				},
			});
		}
		return Decoration.set(ranges, true);
	};
	return {
		decorations: build(view),
		update(u) { if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view); },
	};
}, { decorations: (v) => v.decorations });
