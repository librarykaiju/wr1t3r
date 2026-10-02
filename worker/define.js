// Dictionary and thesaurus for the "Look up" command: definitions from Free
// Dictionary API (dictionaryapi.dev, Wiktionary data) and synonyms from
// Datamuse. Both are free and need no key.
//
//   GET /api/define?word=  -> {word, phonetic, meanings: [{part, definitions:
//                             [{text, example}]}], synonyms: [...]}

import { HttpError } from "./util.js";

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
	const word = (url.searchParams.get("word") || "").trim().toLowerCase();
	if (!word || word.length > 60 || !/^[\p{L}'’ -]+$/u.test(word)) throw new HttpError(400, "Send one word");
	const w = encodeURIComponent(word);
	const [dict, syn, near] = await Promise.all([
		get(`https://api.dictionaryapi.dev/api/v2/entries/en/${w}`),
		get(`https://api.datamuse.com/words?rel_syn=${w}&max=30`),
		get(`https://api.datamuse.com/words?ml=${w}&max=20`),
	]);
	const entries = Array.isArray(dict) ? dict : [];
	const meanings = [];
	for (const e of entries) {
		for (const m of e.meanings || []) {
			let into = meanings.find((x) => x.part === m.partOfSpeech);
			if (!into) meanings.push((into = { part: m.partOfSpeech, definitions: [] }));
			for (const d of m.definitions || []) if (into.definitions.length < 5) into.definitions.push({ text: d.definition, example: d.example || "" });
		}
	}
	const synonyms = [];
	const add = (s) => { if (s && s !== word && !synonyms.includes(s) && synonyms.length < 30) synonyms.push(s); };
	for (const e of entries) for (const m of e.meanings || []) for (const s of m.synonyms || []) add(s);
	for (const x of Array.isArray(syn) ? syn : []) add(x.word);
	if (synonyms.length < 8) for (const x of Array.isArray(near) ? near : []) add(x.word);
	return { word, phonetic: entries.find((e) => e.phonetic)?.phonetic || "", meanings, synonyms };
}
