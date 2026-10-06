// Dictionary and thesaurus for the "Look up" command: definitions from Free
// Dictionary API (dictionaryapi.dev, Wiktionary data) and synonyms from
// Datamuse. Both are free, need no key and allow calls from a web page, so
// the Worker (worker/define.js) and a device with no Worker share this.
//
// getJson(url) -> parsed JSON, or null when the service has nothing.

export const cleanWord = (w) => String(w || "").trim().toLowerCase();
export const isWord = (w) => !!w && w.length <= 60 && /^[\p{L}'’ -]+$/u.test(w);

export async function defineWord(word, getJson) {
	const w = encodeURIComponent(word);
	const [dict, syn, near] = await Promise.all([
		getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${w}`),
		getJson(`https://api.datamuse.com/words?rel_syn=${w}&max=30`),
		getJson(`https://api.datamuse.com/words?ml=${w}&max=20`),
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

// The page calling the services itself (no Worker).
export async function defineHere(word) {
	const w = cleanWord(word);
	if (!isWord(w)) throw new Error("Send one word");
	const getJson = async (url) => {
		const res = await fetch(url, { headers: { Accept: "application/json" } });
		return res.ok ? res.json() : null;
	};
	return defineWord(w, getJson);
}
