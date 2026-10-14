// Neighbors: the sites you follow and what they've posted lately, newest
// first. Each post shows its title, site, date and a line or two, and opens on
// its own site, so reading happens there. Following a site, unfollowing, and
// importing another reader's OPML change _wr1t3r/Following.md (src/feeds.js).
// Feeds are read twice a day, morning and evening (main.js), or now with
// Refresh.
//
// host: {
//   list()                 the follows, from Following.md
//   save(list)             writes them back -> Promise
//   feeds()                the last read: { at, feeds: { [site url]: { title, items, error? } } }
//   refresh()              reads every feed now -> Promise (the new feeds())
//   lookup(address)        one site's feed through the relay -> { feed, title, site, items }
//   seen(ms)               marks the posts up to now as seen
//   toast(text)
// }

import { neighborsList, addFollow, parseOpml, siteUrl, sameSite, hostOf } from "./feeds.js";

let open = null;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function when(iso) {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return "";
	const d = new Date(t), now = new Date();
	return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === now.getFullYear() ? "" : ", " + d.getFullYear()}`;
}
function ago(ms) {
	if (!ms) return "not yet";
	const m = Math.round((Date.now() - ms) / 60000);
	if (m < 1) return "just now";
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
	const d = Math.round(h / 24);
	return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function openNeighbors(host, { follow = "" } = {}) {
	open?.close();
	const back = document.activeElement;
	const wrap = el("div", "palette compile neighbors");
	wrap.setAttribute("role", "dialog");
	wrap.setAttribute("aria-label", "Neighbors");
	const box = el("div", "compile-box");
	const head = el("header", "compile-head");
	const h = el("h2", null, "Neighbors");
	const x = el("button", "quiet", "×");
	x.type = "button";
	x.setAttribute("aria-label", "Close");
	head.append(h, x);

	// The left side: follow a site, the list of who you follow.
	const form = el("form", "compile-form");
	const add = el("label");
	const address = Object.assign(el("input"), { type: "text", value: follow, placeholder: "someone.neocities.org", autocomplete: "off", spellcheck: false });
	address.setAttribute("autocapitalize", "off");
	add.append(el("span", null, "Follow a site: its address or its feed's"), address);
	const go = Object.assign(el("button", null, "Follow"), { type: "submit" });
	const status = el("p", "hint");
	status.setAttribute("aria-live", "polite");
	const row = el("div", "compile-actions");
	const refresh = Object.assign(el("button", null, "Refresh now"), { type: "button" });
	const importBtn = Object.assign(el("button", null, "Import OPML…"), { type: "button" });
	importBtn.title = "Bring in the sites another feed reader follows (its OPML export)";
	const file = Object.assign(el("input"), { type: "file", accept: ".opml,.xml,text/xml,application/xml", hidden: true });
	row.append(refresh, importBtn, file);
	const lastRead = el("p", "hint");
	const followingHead = el("h3", null, "Following");
	const sites = el("ul", "neighbors-sites");
	form.append(add, go, status, row, lastRead, followingHead, sites,
		el("p", "hint", "Feeds are read each morning and evening while wr1t3r is open. Who you follow is kept in your notebook (_wr1t3r/Following.md), not on any server."));

	// The right side: the posts.
	const side = el("div", "neighbors-posts");
	const posts = el("ol", "neighbors-list");
	side.append(posts);

	const grid = el("div", "compile-grid");
	grid.append(form, side);
	box.append(head, grid);
	wrap.append(box);
	document.body.append(wrap);

	function draw() {
		const list = host.list(), last = host.feeds();
		const feeds = last.feeds || {};
		lastRead.textContent = `Last read ${ago(last.at)}.`;
		sites.replaceChildren(...list.map((s) => {
			const li = el("li");
			const f = feeds[s.url];
			const a = Object.assign(el("a", null, s.name || f?.title || hostOf(s.url)), { href: s.url, target: "_blank", rel: "noopener" });
			const note = f?.error ? el("span", "neighbors-error", `Couldn't read its feed: ${f.error}`) : null;
			const un = Object.assign(el("button", "quiet", "Unfollow"), { type: "button" });
			un.addEventListener("click", async () => {
				if (!confirm(`Stop following ${a.textContent}?`)) return;
				await host.save(host.list().filter((t) => t.url !== s.url));
				draw();
			});
			li.append(a, un);
			if (note) li.append(note);
			return li;
		}));
		if (!list.length) sites.append(el("li", "hint", "Nobody yet. Follow a site above, or import the list from another feed reader."));
		const items = neighborsList(list, feeds);
		posts.replaceChildren(...items.map((p) => {
			const li = el("li", "neighbors-post");
			const a = Object.assign(el("a", "neighbors-title", p.title), { href: p.url, target: "_blank", rel: "noopener" });
			const meta = el("p", "neighbors-meta");
			meta.append(Object.assign(el("a", null, p.name), { href: p.site, target: "_blank", rel: "noopener" }));
			if (p.date) meta.append(" · ", Object.assign(el("time", null, when(p.date)), { dateTime: p.date }));
			li.append(a, meta);
			if (p.summary) li.append(el("p", "neighbors-summary", p.summary));
			return li;
		}));
		if (!items.length) posts.append(el("li", "neighbors-empty", list.length ? (last.at ? "Nothing posted yet by the sites you follow." : "Reading their feeds…") : "When the sites you follow post something, it shows here, newest first. Click a post to read it on their site."));
	}

	async function doRefresh() {
		refresh.disabled = true;
		refresh.textContent = "Reading…";
		try { await host.refresh(); } catch (e) { host.toast("Couldn't read the feeds: " + e.message); }
		refresh.disabled = false;
		refresh.textContent = "Refresh now";
		if (open?.wrap === wrap) draw();
	}

	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		const url = siteUrl(address.value);
		if (!url) { status.textContent = "That isn't a web address."; return; }
		if (host.list().some((s) => sameSite(s.url, url) || sameSite(s.feed, url))) { status.textContent = "You follow that site already."; return; }
		go.disabled = true;
		status.textContent = "Looking for its feed…";
		try {
			const f = await host.lookup(url);
			// Given a feed's address, follow the site it belongs to.
			const site = f.feed && sameSite(f.feed, url) && f.site ? siteUrl(f.site) || url : url;
			const next = addFollow(host.list(), { url: site, feed: f.feed, name: f.title });
			if (next === host.list() || next.length === host.list().length) status.textContent = "You follow that site already.";
			else {
				await host.save(next);
				status.textContent = `Following ${f.title || hostOf(site)}.`;
				address.value = "";
				await doRefresh();
			}
		} catch (err) {
			status.textContent = /No feed/.test(err.message) ? "That site has no feed wr1t3r can find, so there's nothing to follow yet." : "Couldn't reach it: " + err.message;
		}
		go.disabled = false;
		draw();
	});
	refresh.addEventListener("click", doRefresh);
	importBtn.addEventListener("click", () => file.click());
	file.addEventListener("change", async () => {
		const f = file.files?.[0];
		file.value = "";
		if (!f) return;
		const found = parseOpml(await f.text());
		let list = host.list();
		const before = list.length;
		for (const s of found) list = addFollow(list, s);
		if (list.length === before) { status.textContent = found.length ? "You follow all of those already." : "No feeds in that file."; return; }
		await host.save(list);
		status.textContent = `Following ${list.length - before} more site${list.length - before === 1 ? "" : "s"}.`;
		draw();
		await doRefresh();
	});

	function close() {
		host.seen(Date.now());
		wrap.remove();
		document.removeEventListener("keydown", esc, true);
		open = null;
		back?.focus?.();
	}
	const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
	x.addEventListener("click", close);
	wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
	document.addEventListener("keydown", esc, true);
	open = { close, wrap };
	draw();
	if (follow) address.focus();
	else if (host.list().length && !host.feeds().at) doRefresh();
}
