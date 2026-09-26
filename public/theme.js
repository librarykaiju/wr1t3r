// Runs before the page draws, so a saved theme or text size never flashes
// the default first. The settings panel (src/main.js) changes both later.
(function () {
	var root = document.documentElement;
	try {
		var t = localStorage.getItem("wr1t3rTheme");
		if (t === "light" || t === "dark" || t === "sepia") root.setAttribute("data-theme", t);
		var size = Number(localStorage.getItem("wr1t3rFontSize"));
		if (size >= 14 && size <= 30) root.style.setProperty("--editor-size", size + "px");
	} catch (e) {}
})();
