import { defineConfig } from "vite";

export default defineConfig({
	// CodeMirror plus the markdown grammar (which embeds HTML, CSS and JS) is ~200 kB
	// gzipped; it is cached for offline use, so one chunk is fine.
	build: { outDir: "dist", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 800 },
	server: { proxy: { "/api": "http://localhost:8787" } },
});
