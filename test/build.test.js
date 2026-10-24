import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT, ownFolderIn, oldOwnFolders } from "../src/build.js";

test("this is the personal build", () => {
	assert.equal(PRODUCT, false);
});

test("wr1t3r's own folders have plain names, unless a notebook still has an old one", () => {
	assert.equal(ownFolderIn([], "content/", "daily/"), "daily/");
	assert.equal(ownFolderIn(["content/_daily/2026-10-01.md"], "content/", "daily/"), "_daily/");
	assert.equal(ownFolderIn(["content/Daily/2026-10-01.md"], "content/", "daily/"), "Daily/", "the product build's");
	assert.equal(ownFolderIn(["content/_daily/a.md", "content/daily/b.md"], "content/", "daily/"), "daily/");
	assert.equal(ownFolderIn(["content/_docs/To Do's.md"], "content/", "docs/"), "_docs/");
	assert.equal(ownFolderIn(["content/Lists/To Do's.md"], "content/", "docs/"), "Lists/");
	assert.equal(ownFolderIn(["content/DOCS/a.md"], "content/", "docs/"), "DOCS/", "another case of the plain name");
	assert.equal(ownFolderIn(["_daily/x.md"], "content/", "daily/"), "daily/", "only under the notes' folder");
	assert.equal(ownFolderIn(["content/_uploads/a.md"], "content/", "Imports/"), "Imports/", "a folder someone picked stays");
	assert.equal(ownFolderIn([], "", "Inbox.md"), "Inbox.md");
});

test("the old folders to rename", () => {
	const paths = ["content/_daily/a.md", "content/_DOCS/b.md", "content/Weekly/2026-W42.md", "content/Lists/c.md", "content/_templates/Daily.md", "content/_wr1t3r/Home.md", "content/Notes/_weekly.md"];
	assert.deepEqual(oldOwnFolders(paths, "content/"), [{ from: "content/_daily/", name: "daily" }, { from: "content/_DOCS/", name: "docs" }, { from: "content/Lists/", name: "docs" }], "a change of case only where it's safe");
	assert.deepEqual(oldOwnFolders(paths, "content/", true, true), [{ from: "content/_daily/", name: "daily" }, { from: "content/_DOCS/", name: "docs" }], "the product build keeps its own names");
	assert.deepEqual(oldOwnFolders(paths, "content/", true), [
		{ from: "content/_daily/", name: "daily" },
		{ from: "content/Weekly/", name: "weekly" },
		{ from: "content/_DOCS/", name: "docs" },
		{ from: "content/Lists/", name: "docs" },
	]);
	assert.deepEqual(oldOwnFolders(["daily/a.md"], "", true), []);
});

test("clippings move under docs/", () => {
	assert.equal(ownFolderIn([], "content/", "docs/clippings/"), "docs/clippings/");
	assert.equal(ownFolderIn(["content/clippings/a.md"], "content/", "docs/clippings/"), "clippings/", "kept while the notebook still has it");
	assert.equal(ownFolderIn(["content/_clippings/a.md"], "content/", "docs/clippings/"), "_clippings/");
	assert.equal(ownFolderIn(["content/clippings/a.md", "content/docs/clippings/b.md"], "content/", "docs/clippings/"), "docs/clippings/");
	assert.deepEqual(oldOwnFolders(["content/clippings/a.md", "content/docs/To Do's.md"], "content/"), [{ from: "content/clippings/", name: "docs/clippings" }]);
	assert.deepEqual(oldOwnFolders(["content/_docs/a.md", "content/_clippings/b.md"], "content/"), [{ from: "content/_docs/", name: "docs" }, { from: "content/_clippings/", name: "docs/clippings" }], "docs/ first");
	assert.deepEqual(oldOwnFolders(["Clippings/a.md"], ""), [{ from: "Clippings/", name: "docs/clippings" }], "not just a change of case, so safe anywhere");
	assert.deepEqual(oldOwnFolders(["docs/clippings/a.md"], "", true), []);
});
