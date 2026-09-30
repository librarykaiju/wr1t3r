import { test } from "node:test";
import assert from "node:assert/strict";
import { homePath, readPins, writePins, pinKind, pinPath, linkFor, pinTitle, pinColor, pinCover, retargetPins, pinOpens, folderLink, isAppFile, tileOrdinals } from "../src/home.js";

const HOME = "content/_wr1t3r/Home.md";
const paths = ["content/Reading log.md", "content/_docs/Books.base", "content/a/Idea.md", "content/b/Idea.md", HOME];

test("the Home note is found anywhere, else made in the notes' folder", () => {
	assert.equal(homePath(paths, "content/"), HOME);
	assert.equal(homePath(["content/x.md"], "content/"), HOME);
	assert.equal(homePath(["notes.md"], ""), "_wr1t3r/Home.md");
	assert.equal(homePath(["other/_wr1t3r/home.md"], "content/"), "other/_wr1t3r/home.md");
});

test("pins round-trip; other properties, unknown keys and the body are kept", () => {
	const text = [
		"---",
		"tags: [wr1t3r]",
		"pins:",
		'  - link: "[[Reading log]]"',
		"    color: 3",
		'    cover: "[[covers/reading.jpg]]"',
		"    size: wide",
		"  - link: folder:content/_daily",
		"  - \"https://example.com\"",
		"cssclasses: home",
		"---",
		"Body stays.",
		"",
	].join("\n");
	const pins = readPins(text);
	assert.deepEqual(pins, [
		{ link: "[[Reading log]]", color: 3, cover: "[[covers/reading.jpg]]", size: "wide" },
		{ link: "folder:content/_daily" },
		{ link: "https://example.com" },
	]);
	const again = writePins(text, pins);
	assert.deepEqual(readPins(again), pins);
	assert.match(again, /^---\ntags: \[wr1t3r\]\npins:\n/);
	assert.match(again, /\ncssclasses: home\n---\nBody stays.\n$/);
	assert.match(again, /  - link: "\[\[Reading log\]\]"\n    color: 3\n    cover: "\[\[covers\/reading.jpg\]\]"\n    size: "wide"\n/);
	// Same pins, same text (after the first normalising write).
	assert.equal(writePins(again, readPins(again)), again);
});

test("pins written into a note without them, or without frontmatter", () => {
	const t1 = writePins("---\ntitle: Home\n---\nHi\n", [{ link: "[[A]]" }]);
	assert.equal(t1, '---\ntitle: Home\npins:\n  - link: "[[A]]"\n---\nHi\n');
	const t2 = writePins("", [{ link: "command:Open today's daily note", title: "Today", color: 5 }]);
	assert.deepEqual(readPins(t2), [{ link: "command:Open today's daily note", title: "Today", color: 5 }]);
	assert.match(t2, /---\nPinned tiles/);
	assert.equal(readPins(writePins(t1, [])).length, 0);
	assert.match(writePins(t1, []), /pins: \[\]\n---\nHi/);
	// "- " items at the left edge under pins: are replaced too.
	const flush = "---\npins:\n- link: \"[[A]]\"\n- link: \"[[B]]\"\nx: 1\n---\n";
	assert.equal(writePins(flush, [{ link: "[[C]]" }]), '---\npins:\n  - link: "[[C]]"\nx: 1\n---\n');
});

test("what a pin points at", () => {
	assert.deepEqual(pinKind("https://reader.brandonj.ink"), { kind: "url", url: "https://reader.brandonj.ink" });
	assert.deepEqual(pinKind("command: Open today's daily note"), { kind: "command", command: "Open today's daily note" });
	assert.deepEqual(pinKind("folder:content/_daily/"), { kind: "folder", folder: "content/_daily/" });
	assert.deepEqual(pinKind("[[Reading log#Top|RL]]"), { kind: "note", target: "Reading log" });
	assert.equal(pinPath({ link: "[[Reading log]]" }, paths, HOME), "content/Reading log.md");
	assert.equal(pinPath({ link: "[[Books.base]]" }, paths, HOME), "content/_docs/Books.base");
	assert.equal(pinPath({ link: "[[content/_docs/Books.base]]" }, paths, HOME), "content/_docs/Books.base");
	assert.equal(pinPath({ link: "[[content/b/Idea]]" }, paths, HOME), "content/b/Idea.md");
	assert.equal(pinPath({ link: "[[Nope]]" }, paths, HOME), null);
	assert.equal(pinPath({ link: "folder:content" }, paths, HOME), null);
});

test("links for new pins use the name unless it's shared", () => {
	assert.equal(linkFor("content/Reading log.md", paths), "[[Reading log]]");
	assert.equal(linkFor("content/_docs/Books.base", paths), "[[Books.base]]");
	assert.equal(linkFor("content/a/Idea.md", paths), "[[content/a/Idea]]");
	assert.equal(folderLink("content/_daily/"), "folder:content/_daily");
});

test("titles, colors and covers", () => {
	assert.equal(pinTitle({ link: "[[Reading log]]" }, "content/Reading log.md"), "Reading log");
	assert.equal(pinTitle({ link: "[[Reading log]]", title: "Reading" }, "content/Reading log.md"), "Reading");
	assert.equal(pinTitle({ link: "https://www.example.com/x" }), "example.com");
	assert.equal(pinTitle({ link: "folder:content/_daily" }), "_daily");
	assert.equal(pinTitle({ link: "command:Sync now" }), "Sync now");
	assert.equal(pinTitle({ link: "[[Books.base]]" }, "content/_docs/Books.base"), "Books");
	assert.equal(pinColor({ color: 3 }, 0), "var(--f3)");
	assert.equal(pinColor({ color: "#c0ffee" }, 0), "#c0ffee");
	assert.equal(pinColor({}, 8), "var(--f2)");
	assert.equal(pinColor({ color: "red; x" }, 0), "var(--f1)");
	const note = "---\ncoverImage: https://img/x.jpg\nbanner: \"[[b.png]]\"\n---\n";
	assert.deepEqual(pinCover({ link: "[[A]]" }, "content/A.md", note, HOME), { ref: { url: "https://img/x.jpg" }, from: "content/A.md" });
	assert.deepEqual(pinCover({ link: "[[A]]" }, "content/A.md", "---\nbanner: \"[[b.png]]\"\n---\n", HOME), { ref: { name: "b.png" }, from: "content/A.md" });
	assert.deepEqual(pinCover({ link: "[[A]]", cover: "[[c.jpg]]" }, "content/A.md", note, HOME), { ref: { name: "c.jpg" }, from: HOME });
	assert.equal(pinCover({ link: "[[A]]", cover: "none" }, "content/A.md", note, HOME), null);
	assert.equal(pinCover({ link: "https://x.com" }, null, null, HOME), null);
});

test("pins follow moved notes and folders", () => {
	const pins = [{ link: "[[Reading log]]", color: 2 }, { link: "folder:content/a" }, { link: "[[content/a/Idea]]" }, { link: "https://x.com" }];
	const moved = new Map([["content/Reading log.md", "content/logs/Reading.md"]]);
	const after = paths.filter((p) => !moved.has(p)).concat("content/logs/Reading.md");
	assert.deepEqual(retargetPins(pins, moved, paths, after, HOME)[0], { link: "[[Reading]]", color: 2 });
	const m2 = new Map([["content/a/Idea.md", "content/z/Idea.md"]]);
	const after2 = paths.filter((p) => !m2.has(p)).concat("content/z/Idea.md");
	const r = retargetPins(pins, m2, paths, after2, HOME, "content/a/", "content/z/");
	assert.equal(r[1].link, "folder:content/z");
	assert.equal(r[2].link, "[[content/z/Idea]]");
	assert.equal(retargetPins(pins, new Map([["content/x.md", "content/y.md"]]), paths, paths, HOME), null);
	assert.ok(pinOpens(pins[0], { path: "content/Reading log.md" }, paths, HOME));
	assert.ok(pinOpens(pins[1], { folder: "content/a/" }, paths, HOME));
	assert.ok(!pinOpens(pins[1], { path: "content/a/" }, paths, HOME));
});

test("a folder's corkboard, outliner or scrivenings can be pinned, and follows the folder", async () => {
	const { viewLink } = await import("../src/home.js");
	const pin = { link: viewLink("corkboard", "content/Novel/") };
	assert.equal(pin.link, "corkboard:content/Novel");
	assert.deepEqual(pinKind(pin.link), { kind: "view", view: "corkboard", folder: "content/Novel/" });
	assert.equal(pinTitle(pin, null), "Novel");
	assert.ok(pinOpens(pin, { folder: "content/novel/", view: "corkboard" }, [], HOME));
	assert.ok(!pinOpens(pin, { folder: "content/Novel/", view: "outliner" }, [], HOME));
	assert.deepEqual(retargetPins([pin], new Map(), [], [], HOME, "content/Novel/", "content/Books/Novel/"), [{ link: "corkboard:content/Books/Novel" }]);
});

test("a folder: pin counts as the folder's corkboard pin; wr1t3r's own files are app files", () => {
	const pin = { link: "folder:content/Novel" };
	assert.ok(pinOpens(pin, { folder: "content/novel/", view: "corkboard" }, [], HOME));
	assert.ok(!pinOpens(pin, { folder: "content/Novel/", view: "outliner" }, [], HOME));
	assert.ok(isAppFile("content/_wr1t3r/Home.md"));
	assert.ok(isAppFile("_wr1t3r/Home.md"));
	assert.ok(!isAppFile("content/my_wr1t3r/Home.md"));
	assert.ok(!isAppFile("content/Home.md"));
});

test("section headers live in the pins list and round-trip", () => {
	const text = '---\npins:\n  - section: Reading\n  - link: "[[Reading log]]"\n  - section: 2026\n  - link: folder:content/_daily\n---\n';
	const pins = readPins(text);
	assert.deepEqual(pins, [{ section: "Reading" }, { link: "[[Reading log]]" }, { section: 2026 }, { link: "folder:content/_daily" }]);
	assert.equal(writePins(text, pins), '---\npins:\n  - section: "Reading"\n  - link: "[[Reading log]]"\n  - section: 2026\n  - link: "folder:content/_daily"\n---\n');
	// Automatic colors count tiles only, so a header doesn't shift them.
	assert.deepEqual(tileOrdinals(pins), [-1, 0, -1, 1]);
	assert.equal(pinOpens(pins[0], { path: "content/Reading log.md" }, paths, HOME), false);
	assert.equal(retargetPins(pins, new Map([["content/Reading log.md", "content/x/Reading log.md"]]), paths, [...paths, "content/x/Reading log.md"], HOME)[0], pins[0]);
});
