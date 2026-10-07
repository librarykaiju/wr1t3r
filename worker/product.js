// The product build's Worker (wrangler.product.toml): the page's files, plus
// Google sign-in's token swap (worker/googleauth.js). Nothing else runs here
// and nothing is stored.

import { googleAuthApi } from "./googleauth.js";
import { HttpError } from "./util.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
		// Only this page may use it.
		const origin = request.headers.get("Origin");
		if (origin && origin !== url.origin) return json({ error: "Not allowed" }, 403);
		try {
			const out = await googleAuthApi(request, env, url);
			return out ? json(out) : json({ error: "Not found" }, 404);
		} catch (e) {
			if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
			return json({ error: "Something went wrong" }, 500);
		}
	},
};
