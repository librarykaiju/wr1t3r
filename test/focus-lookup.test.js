import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { paragraphAt } from "../src/focus.js";
import { wordFor, matchCase } from "../src/lookup.js";

test("focus paragraph", () => {
	const doc = EditorState.create({ doc: "a\nb\n\nc\nd\ne\n\nf" }).doc;
	assert.deepEqual(paragraphAt(doc, doc.line(5).from), [4, 6]);
	assert.deepEqual(paragraphAt(doc, doc.line(3).from), [3, 3]);
});

test("word to look up", () => {
	const at = (doc, anchor, head = anchor) => wordFor(EditorState.create({ doc, selection: { anchor, head } }));
	assert.deepEqual(at("The happy fox", 6), { from: 4, to: 9, word: "happy" });
	assert.deepEqual(at("The happy fox", 3, 10), { from: 4, to: 9, word: "happy" });
	assert.equal(at("one two three four", 0, 18), null);
	assert.equal(matchCase("Happy", "glad"), "Glad");
	assert.equal(matchCase("HAPPY", "glad"), "GLAD");
	assert.equal(matchCase("happy", "glad"), "glad");
});

import { defineApi } from "../worker/define.js";
test("define API shapes the two services' answers", async () => {
	const real = globalThis.fetch;
	globalThis.fetch = async (u) => {
		const url = String(u);
		const body = url.includes("dictionaryapi") ? [{ word: "happy", phonetic: "/ˈhæpi/", meanings: [{ partOfSpeech: "adjective", definitions: [{ definition: "Feeling pleasure.", example: "a happy child" }], synonyms: ["content"] }] }]
			: url.includes("rel_syn") ? [{ word: "glad" }, { word: "content" }, { word: "felicitous" }]
			: [{ word: "cheerful" }];
		return new Response(JSON.stringify(body), { status: 200 });
	};
	try {
		const r = await defineApi(new Request("https://x/api/define?word=Happy"), {}, new URL("https://x/api/define?word=Happy"));
		assert.equal(r.word, "happy");
		assert.equal(r.phonetic, "/ˈhæpi/");
		assert.deepEqual(r.meanings, [{ part: "adjective", definitions: [{ text: "Feeling pleasure.", example: "a happy child" }] }]);
		assert.deepEqual(r.synonyms, ["content", "glad", "felicitous", "cheerful"]);
		assert.equal(await defineApi(new Request("https://x/api/files"), {}, new URL("https://x/api/files")), null);
	} finally {
		globalThis.fetch = real;
	}
});

test("the page can look a word up itself, with the same answer shape", async () => {
	const { defineHere } = await import("../src/define.js");
	const real = globalThis.fetch;
	const seen = [];
	globalThis.fetch = async (url) => {
		seen.push(url);
		if (url.includes("dictionaryapi")) return new Response(JSON.stringify([{ phonetic: "/x/", meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "A plot." }], synonyms: ["yard"] }] }]));
		return new Response(JSON.stringify([{ word: "plot" }]));
	};
	try {
		const r = await defineHere("  Garden ");
		assert.equal(r.word, "garden");
		assert.deepEqual(r.meanings, [{ part: "noun", definitions: [{ text: "A plot.", example: "" }] }]);
		assert.deepEqual(r.synonyms, ["yard", "plot"]);
		assert.equal(seen.length, 3);
		await assert.rejects(defineHere("two words!"), /one word/);
	} finally {
		globalThis.fetch = real;
	}
});
