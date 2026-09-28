import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzy } from "../src/palette.js";

test("fuzzy matches letters in order and prefers tighter matches", () => {
	assert.equal(fuzzy("xyz", "Chapter One"), null);
	assert.ok(fuzzy("chone", "Chapter One") != null);
	assert.ok(fuzzy("one", "Chapter One") > fuzzy("chone", "Chapter One"));
	assert.ok(fuzzy("plan", "Plan") > fuzzy("plan", "drafts/Old Plan notes"));
	assert.ok(fuzzy("tdy", "Today") > fuzzy("tdy", "Delete the day entry"));
	assert.equal(fuzzy("", "anything"), 0);
});
