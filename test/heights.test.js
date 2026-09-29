import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CodeMirror works out where every line is from the heights it measures, and
// those leave out margins. A margin on an editor line or a block widget puts
// everything below it lower than CodeMirror thinks, and the arrow keys start
// skipping lines (as they did under the daily note's properties and dataview blocks).
test("editor lines and block widgets keep their spacing out of margins", () => {
	const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	const roots = ["md-fm", "md-banner", "md-cover", "md-dv", "md-dql", "md-embed-wrap", "md-image", "md-grid-wrap", "md-backlinks", "md-base", "md-base-sourcebar", "cm-line"];
	const bad = [];
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const [sel, body] = [m[1].trim(), m[2]];
		// Only rules for the element itself (the last compound names one of the roots), not its insides.
		const hits = sel.split(",").some((s) => {
			const last = s.trim().split(/[\s>+~]+/).pop();
			return roots.some((r) => new RegExp(`\\.${r}(?![\\w-])`).test(last));
		});
		if (hits && /(^|[;\s])margin(-top|-bottom)?\s*:/.test(body) && !/margin\s*:\s*0\s*(;|$)/.test(body)) bad.push(sel);
	}
	assert.deepEqual(bad, []);
});
