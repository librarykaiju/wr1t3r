// Tables drawn as real grids. While the cursor is outside a table it shows as
// a table with its cells' formatting (bold, code, links) applied; clicking a
// cell puts the cursor in that cell's text, and the table shows as markdown
// until the cursor leaves it (Tab / Shift-Tab / Enter work there as before).
// Links in a cell open like links anywhere else. Drawing only: the note's
// text is never changed here.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { cells, cellStart } from "./table.js";
import { target, wikiTarget, linkOpener } from "./links.js";

const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const alignOf = (d) => (/^:-+:$/.test(d) ? "center" : /-:$/.test(d) ? "right" : /^:/.test(d) ? "left" : "");

// Table lines -> { aligns, rows } (rows[0] is the header; the dashes row is dropped).
export function parseTable(lines) {
	const rows = lines.filter((_, i) => i !== 1).map(cells);
	const n = Math.max(...rows.map((r) => r.length));
	const aligns = Array.from({ length: n }, (_, i) => alignOf(cells(lines[1])[i] || ""));
	return { aligns, rows: rows.map((r) => Array.from({ length: n }, (_, i) => r[i] ?? "")) };
}

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

class GridWidget extends WidgetType {
	constructor(lines) { super(); this.lines = lines; }
	eq(o) { return o.lines.join("\n") === this.lines.join("\n"); }
	toDOM(view) {
		const wrap = document.createElement("div");
		wrap.className = "md-grid-wrap";
		const table = document.createElement("table");
		table.className = "md-grid";
		const { aligns, rows } = parseTable(this.lines);
		rows.forEach((row, r) => {
			const tr = document.createElement("tr");
			row.forEach((text, c) => {
				const cell = document.createElement(r === 0 ? "th" : "td");
				if (aligns[c]) cell.style.textAlign = aligns[c];
				cell.dataset.row = r === 0 ? 0 : r + 1; // line within the table
				cell.dataset.col = c;
				draw(inline(text), cell);
				tr.append(cell);
			});
			(r === 0 ? (table.tHead || table.createTHead()) : (table.tBodies[0] || table.createTBody())).append(tr);
		});
		wrap.append(table);
		wrap.addEventListener("mousedown", (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			const a = e.target.closest("a.md-cell-link");
			if (a && !e.shiftKey) return view.state.facet(linkOpener)?.(a.link);
			const cell = e.target.closest("td, th");
			const from = view.posAtDOM(wrap);
			const doc = view.state.doc;
			let pos = from;
			if (cell) {
				const line = doc.line(doc.lineAt(from).number + Number(cell.dataset.row));
				pos = line.from + Math.min(cellStart(line.text, Number(cell.dataset.col)), line.length);
			}
			view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
			view.focus();
		});
		wrap.addEventListener("click", (e) => { if (e.target.closest("a.md-cell-link")) e.preventDefault(); });
		return wrap;
	}
	ignoreEvent() { return true; }
}

function build(state) {
	const b = new RangeSetBuilder();
	const doc = state.doc;
	const sel = state.selection.ranges;
	syntaxTree(state).iterate({
		enter(n) {
			if (n.name !== "Table") return;
			const first = doc.lineAt(n.from), last = doc.lineAt(n.to);
			if (last.number - first.number < 1) return false;
			const lines = [];
			for (let l = first.number; l <= last.number; l++) lines.push(doc.line(l).text);
			if (!DELIM.test(lines[1])) return false;
			if (sel.some((r) => r.to >= first.from && r.from <= last.to)) return false; // being edited
			b.add(first.from, last.to, Decoration.replace({ widget: new GridWidget(lines), block: true }));
			return false;
		},
	});
	return b.finish();
}

export const tableGrid = StateField.define({
	create: build,
	update(deco, tr) {
		if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});
