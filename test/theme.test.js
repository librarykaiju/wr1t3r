import { test } from "node:test";
import assert from "node:assert/strict";
import { readTheme, familyOf, themeAttr, readTones, readMixtape, mixtapeVars, toHex, contrast, themeVariants, MIXTAPE_DEFAULT } from "../src/theme.js";

test("old saved themes still load", () => {
	assert.deepEqual(readTheme(null, "dark"), { family: "default", mode: "dark" });
	assert.deepEqual(readTheme(null, null), { family: "default", mode: "auto" });
	assert.deepEqual(readTheme("dracula", "light"), { family: "dracula", mode: "light" });
});

test("families pick their light or dark variant, Auto follows the system", () => {
	assert.equal(themeAttr("default", "auto", true), null);
	assert.equal(themeAttr("default", "dark", false), "dark");
	assert.equal(themeAttr("dracula", "auto", true), "dracula");
	assert.equal(themeAttr("dracula", "auto", false), "dracula-light");
	assert.equal(themeAttr("rosepine", "light", true), "rosepine-dawn");
	assert.equal(themeAttr("rosepine", "dark", false), "rosepine");
	assert.equal(themeAttr("gruvbox", "auto", true), "gruvbox");
	assert.equal(themeAttr("gruvbox", "light", true), "gruvbox-light");
	assert.equal(themeAttr("tokyonight", "auto", false), "tokyonight-day");
	assert.equal(themeAttr("catppuccin", "dark", false), "catppuccin");
	assert.equal(themeAttr("kanagawa", "light", true), "kanagawa-lotus");
	assert.equal(themeAttr("everforest", "light", true), "everforest-light");
	assert.equal(themeAttr("nord", "auto", true), "nord");
	assert.equal(themeAttr("monokai", "light", false), "monokai");
	assert.equal(themeAttr("synthwave", "light", false), "synthwave");
	assert.equal(themeAttr("bubblegum", "light", true), "bubblegum");
	assert.equal(themeAttr("bubblegum", "auto", true), "bubblegum-night");
});

test("A saved Sakura, since dropped, opens as Bubblegum", () => {
	assert.deepEqual(readTheme("sakura", "dark"), { family: "bubblegum", mode: "dark" });
	assert.equal(familyOf("sakura"), "bubblegum");
	assert.equal(familyOf("nope"), null);
});

test("Mixtape is one mode, whatever Auto or the system say", () => {
	assert.equal(readTheme("mixtape", "dark").family, "mixtape");
	assert.equal(themeAttr("mixtape", "auto", true), "mixtape");
	assert.equal(themeAttr("mixtape", "light", true), "mixtape");
	assert.deepEqual(themeVariants("mixtape", "auto"), { light: "mixtape", dark: null });
});

test("Colors: rainbow unless two-tone or one-tone was saved", () => {
	assert.equal(readTones(null), "rainbow");
	assert.equal(readTones("two"), "two");
	assert.equal(readTones("one"), "one");
	assert.equal(readTones("plaid"), "rainbow");
});

test("Mixtape colors: bad or missing ones fall back, dark backgrounds make a dark page", () => {
	assert.deepEqual(readMixtape(null), MIXTAPE_DEFAULT);
	assert.deepEqual(readMixtape("not json"), MIXTAPE_DEFAULT);
	const mx = readMixtape(JSON.stringify({ bg: "#101820", fg: "#F2AA4C", accent: "red", second: "#7fd6d9" }));
	assert.deepEqual(mx, { bg: "#101820", fg: "#f2aa4c", accent: MIXTAPE_DEFAULT.accent, second: "#7fd6d9" });
	assert.equal(mixtapeVars(mx)["--mx-scheme"], "dark");
	assert.equal(mixtapeVars(MIXTAPE_DEFAULT)["--mx-scheme"], "light");
	assert.equal(toHex(" #ABC "), "#aabbcc");
	assert.equal(toHex("rgb(0,0,0)"), null);
	assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
	assert.ok(contrast("#fbfaf7", "#f0f0f0") < 4.5);
});
