import test from "node:test";
import assert from "node:assert/strict";
import { stats, noteGoal } from "../src/count.js";

test("document stats", () => {
	const s = stats("---\ngoal: 500\n---\n# A title\n\nOne two three. Four five! Six\n\n- item one\n\n```\ncode here. more.\n```\n");
	assert.equal(s.words, 10);
	assert.equal(s.sentences, 5); // title, 3 in the paragraph, list item
	assert.equal(s.paragraphs, 3);
	assert.equal(s.perSentence, 2);
	assert.equal(s.minutes, 1);
	assert.equal(stats("").minutes, 0);
});

test("note goal", () => {
	assert.equal(noteGoal("---\ngoal: 2000\n---\ntext"), 2000);
	assert.equal(noteGoal("---\ntitle: x\n---\n"), null);
	assert.equal(noteGoal("goal: 5"), null);
});

test("tags aren't words", () => {
	assert.equal(stats('The <u><span style="color: #3b7dd8">fox</span></u> ran.\n\n<p align="center">Two words</p>').words, 5);
});
