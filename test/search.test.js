import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, matches, snippet } from "../src/search.js";

const tagsOf = (t) => [...t.matchAll(/#([\w/]+)/g)].map((m) => m[1]);

test("parseQuery reads words, phrases and operators", () => {
	assert.deepEqual(parseQuery('Fox path:Drafts "red dog" -old #Idea tag:book file:plan'), [
		{ kind: "word", value: "fox", not: false },
		{ kind: "path", value: "drafts", not: false },
		{ kind: "phrase", value: "red dog", not: false },
		{ kind: "word", value: "old", not: true },
		{ kind: "tag", value: "idea", not: false },
		{ kind: "tag", value: "book", not: false },
		{ kind: "file", value: "plan", not: false },
	]);
	assert.deepEqual(parseQuery('path:"my folder"'), [{ kind: "path", value: "my folder", not: false }]);
});

test("matches ANDs every term", () => {
	const n = { path: "content/drafts/Plan.md", text: "A red dog ran. #book/fiction" };
	const m = (q) => matches(n, parseQuery(q), tagsOf);
	assert.ok(m("red path:drafts"));
	assert.ok(m('"red dog" #book'));
	assert.ok(m("file:plan"));
	assert.ok(!m("file:drafts"));
	assert.ok(!m("red -dog"));
	assert.ok(!m("#bo"));
	assert.ok(!m("red path:other"));
});

test("snippet shows the matching line with the match marked", () => {
	const text = "---\ntitle: fox\n---\nfirst line\nThe quick brown fox jumps";
	assert.deepEqual(snippet(text, parseQuery("fox")), { before: "The quick brown ", match: "fox", after: " jumps" });
	assert.equal(snippet(text, parseQuery("path:x")), null);
	const long = "x".repeat(200) + " needle " + "y".repeat(200);
	const s = snippet(long, parseQuery("needle"));
	assert.ok(s.before.startsWith("…") && s.after.endsWith("…") && s.match === "needle");
});
