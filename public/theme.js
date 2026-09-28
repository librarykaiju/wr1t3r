// Runs before the page draws, so a saved theme or text size never flashes
// the default first. The settings panel (src/main.js, src/theme.js) changes
// both later; this repeats src/theme.js's themeAttr(), so keep them in step.
(function () {
	var root = document.documentElement;
	try {
		var fam = localStorage.getItem("wr1t3rThemeFamily"), mode = localStorage.getItem("wr1t3rTheme");
		var families = { default: ["light", "dark"], sepia: ["sepia", "sepia"], dracula: ["dracula-light", "dracula"], rosepine: ["rosepine-dawn", "rosepine"] };
		if (!families[fam]) fam = mode === "sepia" ? "sepia" : "default";
		if (mode !== "light" && mode !== "dark") mode = "auto";
		if (!(fam === "default" && mode === "auto")) {
			var dark = mode === "dark" || (mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
			root.setAttribute("data-theme", families[fam][dark ? 1 : 0]);
		}
		var size = Number(localStorage.getItem("wr1t3rFontSize"));
		if (size >= 14 && size <= 30) root.style.setProperty("--editor-size", size + "px");
	} catch (e) {}
})();
