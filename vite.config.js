import { defineConfig } from "vite";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
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

export default defineConfig({
	// CodeMirror plus the markdown grammar (which embeds HTML, CSS and JS) is ~200 kB
	// gzipped; it is cached for offline use, so one chunk is fine.
	build: { outDir: "dist", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 900 },
	server: { proxy: { "/api": "http://localhost:8787" } },
	plugins: [ocrAssets()],
});
