// Page view: the note drawn on pages, as a word processor's print layout
// does. The page is the size Page setup gives (src/pagelayout.js), its margins
// padding around the text, and where a page fills up a gap is drawn: the rest
// of that page with its number, the desk, and the next page's top margin. A
// paragraph that runs off a page continues on the next, split at a line as it
// wraps; a <div class="pagebreak"></div> line (Insert > Page break) starts a
// new page. Lines far off screen are placed by estimate until they're drawn.
// Page setup's header and footer show in each page's top and bottom margins.
// Nothing is added to the note.

import { StateField, StateEffect } from "@codemirror/state";
import { EditorView, ViewPlugin, Decoration, WidgetType, BlockType } from "@codemirror/view";
import { pagePixels, paginate, readSetup, marginParts, marginText } from "./pagelayout.js";

export const PAGE_BREAK_LINE = /^\s*<div class="pagebreak"><\/div>\s*$/;
const GAP = 28; // the desk between pages, px

const setPage = StateEffect.define(); // { on, setup } (setup.title: the note's, for {title})
const setBreaks = StateEffect.define(); // [{ pos, inline, height, page, row?, end? }]

const pageField = StateField.define({
	create: () => ({ on: false, setup: null }),
	update(v, tr) { for (const e of tr.effects) if (e.is(setPage)) v = e.value; return v; },
	provide: (f) => EditorView.editorAttributes.from(f, (v) => {
		if (!v.on) return {};
		const p = pagePixels(v.setup);
		return { class: "page-view", style: `--page-w: ${p.w}px; --page-m: ${p.margin}px; --page-gap: ${GAP}px;` };
	}),
});

// A header or footer line: [left, center, right] in a page margin.
function marginLine(cls, cells, height) {
	const row = document.createElement("span");
	row.className = "page-mline " + cls;
	row.style.height = height + "px";
	for (const t of cells) { const c = document.createElement("span"); c.textContent = t; row.append(c); }
	return row;
}
// The header and footer texts for page n of pages, or null for none.
function marginCells(setup, edge, page, pages) {
	const parts = marginParts(setup[edge], { title: setup.title || "" });
	return parts && ["left", "center", "right"].map((k) => marginText(parts[k], page, pages));
}
const sameCells = (a, b) => (a ? a.join("|") : null) === (b ? b.join("|") : null);

class Gap extends WidgetType {
	constructor(height, page, inline, bottom, margin, foot, head) { super(); Object.assign(this, { height, page, inline, bottom, margin, foot, head }); }
	eq(o) { return o.height === this.height && o.page === this.page && o.inline === this.inline && o.bottom === this.bottom && sameCells(o.foot, this.foot) && sameCells(o.head, this.head); }
	toDOM() {
		const el = document.createElement(this.inline ? "span" : "div");
		el.className = "page-gap" + (this.inline ? " inline" : "") + (this.bottom ? " last" : "");
		el.style.height = this.height + "px";
		el.setAttribute("aria-hidden", "true");
		el.contentEditable = "false";
		// The end of page n: its bottom margin, holding the footer, and the
		// next page's top margin, holding its header.
		if (this.foot) el.append(marginLine("page-foot", this.foot, this.margin));
		if (this.head && !this.bottom) el.append(marginLine("page-head", this.head, this.margin));
		return el;
	}
	get estimatedHeight() { return this.height; }
	ignoreEvent() { return true; }
}

const breakField = StateField.define({
	create: () => [],
	update(v, tr) {
		for (const e of tr.effects) if (e.is(setBreaks)) return e.value;
		if (tr.docChanged) return v.map((b) => ({ ...b, pos: tr.changes.mapPos(b.pos, -1) }));
		if (tr.effects.some((e) => e.is(setPage) && !e.value.on)) return [];
		return v;
	},
	provide: (f) => EditorView.decorations.from(f, (list) => {
		if (!list.length) return Decoration.none;
		return Decoration.set(list.map((b) => Decoration.widget({
			widget: new Gap(b.height, b.page, b.inline, !!b.end, b.margin, b.foot, b.head),
			block: !b.inline, side: b.end ? 1 : -1,
		}).range(b.pos)), true);
	}),
});

export const isPageView = (view) => !!view?.state.field(pageField, false)?.on;
export function setPageView(view, on, setup) {
	if (view) view.dispatch({ effects: [setPage.of({ on: !!on, setup }), ...(on ? [] : [setBreaks.of([])])] });
}

// Measures the note's lines and works out the page breaks, ignoring the gaps
// already drawn (so the answer doesn't move as they come and go).
function measure(view) {
	const page = view.state.field(pageField);
	if (!page.on) return null;
	const px = pagePixels(page.setup);
	const setup = { ...readSetup(page.setup), title: page.setup?.title };
	const contentH = px.h - 2 * px.margin;
	const doc = view.state.doc;
	const drawn = view.state.field(breakField);
	const lh = view.defaultLineHeight;
	const { from: vFrom, to: vTo } = view.viewport;
	const contentLeft = view.contentDOM.getBoundingClientRect().left + px.margin + 2;
	const blocks = [];
	let last = -1;
	for (let n = 1; n <= doc.lines; n++) {
		const line = doc.line(n);
		const blk = view.lineBlockAt(line.from);
		if (blk.from === last) continue;
		last = blk.from;
		const mine = drawn.filter((b) => !b.end && b.pos >= blk.from && b.pos <= blk.to);
		const lead = mine.find((b) => !b.inline && b.pos === blk.from)?.height || 0;
		const height = blk.height - mine.reduce((s, b) => s + b.height, 0);
		// Plain text, or text with one of our gaps in front of it.
		const parts = Array.isArray(blk.type) ? blk.type : [blk];
		const text = parts.filter((x) => x.type === BlockType.Text).length === 1 && parts.length === (lead ? 2 : 1);
		let rows = 1;
		if (text && height > lh * 1.5) {
			const r = Math.round(height / lh);
			if (Math.abs(height - r * lh) < 2) rows = r;
		}
		const inView = blk.from >= vFrom && blk.to <= vTo;
		const split = (row) => {
			if (!inView || rows < 2) return null;
			const before = mine.filter((b) => b.inline && b.row != null && b.row <= row).reduce((s, b) => s + b.height, 0);
			const y = view.documentTop + blk.top + lead + before + row * lh + lh / 2;
			const pos = view.posAtCoords({ x: contentLeft, y }, false);
			return pos > blk.from && pos < blk.to ? pos : null;
		};
		const next = blk.to + 1 <= doc.length ? blk.to + 1 : null;
		blocks.push({ from: blk.from, height, rows, split, breakAfter: PAGE_BREAK_LINE.test(line.text), next });
	}
	const r = paginate(blocks, contentH);
	const cells = (edge, n) => marginCells(setup, edge, n, r.pages);
	const out = r.breaks.map((b, i) => ({ pos: b.pos, inline: b.inline, row: b.row, page: i + 1, margin: px.margin, height: Math.round(b.fill + 2 * px.margin + GAP), foot: cells("footer", i + 1), head: cells("header", i + 2) }));
	out.push({ pos: doc.length, inline: false, end: true, page: r.pages, margin: px.margin, height: Math.round(r.lastFill + px.margin), foot: cells("footer", r.pages) });
	return { breaks: out, firstHead: cells("header", 1), margin: px.margin };
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x.pos === b[i].pos && x.height === b[i].height && x.inline === b[i].inline && x.page === b[i].page && sameCells(x.foot, b[i].foot) && sameCells(x.head, b[i].head));

const pager = ViewPlugin.fromClass(class {
	constructor(view) { this.view = view; this.pending = false; this.burst = []; this.head = null; this.schedule(); }
	update(u) {
		const changed = u.docChanged || u.viewportChanged || u.geometryChanged || u.heightChanged
			|| u.startState.field(pageField) !== u.state.field(pageField);
		if (changed) this.schedule();
		if (u.state.field(pageField).on) this.align();
		else this.setHead(null);
	}
	destroy() { this.head?.remove(); }
	// Page 1's header sits in the content's top padding, outside any line, so
	// it's an overlay on the scroller rather than a widget.
	setHead(cells, margin) {
		if (!cells) { this.head?.remove(); this.head = null; this.headCells = null; return; }
		const line = marginLine("page-head first", cells, margin);
		line.setAttribute("aria-hidden", "true");
		if (this.head) this.head.replaceWith(line); else this.view.scrollDOM.append(line);
		this.head = line;
		this.align();
	}
	// Gaps span the whole page: one inside an indented list item starts at the
	// item's indent, so each is pulled out to the page's edges.
	align() {
		this.view.requestMeasure({
			key: "page-align",
			read: (view) => {
				const page = view.contentDOM.getBoundingClientRect(), sc = view.scrollDOM.getBoundingClientRect();
				const head = this.head && { top: page.top - sc.top + view.scrollDOM.scrollTop, left: page.left - sc.left + view.scrollDOM.scrollLeft, width: page.width };
				const gaps = [...view.contentDOM.querySelectorAll(".page-gap")].map((el) => {
					const r = el.getBoundingClientRect();
					return { el, shift: r.left - page.left, width: page.width, current: parseFloat(el.style.marginLeft) || null };
				});
				return { gaps, head };
			},
			write: ({ gaps, head }) => {
				if (head && this.head) Object.assign(this.head.style, { top: head.top + "px", left: head.left + "px", width: head.width + "px" });
				for (const g of gaps) {
					const base = g.current ?? (parseFloat(getComputedStyle(g.el).marginLeft) || 0);
					if (Math.abs(g.shift) < 0.5 && g.el.style.width === g.width + "px") continue;
					g.el.style.marginLeft = base - g.shift + "px";
					g.el.style.width = g.width + "px";
				}
			},
		});
	}
	schedule() {
		if (this.pending || !this.view.state.field(pageField).on) return;
		this.pending = true;
		this.view.requestMeasure({
			read: (view) => measure(view),
			write: (m, view) => {
				this.pending = false;
				if (!m) return;
				if (!sameCells(m.firstHead, this.headCells) || m.margin !== this.headMargin) {
					this.headCells = m.firstHead; this.headMargin = m.margin;
					this.setHead(m.firstHead, m.margin);
				}
				const list = m.breaks;
				if (same(list, view.state.field(breakField))) return;
				// Guard against layouts that never settle: at most 8 redraws a second.
				const now = Date.now();
				this.burst = this.burst.filter((t) => now - t < 1000);
				if (this.burst.length >= 8) { setTimeout(() => this.schedule(), 1000); return; }
				this.burst.push(now);
				queueMicrotask(() => view.dispatch({ effects: setBreaks.of(list) }));
			},
		});
	}
});

// A page break line shows as a labeled rule while the cursor is off it.
class BreakRule extends WidgetType {
	eq() { return true; }
	toDOM() { const d = document.createElement("div"); d.className = "md-pagebreak"; d.textContent = "Page break"; return d; }
}
const breakRule = Decoration.replace({ widget: new BreakRule(), block: true });
const breakLines = EditorView.decorations.compute(["doc", "selection"], (state) => {
	const out = [];
	const head = state.selection.main.head;
	for (let n = 1; n <= state.doc.lines; n++) {
		const l = state.doc.line(n);
		if (l.text.includes("pagebreak") && PAGE_BREAK_LINE.test(l.text) && !(head >= l.from && head <= l.to)) out.push(breakRule.range(l.from, l.to));
	}
	return Decoration.set(out);
});

export const pageView = [pageField, breakField, pager, breakLines];
