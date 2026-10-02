import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { prose, paragraphRange } from "../src/grammar.js";
import { grammarApi } from "../worker/grammar.js";

test("prose keeps length and blanks Markdown", () => {
	const cases = [
		"- [ ] Buy **some** milk",
		"See [the site](https://example.com) and [[Other Note|that note]].",
		"A `code` bit, a #tag and a footnote[^1].",
		"> [!note] Callout text",
		"## A heading ^block-id",
		"<span style=\"color: red\">red</span> words %% hidden %%",
	];
	for (const c of cases) assert.equal(prose(c).length, c.length, c);
	assert.equal(prose("- [ ] Buy **some** milk").trim(), "Buy   some   milk");
	assert.equal(prose("See [the site](https://example.com) now").replace(/ +/g, " "), "See the site now");
	assert.equal(prose("[[Other Note|that note]]").trim(), "that note");
	assert.equal(prose("[[Plain]]").trim(), "Plain");
	assert.equal(prose("A `x` #tag b").replace(/ +/g, " "), "A b");
	assert.equal(prose("> [!note] Hi there").trim(), "Hi there");
	assert.equal(prose("snake_case and 3*4").trim(), "snake_case and 3*4");
});

test("paragraphRange finds prose and skips code, properties and tables", () => {
	const doc = "---\ntitle: x\n---\nFirst line\nsecond line\n\n```js\nlet a\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nLast one";
	const state = EditorState.create({ doc, extensions: [markdown()] });
	const r = paragraphRange(state, doc.indexOf("second"));
	assert.equal(state.sliceDoc(r.from, r.to), "First line\nsecond line");
	assert.equal(paragraphRange(state, doc.indexOf("title")), null);
	assert.equal(paragraphRange(state, doc.indexOf("let a")), null);
	assert.equal(paragraphRange(state, doc.indexOf("| 1")), null);
	assert.equal(paragraphRange(state, doc.indexOf("\n\nLast") + 1), null);
	const last = paragraphRange(state, doc.length);
	assert.equal(state.sliceDoc(last.from, last.to), "Last one");
});

test("grammarApi forwards to LanguageTool and trims the answer", async () => {
	const real = globalThis.fetch;
	let sent;
	globalThis.fetch = async (url, init) => {
		sent = { url, body: new URLSearchParams(init.body) };
		return new Response(JSON.stringify({ matches: [
			{ offset: 0, length: 4, message: "Use “These”.", shortMessage: "Agreement", replacements: [{ value: "These" }, { value: "This" }], rule: { id: "THIS_NNS" } },
			{ offset: 3, length: 0, message: "empty" },
		] }), { headers: { "Content-Type": "application/json" } });
	};
	try {
		const req = new Request("https://x/api/grammar", { method: "POST", body: JSON.stringify({ text: "This apples are good." }) });
		const out = await grammarApi(req, { LANGUAGETOOL_URL: "https://lt.example.com/" }, new URL(req.url));
		assert.equal(sent.url, "https://lt.example.com/v2/check");
		assert.equal(sent.body.get("text"), "This apples are good.");
		assert.equal(sent.body.get("disabledCategories"), "TYPOS");
		assert.deepEqual(out.matches, [{ offset: 0, length: 4, message: "Use “These”.", short: "Agreement", replacements: ["These", "This"], rule: "THIS_NNS" }]);
		const other = new Request("https://x/api/other");
		assert.equal(await grammarApi(other, {}, new URL(other.url)), null);
		await assert.rejects(grammarApi(new Request("https://x/api/grammar", { method: "POST", body: "{}" }), {}, new URL("https://x/api/grammar")), /Send some text/);
	} finally {
		globalThis.fetch = real;
	}
});
