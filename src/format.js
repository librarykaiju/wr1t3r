// Underline, text color and alignment. Markdown has none of them, so they're
// written as the HTML other Markdown apps show too:
//   <u>words</u>   <span style="color: #3b7dd8">words</span>
//   <p align="center">a paragraph</p>
// The editor draws them (underlined, colored, aligned) with the tags dimmed.

import { EditorSelection } from "@codemirror/state";
import { ViewPlugin, Decoration } from "@codemirror/view";
import { menu } from "./basesui.js";

export const COLORS = [
	["Red", "#d1453b"], ["Orange", "#d9822b"], ["Green", "#3a9d5d"],
	["Blue", "#3b7dd8"], ["Purple", "#8e5bd0"], ["Gray", "#8a8a8a"],
];
export const ALIGNS = [["Left", null], ["Center", "center"], ["Right", "right"], ["Justify", "justify"]];

const COLOR_OPEN = /<span style="color: ?([^";]+);?">$/;

// Wraps each selection in open/close, or unwraps it when the tags sit just
// around it (or at its ends). With nothing selected, the cursor lands between.
export function toggleTag(state, open, close) {
	return state.changeByRange((r) => {
		const text = state.sliceDoc(r.from, r.to);
		if (text.startsWith(open) && text.endsWith(close) && text.length >= open.length + close.length) {
			return { changes: [{ from: r.from, to: r.from + open.length }, { from: r.to - close.length, to: r.to }], range: EditorSelection.range(r.from, r.to - open.length - close.length) };
		}
		if (state.sliceDoc(r.from - open.length, r.from) === open && state.sliceDoc(r.to, r.to + close.length) === close) {
			return { changes: [{ from: r.from - open.length, to: r.from }, { from: r.to, to: r.to + close.length }], range: EditorSelection.range(r.from - open.length, r.to - open.length) };
		}
		return { changes: [{ from: r.from, insert: open }, { from: r.to, insert: close }], range: EditorSelection.range(r.from + open.length, r.to + open.length) };
	});
}

// Colors each selection (color null takes the color off). A color span just
// around the selection is changed rather than nested.
export function setColor(state, color) {
	return state.changeByRange((r) => {
		const before = state.sliceDoc(Math.max(0, r.from - 60), r.from).match(COLOR_OPEN);
		if (before && state.sliceDoc(r.to, r.to + 7) === "</span>") {
			const start = r.from - before[0].length;
			if (!color) return { changes: [{ from: start, to: r.from }, { from: r.to, to: r.to + 7 }], range: EditorSelection.range(start, r.to - before[0].length) };
			const open = `<span style="color: ${color}">`;
			const shift = open.length - before[0].length;
			return { changes: [{ from: start, to: r.from, insert: open }], range: EditorSelection.range(r.from + shift, r.to + shift) };
		}
		if (!color) return { range: r };
		const open = `<span style="color: ${color}">`;
		return { changes: [{ from: r.from, insert: open }, { from: r.to, insert: "</span>" }], range: EditorSelection.range(r.from + open.length, r.to + open.length) };
	});
}

// The paragraphs the selection touches, as [first line, last line] numbers.
function paragraphs(state) {
	const out = [];
	for (const r of state.selection.ranges) {
		let a = state.doc.lineAt(r.from).number, b = state.doc.lineAt(r.to).number;
		while (a > 1 && state.doc.line(a - 1).text.trim()) a--;
		while (b < state.doc.lines && state.doc.line(b + 1).text.trim()) b++;
		if (!out.some(([x, y]) => x === a && y === b)) out.push([a, b]);
	}
	return out;
}

const P_OPEN = /^<p align="(\w+)">/;

// Aligns each paragraph the selection touches (align null = back to left).
export function setAlign(state, align) {
	const changes = [];
	for (const [a, b] of paragraphs(state)) {
		const first = state.doc.line(a), last = state.doc.line(b);
		if (!first.text.trim()) continue;
		const m = first.text.match(P_OPEN);
		if (m && last.text.endsWith("</p>")) {
			if (align) changes.push({ from: first.from, to: first.from + m[0].length, insert: `<p align="${align}">` });
			else changes.push({ from: first.from, to: first.from + m[0].length }, { from: last.to - 4, to: last.to });
		} else if (align) changes.push({ from: first.from, insert: `<p align="${align}">` }, { from: last.to, insert: "</p>" });
	}
	return { changes };
}

const run = (fn) => (view) => view.dispatch(view.state.update(fn(view.state), { userEvent: "input", scrollIntoView: true }));
export const underline = run((s) => toggleTag(s, "<u>", "</u>"));

// Menus under a toolbar button (or at the cursor, from the slash menu).
function at(view, anchor) {
	if (anchor) { const b = anchor.getBoundingClientRect(); return [b.left, b.bottom + 4]; }
	const c = view.coordsAtPos(view.state.selection.main.head);
	return c ? [c.left, c.bottom + 4] : [100, 100];
}
export function colorMenu(view, anchor) {
	const [x, y] = at(view, anchor);
	menu([...COLORS.map(([name, hex]) => [name, () => { run((s) => setColor(s, hex))(view); view.focus(); }, "color-item"]), null, ["No color", () => { run((s) => setColor(s, null))(view); view.focus(); }]], x, y);
	document.querySelectorAll(".item-menu .color-item").forEach((b, i) => b.style.setProperty("--swatch", COLORS[i][1]));
}
export function alignMenu(view, anchor) {
	const [x, y] = at(view, anchor);
	menu(ALIGNS.map(([name, v]) => [name, () => { run((s) => setAlign(s, v))(view); view.focus(); }]), x, y);
}

// Drawing: underlined and colored text, aligned paragraphs.
const UNDERLINED = /<u>([\s\S]*?)<\/u>/g;
const COLORED = /<span style="color: ?([^";<>]+);?">([\s\S]*?)<\/span>/g;
const ALIGNED = /^<p align="(left|center|right|justify)">[\s\S]*?<\/p>$/gm;
export const formatLook = ViewPlugin.define((view) => {
	const build = (state) => {
		const text = state.sliceDoc();
		if (!/<u>|<span style="color|<p align=/.test(text)) return Decoration.none;
		const ranges = [];
		for (const m of text.matchAll(UNDERLINED)) if (m[1]) ranges.push(Decoration.mark({ class: "md-u" }).range(m.index + 3, m.index + 3 + m[1].length));
		for (const m of text.matchAll(COLORED)) {
			if (!m[2]) continue;
			const from = m.index + m[0].length - 7 - m[2].length;
			ranges.push(Decoration.mark({ class: "md-colored", attributes: { style: `--text-c: ${m[1].replace(/[^#\w(),.% -]/g, "")}` } }).range(from, from + m[2].length));
		}
		for (const m of text.matchAll(ALIGNED)) {
			const deco = Decoration.line({ attributes: { style: `text-align: ${m[1]}` } });
			for (let p = m.index; p <= m.index + m[0].length; ) {
				const line = state.doc.lineAt(p);
				ranges.push(deco.range(line.from));
				p = line.to + 1;
			}
		}
		return Decoration.set(ranges, true);
	};
	return {
		decorations: build(view.state),
		update(u) { if (u.docChanged) this.decorations = build(u.state); },
	};
}, { decorations: (v) => v.decorations });
