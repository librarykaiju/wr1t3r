import { test } from "node:test";
import assert from "node:assert/strict";
import { wavBytes, segmentsOf, transcriptMarkdown, clock } from "../src/transcript.js";

const words = (list) => list.map(([w, start, speaker]) => ({ word: w.toLowerCase().replace(/[^a-z']/g, ""), punctuated_word: w, start, end: start + 0.3, speaker }));

test("a WAV header for 16 kHz mono 16-bit", () => {
	const b = wavBytes(new Float32Array([0, 1, -1, 0.5]));
	const v = new DataView(b.buffer);
	assert.equal(String.fromCharCode(...b.slice(0, 4)), "RIFF");
	assert.equal(String.fromCharCode(...b.slice(8, 12)), "WAVE");
	assert.equal(v.getUint32(24, true), 16000);
	assert.equal(v.getUint16(22, true), 1);
	assert.equal(v.getUint32(40, true), 8);
	assert.deepEqual([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)], [0, 32767, -32768]);
	assert.equal(b.length, 52);
});

test("clock", () => {
	assert.equal(clock(0), "0:00");
	assert.equal(clock(75.9), "1:15");
	assert.equal(clock(3725), "1:02:05");
});

test("paragraphs with speakers, wrapped in { result } or bare", () => {
	const bare = {
		metadata: { duration: 64.2 },
		results: { channels: [{ alternatives: [{ transcript: "…", words: [], paragraphs: { paragraphs: [
			{ speaker: 0, start: 0.1, sentences: [{ text: "Welcome back." }, { text: "Today we talk soup." }] },
			{ speaker: 0, start: 20, sentences: [{ text: "First, the stock." }] },
			{ speaker: 1, start: 42.5, sentences: [{ text: "Can I jump in?" }] },
		] } }] }] },
	};
	for (const answer of [bare, { result: bare }]) {
		const r = segmentsOf(answer);
		assert.equal(r.duration, 64.2);
		assert.deepEqual(r.segments, [
			{ speaker: 0, start: 0.1, text: "Welcome back. Today we talk soup." },
			{ speaker: 0, start: 20, text: "First, the stock." },
			{ speaker: 1, start: 42.5, text: "Can I jump in?" },
		]);
		assert.equal(transcriptMarkdown(r, { name: "soup.mp4" }), [
			"## Transcript", "",
			"*soup.mp4 · 1:04 · 2 speakers*", "",
			"**Speaker 1**", "[0:00] Welcome back. Today we talk soup.", "",
			"[0:20] First, the stock.", "",
			"**Speaker 2**", "[0:42] Can I jump in?", "",
		].join("\n"));
	}
});

test("utterances when there are no paragraphs", () => {
	const r = segmentsOf({ results: { channels: [{ alternatives: [{ words: words([["Hi.", 0, 0], ["Hey.", 1, 1]]) }] }], utterances: [
		{ speaker: 0, start: 0, transcript: "Hi." }, { speaker: 1, start: 1, transcript: "Hey." },
	] } });
	assert.equal(r.duration, 1.3);
	assert.deepEqual(r.segments.map((s) => [s.speaker, s.text]), [[0, "Hi."], [1, "Hey."]]);
});

test("words only: split on speaker changes and long pauses", () => {
	const r = segmentsOf({ results: { channels: [{ alternatives: [{ words: words([["So,", 0, 0], ["anyway.", 0.4, 0], ["Right.", 1, 1], ["Later", 9, 1], ["on.", 9.4, 1]]) }] }] } });
	assert.deepEqual(r.segments, [
		{ speaker: 0, start: 0, text: "So, anyway." },
		{ speaker: 1, start: 1, text: "Right." },
		{ speaker: 1, start: 9, text: "Later on." },
	]);
});

test("one speaker: no speaker lines; nothing said: says so", () => {
	const one = { duration: 30, segments: [{ speaker: 0, start: 0, text: "Just me." }, { speaker: 0, start: 12, text: "Still me." }] };
	assert.equal(transcriptMarkdown(one, { name: "memo.m4a" }), "## Transcript\n\n*memo.m4a · 0:30*\n\n[0:00] Just me.\n\n[0:12] Still me.\n");
	const none = segmentsOf({ results: { channels: [{ alternatives: [{ transcript: "", words: [] }] }] } });
	assert.match(transcriptMarkdown(none), /No speech found/);
	// A bare transcript with no words still comes through.
	assert.deepEqual(segmentsOf({ results: { channels: [{ alternatives: [{ transcript: " Hello there. " }] }] } }).segments, [{ speaker: null, start: 0, text: "Hello there." }]);
});
