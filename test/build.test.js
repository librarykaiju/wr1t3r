import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT, ownFolderName } from "../src/build.js";

test("the personal build keeps the leading underscore", () => {
	assert.equal(PRODUCT, false);
	assert.equal(ownFolderName("_daily/"), "_daily/");
});

test("the product build drops it and capitalizes", () => {
	assert.equal(ownFolderName("_daily/", true), "Daily/");
	assert.equal(ownFolderName("_uploads/", true), "Uploads/");
	assert.equal(ownFolderName("Inbox.md", true), "Inbox.md");
});
