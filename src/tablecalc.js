// A table as data: its cells, column alignment and formulas (the comment line
// under it, see formula.js), read from the note and written back. Also keeps
// formula results current after the table is edited as markdown: once the
// cursor leaves a table it changed, its formulas are worked out again.

import { ViewPlugin } from "@codemirror/view";
import { cells, format, tableAt } from "./table.js";
import { readFormulas, writeFormulas, recalc, isColumnFormula, colName, cellName } from "./formula.js";

const alignOf = (d) => (/^:-+:$/.test(d) ? "center" : /-:$/.test(d) ? "right" : /^:/.test(d) ? "left" : "");
const dashes = { center: ":-:", right: "--:", left: ":--", "": "---" };

// Table lines -> { aligns, rows } (rows[0] is the header; the dashes row is dropped).
export function parseTable(lines) {
	const rows = lines.filter((_, i) => i !== 1).map(cells);
	const n = Math.max(...rows.map((r) => r.length));
	const aligns = Array.from({ length: n }, (_, i) => alignOf(cells(lines[1])[i] || ""));
	return { aligns, rows: rows.map((r) => Array.from({ length: n }, (_, i) => r[i] ?? "")) };
}

export function readModel(lines, fline) {
	return { ...parseTable(lines), formulas: readFormulas(fline) || new Map() };
}

// The model -> the block's text: the table (columns lined up) and, when it
// has formulas, their comment line.
export function writeModel(model, nl = "\n") {
	const row = (r) => "| " + r.join(" | ") + " |";
	const lines = format([row(model.rows[0]), row(model.aligns.map((a) => dashes[a])), ...model.rows.slice(1).map(row)]);
	const fline = writeFormulas(model.formulas);
	return lines.join(nl) + (fline ? nl + fline : "");
}

export const recalcModel = (model) => ({ ...model, rows: recalc(model.rows, model.formulas).rows });

// The table block at pos (a table, plus the formula line right under it):
// { from, to, tableTo, lines, fline, firstLine } or null. pos may be on the
// formula line.
export function blockAt(state, pos) {
	const doc = state.doc;
	let t = tableAt(state, pos);
	if (!t) {
		const line = doc.lineAt(pos);
		if (line.number > 1 && readFormulas(line.text)) t = tableAt(state, doc.line(line.number - 1).to);
	}
	if (!t) return null;
	const last = doc.lineAt(t.to);
	const below = last.number < doc.lines ? doc.line(last.number + 1) : null;
	const fline = below && readFormulas(below.text) ? below.text : null;
	return { from: t.from, to: fline ? below.to : t.to, tableTo: t.to, lines: t.lines, fline, firstLine: t.firstLine };
}

// Cells typed as markdown that start with "=" (under the header) become
// formulas, as they would in the grid: "| 35 | 7 | =A1*B1 |". True if any did.
export function takeTypedFormulas(model) {
	let found = false;
	model.rows.forEach((row, r) => {
		if (r < 1) return;
		row.forEach((text, c) => {
			const t = text.trim();
			if (!/^=\s*\S/.test(t)) return;
			const src = t.slice(1).trim();
			const f = model.formulas;
			if (isColumnFormula(src)) { f.set(colName(c), src); f.delete(cellName(r, c)); }
			else f.set(cellName(r, c), src);
			found = true;
		});
	});
	return found;
}

// The change that brings a table's formula results up to date, or null.
export function recalcChange(state, blk) {
	const model = readModel(blk.lines, blk.fline);
	const typed = takeTypedFormulas(model);
	if (!model.formulas.size) return null;
	const next = recalcModel(model);
	if (!typed && next.rows.every((r, i) => r.every((c, j) => c === model.rows[i][j]))) return null;
	return { from: blk.from, to: blk.to, insert: writeModel(next, state.lineBreak) };
}

const touches = (sel, blk) => sel.ranges.some((r) => r.to >= blk.from && r.from <= blk.to);

// Tables edited as markdown get their formulas worked out again when the
// cursor leaves them (not while typing in them, so nothing moves under you).
export const tableCalc = ViewPlugin.fromClass(class {
	constructor(view) { this.view = view; this.dirty = []; this.timer = 0; }
	update(u) {
		if (u.docChanged) {
			this.dirty = this.dirty.map((p) => u.changes.mapPos(p, -1));
			const typed = u.transactions.some((tr) => tr.docChanged &&
				(tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("move")) &&
				!tr.isUserEvent("input.grid") && !tr.isUserEvent("input.calc"));
			if (typed) {
				u.changes.iterChangedRanges((_fa, _ta, from, to) => {
					for (const p of new Set([from, to])) {
						const blk = blockAt(u.state, Math.min(p, u.state.doc.length));
						if (blk && !this.dirty.includes(blk.from)) this.dirty.push(blk.from);
					}
				});
			}
		}
		if (this.dirty.length && (u.docChanged || u.selectionSet) && !this.timer) {
			this.timer = setTimeout(() => { this.timer = 0; this.check(); });
		}
	}
	check() {
		const { state } = this.view;
		const keep = [], changes = [];
		for (const p of this.dirty) {
			const blk = p <= state.doc.length ? blockAt(state, p) : null;
			if (!blk || blk.from !== p) continue;
			if (touches(state.selection, blk)) { keep.push(p); continue; }
			const ch = recalcChange(state, blk);
			if (ch) changes.push(ch);
		}
		this.dirty = keep;
		if (changes.length) this.view.dispatch({ changes, userEvent: "input.calc" });
	}
	destroy() { clearTimeout(this.timer); }
});
