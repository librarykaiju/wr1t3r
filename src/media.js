// Media notes in the page: search a kind (movie/TV, book, music, game, comic,
// podcast), pick a result, pick a cover where there's a choice, and get a
// filled-in note. The lookups happen in the Worker (worker/media.js); the
// dialogs reuse the command palette's look.

import { mediaNote, mediaNoteName } from "./medianote.js";

// The search dialog. search(q) resolves to [{title, subtitle, thumbnailUrl}];
// resolves to the chosen result, or null when closed.
// blank: a label for a button that skips the search (resolves { blank: true }).
export function searchDialog(title, search, { blank = null } = {}) {
	return new Promise((resolve) => {
		const { wrap, box, close } = dialog(title, () => resolve(null));
		const input = document.createElement("input");
		input.type = "search";
		input.placeholder = title + "…";
		input.setAttribute("aria-label", title);
		input.setAttribute("autocomplete", "off");
		input.spellcheck = false;
		const list = document.createElement("ul");
		list.setAttribute("role", "listbox");
		list.className = "media-results";
		box.append(input, list);
		if (blank) {
			const b = Object.assign(document.createElement("button"), { type: "button", className: "media-blank", textContent: blank });
			b.addEventListener("mousedown", (e) => e.preventDefault());
			b.addEventListener("click", () => { close(false); resolve({ blank: true }); });
			box.append(b);
		}
		const note = (text) => list.replaceChildren(Object.assign(document.createElement("li"), { className: "none", textContent: text }));
		note("Type, then press Enter to search.");

		let results = [], sel = 0, busy = false;
		const pick = (i) => {
			if (!results[i]) return;
			close(false);
			resolve(results[i]);
		};
		const draw = () => {
			if (!results.length) return note("Nothing found.");
			list.replaceChildren(...results.map((r, i) => {
				const li = document.createElement("li");
				li.setAttribute("role", "option");
				li.setAttribute("aria-selected", String(i === sel));
				if (r.thumbnailUrl) {
					const img = document.createElement("img");
					img.src = r.thumbnailUrl;
					img.alt = "";
					img.loading = "lazy";
					img.referrerPolicy = "no-referrer";
					li.append(img);
				} else li.append(Object.assign(document.createElement("span"), { className: "media-thumb" }));
				const text = document.createElement("span");
				text.className = "media-text";
				text.append(Object.assign(document.createElement("span"), { className: "label", textContent: r.title }));
				if (r.subtitle) text.append(Object.assign(document.createElement("span"), { className: "detail", textContent: r.subtitle }));
				li.append(text);
				li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(i); });
				return li;
			}));
			list.children[sel]?.scrollIntoView?.({ block: "nearest" });
		};
		const run = async () => {
			const q = input.value.trim();
			if (!q || busy) return;
			busy = true;
			note("Searching…");
			try {
				results = await search(q);
				sel = 0;
				if (wrap.isConnected) draw();
			} catch (e) {
				results = [];
				if (wrap.isConnected) note("Search failed: " + e.message);
			}
			busy = false;
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				// Enter searches; once there are results for what's typed, it picks.
				if (results.length && input.dataset.searched === input.value.trim()) pick(sel);
				else { input.dataset.searched = input.value.trim(); run(); }
			} else if (e.key === "ArrowDown" && results.length) { e.preventDefault(); sel = Math.min(sel + 1, results.length - 1); draw(); }
			else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
		});
		input.focus();
	});
}

// The cover picker: a grid of candidates, a box for pasting an address, and a
// "No cover" button. Resolves to the address ("" for none), or null when closed.
export function coverDialog(covers) {
	return new Promise((resolve) => {
		const { box, close } = dialog("Choose a cover", () => resolve(null));
		box.classList.add("media-cover-box");
		const done = (u) => { close(false); resolve(u); };
		const h = Object.assign(document.createElement("p"), { className: "hotkey-title", textContent: "Choose a cover" });
		box.append(h);
		if (!covers.length) box.append(Object.assign(document.createElement("p"), { className: "hotkey-now", textContent: "No cover art found. Paste an address below, or skip." }));
		const grid = document.createElement("div");
		grid.className = "media-covers";
		for (const u of covers) {
			const b = document.createElement("button");
			b.type = "button";
			b.className = "media-cover";
			b.setAttribute("aria-label", "Use this cover");
			const img = document.createElement("img");
			img.src = u;
			img.alt = "";
			img.referrerPolicy = "no-referrer";
			b.append(img);
			b.addEventListener("click", () => done(u));
			grid.append(b);
		}
		const row = document.createElement("div");
		row.className = "hotkey-actions media-url";
		const url = Object.assign(document.createElement("input"), { type: "url", placeholder: "Or paste a cover address (https://…)" });
		url.setAttribute("aria-label", "Cover address");
		const use = Object.assign(document.createElement("button"), { type: "button", textContent: "Use address" });
		const skip = Object.assign(document.createElement("button"), { type: "button", textContent: "No cover" });
		const useUrl = () => { const u = url.value.trim(); if (/^https:\/\//i.test(u)) done(u); else url.focus(); };
		use.addEventListener("click", useUrl);
		url.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); useUrl(); } });
		skip.addEventListener("click", () => done(""));
		row.append(url, use, skip);
		box.append(grid, row);
		(grid.querySelector("button") || url).focus();
	});
}

// A palette-style modal. onCancel runs when it's closed without a choice.
function dialog(label, onCancel) {
	document.querySelector(".palette")?.remove();
	const wrap = document.createElement("div");
	wrap.className = "palette";
	wrap.setAttribute("role", "dialog");
	wrap.setAttribute("aria-label", label);
	const box = document.createElement("div");
	box.className = "palette-box";
	wrap.append(box);
	document.body.append(wrap);
	const back = document.activeElement;
	const close = (cancelled = true) => {
		wrap.remove();
		document.removeEventListener("keydown", esc, true);
		if (cancelled) { back?.focus?.(); onCancel(); }
	};
	const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
	document.addEventListener("keydown", esc, true);
	wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) { e.preventDefault(); close(); } });
	return { wrap, box, close };
}

// The whole flow for one kind -> { folder, name, text } for the new note, or
// null if it was cancelled, or { blank: true } when blank (a label) was given
// and picked. api is src/api.js's; status(text) shows progress ("" hides it).
export async function makeMediaNote(k, api, status, { blank = null } = {}) {
	const hit = await searchDialog(`Search ${k.label.toLowerCase()}`, (q) => api.mediaSearch(k.kind, q), { blank });
	if (!hit || hit.blank) return hit;
	let cover = "";
	if (k.covers) {
		status("Finding covers…");
		const covers = await api.mediaCovers(k.kind, hit.ref);
		status("");
		const picked = await coverDialog(covers);
		if (picked == null) return null;
		cover = picked;
	}
	status(`Looking up “${hit.title}”…`);
	const today = new Date().toLocaleDateString("en-CA");
	const { fields, year } = await api.mediaNote(k.kind, hit.ref, cover, today);
	return { folder: k.folder + "/", name: mediaNoteName(fields.title, year), text: mediaNote(fields, k.heading) };
}
