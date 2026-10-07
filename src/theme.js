// Themes: a family (Default, Sepia, Dracula, Rosé Pine, Tokyo Night,
// Catppuccin, Kanagawa, SynthWave '84) and a mode (Auto,
// Light, Dark). themeAttr() gives the data-theme value set on <html>; the
// colors are in src/style.css. public/theme.js repeats this before the page
// draws, so keep the two in step.

export const FAMILIES = ["default", "sepia", "dracula", "rosepine", "tokyonight", "catppuccin", "kanagawa", "synthwave"];

const VARIANTS = {
	default: { light: "light", dark: "dark" },
	sepia: { light: "sepia", dark: "sepia" }, // light only
	dracula: { light: "dracula-light", dark: "dracula" },
	rosepine: { light: "rosepine-dawn", dark: "rosepine" },
	tokyonight: { light: "tokyonight-day", dark: "tokyonight" },
	catppuccin: { light: "catppuccin-latte", dark: "catppuccin" },
	kanagawa: { light: "kanagawa-lotus", dark: "kanagawa" },
	synthwave: { light: "synthwave", dark: "synthwave" }, // dark only
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

// The variants a page outside the app (the exported website) uses for a
// family and mode: { light, dark } as data-theme values, null for Default's
// light colors (the stylesheet's plain :root). dark is null when the site
// shouldn't switch with the visitor's system.
export function themeVariants(family, mode) {
	const v = VARIANTS[family] || VARIANTS.default;
	const light = family === "default" ? null : v.light;
	if (mode === "light") return { light, dark: null };
	if (mode === "dark") return { light: v.dark, dark: null };
	return { light, dark: v.dark === v.light ? null : v.dark };
}
