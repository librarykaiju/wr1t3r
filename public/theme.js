// Runs before the page draws, so a saved theme or text size never flashes
// the default first. The settings panel (src/main.js, src/theme.js) changes
// both later; this repeats src/theme.js's themeAttr(), readTones(),
// readMixtape() and mixtapeVars(), so keep them in step.
(function () {
	var root = document.documentElement;
	try {
		var fam = localStorage.getItem("wr1t3rThemeFamily"), mode = localStorage.getItem("wr1t3rTheme");
		var families = { default: ["light", "dark"], gruvbox: ["gruvbox-light", "gruvbox"], dracula: ["dracula-light", "dracula"], rosepine: ["rosepine-dawn", "rosepine"], tokyonight: ["tokyonight-day", "tokyonight"], catppuccin: ["catppuccin-latte", "catppuccin"], kanagawa: ["kanagawa-lotus", "kanagawa"], everforest: ["everforest-light", "everforest"], nord: ["nord-light", "nord"], monokai: ["monokai", "monokai"], synthwave: ["synthwave", "synthwave"], bubblegum: ["bubblegum", "bubblegum-night"], mixtape: ["mixtape", "mixtape"] };
		if (fam === "sakura") fam = "bubblegum"; // retired, see src/theme.js RETIRED
		if (!families[fam]) fam = "default";
		if (mode !== "light" && mode !== "dark") mode = "auto";
		if (!(fam === "default" && mode === "auto")) {
			var dark = mode === "dark" || (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
			root.setAttribute("data-theme", families[fam][dark ? 1 : 0]);
		}
		var tones = localStorage.getItem("wr1t3rColors");
		if (tones === "two" || tones === "one") root.setAttribute("data-colors", tones);
		if (fam === "mixtape") {
			var mx = {}, hex = /^#[0-9a-f]{6}$/i, def = { bg: "#fbfaf7", fg: "#1d1c1a", accent: "#2f5fd0", second: "#c2650f" };
			try { mx = JSON.parse(localStorage.getItem("wr1t3rMixtape")) || {}; } catch (e) {}
			for (var k in def) root.style.setProperty("--mx-" + k, hex.test(mx[k]) ? mx[k] : def[k]);
			var bg = hex.test(mx.bg) ? mx.bg : def.bg, lum = 0;
			[1, 3, 5].forEach(function (i, n) { var c = parseInt(bg.slice(i, i + 2), 16) / 255; lum += [0.2126, 0.7152, 0.0722][n] * (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); });
			root.style.setProperty("--mx-scheme", lum < 0.18 ? "dark" : "light");
		}
		var size = Number(localStorage.getItem("wr1t3rFontSize"));
		if (size >= 14 && size <= 30) root.style.setProperty("--editor-size", size + "px");
	} catch (e) {}
})();
