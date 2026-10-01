// The Properties cleanup panel (src/propclean.js works out the edits): every
// key in the vault with how many notes use it and how many of those are
// empty. Each action (clear empty values, rename or merge, delete) shows the
// notes it would change, with the lines that go and come, and writes only
// when confirmed.

import { propertyIndex, planChange, clearEmpty, deleteKey, renameKey, frontmatterDiff, validKey } from "./propclean.js";
import { SITE_KEYS } from "./sitekeys.js";

const SITE_WARNING = (keys) => `The website reads ${keys.map((k) => `“${k}”`).join(" and ")}. ${keys.length > 1 ? "Changing them" : "Changing it"} changes the published pages that use ${keys.length > 1 ? "them" : "it"}, and can break them.`;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const plural = (n, one, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const SHOWN = 60; // notes listed in a preview

let open = null;

// host: { notes() -> { path: text } (the notes to clean; no templates),
// write(path, fn) -> Promise (saves without redrawing), done() (redraw and
// sync once, after a batch), open(path), toast(text) }.
export function openPropertyCleanup(host) {
	open?.close();
	const back = document.activeElement;
	const wrap = el("div", "palette compile props-clean");
	wrap.setAttribute("role", "dialog");
	wrap.setAttribute("aria-label", "Clean up properties");
	const box = el("div", "compile-box props-box");
	const head = el("header", "compile-head");
	const h = el("h2", null, "Clean up properties");
	const x = el("button", "quiet", "×");
	x.type = "button";
	x.setAttribute("aria-label", "Close");
	head.append(h, x);
	const body = el("div", "props-body");
	box.append(head, body);
	wrap.append(box);
	document.body.append(wrap);

	let filter = "";
	let busy = false;
	const close = () => {
		if (busy) return;
		wrap.remove();
		document.removeEventListener("keydown", onKey, true);
		open = null;
		back?.focus?.();
	};
	const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
	document.addEventListener("keydown", onKey, true);
	x.addEventListener("click", close);
	wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
	open = { close };

	// The list of keys.
	function list() {
		const notes = host.notes();
		const idx = propertyIndex(notes);
		body.replaceChildren();
		const bar = el("div", "props-bar");
		const q = el("input", "props-filter");
		Object.assign(q, { type: "search", placeholder: `Filter ${plural(idx.length, "property", "properties")}…`, value: filter });
		const all = planChange(notes, (t) => clearEmpty(t));
		const clearAll = el("button", "props-btn props-primary", all.changed.length ? `Clear all empty values (${plural(all.changed.length, "note")})` : "No empty values");
		clearAll.type = "button";
		clearAll.disabled = !all.changed.length;
		clearAll.addEventListener("click", () => preview(`Clear every empty value`, "Properties with nothing in them, and blank items in lists, are taken out.", (t) => clearEmpty(t)));
		bar.append(q, clearAll);
		const hint = el("p", "props-hint", `${plural(Object.keys(notes).length, "note")} with properties. Templates and wr1t3r's own files aren't touched. Nothing is written until you confirm. Clearing empty values never changes the website (it treats an empty property and a missing one alike); properties marked “site” are read by it, so renaming or deleting them can.`);
		const table = el("table", "props-table");
		const thead = el("thead");
		const tr = el("tr");
		for (const t of ["Property", "Notes", "Empty", ""]) tr.append(el("th", null, t));
		thead.append(tr);
		const tbody = el("tbody");
		const rows = () => {
			tbody.replaceChildren();
			const f = filter.trim().toLowerCase();
			for (const r of idx.filter((r) => !f || r.key.toLowerCase().includes(f))) {
				const row = el("tr");
				const keyCell = el("td", "props-key", r.key);
				if (SITE_KEYS.has(r.key)) { const b = el("span", "props-site", "site"); b.title = "The website reads this property"; keyCell.append(b); }
				row.append(keyCell, el("td", "props-num", r.notes.toLocaleString()), el("td", "props-num" + (r.empty ? " props-empty" : ""), r.empty ? r.empty.toLocaleString() : "—"));
				const acts = el("td", "props-acts");
				const act = (label, title, run) => { const b = el("button", "props-btn", label); b.type = "button"; b.title = title; b.addEventListener("click", run); acts.append(b); };
				if (r.empty || r.blanks) act("Clear empty", `Take out ${r.key} where it's empty, and blank items in its lists`, () => preview(`Clear empty “${r.key}”`, `“${r.key}” is taken out of the notes where it has nothing in it${r.blanks ? ", and blank items are taken out of its lists" : ""}.`, (t) => clearEmpty(t, r.key)));
				act("Rename…", `Rename ${r.key} in every note, or merge it into another property`, () => rename(r.key));
				act("Delete", `Take ${r.key} out of every note, values and all`, () => preview(`Delete “${r.key}”`, `“${r.key}” is taken out of every note, with its values.`, (t) => deleteKey(t, r.key), true, SITE_KEYS.has(r.key) ? SITE_WARNING([r.key]) : null));
				row.append(acts);
				tbody.append(row);
			}
		};
		q.addEventListener("input", () => { filter = q.value; rows(); });
		rows();
		table.append(thead, tbody);
		body.append(bar, hint, table);
		q.focus();
	}

	function rename(from, to = null, combine = false) {
		to ??= prompt(`Rename “${from}” to (an existing property's name merges into it):`, from)?.trim();
		if (to == null || to === "" || to === from) return;
		if (!validKey(to)) return host.toast(`“${to}” can't be a property name.`);
		const site = [from, to].filter((k) => SITE_KEYS.has(k));
		const what = combine
			? `Notes with both get one “${to}” list with the values of both (its own first, no repeats).`
			: `Where a note already has “${to}”, an empty one gives way, and so does one with the same values. If both have different values, the note is left alone and listed below.`;
		preview(`Rename “${from}” to “${to}”`, what, (t) => renameKey(t, from, to, { combine }), !!site.length, site.length ? SITE_WARNING(site) : null,
			combine ? null : { label: "Combine their values", run: () => rename(from, to, true) });
	}

	// What an action would change, with Confirm and Back.
	// alt: { label, run } for the conflict box (Rename's "Combine their values").
	function preview(title, what, change, destructive = false, warning = null, alt = null) {
		const notes = host.notes();
		const plan = planChange(notes, change);
		body.replaceChildren();
		const top = el("div", "props-bar");
		const backBtn = el("button", "props-btn", "← Back");
		backBtn.type = "button";
		backBtn.addEventListener("click", list);
		const go = el("button", "props-btn props-primary" + (destructive ? " props-danger" : ""), plan.changed.length ? `${title.replace(/ “.*$/, "")}: change ${plural(plan.changed.length, "note")}` : "Nothing to change");
		go.type = "button";
		go.disabled = !plan.changed.length;
		top.append(backBtn, el("span", "props-title", title), go);
		const info = el("p", "props-hint", what);
		body.append(top, info);
		if (warning) body.append(el("p", "props-warning", "⚠ " + warning));
		if (plan.conflicts.length) {
			const c = el("div", "props-conflicts");
			c.append(el("strong", null, `Left alone (${plan.conflicts.length}): both properties have different values.`));
			for (const p of plan.conflicts.slice(0, SHOWN)) c.append(noteLink(p));
			if (alt) {
				const b = el("button", "props-btn", `${alt.label} (${plural(plan.conflicts.length, "note")})`);
				b.type = "button";
				b.style.alignSelf = "flex-start";
				b.style.marginTop = "6px";
				b.addEventListener("click", alt.run);
				c.append(b);
			}
			body.append(c);
		}
		const listEl = el("div", "props-preview");
		for (const c of plan.changed.slice(0, SHOWN)) {
			const item = el("div", "props-change");
			item.append(noteLink(c.path));
			const d = frontmatterDiff(c.before, c.after);
			const pre = el("pre", "props-diff");
			for (const l of d.removed) pre.append(el("span", "props-del", "− " + l + "\n"));
			for (const l of d.added) pre.append(el("span", "props-add", "+ " + l + "\n"));
			item.append(pre);
			listEl.append(item);
		}
		if (plan.changed.length > SHOWN) listEl.append(el("p", "props-hint", `…and ${plural(plan.changed.length - SHOWN, "more note")}.`));
		body.append(listEl);
		go.addEventListener("click", async () => {
			if (destructive && !confirm(`${title}: change ${plural(plan.changed.length, "note")}? This can't be undone here.${warning ? "\n\n" + warning : ""}`)) return;
			busy = true;
			go.disabled = backBtn.disabled = x.disabled = true;
			let done = 0;
			for (const c of plan.changed) {
				// Worked out again from the note as it is now, in case it changed.
				await host.write(c.path, (t) => { const r = change(t); return typeof r === "string" ? r : r.conflict ? t : r.text; });
				go.textContent = `Changing… ${++done} / ${plan.changed.length}`;
			}
			host.done();
			busy = false;
			x.disabled = false;
			host.toast(`${title}: changed ${plural(done, "note")}.`);
			list();
		});
	}

	function noteLink(path) {
		const a = el("a", "props-note", path.replace(/^content\//, "").replace(/\.md$/i, ""));
		a.href = "#";
		a.addEventListener("click", (e) => { e.preventDefault(); if (busy) return; close(); host.open(path); });
		return a;
	}

	list();
}
