// Conflict copies: when a note changed in two places before they synced,
// sync (src/sync.js) or the local folder (src/localvault.js) keeps both, the
// second version as "Note (conflict 2026-11-03).md" next to the note. This
// file works out how to put them back together; src/conflictview.js shows
// the choice.

import { lineDiff } from "./history.js";

// Every line of both versions, in order: lines the two share once, and each
// side's own lines where they fall. A task that is ticked on one side and
// still open on the other comes out once, ticked; any other line that differs
// shows up both ways, for the person to tidy.
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[(.)\]\s?/;
const taskKey = (line) => {
	const m = line.match(TASK);
	return m ? m[1] + "[ ] " + line.slice(m[0].length).replace(/\s*✅ ?\d{4}-\d{2}-\d{2}/u, "").trimEnd() : null;
};
const isDone = (line) => /^[xX]$/.test(line.match(TASK)?.[2] || "");
export function mergeLines(original, copy) {
	const lines = lineDiff(original, copy);
	const done = new Set(lines.filter((l) => l.op !== "same" && isDone(l.text)).map((l) => taskKey(l.text)));
	return lines
		.filter((l) => l.op === "same" || isDone(l.text) || !done.has(taskKey(l.text)))
		.map((l) => l.text)
		.join("\n");
}

// How the copy differs from the original: { added, removed } line counts.
export function diffCounts(original, copy) {
	let added = 0, removed = 0;
	for (const l of lineDiff(original, copy)) {
		if (l.op === "add") added++;
		else if (l.op === "del") removed++;
	}
	return { added, removed };
}
