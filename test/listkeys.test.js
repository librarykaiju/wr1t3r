import test from "node:test";
import assert from "node:assert/strict";
import { listKeys } from "../src/properties.js";

test("properties the vault keeps as lists", () => {
	const notes = [
		"---\nsubjects:\n  - Philosophy\nauthor: Bell\n---\n",
		"---\nsubjects: [Games, Art]\nauthor: Sam\n---\n",
		"---\nsubjects: Games\nauthor:\n---\n",
		"---\nsubjects:\nform: Browser\n---\n",
		"no frontmatter",
	];
	assert.deepEqual(listKeys(notes), { subjects: "list" });
});
