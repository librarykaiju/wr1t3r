import test from "node:test";
import assert from "node:assert/strict";
import { pageText, readIcon } from "../src/pagehead.js";
import { readPlanner, writePlanner } from "../src/planner.js";

test("pageText: trimmed text, or null for empty and template placeholders", () => {
	assert.equal(pageText("  The life and times  "), "The life and times");
	assert.equal(pageText(""), null);
	assert.equal(pageText(null), null);
	assert.equal(pageText("{{date}}"), null);
});

test("readIcon: an emoji or letters, or a picture as a banner takes", () => {
	assert.deepEqual(readIcon("❤️"), { text: "❤️" });
	assert.deepEqual(readIcon("👩‍💻"), { text: "👩‍💻" });
	assert.deepEqual(readIcon("WR"), { text: "WR" });
	assert.deepEqual(readIcon("[[heart.png]]"), { image: { name: "heart.png" } });
	assert.deepEqual(readIcon("https://example.com/i.png"), { image: { url: "https://example.com/i.png" } });
	assert.equal(readIcon(""), null);
});

test("Planner: icon and description round-trip next to the title", () => {
	const cfg = readPlanner('icon: 🌻\ntitle: My day\ndescription: "One day at a time"');
	assert.equal(cfg.icon, "🌻");
	assert.equal(cfg.description, "One day at a time");
	const text = writePlanner(cfg);
	assert.match(text, /^icon: 🌻\ntitle: My day\ndescription: One day at a time/);
	assert.deepEqual(readPlanner(text), cfg);
});
