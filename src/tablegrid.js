// Tables drawn as real grids you edit in place, like a spreadsheet. Click a
// cell to type in it; Tab, Enter and the up/down arrows move between cells,
// Esc stops. A bar over the table adds and removes rows and columns, and its
// Markdown button shows the table as text (as does moving the cursor into it
// with the keyboard). Typing "=" starts a formula (formula.js): "=B2*C2" for
// one cell, "=B*C" for the whole column; clicking a cell while typing one
// adds its name. Links in a cell open like links anywhere else.
// Only the cells you change are rewritten, with the table lined up; formula
// results are worked out again on every change.

import { StateField, StateEffect, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { cellStart } from "./table.js";
import { target, wikiTarget, linkOpener } from "./links.js";
import { readModel, writeModel, recalcModel, blockAt } from "./tablecalc.js";
import { recalc, isColumnFormula, shiftFormulas, colName, cellName } from "./formula.js";

export { parseTable } from "./tablecalc.js";

// A cell's inline markdown -> [{ type, text, children, href }] tokens, drawn
// below with DOM nodes (never innerHTML, so nothing in a note runs as HTML).
const INLINE = /(`+)([^`]+?)\1|\[\[([^\]\n]+)\]\]|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|==(.+?)==|\\([\\`*_{}[\]()#+\-.!|~=])/g;
export function inline(text) {
	const out = [];
	let last = 0;
	for (const m of text.matchAll(INLINE)) {
		if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
		last = m.index + m[0].length;
		if (m[2] != null) out.push({ type: "code", text: m[2] });
		else if (m[3] != null) {
			const t = wikiTarget(m[3]);
			const shown = m[3].includes("|") ? m[3].slice(m[3].indexOf("|") + 1) : m[3];
			out.push(t ? { type: "link", link: t, children: [{ type: "text", text: shown }] } : { type: "text", text: m[0] });
		} else if (m[4] != null) {
			const t = target(m[5]);
			out.push(t ? { type: "link", link: t, children: inline(m[4]) } : { type: "text", text: m[0] });
		} else if (m[6] || m[7]) out.push({ type: "link", link: { url: m[6] || m[7] }, children: [{ type: "text", text: m[6] || m[7] }] });
		else if (m[8] != null || m[9] != null) out.push({ type: "strong", children: inline(m[8] ?? m[9]) });
		else if (m[10] != null) out.push({ type: "del", children: inline(m[10]) });
		else if (m[11] != null || m[12] != null) out.push({ type: "em", children: inline(m[11] ?? m[12]) });
		else if (m[13] != null) out.push({ type: "mark", children: inline(m[13]) });
		else out.push({ type: "text", text: m[14] });
	}
	if (last < text.length) out.push({ type: "text", text: text.slice(last) });
	return out;
}

function draw(tokens, into) {
	for (const t of tokens) {
		if (t.type === "text") { into.append(t.text); continue; }
		const el = document.createElement(t.type === "link" ? "a" : t.type);
		if (t.type === "link") {
			el.className = "md-cell-link";
			el.href = t.link.url || "#";
			el.link = t.link;
		}
		if (t.type === "code") el.textContent = t.text;
		else draw(t.children, el);
		into.append(el);
	}
}


// The cell being edited: { pos (the table's start), row, col } or null. Rows
// count from the header (0); the dashes row isn't one.
const setEdit = StateEffect.define();
const gridEdit = StateField.define({
	create: () => null,
	update(v, tr) {
		for (const e of tr.effects) if (e.is(setEdit)) return e.value;
		if (v && tr.docChanged) return { ...v, pos: tr.changes.mapPos(v.pos, -1) };
		return v;
	},
});

// The formula behind a cell: its own, or its column's.
function formulaFor(model, row, col) {
	if (row < 1) return null;
	const own = model.formulas.get(cellName(row, col));
	if (own !== undefined) return own ? { src: own, column: false } : null;
	const whole = model.formulas.get(colName(col));
	return whole ? { src: whole, column: true } : null;
}

// What the cell's box shows while you edit it.
export function editText(model, row, col) {
	const f = formulaFor(model, row, col);
	return f ? "=" + f.src : (model.rows[row]?.[col] ?? "").replace(/\\\|/g, "|");
}

// Put what was typed into a cell. "=..." in a row under the header is a
// formula ("=B*C" belongs to the whole column); anything else is the cell's
// text, and keeps its column's formula off this cell. True if anything changed.
export function setCell(model, row, col, value) {
	const before = writeModel(model);
	value = value.trim();
	const key = cellName(row, col), whole = colName(col), f = model.formulas;
	if (row >= 1 && /^=./.test(value)) {
		const src = value.slice(1).trim();
		if (isColumnFormula(src)) { f.set(whole, src); f.delete(key); }
		else f.set(key, src);
	} else {
		if (row >= 1 && f.get(whole)) f.set(key, "");
		else f.delete(key);
		model.rows[row][col] = value.replace(/(?<!\\)\|/g, "\\|");
	}
	return writeModel(model) !== before;
}

// Row and column changes from the bar. Each takes the model and the cell
// being edited, and returns the cell to edit next.
export const ops = {
	addRow(m, at) {
		const i = Math.max(at.row, 0) + 1;
		m.rows.splice(i, 0, m.rows[0].map(() => ""));
		m.formulas = shiftFormulas(m.formulas, "row", i, 1);
		return { row: i, col: at.col };
	},
	addColumn(m, at) {
		const i = at.col + 1;
		for (const r of m.rows) r.splice(i, 0, "");
		m.aligns.splice(i, 0, "");
		m.formulas = shiftFormulas(m.formulas, "col", i, 1);
		return { row: at.row, col: i };
	},
	deleteRow(m, at) {
		if (at.row < 1) return at;
		m.rows.splice(at.row, 1);
		m.formulas = shiftFormulas(m.formulas, "row", at.row, -1);
		return { row: Math.min(at.row, m.rows.length - 1), col: at.col };
	},
	deleteColumn(m, at) {
		if (m.rows[0].length < 2) return at;
		for (const r of m.rows) r.splice(at.col, 1);
		m.aligns.splice(at.col, 1);
		m.formulas = shiftFormulas(m.formulas, "col", at.col, -1);
		return { row: at.row, col: Math.min(at.col, m.rows[0].length - 1) };
	},
	// The column's formula goes; its cells keep their last results as text.
	clearColumnFormula(m, at) {
		const name = colName(at.col);
		m.formulas.delete(name);
		for (const [k, v] of m.formulas) if (!v && k.replace(/\d+$/, "") === name) m.formulas.delete(k);
		return at;
	},
};

// Write the cell being edited (and apply op), then edit `next` (or stop).
function commit(view, wrap, next, op) {
	if (!wrap.isConnected) return null;
	const blk = blockAt(view.state, view.posAtDOM(wrap));
	if (!blk) return null;
	const model = readModel(blk.lines, blk.fline);
	const at = wrap.editing;
	let changed = false;
	if (at && at.row < model.rows.length && at.col < model.rows[0].length) changed = setCell(model, at.row, at.col, wrap.input.value);
	if (op && at) { next = op(model, at); changed = true; }
	const insert = changed ? writeModel(recalcModel(model), view.state.lineBreak) : null;
	wrap.committing = true;
	try {
		view.dispatch({
			changes: insert != null && insert !== view.state.sliceDoc(blk.from, blk.to) ? { from: blk.from, to: blk.to, insert } : undefined,
			effects: setEdit.of(next ? { pos: blk.from, ...next } : null),
			userEvent: "input.grid",
		});
	} finally { wrap.committing = false; }
	return blk.from;
}

// Stop editing (saving what was typed, or not) and put the cursor just after
// the table, so it stays a grid.
function leave(view, wrap, save) {
	const from = save ? commit(view, wrap, null) : view.posAtDOM(wrap);
	if (!save) view.dispatch({ effects: setEdit.of(null) });
	const blk = from != null && blockAt(view.state, from);
	if (blk) {
		const doc = view.state.doc;
		const after = blk.to < doc.length ? blk.to + 1 : blk.from > 0 ? blk.from - 1 : null;
		if (after != null) view.dispatch({ selection: { anchor: after } });
	}
	view.focus();
}

// Show the table as markdown with the cursor in cell (row, col).
function toMarkdown(view, wrap, row, col) {
	const from = wrap.editing ? commit(view, wrap, null) : view.posAtDOM(wrap);
	const blk = from != null && blockAt(view.state, from);
	if (!blk) return;
	const line = view.state.doc.line(blk.firstLine + (row === 0 ? 0 : row + 1));
	view.dispatch({ selection: { anchor: line.from + Math.min(cellStart(line.text, col), line.length) }, scrollIntoView: true });
	view.focus();
}

// Clicking a cell while typing a formula adds its name at the caret, or
// swaps the name just before it; with Shift, makes a range from that name.
export function insertRef(input, name, range) {
	const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
	const m = /\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?$/i.exec(input.value.slice(0, s));
	let start = s;
	if (m && /[=(,+\-*/^&<>:\s]$/.test(input.value.slice(0, s - m[0].length))) {
		start = s - m[0].length;
		if (range) name = m[0].split(":")[0] + ":" + name;
	}
	input.setRangeText(name, start, e, "end");
}

const BAR = [
	["addRow", "+ Row", "Add a row below"],
	["addColumn", "+ Column", "Add a column to the right"],
	["deleteRow", "− Row", "Delete this row"],
	["deleteColumn", "− Column", "Delete this column"],
	["clearColumnFormula", "No column formula", "Stop working out this column; its cells keep their numbers"],
	["markdown", "Markdown", "Edit the table as markdown"],
	["done", "Done", "Stop editing"],
];

function setup(wrap, view) {
	const input = document.createElement("input");
	input.className = "md-grid-input";
	input.setAttribute("autocomplete", "off");
	input.setAttribute("autocapitalize", "off");
	wrap.input = input;

	const bar = document.createElement("div");
	bar.className = "md-grid-bar";
	const addr = document.createElement("span");
	addr.className = "md-grid-addr";
	bar.append(addr);
	wrap.buttons = {};
	for (const [id, label, title] of BAR) {
		const b = document.createElement("button");
		b.type = "button";
		b.textContent = label;
		b.title = title;
		b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the cell's box focused
		b.addEventListener("click", () => {
			const at = wrap.editing;
			if (!at) return;
			if (id === "done") return leave(view, wrap, true);
			if (id === "markdown") return toMarkdown(view, wrap, at.row, at.col);
			commit(view, wrap, null, ops[id]);
		});
		wrap.buttons[id] = b;
		bar.append(b);
	}
	const hint = document.createElement("span");
	hint.className = "md-grid-hint";
	bar.append(hint);
	wrap.bar = bar;
	wrap.addr = addr;
	wrap.hint = hint;
	const showHint = () => {
		hint.textContent = input.value.trimStart().startsWith("=") ? "Click cells to add them" : "";
	};
	input.addEventListener("input", showHint);
	wrap.showHint = showHint;

	input.addEventListener("keydown", (e) => {
		const at = wrap.editing;
		if (!at || e.isComposing) return;
		const { rows, cols } = wrap.size;
		const go = (next, op) => { e.preventDefault(); commit(view, wrap, next, op); };
		if (e.key === "Enter") {
			if (at.row >= rows - 1) go(null, (m, a) => ops.addRow(m, { row: rows - 1, col: a.col }));
			else go({ row: at.row + 1, col: at.col });
		} else if (e.key === "Tab" && e.shiftKey) {
			const back = at.col > 0 ? { row: at.row, col: at.col - 1 } : at.row > 0 ? { row: at.row - 1, col: cols - 1 } : at;
			go(back);
		} else if (e.key === "Tab") {
			if (at.col < cols - 1) go({ row: at.row, col: at.col + 1 });
			else if (at.row < rows - 1) go({ row: at.row + 1, col: 0 });
			else go(null, (m) => ({ ...ops.addRow(m, { row: rows - 1, col: 0 }), col: 0 }));
		} else if (e.key === "ArrowUp" && at.row > 0) go({ row: at.row - 1, col: at.col });
		else if (e.key === "ArrowDown" && at.row < rows - 1) go({ row: at.row + 1, col: at.col });
		else if (e.key === "Escape") { e.preventDefault(); leave(view, wrap, false); }
	});
	// Clicking or tabbing away from the grid saves the cell.
	input.addEventListener("blur", () => {
		if (wrap.rendering || wrap.committing) return;
		queueMicrotask(() => {
			if (wrap.editing && wrap.isConnected && document.activeElement !== input) commit(view, wrap, null);
		});
	});

	wrap.addEventListener("mousedown", (e) => {
		if (e.button !== 0 || e.target === input || e.target.closest(".md-grid-bar")) return;
		e.preventDefault();
		const cell = e.target.closest("td[data-row], th[data-row]");
		const at = wrap.editing;
		const r = cell ? Number(cell.dataset.row) : -1, c = cell ? Number(cell.dataset.col) : -1;
		if (at && cell && input.value.trimStart().startsWith("=") && !(r === at.row && c === at.col)) {
			insertRef(input, cellName(r, c), e.shiftKey);
			showHint();
			return;
		}
		const a = e.target.closest("a.md-cell-link");
		if (a && !e.shiftKey) return view.state.facet(linkOpener)?.(a.link);
		if (!cell) return;
		if (view.state.readOnly) return toMarkdown(view, wrap, r, c);
		if (at) commit(view, wrap, { row: r, col: c });
		else view.dispatch({ effects: setEdit.of({ pos: view.posAtDOM(wrap), row: r, col: c }) });
	});
	wrap.addEventListener("click", (e) => { if (e.target.closest("a.md-cell-link")) e.preventDefault(); });
}

class GridWidget extends WidgetType {
	constructor(lines, fline, edit) { super(); this.lines = lines; this.fline = fline; this.edit = edit; }
	eq(o) {
		return o.lines.join("\n") === this.lines.join("\n") && o.fline === this.fline &&
			o.edit?.row === this.edit?.row && o.edit?.col === this.edit?.col;
	}
	toDOM(view) {
		const wrap = document.createElement("div");
		wrap.className = "md-grid-wrap";
		setup(wrap, view);
		this.render(wrap, view);
		return wrap;
	}
	updateDOM(dom, view) {
		if (!dom.input) return false;
		this.render(dom, view);
		return true;
	}
	render(wrap, view) {
		const model = readModel(this.lines, this.fline);
		const nRows = model.rows.length, nCols = model.rows[0].length;
		const e = this.edit;
		const edit = e && !view.state.readOnly && e.row < nRows && e.col < nCols ? { row: e.row, col: e.col } : null;
		const { errors } = model.formulas.size ? recalc(model.rows, model.formulas) : { errors: new Map() };
		const input = wrap.input;
		wrap.rendering = true;
		wrap.editing = edit;
		wrap.size = { rows: nRows, cols: nCols };

		const table = document.createElement("table");
		table.className = "md-grid";
		const thead = table.createTHead(), tbody = table.createTBody();
		if (edit) { // column letters and row numbers, for writing formulas
			const tr = document.createElement("tr");
			tr.className = "md-grid-letters";
			tr.append(document.createElement("th"));
			for (let c = 0; c < nCols; c++) {
				const th = document.createElement("th");
				th.textContent = colName(c);
				if (c === edit.col) th.className = "md-grid-here";
				tr.append(th);
			}
			thead.append(tr);
		}
		model.rows.forEach((row, r) => {
			const tr = document.createElement("tr");
			if (edit) {
				const th = document.createElement("th");
				th.className = "md-grid-num" + (r === edit.row ? " md-grid-here" : "");
				th.textContent = r + 1;
				tr.append(th);
			}
			row.forEach((text, c) => {
				const cell = document.createElement(r === 0 ? "th" : "td");
				if (model.aligns[c]) cell.style.textAlign = model.aligns[c];
				cell.dataset.row = r;
				cell.dataset.col = c;
				const f = formulaFor(model, r, c);
				if (f) {
					cell.classList.add("md-grid-calc");
					cell.title = `${cellName(r, c)} = ${f.src}${f.column ? " (whole column)" : ""}`;
					const err = errors.get(cellName(r, c));
					if (err || /^\\#[A-Z/0-9]+[!?]$/.test(text)) {
						cell.classList.add("md-grid-err");
						if (err) cell.title += `\n${err}`;
					}
				}
				if (edit && r === edit.row && c === edit.col) {
					cell.classList.add("md-grid-editing");
					cell.append(input);
				} else draw(inline(text), cell);
				tr.append(cell);
			});
			(r === 0 ? thead : tbody).append(tr);
		});

		wrap.bar.hidden = !edit;
		wrap.classList.toggle("md-grid-active", !!edit);
		if (edit) {
			wrap.addr.textContent = cellName(edit.row, edit.col);
			wrap.buttons.deleteRow.hidden = edit.row < 1;
			wrap.buttons.deleteColumn.hidden = nCols < 2;
			wrap.buttons.clearColumnFormula.hidden = !model.formulas.get(colName(edit.col));
		}
		wrap.replaceChildren(wrap.bar, table);
		if (edit) {
			// A new cell, or its text changed under us: load it; otherwise keep what's being typed.
			const key = `${edit.row},${edit.col}`, text = editText(model, edit.row, edit.col);
			if (wrap.loaded?.key !== key || wrap.loaded.text !== text) {
				input.value = text;
				wrap.loaded = { key, text };
				input.select(); // typing replaces the cell, as in a spreadsheet; click or arrows to change it
			}
			wrap.showHint();
			input.focus({ preventScroll: true });
			input.scrollIntoView?.({ block: "nearest", inline: "nearest" });
		} else wrap.loaded = null;
		wrap.rendering = false;
		view.requestMeasure();
	}
	ignoreEvent() { return true; }
}

function build(state) {
	const b = new RangeSetBuilder();
	const doc = state.doc;
	const sel = state.selection.ranges;
	const edit = state.field(gridEdit, false);
	syntaxTree(state).iterate({
		enter(n) {
			if (n.name !== "Table") return;
			const blk = blockAt(state, n.from);
			if (!blk || blk.from !== doc.lineAt(n.from).from) return false;
			const mine = edit && edit.pos === blk.from;
			if (!mine && sel.some((r) => r.to >= blk.from && r.from <= blk.to)) return false; // being edited as markdown
			b.add(blk.from, blk.to, Decoration.replace({ widget: new GridWidget(blk.lines, blk.fline, mine ? edit : null), block: true }));
			return false;
		},
	});
	return b.finish();
}

const gridField = StateField.define({
	create: build,
	update(deco, tr) {
		if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(setEdit)) || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

export const tableGrid = [gridEdit, gridField];
