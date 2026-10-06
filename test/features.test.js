import { test } from "node:test";
import assert from "node:assert/strict";
import { readSettings, writeSettings, cleanFolder, commandArea, settingsPath, FEATURE_AREAS, FOLDER_SETTINGS, SETTINGS_BODY } from "../src/features.js";

const defaults = readSettings("");

test("no Settings note means everything on and today's folders", () => {
	assert.ok(FEATURE_AREAS.every((a) => defaults.features[a.id] === true));
	assert.deepEqual(defaults.folders, { inbox: "Inbox.md", uploads: "_uploads/", clippings: "_clippings/", compiled: "_compiled/", lists: "_docs/" });
	assert.deepEqual(readSettings("just text, no properties"), defaults);
});

test("only false turns an area off; folders are cleaned", () => {
	const s = readSettings("---\nfeatures:\n  health: false\n  media: no\n  calendar: 0\nfolders:\n  uploads: /Imports\n  inbox: Captures/Inbox\n  clippings: ../escape/\n---\n");
	assert.equal(s.features.health, false);
	assert.equal(s.features.calendar, true, "only false counts");
	assert.equal(s.folders.uploads, "Imports/");
	assert.equal(s.folders.inbox, "Captures/Inbox.md");
	assert.equal(s.folders.clippings, "_clippings/", "a path climbing out falls back to the default");
});

test("written settings leave out defaults and read back the same", () => {
	const want = { features: { ...defaults.features, health: false, ocr: false }, folders: { ...defaults.folders, lists: "Lists/" } };
	const text = writeSettings("", want);
	assert.equal(text, `---\nfeatures:\n  health: false\n  ocr: false\nfolders:\n  lists: Lists/\n---\n${SETTINGS_BODY}`);
	assert.deepEqual(readSettings(text), want);
	assert.equal(writeSettings("", defaults), `---\n---\n${SETTINGS_BODY}`);
});

test("rewriting keeps other properties and the body, and replaces the old blocks", () => {
	const text = "---\ntitle: Mine\nfeatures:\n  media: false\n  health: false\nfolders:\n  uploads: X/\ntags: [a]\n---\nMy notes.\n";
	const out = writeSettings(text, { features: { ...defaults.features, media: false }, folders: defaults.folders });
	assert.equal(out, "---\ntitle: Mine\ntags: [a]\nfeatures:\n  media: false\n---\nMy notes.\n");
});

test("odd folder names are quoted so they read back", () => {
	const want = { features: defaults.features, folders: { ...defaults.folders, uploads: "Files: imported/" } };
	assert.deepEqual(readSettings(writeSettings("", want)).folders.uploads, "Files: imported/");
});

test("cleanFolder", () => {
	assert.equal(cleanFolder("uploads", ""), "_uploads/");
	assert.equal(cleanFolder("uploads", " a\\b "), "a/b/");
	assert.equal(cleanFolder("inbox", "Inbox.MD"), "Inbox.MD");
	assert.equal(cleanFolder("inbox", "/"), "Inbox.md");
	assert.equal(cleanFolder("nope", "x"), null);
	assert.ok(FOLDER_SETTINGS.every((s) => cleanFolder(s.id, s.dflt) === s.dflt));
});

test("commands map to their areas; core commands to none", () => {
	assert.equal(commandArea("Open corkboard"), "longform");
	assert.equal(commandArea("Log food"), "health");
	assert.equal(commandArea("New comic log"), "media");
	assert.equal(commandArea("New note"), null);
});

test("the Settings note sits beside Home unless one exists", () => {
	assert.equal(settingsPath(["content/a.md"], "content/_wr1t3r/"), "content/_wr1t3r/Settings.md");
	assert.equal(settingsPath(["x/_wr1t3r/settings.md", "content/a.md"], "content/_wr1t3r/"), "x/_wr1t3r/settings.md");
});
