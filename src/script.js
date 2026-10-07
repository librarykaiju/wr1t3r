// The script layout: a note whose properties include
//   cssclasses:
//     - script
// is laid out as a screenplay, in the editor (src/scriptview.js) and in what
// Compile exports (src/exporter.js). The text stays plain lines, written the
// way screenwriters type in Fountain:
//
//   INT. DINER - NIGHT          a scene heading (INT., EXT., EST., INT./EXT., I/E)
//   Rain on the window.         action
//   MAYA                        a character: a line in capitals, then dialogue
//   (quietly)                   a parenthetical, in the dialogue
//   I thought you left.         dialogue, up to the next blank line
//   CUT TO:                     a transition: capitals ending in TO:, or FADE OUT.
//
// Nothing is added to the text; the layout only reads it.

import { cssClasses } from "./manuscript.js";

export const SCRIPT = "script";

export const isScript = (text) => /^---/.test(String(text || "")) && cssClasses(text).some((c) => /^(script|screenplay)$/i.test(c));

const SCENE = /^(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[. ]/i;
const TRANSITION = /^(?:[A-Z0-9 .'’-]+ TO:|FADE OUT\.?|FADE TO BLACK\.?|CUT TO BLACK\.?)$/;
// Capitals with at least one letter, maybe with an extension like (V.O.) or (CONT'D).
const CUE = /^(?=.*\p{Lu})[^\p{Ll}]*?(?:\s*\([^)]*\))?\s*\^?$/u;
const MARKUP = /^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\||<|%%|```|~~~|\[\^)/;

// Each line's part in the script: "scene", "action", "character", "paren",
// "dialogue", "transition", or null (blank, or Markdown like a heading or list).
export function scriptKinds(lines) {
	const out = new Array(lines.length).fill(null);
	let fence = null, comment = false, talk = false;
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i], line = raw.trim();
		const f = raw.match(/^\s*(`{3,}|~{3,})/);
		if (f) { fence = fence ? (f[1][0] === fence ? null : fence) : f[1][0]; talk = false; continue; }
		if (fence) continue;
		// %% comments %% can run over several lines.
		const marks = (raw.match(/%%/g) || []).length;
		if (comment || /^\s*%%/.test(raw)) {
			if (marks % 2) comment = !comment;
			talk = false;
			continue;
		}
		if (!line) { talk = false; continue; }
		if (talk) { out[i] = /^\(.*\)$/.test(line) ? "paren" : "dialogue"; continue; }
		if (MARKUP.test(raw)) continue;
		const before = i === 0 || !lines[i - 1].trim();
		const after = i + 1 < lines.length && lines[i + 1].trim();
		if (before && SCENE.test(line)) out[i] = "scene";
		else if (before && TRANSITION.test(line)) out[i] = "transition";
		else if (before && after && CUE.test(line) && /\p{L}/u.test(line) && !/[.:!?]$/.test(line.replace(/\s*\([^)]*\)\s*\^?$/, ""))) { out[i] = "character"; talk = true; }
		else out[i] = "action";
	}
	return out;
}
