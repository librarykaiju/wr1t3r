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

export function counts(text) {
	const body = stripFrontmatter(text);
	return { words: countWords(body), chars: countChars(body) };
}
