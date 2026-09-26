// Keeps wr1t3r's page on this device so it opens with no connection. Notes
// themselves live in IndexedDB (src/store.js); /api/ is never cached.
const CACHE = "wr1t3r-shell";

async function cacheShell() {
	const cache = await caches.open(CACHE);
	const res = await fetch("/", { cache: "no-store" });
	if (!res.ok) return;
	const html = await res.clone().text();
	const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
	await cache.put("/", res);
	await Promise.all(assets.map((a) => cache.add(a).catch(() => {})));
}

self.addEventListener("install", (e) => {
	e.waitUntil(cacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
	e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
	const url = new URL(e.request.url);
	if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

	// The page: fresh when online (and re-cache what it points at), cached otherwise.
	if (e.request.mode === "navigate") {
		e.respondWith(
			fetch("/", { cache: "no-store" })
				.then((res) => {
					if (res.ok) e.waitUntil(cacheShell());
					return res;
				})
				.catch(async () => (await caches.match("/")) || Response.error()),
		);
		return;
	}

	// Everything else: cache first (built files have hashed names), then network.
	e.respondWith(
		caches.match(e.request).then(
			(hit) =>
				hit ||
				fetch(e.request).then((res) => {
					if (res.ok) {
						const copy = res.clone();
						e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy)));
					}
					return res;
				}),
		),
	);
});
