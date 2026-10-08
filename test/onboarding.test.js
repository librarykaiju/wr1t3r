import { test } from "node:test";
import assert from "node:assert/strict";
import { USES, featuresFor, starterNotes, guideText, needsHomeScreen } from "../src/onboarding.js";
import { FEATURE_AREAS, readSettings, writeSettings } from "../src/features.js";
import { readPins } from "../src/home.js";
import { cardInfo } from "../src/binder.js";

test("every area belongs to some use", () => {
	const covered = new Set(USES.flatMap((u) => u.areas));
	for (const a of FEATURE_AREAS) assert.ok(covered.has(a.id), a.id);
});

test("featuresFor turns on what the chosen uses need, and nothing else", () => {
	const f = featuresFor(["writing"]);
	assert.equal(f.longform, true);
	assert.equal(f.boards, true);
	assert.equal(f.health, false);
	assert.equal(f.daily, false);
	assert.equal(featuresFor(["health"]).daily, true); // the planner holds the food log
	assert.ok(Object.values(featuresFor([])).every(Boolean));
	assert.ok(Object.values(featuresFor(USES.map((u) => u.id))).every(Boolean));
});

test("the features round-trip through the Settings note", () => {
	const features = featuresFor(["media"]);
	const text = writeSettings("", { ...readSettings(""), features });
	assert.deepEqual(readSettings(text).features, features);
});

test("starter notes follow the uses, and Home pins them", () => {
	const writing = starterNotes(["writing"]);
	const paths = writing.map((n) => n.path);
	assert.ok(paths.includes("Welcome.md"));
	assert.ok(paths.includes("My Story/01 Opening.md"));
	assert.ok(paths.includes("_wr1t3r/Home.md"));
	assert.ok(!paths.includes("Inbox.md"));
	const pins = readPins(writing.find((n) => n.path === "_wr1t3r/Home.md").text);
	assert.deepEqual(pins.map((p) => p.link), ["[[Welcome]]", "corkboard:My Story"]);
	assert.equal(pins[1].title, "My Story");
	assert.equal(cardInfo("My Story/01 Opening.md", writing[1].text).synopsis, "Where the story starts, and who we meet first.");
	assert.match(writing[0].text, /Storyboard/);

	const other = starterNotes(["planner", "research"], "content/");
	const op = other.map((n) => n.path);
	assert.ok(op.includes("content/Inbox.md"));
	assert.ok(!op.some((p) => p.includes("My Story/")));
	const pins2 = readPins(other.find((n) => n.path === "content/_wr1t3r/Home.md").text).map((p) => p.link);
	assert.deepEqual(pins2, ["[[Welcome]]", "command:Open today's daily note", "[[Inbox]]"]);
	assert.doesNotMatch(other[0].text, /storyboard/i);
});

test("the guide covers what's on, and only what this build can do", () => {
	const writing = guideText(featuresFor(["writing"]), { story: true });
	assert.match(writing, /Right-click the folder in the sidebar/);
	assert.match(writing, /\*\*Storyboard:\*\*[\s\S]*\*\*Outliner:\*\*[\s\S]*\*\*Draft:\*\*/);
	assert.match(writing, /\[\[My Story\/01 Opening\|My Story\]\]/);
	assert.match(writing, /the gear button/);
	assert.doesNotMatch(writing, /## Your day|## Capture|## Recordings/);
	assert.doesNotMatch(guideText(featuresFor(["writing"])), /My Story/); // no sample, no link

	const all = featuresFor([]);
	const worker = guideText(all), dropbox = guideText(all, { worker: false });
	assert.match(worker, /the Clip button/);
	assert.match(dropbox, /Clip to wr1t3r bookmarklet/);
	assert.match(worker, /## Recordings/);
	assert.match(worker, /even with wr1t3r closed/);
	assert.doesNotMatch(dropbox, /Clip button|## Recordings|even with wr1t3r closed/);
	assert.match(dropbox, /Capture to the Inbox/);
	assert.match(dropbox, /open in a tab/);
});

test("the Home Screen tip is for iPhone and iPad Safari outside the Home Screen", () => {
	const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
	const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
	assert.equal(needsHomeScreen(iphone, false), true);
	assert.equal(needsHomeScreen(iphone, true), false);
	assert.equal(needsHomeScreen(ipad, false, 5), true);
	assert.equal(needsHomeScreen(ipad, false, 0), false);
	assert.equal(needsHomeScreen("Mozilla/5.0 (Windows NT 10.0) Chrome/130", false), false);
});
