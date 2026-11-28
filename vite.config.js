import { defineConfig, loadEnv } from "vite";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const OCR_VERSION = "7.0.0";

// Tesseract (src/localocr.js) runs in a web worker that loads its engine and
// language data by URL, so those files are copied into the build as they are,
// served from this site rather than a CDN.
function ocrAssets() {
	const pkg = (name) => dirname(require.resolve(name + "/package.json"));
	const version = JSON.parse(readFileSync(join(pkg("tesseract.js"), "package.json"), "utf8")).version;
	if (version !== OCR_VERSION) throw new Error(`tesseract.js is ${version}; update OCR_VERSION here and in src/ocrassets.js`);
	const files = [
		[join(pkg("tesseract.js"), "dist/worker.min.js"), "worker.min.js"],
		...["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"].map((f) => [join(pkg("tesseract.js-core"), f), f]),
		[join(pkg("@tesseract.js-data/eng"), "4.0.0_best_int/eng.traineddata.gz"), "eng.traineddata.gz"],
	];
	let outDir = "dist";
	return {
		name: "ocr-assets",
		configResolved(c) { outDir = c.build.outDir; },
		closeBundle() {
			const to = join(outDir, "ocr", OCR_VERSION);
			mkdirSync(to, { recursive: true });
			for (const [from, name] of files) copyFileSync(from, join(to, name));
		},
	};
}

// The personal build (no VITE_DROPBOX_ONLY) frames brandonj.ink's mixtape
// player (src/mixtape.js), so its copy of _headers lets the page frame that
// site. The product and self-host builds keep the plain policy.
function personalHeaders(mode) {
	let outDir = "dist";
	return {
		name: "personal-headers",
		configResolved(c) { outDir = c.build.outDir; },
		closeBundle() {
			if (loadEnv(mode, process.cwd()).VITE_DROPBOX_ONLY) return;
			const file = join(outDir, "_headers");
			const text = readFileSync(file, "utf8");
			const out = text.replace("frame-ancestors 'none'", "frame-src 'self' https://brandonj.ink; frame-ancestors 'none'");
			if (out === text) throw new Error("personal-headers: couldn't find frame-ancestors in _headers");
			writeFileSync(file, out);
		},
	};
}

export default defineConfig(({ mode }) => {
	// The product build (`npm run deploy:product`, .env.product) is no use
	// without a Dropbox app key: there's no Worker to sign in to instead.
	if (mode === "product" && !loadEnv(mode, process.cwd()).VITE_DROPBOX_APP_KEY) throw new Error("Set VITE_DROPBOX_APP_KEY in .env.product.local (see docs/builds.md, \"The product build\")");
	// The self-host build (`npm run build:selfhost`) gets its key from the
	// host's build settings; loadEnv also reads the shell's VITE_ variables.
	if (mode === "selfhost" && !loadEnv(mode, process.cwd()).VITE_DROPBOX_APP_KEY) throw new Error("Add a build variable called VITE_DROPBOX_APP_KEY with your Dropbox app's App key (see https://wr1t3r.app/self-host.html, step 2)");
	return { ...config, plugins: [...config.plugins, personalHeaders(mode)] };
});

const config = {
	// CodeMirror plus the markdown grammar (which embeds HTML, CSS and JS) is ~200 kB
	// gzipped; it is cached for offline use, so one chunk is fine.
	build: { outDir: "dist", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 900 },
	server: { proxy: { "/api": "http://localhost:8787" } },
	plugins: [ocrAssets()],
};
