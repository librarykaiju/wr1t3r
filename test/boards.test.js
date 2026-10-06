import { test } from "node:test";
import assert from "node:assert/strict";
import { isNotePath, isBoardPath, BOARD_EXT } from "../src/paths.js";
import { movePlan, moveLinkEdits } from "../src/moves.js";
import { resolveNote } from "../src/links.js";
import { conflictPath } from "../src/sync.js";

test("boards are .board, and .base still counts as one", () => {
	assert.equal(BOARD_EXT, ".board");
	for (const p of ["content/Books.board", "content/Books.base"]) {
		assert.ok(isNotePath(p) && isBoardPath(p), p);
	}
	assert.ok(!isBoardPath("content/Books.md"));
});

test("a renamed board keeps its own extension", () => {
	const paths = ["content/Books.board", "content/Old.base", "content/A.md"];
	assert.deepEqual(movePlan(paths, "content/Books.board", "content/", "Reading").pairs, [{ from: "content/Books.board", to: "content/Reading.board" }]);
	assert.deepEqual(movePlan(paths, "content/Old.base", "content/", "Older").pairs, [{ from: "content/Old.base", to: "content/Older.base" }]);
});

test("links and embeds to a .base follow it to .board", () => {
	const paths = ["content/_docs/Books.base", "content/Home.md"];
	assert.equal(resolveNote({ note: "Books.base", wiki: true }, "content/Home.md", paths), "content/_docs/Books.base");
	const text = { "content/Home.md": "See [[Books.base]] and ![[Books.base|shelf]] and [b](_docs/Books.base).", "content/_docs/Books.base": "views: []\n" };
	const edits = moveLinkEdits([{ from: "content/_docs/Books.base", to: "content/_docs/Books.board" }], paths, (p) => text[p]);
	assert.deepEqual(edits, [{ path: "content/Home.md", text: "See [[Books.board]] and ![[Books.board|shelf]] and [b](_docs/Books.board).", count: 3 }]);
});

test("a board's conflict copy stays a board", () => {
	assert.equal(conflictPath("content/Books.board", () => false, new Date("2026-10-06T12:00:00Z")), "content/Books (conflict 2026-10-06).board");
});
