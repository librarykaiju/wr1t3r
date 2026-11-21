// Makes the iPhone and iPad launch screens (public/splash/) and the <link>
// tags for index.html. iOS shows one of these while a home-screen app starts;
// without them it shows a blank white screen, which flashes in a dark theme.
// iOS only uses an image whose size matches the screen exactly, so there is
// one per screen size, in light and dark.
//
//   node scripts/splash.js        (needs Playwright: npm i -D playwright)
//
// The committed images were then cut to 64 colors (Pillow's quantize) to
// shrink them about sixfold; Playwright's straight output works too.
//
// Then paste the printed tags into index.html in place of the old ones. Add a
// device here when a new screen size comes out.

import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)("playwright");

// [width, height, pixel ratio] in CSS pixels, portrait.
const SCREENS = [
	[440, 956, 3], // iPhone 16 Pro Max, 17 Pro Max
	[430, 932, 3], // iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
	[428, 926, 3], // iPhone 12 Pro Max, 13 Pro Max, 14 Plus
	[420, 912, 3], // iPhone Air
	[414, 896, 3], // iPhone XS Max, 11 Pro Max
	[414, 896, 2], // iPhone XR, 11
	[402, 874, 3], // iPhone 16 Pro, 17, 17 Pro
	[393, 852, 3], // iPhone 14 Pro, 15, 15 Pro, 16
	[390, 844, 3], // iPhone 12, 13, 14, 12 Pro, 13 Pro, 16e
	[375, 812, 3], // iPhone X, XS, 11 Pro, 12 mini, 13 mini
	[375, 667, 2], // iPhone SE (2nd and 3rd), 8
	[1032, 1376, 2], // iPad Pro 13" (M4)
	[1024, 1366, 2], // iPad Pro 12.9"
	[834, 1210, 2], // iPad Pro 11" (M4)
	[834, 1194, 2], // iPad Pro 11"
	[820, 1180, 2], // iPad Air, iPad (10th)
	[810, 1080, 2], // iPad (9th)
	[744, 1133, 2], // iPad mini (6th)
];

// The default theme's backgrounds (src/style.css :root and its dark mode).
const SCHEMES = { light: "#fbfaf7", dark: "#141414" };

const icon = readFileSync(new URL("../public/icon.svg", import.meta.url), "utf8");
const out = new URL("../public/splash/", import.meta.url);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const tags = [];
for (const [w, h, dpr] of SCREENS) {
	const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
	for (const [scheme, bg] of Object.entries(SCHEMES)) {
		const size = Math.round(Math.min(w, h) * 0.3);
		await page.setContent(`<style>html,body{margin:0;height:100%;background:${bg}}body{display:grid;place-items:center}svg{width:${size}px;height:${size}px}</style>${icon}`);
		const name = `${scheme}-${w * dpr}x${h * dpr}.png`;
		await page.screenshot({ path: new URL(name, out).pathname });
		tags.push(`\t<link rel="apple-touch-startup-image" href="/splash/${name}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait) and (prefers-color-scheme: ${scheme})">`);
	}
	await page.close();
}
await browser.close();
console.log(tags.join("\n"));
