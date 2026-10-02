// Keeps wr1t3r's page on this device so it opens with no connection. Notes
// themselves live in IndexedDB (src/store.js); /api/ is never cached.
const CACHE = "wr1t3r-shell";
const SANDBOX = "/dv-sandbox"; // public/dv-sandbox.html, runs dataviewjs blocks (src/dataview.js)

async function cacheShell() {
	const cache = await caches.open(CACHE);
	const res = await fetch("/", { cache: "no-store" });
	if (!res.ok) return;
	const html = await res.clone().text();
	const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
	await cache.put("/", res);
	let missed = false;
	await Promise.all([...assets, SANDBOX].map((a) => cache.add(a).catch(() => { missed = true; })));
	// Pruning reads the new scripts from the cache; with one missing it could
	// drop lazy parts that are still current, so it waits for a clean pass.
	if (!missed) await prune(cache, assets);
}

// Drops files from earlier builds. Kept: the page, the sandbox, what the page
// points at, and every built file those scripts can load later (lazy parts
// like export or PDF import, named inside the scripts), cached or not yet.
async function prune(cache, assets) {
	const keep = new Set(["/", SANDBOX]);
	const queue = [...assets];
	while (queue.length) {
		const path = queue.pop();
		if (keep.has(path)) continue;
		keep.add(path);
		if (!/\.m?js$/.test(path)) continue;
		const hit = await cache.match(path);
		if (!hit) continue;
		for (const m of (await hit.text()).matchAll(/(?:\.\/|\/?assets\/)([\w.-]+\.(?:m?js|css))/g)) queue.push("/assets/" + m[1]);
	}
	for (const req of await cache.keys()) {
		if (!keep.has(new URL(req.url).pathname)) await cache.delete(req);
	}
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

	// The dataviewjs sandbox: fresh when online, cached otherwise.
	if (url.pathname === SANDBOX) {
		e.respondWith(
			fetch(SANDBOX, { cache: "no-store" })
				.then((res) => {
					if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(SANDBOX, copy))); }
					return res;
				})
				.catch(async () => (await caches.match(SANDBOX)) || Response.error()),
		);
		return;
	}

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

// Task reminders, pushed by the Worker (worker/push.js): shown even with
// wr1t3r closed. Tapping one opens its note.
self.addEventListener("push", (e) => {
	let m = {};
	try { m = e.data?.json() || {}; } catch { m = { title: e.data?.text() || "Reminder" }; }
	e.waitUntil(self.registration.showNotification(m.title || "Reminder", {
		body: m.path ? m.path.split("/").pop().replace(/\.md$/i, "") : m.body || "",
		tag: m.tag || undefined,
		icon: "/icon-180.png",
		badge: "/icon-180.png",
		data: { path: m.path || "" },
		requireInteraction: true,
	}));
});

self.addEventListener("notificationclick", (e) => {
	e.notification.close();
	const path = e.notification.data?.path;
	const url = "/" + (path ? "#" + encodeURIComponent(path) : "");
	e.waitUntil((async () => {
		const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
		const win = open.find((c) => new URL(c.url).origin === location.origin);
		if (win) { await win.focus(); return win.navigate ? win.navigate(url).catch(() => win.postMessage({ open: path })) : null; }
		return self.clients.openWindow(url);
	})());
});
