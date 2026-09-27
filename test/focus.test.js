import { test } from "node:test";
import assert from "node:assert/strict";
import { counts, countWords, stripFrontmatter } from "../src/count.js";
import * as P from "../src/pomodoro.js";

test("word count skips frontmatter and markdown marks", () => {
	const text = "---\ntitle: Many words here\ntags: [a, b]\n---\n# Hello world\n\n- [ ] don't *stop*\n> well-known 42\n";
	assert.equal(counts(text).words, 6);
	assert.equal(stripFrontmatter("---\r\na: 1\r\n---\r\nBody").trim(), "Body");
	assert.equal(stripFrontmatter("--- not frontmatter\nx"), "--- not frontmatter\nx");
	assert.equal(countWords("日本語 text"), 4);
	assert.equal(countWords(""), 0);
	assert.equal(counts("ab c\r\nd").chars, 5);
});

test("pomodoro runs from an end time and moves to the next phase", () => {
	const set = { work: 25, brk: 5 };
	let s = P.idle(set);
	assert.equal(P.format(P.remaining(s, 0)), "25:00");
	s = P.start(s, 1000);
	assert.equal(P.format(P.remaining(s, 1000 + 60000)), "24:00");
	s = P.pause(s, 1000 + 60000);
	assert.equal(P.remaining(s, 10 ** 9), 24 * 60000);
	s = P.start(s, 5000);
	assert.equal(P.tick(s, set, 5000 + 24 * 60000 - 1).ended, null);
	const r = P.tick(s, set, 5000 + 24 * 60000);
	assert.equal(r.ended, "work");
	assert.deepEqual(r.state, { phase: "break", running: false, endsAt: null, left: 5 * 60000 });
});

test("pomodoro lengths change only an unstarted timer, and bad stored state is dropped", () => {
	const a = { work: 25, brk: 5 }, b = { work: 30, brk: 5 };
	assert.equal(P.resize(P.idle(a), a, b).left, 30 * 60000);
	const paused = P.pause(P.start(P.idle(a), 0), 60000);
	assert.equal(P.resize(paused, a, b), paused);
	assert.deepEqual(P.restore({ phase: "nap" }, a), P.idle(a));
	assert.deepEqual(P.restore({ phase: "break", running: true, endsAt: 99 }, a), { phase: "break", running: true, endsAt: 99, left: null });
});
