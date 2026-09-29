import { test } from "node:test";
import assert from "node:assert/strict";
import { movePlan, moveLinkEdits } from "../src/moves.js";

const paths = ["content/a/One.md", "content/a/sub/Two.md", "content/b/Three.md", "content/Top.md"];

test("a note dropped on a folder moves there", () => {
	assert.deepEqual(movePlan(paths, "content/a/One.md", "content/b/"), { pairs: [{ from: "content/a/One.md", to: "content/b/One.md" }], error: null });
	assert.deepEqual(movePlan(paths, "content/a/One.md", "content/a/").pairs, [], "already there");
});

test("a folder moves with everything in it, but never into itself", () => {
	assert.deepEqual(movePlan(paths, "content/a/", "content/b/").pairs, [
		{ from: "content/a/One.md", to: "content/b/a/One.md" },
		{ from: "content/a/sub/Two.md", to: "content/b/a/sub/Two.md" },
	]);
	assert.match(movePlan(paths, "content/a/", "content/a/sub/").error, /inside itself/);
});

test("renaming keeps the folder and checks the name", () => {
	assert.deepEqual(movePlan(paths, "content/Top.md", "content/", "Summit").pairs, [{ from: "content/Top.md", to: "content/Summit.md" }]);
	assert.deepEqual(movePlan(paths, "content/a/", "content/", "Alpha").pairs.map((p) => p.to), ["content/Alpha/One.md", "content/Alpha/sub/Two.md"]);
	assert.ok(movePlan(paths, "content/Top.md", "content/", "x/y").error);
	assert.match(movePlan(paths, "content/Top.md", "content/b/", "three").error, /already a note/, "case-insensitive clash");
});

test("links to moved notes are rewritten, including between moved notes", () => {
	const texts = {
		"content/Top.md": "See [[content/a/One]] and [two](a/sub/Two.md).",
		"content/a/One.md": "Next: [[content/a/sub/Two]]",
		"content/b/Three.md": "Nothing here.",
	};
	const { pairs } = movePlan(paths, "content/a/", "content/b/");
	const edits = moveLinkEdits(pairs, paths, (p) => texts[p] ?? null);
	const by = Object.fromEntries(edits.map((e) => [e.path, e]));
	assert.equal(by["content/Top.md"].text, "See [[content/b/a/One]] and [two](b/a/sub/Two.md).");
	assert.equal(by["content/Top.md"].count, 2);
	assert.equal(by["content/b/a/One.md"].text, "Next: [[content/b/a/sub/Two]]", "keyed by the note's new path");
	assert.equal(by["content/b/Three.md"], undefined);
});
