// A folder as a manuscript: the corkboard (index cards) and the outliner (a
// table of the same things). Both follow the folder's _Binder.md order
// (src/binder.js) and write it back when something is dragged to a new place.
//
// host: {
//   folder,                      the folder shown ("content/Novel/")
//   order(folder),               its items: [{ kind: "note"|"folder", path, listed }]
//   text(path),                  a note's text, or null
//   cover(path, text),           a picture for a note's card, or null
//   open(path),                  open a note
//   openFolder(folder),          show a subfolder in the same view
//   menu(item, x, y, index),     the menu for a note (path) or folder ("…/")
//   reorder(folder, items),      save a new order
//   moveInto(item, folder, at),  move a note or folder into another folder, at a place in its order
//   setProp(path, key, value),   change a note's property (null removes it)
//   add(folder, at),             a new note in folder, at a place in its order
// }

import { cardInfo } from "./binder.js";
import { makeCard, arrowMoves } from "./cards.js";
import { sortable, reorder } from "./drag.js";

const folderName = (f) => f.replace(/\/+$/, "").split("/").pop();
const fmt = (n) => n.toLocaleString();
const words = (n) => `${fmt(n)} word${n === 1 ? "" : "s"}`;

let live = []; // the sortables of what's drawn now
function reset() {
	for (const s of live) s.destroy();
	live = [];
}

// Words in a folder, subfolders included.
export function folderWords(folder, host) {
	let n = 0;
	for (const it of host.order(folder)) {
		if (it.kind === "folder") n += folderWords(it.path, host);
		else { const t = host.text(it.path); if (t != null) n += cardInfo(it.path, t).words; }
	}
	return n;
}

function folderSummary(folder, host) {
	const items = host.order(folder);
	const names = items.slice(0, 4).map((it) => (it.kind === "folder" ? folderName(it.path) + "/" : cardInfo(it.path, host.text(it.path) || "").title));
	return (names.join(" · ") + (items.length > 4 ? " …" : "")) || "Empty";
}

// ---- corkboard ---------------------------------------------------------------

export function drawBoard(root, host) {
	reset();
	root.replaceChildren();
	const items = host.order(host.folder);
	const hasBinder = items.some((it) => it.listed); // else "new" would be on every card
	const grid = document.createElement("div");
	grid.className = "board";
	grid.setAttribute("role", "list");
	items.forEach((it, i) => {
		let card;
		if (it.kind === "folder") {
			const n = host.order(it.path).length;
			card = makeCard({
				title: folderName(it.path),
				text: folderSummary(it.path, host),
				dim: true,
				stack: true,
				badge: `${n} item${n === 1 ? "" : "s"}`,
				meta: words(folderWords(it.path, host)),
				open: () => host.openFolder(it.path),
				menu: (x, y) => host.menu(it.path, x, y, i),
			});
			card.dataset.folder = it.path;
		} else {
			const text = host.text(it.path) ?? "";
			const info = cardInfo(it.path, text);
			card = makeCard({
				title: info.title,
				text: info.synopsis,
				dim: !info.written,
				color: info.label,
				badge: info.status || null,
				meta: words(info.words) + (it.listed || !hasBinder ? "" : " · new"),
				cover: host.cover(it.path, text),
				placeholder: "Write a synopsis…",
				open: () => host.open(it.path),
				edit: (v) => host.setProp(it.path, "synopsis", v || null),
				menu: (x, y) => host.menu(it.path, x, y, i),
			});
			card.title = it.path;
		}
		card.setAttribute("role", "listitem");
		card.dataset.path = it.path;
		card.addEventListener("dblclick", (e) => { if (!e.target.closest("textarea, .card-text.editable")) (it.kind === "folder" ? host.openFolder(it.path) : host.open(it.path)); });
		arrowMoves(card, (d) => {
			const to = i + d;
			if (to < 0 || to >= items.length) return;
			host.reorder(host.folder, reorder(items, i, to));
			requestAnimationFrame(() => root.querySelector(`[data-path="${CSS.escape(it.path)}"]`)?.focus());
		});
		grid.append(card);
	});
	const add = document.createElement("button");
	add.type = "button";
	add.className = "card card-add";
	add.textContent = "+ New card";
	add.addEventListener("click", () => host.add(host.folder, items.length));
	grid.append(add);
	root.append(grid);

	live.push(sortable(grid, {
		item: ".card[data-sort]",
		layout: "grid",
		into: (el) => !!el.dataset.folder,
		onHold: (el, x, y) => host.menu(el.dataset.path, x, y, items.findIndex((it) => it.path === el.dataset.path)),
		onDrop: ({ from, to, into }) => {
			if (into) return host.moveInto(items[from].path, into.dataset.folder, host.order(into.dataset.folder).length);
			host.reorder(host.folder, reorder(items, from, to));
		},
	}));
}

// ---- outliner ------------------------------------------------------------------

const OPEN_KEY = "wr1t3r-outline-open";
const readOpen = () => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY)) || []); } catch { return new Set(); } };
const saveOpen = (s) => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...s])); } catch {} };

export function drawOutline(root, host) {
	reset();
	root.replaceChildren();
	const open = readOpen();
	const table = document.createElement("div");
	table.className = "outline";
	table.setAttribute("role", "treegrid");
	const head = document.createElement("div");
	head.className = "ol-row ol-head";
	head.setAttribute("role", "row");
	head.append(document.createElement("span"));
	for (const [cls, label] of [["ol-title", "Title"], ["ol-syn", "Synopsis"], ["ol-status", "Status"], ["ol-words", "Words"]]) {
		const c = document.createElement("span");
		c.className = cls;
		c.setAttribute("role", "columnheader");
		c.textContent = label;
		head.append(c);
	}
	table.append(head);
	const group = "outline:" + host.folder;
	const statuses = new Set();

	const level = (folder, depth) => {
		const items = host.order(folder);
		const list = document.createElement("div");
		list.className = "ol-list";
		list.dataset.folder = folder;
		items.forEach((it, i) => {
			const wrap = document.createElement("div");
			wrap.className = "ol-item";
			wrap.dataset.sort = "";
			wrap.dataset.path = it.path;
			const row = document.createElement("div");
			row.className = "ol-row";
			row.setAttribute("role", "row");
			row.tabIndex = 0;
			row.style.setProperty("--depth", depth);
			const grip = document.createElement("span");
			grip.className = "ol-grip";
			grip.textContent = "⠿";
			grip.setAttribute("aria-hidden", "true");
			const title = document.createElement("span");
			title.className = "ol-title";
			const name = document.createElement("button");
			name.type = "button";
			name.className = "ol-name";
			const syn = document.createElement("span");
			syn.className = "ol-syn";
			const status = document.createElement("span");
			status.className = "ol-status";
			const count = document.createElement("span");
			count.className = "ol-words";
			if (it.kind === "folder") {
				const shut = !open.has(it.path);
				const tw = document.createElement("button");
				tw.type = "button";
				tw.className = "ol-twisty" + (shut ? " shut" : "");
				tw.textContent = "▾";
				tw.setAttribute("aria-label", (shut ? "Show" : "Hide") + " what's in " + folderName(it.path));
				tw.setAttribute("aria-expanded", String(!shut));
				tw.addEventListener("click", () => {
					shut ? open.add(it.path) : open.delete(it.path);
					saveOpen(open);
					drawOutline(root, host);
				});
				name.textContent = folderName(it.path) + "/";
				name.title = "Show this folder";
				name.addEventListener("click", () => host.openFolder(it.path));
				title.append(tw, name);
				syn.textContent = folderSummary(it.path, host);
				syn.classList.add("dim");
				count.textContent = fmt(folderWords(it.path, host));
				row.append(grip, title, syn, status, count);
				wrap.append(row);
				if (!shut) wrap.append(level(it.path, depth + 1));
			} else {
				const info = cardInfo(it.path, host.text(it.path) ?? "");
				if (info.status) statuses.add(info.status);
				const dot = document.createElement("button");
				dot.type = "button";
				dot.className = "ol-dot";
				if (info.label) dot.style.setProperty("--cc", `var(--f${info.label})`);
				dot.setAttribute("aria-label", "Label color");
				dot.title = "Label color";
				dot.addEventListener("click", (e) => { const r = dot.getBoundingClientRect(); host.menu(it.path, r.left, r.bottom + 4, i, "label"); e.stopPropagation(); });
				name.textContent = info.title;
				name.title = it.path;
				name.addEventListener("click", () => host.open(it.path));
				title.append(dot, name);
				syn.textContent = info.synopsis;
				syn.classList.toggle("dim", !info.written);
				syn.classList.add("editable");
				syn.title = "Click to edit the synopsis";
				syn.addEventListener("click", () => editCell(syn, info.written ? info.synopsis : "", "Synopsis", (v) => host.setProp(it.path, "synopsis", v || null), true));
				status.textContent = info.status || "";
				status.classList.add("editable");
				status.title = "Click to set a status";
				status.addEventListener("click", () => editCell(status, info.status, "Status", (v) => host.setProp(it.path, "status", v || null), false, [...statuses]));
				count.textContent = fmt(info.words);
				row.append(grip, title, syn, status, count);
				wrap.append(row);
			}
			row.addEventListener("contextmenu", (e) => { if (e.target.closest("input, textarea")) return; e.preventDefault(); host.menu(it.path, e.clientX, e.clientY, i); });
			row.addEventListener("keydown", (e) => {
				if (e.target !== row) return;
				if (e.key === "Enter") { e.preventDefault(); it.kind === "folder" ? host.openFolder(it.path) : host.open(it.path); }
			});
			arrowMoves(row, (d) => {
				const to = i + d;
				if (to < 0 || to >= items.length) return;
				host.reorder(folder, reorder(items, i, to));
				requestAnimationFrame(() => root.querySelector(`.ol-item[data-path="${CSS.escape(it.path)}"] > .ol-row`)?.focus());
			}, "list");
			list.append(wrap);
		});
		live.push(sortable(list, {
			item: ".ol-item",
			group,
			layout: "list",
			onHold: (el, x, y) => host.menu(el.dataset.path, x, y, items.findIndex((it) => it.path === el.dataset.path)),
			onDrop: ({ el, from, to, source, target }) => {
				if (source === target) return host.reorder(folder, reorder(items, from, to));
				host.moveInto(el.dataset.path, target.dataset.folder, to);
			},
		}));
		return list;
	};

	table.append(level(host.folder, 0));
	const total = document.createElement("div");
	total.className = "ol-row ol-total";
	const label = document.createElement("span");
	label.className = "ol-title";
	label.textContent = "Total";
	const sum = document.createElement("span");
	sum.className = "ol-words";
	sum.textContent = fmt(folderWords(host.folder, host));
	total.append(document.createElement("span"), label, document.createElement("span"), document.createElement("span"), sum);
	table.append(total);
	const add = document.createElement("button");
	add.type = "button";
	add.className = "ol-add quiet";
	add.textContent = "+ New note";
	add.addEventListener("click", () => host.add(host.folder, host.order(host.folder).length));
	root.append(table, add);
}

// A cell as a text box: Enter or leaving saves, Escape doesn't.
function editCell(cell, value, label, save, multi, suggestions = []) {
	if (cell.querySelector("input, textarea")) return;
	const was = [...cell.childNodes];
	const box = document.createElement(multi ? "textarea" : "input");
	box.className = "ol-edit";
	box.value = value;
	box.setAttribute("aria-label", label);
	if (multi) box.rows = 3;
	if (!multi && suggestions.length) {
		const id = "ol-suggest";
		document.getElementById(id)?.remove();
		const dl = document.createElement("datalist");
		dl.id = id;
		for (const s of suggestions) dl.append(new Option(s));
		document.body.append(dl);
		box.setAttribute("list", id);
	}
	cell.replaceChildren(box);
	box.focus();
	box.select?.();
	let done = false;
	const finish = (ok) => {
		if (done) return;
		done = true;
		const v = box.value.replace(/\s+/g, " ").trim();
		cell.replaceChildren(...was);
		if (ok && v !== value.trim()) save(v);
	};
	box.addEventListener("keydown", (e) => {
		e.stopPropagation();
		if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(true); }
		if (e.key === "Escape") { e.preventDefault(); finish(false); }
	});
	box.addEventListener("blur", () => finish(true));
}

export function stopViews() { reset(); }
