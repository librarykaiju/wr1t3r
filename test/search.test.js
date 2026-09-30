import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, matches, snippet, isArchived, asksForArchive, archiveText } from "../src/search.js";
import { setProperty } from "../src/bases.js";

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

test("archived notes: archived: true, or archived as the status", () => {
	assert.equal(isArchived("---\narchived: true\n---\nx"), true);
	assert.equal(isArchived("---\nstatus: archived\n---\nx"), true);
	assert.equal(isArchived("---\nstatus: \"Archived\" # old\n---\nx"), true);
	assert.equal(isArchived("---\nstatus: [seed, archived]\n---\nx"), true);
	assert.equal(isArchived("---\nstatus:\n  - archived\n---\nx"), true);
	assert.equal(isArchived("---\narchived: false\nstatus: seed\n---\narchived"), false);
	assert.equal(isArchived("status: archived"), false);
	assert.equal(isArchived("---\r\ntags: [a]\r\narchived: yes\r\n---\r\n"), true);
});

test("searching archive alone asks for the archive", () => {
	assert.equal(asksForArchive(parseQuery("Archive")), true);
	assert.equal(asksForArchive(parseQuery("archived")), true);
	assert.equal(asksForArchive(parseQuery("archive notes")), false);
	assert.equal(asksForArchive(parseQuery("-archive")), false);
});

test("archiving adds archived: true; unarchiving takes it or the status off", () => {
	assert.equal(archiveText("---\nstatus: seed\n---\nbody", true, setProperty), "---\nstatus: seed\narchived: true\n---\nbody");
	assert.equal(archiveText("---\nstatus: seed\narchived: true\n---\nbody", false, setProperty), "---\nstatus: seed\n---\nbody");
	assert.equal(archiveText("---\narchived: true\nstatus: seed\n---\nbody", false, setProperty), "---\nstatus: seed\n---\nbody");
	assert.equal(archiveText("---\nstatus: archived\n---\nbody", false, setProperty), "---\nstatus:\n---\nbody");
	assert.equal(archiveText("body", true, setProperty), "---\narchived: true\n---\nbody");
	assert.equal(archiveText("---\r\ntitle: x\r\narchived: true\r\n---\r\nbody", false, setProperty), "---\r\ntitle: x\r\n---\r\nbody");
});
