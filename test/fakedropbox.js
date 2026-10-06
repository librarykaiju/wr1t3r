// A Dropbox stand-in that answers the HTTP calls src/dropbox.js makes, with
// the same rules as the real one: revs, WriteMode add/update with
// strict_conflict, delete_v2 parent_rev, paged list_folder, 401 for an old
// token, and case-insensitive paths.

export function fakeDropbox({ pageSize = 2 } = {}) {
	let n = 0;
	let tokenN = 1;
	const files = new Map(); // lower path -> {display, rev, bytes}
	const state = { access: "a1", refresh: "r1", calls: [], files };
	const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
	const err = (summary) => json({ error_summary: summary, error: {} }, 409);
	const meta = (f) => ({ ".tag": "file", name: f.display.split("/").pop(), path_display: f.display, path_lower: f.display.toLowerCase(), rev: f.rev, size: f.bytes.length });
	const cursors = new Map();

	async function fetch(url, init = {}) {
		const u = new URL(url);
		const route = u.pathname;
		state.calls.push(route);
		const h = new Headers(init.headers);
		if (route === "/oauth2/token") {
			const q = new URLSearchParams(init.body.toString());
			if (q.get("grant_type") === "refresh_token") {
				if (q.get("refresh_token") !== state.refresh) return json({ error: "invalid_grant" }, 400);
				state.access = "a" + ++tokenN;
				return json({ access_token: state.access, expires_in: 14400, token_type: "bearer" });
			}
			if (q.get("grant_type") === "authorization_code" && q.get("code") === "good" && q.get("code_verifier")) {
				return json({ access_token: state.access, refresh_token: state.refresh, expires_in: 14400 });
			}
			return json({ error: "invalid_grant" }, 400);
		}
		if (h.get("Authorization") !== "Bearer " + state.access) return json({ error_summary: "expired_access_token/" }, 401);
		const arg = route.startsWith("/2/files/download") || route.startsWith("/2/files/upload")
			? JSON.parse(h.get("Dropbox-API-Arg"))
			: init.body ? JSON.parse(init.body) : null;
		if (h.get("Dropbox-API-Arg") && /[^\x00-\x7e]/.test(h.get("Dropbox-API-Arg"))) return json({ error: "header not ascii" }, 400);
		const key = arg?.path?.toLowerCase();
		const cur = key && files.get(key);

		switch (route) {
			case "/2/users/get_current_account":
				return json({ account_id: "dbid:x" });
			case "/2/files/list_folder":
			case "/2/files/list_folder/continue": {
				let all, at;
				if (arg.cursor) ({ all, at } = cursors.get(arg.cursor));
				else { all = [...files.values()].map(meta); at = 0; }
				const page = all.slice(at, at + pageSize);
				const has_more = at + pageSize < all.length;
				const cursor = "c" + ++n;
				cursors.set(cursor, { all, at: at + pageSize });
				return json({ entries: page, cursor, has_more });
			}
			case "/2/files/get_metadata":
				return cur ? json(meta(cur)) : err("path/not_found/");
			case "/2/files/download":
				if (!cur) return err("path/not_found/");
				return new Response(cur.bytes, { headers: { "Dropbox-API-Result": JSON.stringify(meta(cur)).replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) } });
			case "/2/files/upload": {
				const mode = arg.mode[".tag"];
				if (mode === "add" && cur) return err("path/conflict/file/");
				if (mode === "update" && (!cur || cur.rev !== arg.mode.update)) return err("path/conflict/file/");
				const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
				const f = { display: arg.path, rev: "rev" + ++n, bytes };
				files.set(key, f);
				return json(meta(f));
			}
			case "/2/files/delete_v2":
				if (!cur) return err("path_lookup/not_found/");
				if (arg.parent_rev && arg.parent_rev !== cur.rev) return err("path_write/conflict/file/");
				files.delete(key);
				return json({ metadata: meta(cur) });
		}
		return json({ error: "no route " + route }, 400);
	}

	// Ends the current access token, as Dropbox does after four hours.
	state.expire = () => { state.access = "a" + ++tokenN; };
	return { fetch, state };
}
