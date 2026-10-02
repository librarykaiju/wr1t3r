import test from "node:test";
import assert from "node:assert/strict";
import { shouldKeep, overflow, lineDiff, GAP } from "../src/history.js";
import { isDark } from "../src/diagrams.js";

test("keeps the first copy, then at most one per gap", () => {
	assert.equal(shouldKeep(null, "a", 0), true);
	assert.equal(shouldKeep(null, "  \n", 0), false);
	const latest = { text: "a", at: 1000 };
	assert.equal(shouldKeep(latest, "a", 1000 + GAP * 5), false, "same text");
	assert.equal(shouldKeep(latest, "b", 1000 + GAP - 1), false, "too soon");
	assert.equal(shouldKeep(latest, "b", 1000 + GAP), true);
	assert.equal(shouldKeep(latest, "b", 1001, true), true, "forced");
});

test("drops the oldest copies over the limit", () => {
	const list = [{ id: 1, at: 1 }, { id: 2, at: 3 }, { id: 3, at: 2 }];
	assert.deepEqual(overflow(list, 2).map((c) => c.id), [1]);
	assert.deepEqual(overflow(list, 5), []);
});

test("line diff marks removed and added lines", () => {
	const d = lineDiff("one\ntwo\nthree\nfour", "one\n2\nthree\nfour\nfive");
	assert.deepEqual(d.map((l) => l.op + ":" + l.text), ["same:one", "del:two", "add:2", "same:three", "same:four", "add:five"]);
	assert.deepEqual(lineDiff("a", "a"), [{ op: "same", text: "a" }]);
});

test("diagram theme follows the page background", () => {
	assert.equal(isDark("#1e1e2e"), true);
	assert.equal(isDark("#ffffff"), false);
	assert.equal(isDark("rgb(20, 20, 30)"), true);
});
