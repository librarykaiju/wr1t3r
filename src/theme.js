// Themes: a family (Default, Sepia, Dracula, Rosé Pine, Tokyo Night,
// Catppuccin, Kanagawa, Everforest, Nord, Monokai, SynthWave '84, Bubblegum,
// Sakura, Mixtape) and a mode (Auto, Light, Dark). themeAttr() gives the data-theme value set on <html>; the
// colors are in src/style.css. public/theme.js repeats this before the page
// draws, so keep the two in step.

export const FAMILIES = ["default", "sepia", "dracula", "rosepine", "tokyonight", "catppuccin", "kanagawa", "everforest", "nord", "monokai", "synthwave", "bubblegum", "sakura", "mixtape"];

const VARIANTS = {
	default: { light: "light", dark: "dark" },
	sepia: { light: "sepia", dark: "sepia" }, // light only
	dracula: { light: "dracula-light", dark: "dracula" },
	rosepine: { light: "rosepine-dawn", dark: "rosepine" },
	tokyonight: { light: "tokyonight-day", dark: "tokyonight" },
	catppuccin: { light: "catppuccin-latte", dark: "catppuccin" },
	kanagawa: { light: "kanagawa-lotus", dark: "kanagawa" },
	everforest: { light: "everforest-light", dark: "everforest" },
	nord: { light: "nord-light", dark: "nord" },
	monokai: { light: "monokai", dark: "monokai" }, // dark only
	synthwave: { light: "synthwave", dark: "synthwave" }, // dark only
	bubblegum: { light: "bubblegum", dark: "bubblegum-night" },
	sakura: { light: "sakura", dark: "sakura-night" },
	mixtape: { light: "mixtape", dark: "mixtape" }, // the reader's own colors, one mode
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

// Colors (Settings > Appearance): the rainbow the sidebar folders, tags,
// bullets and planner use (--f1..--f7), or two-tone (the accent and a second
// color in turn), or one-tone (the accent alone). Saved as wr1t3rColors;
// set on <html> as data-colors, and src/style.css does the rest.
export const TONES = ["rainbow", "two", "one"];
export function readTones(raw) {
	return TONES.includes(raw) ? raw : "rainbow";
}

// Mixtape: the reader's own background, text, accent and second color, saved
// as JSON in wr1t3rMixtape and set on <html> as --mx-bg, --mx-fg, --mx-accent
// and --mx-second. src/style.css mixes the other colors from those four.
// public/theme.js repeats readMixtape() and mixtapeVars() before the page
// draws, so keep them in step.
export const MIXTAPE_KEYS = ["bg", "fg", "accent", "second"];
export const MIXTAPE_DEFAULT = { bg: "#fbfaf7", fg: "#1d1c1a", accent: "#2f5fd0", second: "#c2650f" };
const HEX = /^#[0-9a-f]{6}$/i;

export function readMixtape(raw) {
	let saved = {};
	try { saved = JSON.parse(raw) || {}; } catch {}
	const mx = {};
	for (const k of MIXTAPE_KEYS) mx[k] = HEX.test(saved[k]) ? saved[k].toLowerCase() : MIXTAPE_DEFAULT[k];
	return mx;
}

// "#abc" or "#aabbcc" (as a stylesheet writes it) -> "#aabbcc", or null.
export function toHex(value) {
	const v = String(value || "").trim().toLowerCase();
	if (/^#[0-9a-f]{3}$/.test(v)) return "#" + [...v.slice(1)].map((c) => c + c).join("");
	return HEX.test(v) ? v : null;
}

function luminance(hex) {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG contrast between two colors, 1 to 21. Body text wants 4.5 or more.
export function contrast(a, b) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

// The --mx-* variables for <html> or a site's :root, as { name: value }.
// A dark background makes the page dark (scroll bars, form fields).
export function mixtapeVars(mx) {
	return {
		"--mx-bg": mx.bg, "--mx-fg": mx.fg, "--mx-accent": mx.accent, "--mx-second": mx.second,
		"--mx-scheme": luminance(mx.bg) < 0.18 ? "dark" : "light",
	};
}
