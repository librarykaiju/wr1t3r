import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT, ownFolderIn, oldOwnFolders } from "../src/build.js";

test("this is the personal build", () => {
	assert.equal(PRODUCT, false);
});

test("wr1t3r's own folders have plain names, unless a notebook still has the old one", () => {
	assert.equal(ownFolderIn([], "content/", "Daily/"), "Daily/");
	assert.equal(ownFolderIn(["content/_daily/2026-10-01.md"], "content/", "Daily/"), "_daily/");
	assert.equal(ownFolderIn(["content/_daily/2026-10-01.md", "content/Daily/2026-10-21.md"], "content/", "Daily/"), "Daily/");
	assert.equal(ownFolderIn(["content/_docs/To Do's.md"], "content/", "Lists/"), "_docs/");
	assert.equal(ownFolderIn(["_daily/x.md"], "content/", "Daily/"), "Daily/", "only under the notes' folder");
	assert.equal(ownFolderIn(["content/_uploads/a.md"], "content/", "Imports/"), "Imports/", "a folder someone picked stays");
	assert.equal(ownFolderIn([], "", "Inbox.md"), "Inbox.md");
});

test("the old folders to rename", () => {
	const paths = ["content/_daily/a.md", "content/_DOCS/b.md", "content/_templates/Daily.md", "content/_wr1t3r/Home.md", "content/Notes/_weekly.md"];
	assert.deepEqual(oldOwnFolders(paths, "content/"), [{ from: "content/_daily/", name: "Daily" }, { from: "content/_DOCS/", name: "Lists" }]);
	assert.deepEqual(oldOwnFolders(["Daily/a.md"], ""), []);
});
