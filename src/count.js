// Word and character counts for the status bar. Frontmatter isn't counted.
// Markdown marks (#, *, -, >) aren't letters, so they drop out on their own.
// Chinese and Japanese characters count one word each, since they're written
// without spaces.

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const WORD = /[\p{L}\p{N}\p{M}]+(?:['’\-][\p{L}\p{N}\p{M}]+)*/gu;

export function stripFrontmatter(text) {
	const m = text.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
	return m ? text.slice(m[0].length) : text;
}

export function countWords(text) {
	let n = 0;
	const rest = text.replace(CJK, () => { n++; return " "; });
	for (const _ of rest.matchAll(WORD)) n++;
	return n;
}

// Characters as people count them: spaces included, line breaks not.
export function countChars(text) {
	let n = 0;
	for (const ch of text) if (ch !== "\n" && ch !== "\r") n++;
	return n;
}

// HTML tags (<u>, <span style=...>) aren't words.
const TAGS = /<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g;

export function counts(text) {
	const body = stripFrontmatter(text).replace(TAGS, "");
	return { words: countWords(body), chars: countChars(body) };
}

// Reading time, sentences and paragraphs, for the word count's panel. Code
// blocks, tables and markup lines (---, HTML-only) aren't prose, so they're
// left out of the sentence counts. A line with words and no closing . ! or ?
// (a heading, a list item) counts as one sentence.
export const READING_WPM = 238;
export function stats(text) {
	const body = stripFrontmatter(text).replace(TAGS, "").replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "");
	const words = countWords(body);
	let sentences = 0, paragraphs = 0, inPara = false;
	for (const raw of body.split(/\r?\n/)) {
		const line = raw.replace(/%%.*?%%/g, "");
		const prose = countWords(line) > 0 && !/^\s*\|/.test(line);
		if (!prose) { inPara = false; continue; }
		if (!inPara) { paragraphs++; inPara = true; }
		const ends = line.match(/[.!?…]+["'”’)\]]*(?=\s|$)/g)?.length || 0;
		sentences += ends || 1;
		if (ends && !/[.!?…]["'”’)\]]*\s*$/.test(line.trimEnd())) sentences++; // words after the last stop
	}
	return {
		words,
		chars: countChars(body),
		sentences,
		paragraphs,
		perSentence: sentences ? Math.round((words / sentences) * 10) / 10 : 0,
		minutes: words ? Math.max(1, Math.round(words / READING_WPM)) : 0,
	};
}

// A note's word goal from its frontmatter (`goal: 2000`), or null.
export function noteGoal(text) {
	const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)/)?.[1];
	const n = Number(fm?.match(/^goal:[ \t]*["']?(\d+)/m)?.[1]);
	return n > 0 ? n : null;
}
