// Page setup: paper size, orientation and margins, per device. The page view
// (src/pageview.js) draws notes on pages of this size, and printing and
// exports (src/exporter.js) use the same pages.

export const SIZES = {
	letter: { label: "Letter (8.5 × 11 in)", w: 8.5, h: 11 },
	a4: { label: "A4 (210 × 297 mm)", w: 8.27, h: 11.69 },
	legal: { label: "Legal (8.5 × 14 in)", w: 8.5, h: 14 },
	a5: { label: "A5 (148 × 210 mm)", w: 5.83, h: 8.27 },
	trade: { label: "Book (6 × 9 in)", w: 6, h: 9 },
};
export const MARGINS = {
	normal: { label: "Normal (1 in)", in: 1 },
	moderate: { label: "Moderate (0.75 in)", in: 0.75 },
	narrow: { label: "Narrow (0.5 in)", in: 0.5 },
	wide: { label: "Wide (1.5 in)", in: 1.5 },
};
export const DEFAULT_SETUP = { size: "letter", orient: "portrait", margin: "normal" };

// A stored setup, with defaults for anything missing or unknown.
export function readSetup(raw) {
	const s = { ...DEFAULT_SETUP, ...(raw && typeof raw === "object" ? raw : {}) };
	if (!SIZES[s.size]) s.size = DEFAULT_SETUP.size;
	if (!MARGINS[s.margin]) s.margin = DEFAULT_SETUP.margin;
	if (s.orient !== "landscape") s.orient = "portrait";
	return s;
}

// The page in inches: { w, h, margin }.
export function pageInches(setup) {
	const s = readSetup(setup);
	const { w, h } = SIZES[s.size];
	return s.orient === "landscape" ? { w: h, h: w, margin: MARGINS[s.margin].in } : { w, h, margin: MARGINS[s.margin].in };
}

// CSS pixels (96 to the inch), for drawing pages on screen.
export function pagePixels(setup) {
	const p = pageInches(setup);
	return { w: Math.round(p.w * 96), h: Math.round(p.h * 96), margin: Math.round(p.margin * 96) };
}

// The @page rule printing uses.
export function pageRule(setup) {
	const p = pageInches(setup);
	return `@page { size: ${p.w}in ${p.h}in; margin: ${p.margin}in; }`;
}

// Word's page: twentieths of a point (1440 to the inch).
export function pageTwips(setup) {
	const p = pageInches(setup), t = (x) => Math.round(x * 1440);
	return { width: t(p.w), height: t(p.h), margin: t(p.margin) };
}

// The setup printing and exports use now (set by main.js).
let current = DEFAULT_SETUP;
export const setPageSetup = (s) => { current = readSetup(s); };
export const pageSetup = () => current;

// ---- Pagination ---------------------------------------------------------------
// blocks: the note's lines (and block widgets) top to bottom, each
// { from, height, rows, split(row) -> pos|null, breakAfter }: rows is how many
// lines of text it wraps to (1 for something that can't be split), split(n)
// the document position where its nth row starts (null when it can't tell),
// breakAfter a forced page break after it. contentH: a page's text height.
// -> { breaks: [{ pos, inline, fill, row? }], pages, lastFill }: before each
// pos the page ends, with fill px of the page left empty; inline breaks fall
// inside a paragraph, before its row'th row. lastFill: the empty space at the bottom of the last page.
export function paginate(blocks, contentH) {
	const breaks = [];
	let y = 0, pages = 1;
	const newPage = (pos, inline, row) => { breaks.push({ pos, inline, fill: Math.max(0, contentH - y), ...(inline ? { row } : {}) }); pages++; y = 0; };
	for (const b of blocks) {
		let h = b.height;
		if (y > 0 && y + h > contentH) {
			const rowH = b.rows > 1 ? h / b.rows : 0;
			const fit = rowH ? Math.floor((contentH - y) / rowH + 1e-6) : 0;
			const at = fit > 0 && fit < b.rows ? b.split(fit) : null;
			if (at != null) {
				y += fit * rowH;
				newPage(at, true, fit);
				h -= fit * rowH;
				// A paragraph longer than a page breaks again.
				let row = fit;
				while (h > contentH && rowH) {
					const more = Math.floor(contentH / rowH + 1e-6);
					const pos = more > 0 && row + more < b.rows ? b.split(row + more) : null;
					if (pos == null) break;
					row += more;
					y = more * rowH;
					newPage(pos, true, row);
					h -= more * rowH;
				}
			} else newPage(b.from, false);
		}
		y += h;
		if (y > contentH) y = y % contentH || contentH; // something taller than a page
		if (b.breakAfter && b.next != null) { newPage(b.next, false); }
	}
	return { breaks, pages, lastFill: Math.max(0, contentH - y) };
}
