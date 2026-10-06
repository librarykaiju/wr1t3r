import test from "node:test";
import assert from "node:assert/strict";
import { propertyUsage, suggest } from "../src/properties.js";

const notes = [
	"---\ntitle: One\nsubjects:\n  - Games\n  - Art\nstatus: draft\n---\nbody",
	"---\r\ntitle: Two\r\nsubjects: [Games, Philosophy]\r\nstatus: \"draft\"\r\n---\r\n",
	"---\ntitle: Three\nsubjects: Games\nstatus: done\nauthor:\nnotes: |\n  long\n---\n",
	"no frontmatter",
];

test("property names and values with how many notes use them", () => {
	const { names, values } = propertyUsage(notes);
	assert.deepEqual(Object.fromEntries(names), { title: 3, subjects: 3, status: 3, author: 1, notes: 1 });
	assert.deepEqual(Object.fromEntries(values.get("subjects")), { Games: 3, Art: 1, Philosophy: 1 });
	assert.deepEqual(Object.fromEntries(values.get("status")), { draft: 2, done: 1 });
	assert.equal(values.has("author"), false);
	assert.equal(values.has("notes"), false);
});

test("suggestions: starts-with first, then word starts, then anywhere, by use", () => {
	const counts = new Map([["author", 5], ["co-author", 9], ["authority", 2], ["status", 7], ["Auth", 1]]);
	assert.deepEqual(suggest(counts, "auth").map((s) => s.text), ["author", "authority", "Auth", "co-author"]);
	assert.equal(suggest(counts, "auth")[0].prefix, true);
	assert.deepEqual(suggest(counts, "thor").map((s) => s.text), ["author", "authority", "co-author"].sort((a, b) => counts.get(b) - counts.get(a)));
	assert.deepEqual(suggest(counts, "zzz"), []);
	assert.deepEqual(suggest(counts, "").map((s) => s.text).slice(0, 2), ["co-author", "status"]);
	assert.deepEqual(suggest(counts, "a", { skip: ["AUTHOR"] }).map((s) => s.text), ["authority", "Auth", "co-author", "status"]);
});
