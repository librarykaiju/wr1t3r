// Home's grid of tiles (see src/home.js for the pins). A tile opens what it's
// pinned to; right-click, or a long press on a phone, opens its menu; tiles
// drag to a new place on screens with a mouse. The last tile adds a pin.
// Section headers break the grid into labeled groups; they drag and have a
// menu too.

import { isBoardPath } from "./paths.js";
import { pinKind, pinPath, pinTitle, pinColor, pinCover, pinSize, isSection, tileOrdinals } from "./home.js";
import { linePoints, pieChart } from "./charts.js";

const ICONS = {
	note: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6"/>',
	base: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15"/>',
	folder: '<path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
	command: '<path d="M13 3.5 5.5 13.5H12l-1 7 7.5-10H12z"/>',
	url: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
	view: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><rect x="6.5" y="7.5" width="4.5" height="4" rx="0.8"/><rect x="13" y="7.5" width="4.5" height="4" rx="0.8"/><rect x="6.5" y="13.5" width="4.5" height="3.5" rx="0.8"/>',
	neighbors: '<path d="M2.5 11 7 7l4.5 4v8.5h-9z"/><path d="M12.5 11 17 7l4.5 4v8.5h-9z"/><path d="M5.5 19.5v-3.5h3v3.5M15.5 19.5v-3.5h3v3.5"/>',
	add: '<path d="M12 5v14M5 12h14"/>',
};

function icon(kind) {
	const s = document.createElement("span");
	s.className = "tile-icon";
	s.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</svg>`;
	return s;
}

// fn(x, y) on right-click, or on a long press (iOS Safari has no contextmenu).
export function onMenu(el, fn) {
	el.addEventListener("contextmenu", (e) => { e.preventDefault(); fn(e.clientX, e.clientY); });
	let timer = null, opened = false;
	el.addEventListener("touchstart", (e) => {
		opened = false;
		const t = e.touches[0];
		timer = setTimeout(() => { opened = true; fn(t.clientX, t.clientY); }, 550);
	}, { passive: true });
	const cancel = () => clearTimeout(timer);
	el.addEventListener("touchmove", cancel, { passive: true });
	el.addEventListener("touchend", (e) => { cancel(); if (opened) e.preventDefault(); });
	el.addEventListener("click", (e) => { if (opened) { e.preventDefault(); e.stopPropagation(); opened = false; } }, true);
}

// Drag to reorder (mouse), by index into the pins list: drop before the tile
// under the pointer, or after it past its middle. Dropping on a header puts
// the item first under it.
function draggable(el, i, grid, host, header = false) {
	el.draggable = true;
	el.addEventListener("dragstart", (e) => {
		e.dataTransfer.setData("application/x-wr1t3r-pin", String(i));
		e.dataTransfer.effectAllowed = "move";
		el.classList.add("dragging");
	});
	el.addEventListener("dragend", () => { el.classList.remove("dragging"); clearMarks(grid); });
	el.addEventListener("dragover", (e) => {
		if (!e.dataTransfer.types.includes("application/x-wr1t3r-pin")) return;
		e.preventDefault();
		const r = el.getBoundingClientRect();
		const after = header || e.clientX > r.left + r.width / 2;
		clearMarks(grid);
		el.classList.add(after ? "drop-after" : "drop-before");
	});
	el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after"));
	el.addEventListener("drop", (e) => {
		const from = Number(e.dataTransfer.getData("application/x-wr1t3r-pin"));
		if (!Number.isInteger(from)) return;
		e.preventDefault();
		const after = el.classList.contains("drop-after");
		clearMarks(grid);
		let to = i + (after ? 1 : 0);
		if (from < to) to--;
		if (to !== from) host.reorder(from, to);
	});
}

// A stats tile's face: this year's count, two totals and a bar per month (or
// a line, or a pie of its top genres: the pin's chart:), from glance() in
// src/mediastats.js. size (pinSize) gives a bigger tile more: a 2x1 puts the
// chart beside the numbers; a 2x2 adds the chart's first and last labels, the
// pie's legend, and the Habits tile's habits one by one.
function glanceFace(g, chart, size) {
	const box = document.createElement("span");
	box.className = "tile-glance";
	const nums = document.createElement("span");
	nums.className = "tile-glance-nums";
	const n = document.createElement("span");
	n.className = "tile-glance-n";
	n.textContent = Number(g.done).toLocaleString();
	const l = document.createElement("span");
	l.className = "tile-glance-l";
	l.textContent = g.label;
	nums.append(n, l);
	if (g.extras.length) {
		const row = document.createElement("span");
		row.className = "tile-glance-row";
		for (const x of g.extras) {
			const e = document.createElement("span");
			const b = document.createElement("b");
			b.textContent = typeof x.n === "number" ? x.n.toLocaleString() : x.n;
			e.append(b, x.label ? " " + x.label : "");
			if (x.title) e.title = x.title;
			row.append(e);
		}
		nums.append(row);
	}
	box.append(nums);
	const big = size === "2x2";
	if (chart === "pie" && g.pie) {
		const row = document.createElement("span");
		row.className = "tile-glance-pie";
		if (big) row.append(pieChart(g.pie.items, { size: 96 }));
		else {
			row.append(pieChart(g.pie.items, { bare: true, size: size ? 56 : 34 }));
			const top = g.pie.items[0];
			const share = document.createElement("span");
			const total = g.pie.items.reduce((n, i) => n + i.value, 0);
			share.textContent = `${top.label} ${Math.round((top.value / total) * 100)}%`;
			share.title = g.pie.items.map((i) => `${i.label}: ${i.value}`).join("\n");
			row.append(share);
		}
		box.append(row);
	} else if (chart === "line" && g.bars.length) {
		const W = 100, H = 18;
		const pts = linePoints(g.bars.map((b) => b.count), W, H, 1.5);
		const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
		const line = document.createElement("span");
		line.className = "tile-glance-line";
		line.setAttribute("aria-hidden", "true");
		line.title = g.bars.map((b) => `${b.label}: ${b.count}`).join("\n");
		line.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}L${pts.at(-1)[0]},${H}L${pts[0][0]},${H}Z" class="area"/><path d="${d}" class="stroke" vector-effect="non-scaling-stroke"/></svg>`;
		box.append(line);
		if (big) box.append(ends(g.bars));
	} else if (g.bars.length) {
		const bars = document.createElement("span");
		bars.className = "tile-glance-bars";
		bars.setAttribute("aria-hidden", "true");
		const top = Math.max(1, ...g.bars.map((b) => b.count));
		for (const b of g.bars) {
			const bar = document.createElement("span");
			bar.style.height = `${Math.max(b.count ? 12 : 4, Math.round((b.count / top) * 100))}%`;
			bar.title = `${b.label}: ${b.count}`;
			bars.append(bar);
		}
		box.append(bars);
		if (big) box.append(ends(g.bars));
	}
	if (big && g.items?.length) {
		const list = document.createElement("span");
		list.className = "tile-glance-list";
		for (const it of g.items) {
			const li = document.createElement("span");
			li.classList.toggle("done", !!it.done);
			const dot = document.createElement("i");
			const name = document.createElement("span");
			name.textContent = it.label;
			li.append(dot, name);
			if (it.n) {
				const v = document.createElement("b");
				v.textContent = it.n;
				v.title = `${it.n} day${it.n === 1 ? "" : "s"} in a row`;
				li.append(v);
			}
			li.title = `${it.label}: ${it.done ? "done" : "not done"} today`;
			list.append(li);
		}
		box.append(list);
	}
	return box;
}

// The first and last labels under a 2x2 tile's chart.
function ends(bars) {
	const row = document.createElement("span");
	row.className = "tile-glance-ends";
	row.setAttribute("aria-hidden", "true");
	const a = document.createElement("span"), b = document.createElement("span");
	a.textContent = bars[0].label;
	b.textContent = bars.at(-1).label;
	row.append(a, b);
	return row;
}

// host: { pins, homeFile, paths, text(path), image(ref, from) -> Promise<src>|null,
//         open(pin, path), menu(index, x, y), add()?, reorder(from, to), emptyLabel?,
//         glance(folder)? -> glance(...) | null, for stats tiles,
//         habits()? -> habitsGlance(...) | null, for the Habits tile,
//         neighbors()? -> the same shape | null, for the Neighbors tile }
export function drawHome(grid, host) {
	grid.replaceChildren();
	const { pins, homeFile, paths } = host;
	const ordinal = tileOrdinals(pins);
	pins.forEach((pin, i) => {
		if (isSection(pin)) {
			const h = document.createElement("div");
			h.className = "home-section";
			h.setAttribute("role", "heading");
			h.setAttribute("aria-level", "2");
			h.textContent = String(pin.section).trim() || "Section";
			h.title = "Right-click (or long-press) to rename, move or remove";
			onMenu(h, (x, y) => host.menu(i, x, y));
			draggable(h, i, grid, host, true);
			grid.append(h);
			return;
		}
		const k = pinKind(pin.link);
		const path = k.kind === "note" ? pinPath(pin, paths, homeFile) : null;
		const kind = k.kind === "note" && isBoardPath(path || k.target) ? "base" : k.kind;
		const tile = document.createElement("button");
		tile.type = "button";
		tile.className = "tile";
		tile.setAttribute("role", "listitem");
		tile.style.setProperty("--tc", pinColor(pin, ordinal[i]));
		const size = pinSize(pin);
		if (size) tile.classList.add("size-" + size);
		const missing = k.kind === "note" && !path;
		tile.classList.toggle("missing", missing);
		const title = pinTitle(pin, path);
		tile.title = missing ? `${title} (not in the vault)` : k.kind === "url" ? k.url : path || title;
		const label = document.createElement("span");
		label.className = "tile-name";
		label.textContent = title;
		const cover = pinCover(pin, path, path ? host.text(path) : null, homeFile);
		const src = cover && host.image(cover.ref, cover.from);
		if (src) {
			const img = document.createElement("img");
			img.className = "tile-cover";
			img.alt = "";
			img.decoding = "async";
			img.draggable = false;
			img.referrerPolicy = "no-referrer";
			img.addEventListener("error", () => { img.remove(); tile.classList.remove("has-cover"); });
			Promise.resolve(src).then((u) => { img.src = u; }, () => img.dispatchEvent(new Event("error")));
			tile.classList.add("has-cover");
			tile.append(img);
		}
		const g = k.kind === "view" && k.view === "stats" && host.glance ? host.glance(k.folder) : k.kind === "habits" && host.habits ? host.habits() : k.kind === "neighbors" && host.neighbors ? host.neighbors() : null;
		if (g) {
			tile.classList.add("has-glance");
			tile.append(label, glanceFace(g, pin.chart, size));
		} else tile.append(icon(ICONS[kind] ? kind : "view"), label);
		tile.addEventListener("click", () => host.open(pin, path));
		onMenu(tile, (x, y) => host.menu(i, x, y));
		draggable(tile, i, grid, host);
		grid.append(tile);
	});
	if (!host.add) return;
	const add = document.createElement("button");
	add.type = "button";
	add.className = "tile tile-add";
	add.title = "Pin a note, folder, command or web page, or start a section";
	add.setAttribute("aria-label", "Add a tile");
	const label = document.createElement("span");
	label.className = "tile-name";
	label.textContent = pins.length ? "Add" : host.emptyLabel || "Pin notes, folders, commands and web pages here";
	add.append(icon("add"), label);
	add.addEventListener("click", () => host.add());
	grid.append(add);
}

function clearMarks(grid) {
	grid.querySelectorAll(".drop-before, .drop-after").forEach((t) => t.classList.remove("drop-before", "drop-after"));
}
