import { test } from "node:test";
import assert from "node:assert/strict";
import { readTheme, themeAttr } from "../src/theme.js";

test("old saved themes still load", () => {
	assert.deepEqual(readTheme(null, "sepia"), { family: "sepia", mode: "auto" });
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
	assert.equal(themeAttr("sepia", "dark", true), "sepia");
	assert.equal(themeAttr("tokyonight", "auto", false), "tokyonight-day");
	assert.equal(themeAttr("catppuccin", "dark", false), "catppuccin");
	assert.equal(themeAttr("kanagawa", "light", true), "kanagawa-lotus");
});
