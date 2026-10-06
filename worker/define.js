// Dictionary and thesaurus for the "Look up" command (the lookups themselves
// are in src/define.js, shared with a device that has no Worker).
//
//   GET /api/define?word=  -> {word, phonetic, meanings: [{part, definitions:
//                             [{text, example}]}], synonyms: [...]}

import { HttpError } from "./util.js";
import { cleanWord, isWord, defineWord } from "../src/define.js";

const get = async (url) => {
	try {
		const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "wr1t3r" }, cf: { cacheTtl: 86400, cacheEverything: true } });
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
};

export async function defineApi(request, env, url) {
	if (url.pathname !== "/api/define") return null;
	if (request.method !== "GET") throw new HttpError(405, "GET");
	const word = cleanWord(url.searchParams.get("word"));
	if (!isWord(word)) throw new HttpError(400, "Send one word");
	return defineWord(word, get);
}
