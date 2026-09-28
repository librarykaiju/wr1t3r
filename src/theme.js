// Themes: a family (Default, Sepia, Dracula, Rosé Pine) and a mode (Auto,
// Light, Dark). themeAttr() gives the data-theme value set on <html>; the
// colors are in src/style.css. public/theme.js repeats this before the page
// draws, so keep the two in step.

export const FAMILIES = ["default", "sepia", "dracula", "rosepine"];

const VARIANTS = {
	default: { light: "light", dark: "dark" },
	sepia: { light: "sepia", dark: "sepia" }, // light only
	dracula: { light: "dracula-light", dark: "dracula" },
	rosepine: { light: "rosepine-dawn", dark: "rosepine" },
};

// Saved values -> { family, mode }. Before families, wr1t3rTheme held
// "light", "dark" or "sepia" on its own.
export function readTheme(familyRaw, modeRaw) {
	let family = FAMILIES.includes(familyRaw) ? familyRaw : "default";
	let mode = modeRaw === "light" || modeRaw === "dark" ? modeRaw : "auto";
	if (modeRaw === "sepia" && !FAMILIES.includes(familyRaw)) family = "sepia";
	return { family, mode };
}

// The data-theme value, or null for Default + Auto (the stylesheet follows
// the system itself then).
export function themeAttr(family, mode, systemDark) {
	const v = VARIANTS[family] || VARIANTS.default;
	if (family === "default" && mode === "auto") return null;
	const dark = mode === "dark" || (mode === "auto" && systemDark);
	return dark ? v.dark : v.light;
}
