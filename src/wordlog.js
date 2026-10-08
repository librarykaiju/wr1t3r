// Words written today on this device, for a words habit (src/habits.js):
// main.js notes each note's text when an edit starts, and a few seconds after
// typing stops adds the change in its word count to today's tally. Only prose
// counts: front matter, code blocks (the planner's settings among them) and
// HTML tags don't, and neither do health notes, templates or wr1t3r's own
// notes. Deleting words takes them off, down to none.

import { stripFrontmatter, countWords } from "./count.js";

const TAGS = /<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g;
const FENCES = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm;

export const proseWords = (text) => countWords(stripFrontmatter(String(text ?? "")).replace(FENCES, "").replace(TAGS, ""));

// Whether edits to a note count toward words written.
export function countsTowardWords(path) {
	return /\.md$/i.test(path) && !/ Health\.md$/i.test(path) && !/(^|\/)_?(templates|wr1t3r)\//i.test(path) && !/(^|\/)(Medications|Nutrition Database)\.md$/i.test(path);
}

// The tally after an edit: { day, n } for `day` (a new day starts at 0).
export function addWords(tally, day, delta) {
	const n = tally && tally.day === day ? tally.n : 0;
	return { day, n: Math.max(0, n + delta) };
}
