import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseRepo, pagesUrl, blobSha, publishToGitHub } from "../src/githubpublish.js";
import { fakeGitHub } from "./fakegithub.js";

test("repo names and Pages addresses", () => {
	assert.deepEqual(parseRepo("you/my-site"), { owner: "you", name: "my-site" });
	assert.deepEqual(parseRepo("https://github.com/you/my-site.git/"), { owner: "you", name: "my-site" });
	assert.equal(parseRepo("my-site"), null);
	assert.equal(pagesUrl({ owner: "You", name: "my-site" }), "https://you.github.io/my-site/");
	assert.equal(pagesUrl({ owner: "You", name: "you.github.io" }), "https://you.github.io/");
});

test("blob ids match git's", async () => {
	const git = (s) => createHash("sha1").update(`blob ${Buffer.byteLength(s)}\0${s}`).digest("hex");
	assert.equal(await blobSha("hello\n"), git("hello\n"));
	assert.equal(await blobSha(""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
	assert.equal(await blobSha(new TextEncoder().encode("é")), git("é"));
});

const site = (extra = {}) => new Map([["index.html", "<h1>Hi</h1>"], ["style.css", "body{}"], ["pics/a.png", { attachment: "a.png" }], ...Object.entries(extra)]);
const read = async () => new Blob([new Uint8Array([1, 2, 3])]);

test("publishes the site as one commit, turns on Pages, then sends only changes", async () => {
	const gh = fakeGitHub();
	const r = await publishToGitHub({ token: "t", repo: "you/site", files: site({ "old.html": "x" }), read, fetch: gh.fetch });
	assert.equal(r.url, "https://you.github.io/site/");
	assert.equal(r.changed, 5); // index, style, picture, old, .nojekyll
	assert.equal(r.pagesNote, "");
	assert.ok(gh.files().has("README.md"), "leaves the repo's own files");
	assert.equal(gh.text("index.html"), "<h1>Hi</h1>");
	assert.equal([...gh.blobs.values()][0], "AQID");
	assert.equal(gh.calls.filter((c) => c === "POST /repos/you/site/git/commits").length, 1);

	gh.calls.length = 0;
	const again = await publishToGitHub({ token: "t", repo: "you/site", files: site({ "old.html": "x" }), read, last: r.paths, fetch: gh.fetch });
	assert.equal(again.changed, 0);
	assert.ok(!gh.calls.some((c) => c.startsWith("POST /repos/you/site/git/")), "nothing to commit");

	const third = await publishToGitHub({ token: "t", repo: "you/site", files: site({ "index.html": "<h1>New</h1>" }), read, last: again.paths, fetch: gh.fetch });
	assert.equal(third.changed, 1);
	assert.equal(third.deleted, 1);
	assert.equal(gh.text("index.html"), "<h1>New</h1>");
	assert.ok(!gh.files().has("old.html"));
	assert.ok(gh.files().has("README.md"));
});

test("an empty repo gets a first commit; Pages it can't turn on gets directions", async () => {
	const gh = fakeGitHub({ empty: true, canPages: false });
	const r = await publishToGitHub({ token: "t", repo: "https://github.com/you/site", files: site(), read: async () => { throw new Error("gone"); }, fetch: gh.fetch });
	assert.deepEqual(r.missing, ["a.png"]);
	assert.ok(!r.paths.includes("pics/a.png"));
	assert.ok(gh.files().has("index.html"));
	assert.match(r.pagesNote, /Settings > Pages/);
});

test("plain words for the usual mistakes", async () => {
	await assert.rejects(publishToGitHub({ token: "t", repo: "site", files: site(), read }), /owner\/name/);
	await assert.rejects(publishToGitHub({ token: "", repo: "you/site", files: site(), read }), /token/);
	await assert.rejects(publishToGitHub({ token: "t", repo: "you/site", files: site(), read, fetch: fakeGitHub({ push: false }).fetch }), /Contents: Read and write/);
	const bad = async () => ({ ok: false, status: 401, json: async () => ({ message: "Bad credentials" }) });
	await assert.rejects(publishToGitHub({ token: "t", repo: "you/site", files: site(), read, fetch: bad }), /didn't accept the token/);
});
