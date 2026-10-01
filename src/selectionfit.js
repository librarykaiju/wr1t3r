// CodeMirror draws a selection as pieces as tall as the letters (about 1.1em),
// not the line (1.65), so a selection's first and last lines got thin strips
// riding against a taller middle. This snaps each piece's top and bottom to
// the nearest line edge within its paragraph, so the highlight covers whole
// lines and the pieces meet. It runs after CodeMirror draws them, and again
// whenever it moves them.

import { ViewPlugin } from "@codemirror/view";

// The line edge nearest y in a paragraph at top..top+height whose wrapped
// lines are lh tall. A line that isn't a run of lh-tall rows (a heading)
// snaps to its own top or bottom.
export function snapEdge(y, top, height, lh) {
	const rows = Math.round(height / lh);
	if (rows < 1 || Math.abs(rows * lh - height) > 2) return y - top < height / 2 ? top : top + height;
	const k = Math.min(rows, Math.max(0, Math.round((y - top) / lh)));
	return top + k * lh;
}

export const selectionFit = ViewPlugin.fromClass(class {
	constructor(view) {
		this.view = view;
		this.layer = null;
		this.obs = new MutationObserver(() => this.fit());
		this.attach();
	}
	attach() {
		const layer = this.view.dom.querySelector(".cm-selectionLayer");
		if (!layer || layer === this.layer) return;
		this.obs.disconnect();
		this.layer = layer;
		this.obs.observe(layer, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
		this.fit();
	}
	update() { this.attach(); }
	fit() {
		const view = this.view, pieces = this.layer?.querySelectorAll(".cm-selectionBackground");
		if (!pieces?.length) return;
		const lh = view.defaultLineHeight;
		// Piece coordinates -> document heights.
		const offset = this.layer.getBoundingClientRect().top - view.documentTop;
		const edge = (y, below) => {
			const b = view.lineBlockAtHeight(below ? y - 0.5 : y + 0.5);
			return snapEdge(y, b.top, b.height, lh);
		};
		for (const el of pieces) {
			// Already fitted, and CodeMirror hasn't moved it since.
			if (el._fit && el.style.top === el._fit.top && el.style.height === el._fit.height) continue;
			const top = parseFloat(el.style.top) + offset, bottom = top + parseFloat(el.style.height);
			if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
			const t = edge(top, false), b = Math.max(t, edge(bottom, true));
			el.style.top = t - offset + "px";
			el.style.height = b - t + "px";
			el._fit = { top: el.style.top, height: el.style.height };
		}
	}
	destroy() { this.obs.disconnect(); }
});
