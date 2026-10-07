import { test } from "node:test";
import assert from "node:assert/strict";
import { scriptKinds, isScript } from "../src/script.js";
import { toHTML, toDocx } from "../src/exporter.js";
import { builtinTemplate } from "../src/builtintemplates.js";

const SAMPLE = [
	"FADE IN:",
	"",
	"EXT. CITY STREET - NIGHT",
	"",
	"Rain on empty pavement. MAYA hurries past.",
	"",
	"MAYA (V.O.)",
	"(into the phone)",
	"I'm two minutes away.",
	"Don't start without me.",
	"",
	"She stops.",
	"",
	"CUT TO:",
	"",
	"int. diner - continuous",
	"",
	"END OF ACT ONE",
	"",
	"## ACT TWO",
	"",
	"%% a note",
	"MAYA",
	"over two lines %%",
];

test("lines are read as a screenplay's parts", () => {
	assert.deepEqual(scriptKinds(SAMPLE), [
		"action", null, "scene", null, "action", null,
		"character", "paren", "dialogue", "dialogue", null,
		"action", null, "transition", null, "scene", null, "action", null, null, null, null, null, null,
	]);
});

test("a name in capitals with nothing under it is action, not a character", () => {
	assert.deepEqual(scriptKinds(["", "BOOM.", "", "SILENCE"]), [null, "action", null, "action"]);
});

test("cssclasses: script (or screenplay) turns the layout on", () => {
	assert.ok(isScript("---\ncssclasses:\n  - script\n---\n"));
	assert.ok(isScript("---\ncssclasses: screenplay\n---\n"));
	assert.ok(!isScript("---\ncssclasses: manuscript\n---\n"));
	assert.ok(!isScript("no properties"));
	assert.ok(isScript(builtinTemplate("Screenplay")));
	assert.ok(isScript(builtinTemplate("Script scene")));
});

test("Compile's script layout gives each line its part", () => {
	const html = toHTML(SAMPLE.slice(0, 16).join("\n"), { layout: "script" });
	assert.match(html, /<main class="script">/);
	assert.match(html, /<p class="sp-scene">EXT\. CITY STREET - NIGHT<\/p>/);
	assert.match(html, /<div class="sp">\n<p class="sp-character">MAYA \(V\.O\.\)<\/p>\n<p class="sp-paren">\(into the phone\)<\/p>\n<p class="sp-dialogue">I’m two minutes away\.<\/p>\n<p class="sp-dialogue">Don’t start without me\.<\/p>\n<\/div>/);
	assert.match(html, /<p class="sp-transition">CUT TO:<\/p>/);
	// Other layouts are untouched.
	assert.doesNotMatch(toHTML(SAMPLE.join("\n")), /class="sp/);
});

test("a script compiles to Word", async () => {
	const blob = await toDocx(SAMPLE.join("\n"), { layout: "script" });
	assert.ok(blob.size > 1000);
});
