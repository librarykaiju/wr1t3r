// Home's grid of tiles (see src/home.js for the pins). A tile opens what it's
// pinned to; right-click, or a long press on a phone, opens its menu; tiles
// drag to a new place on screens with a mouse. The last tile adds a pin.

import { pinKind, pinPath, pinTitle, pinColor, pinCover } from "./home.js";

const ICONS = {
	note: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6"/>',
	base: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15"/>',
	folder: '<path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
	command: '<path d="M13 3.5 5.5 13.5H12l-1 7 7.5-10H12z"/>',
	url: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
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

// host: { pins, homeFile, paths, text(path), image(ref, from) -> Promise<src>|null,
//         open(pin, path), menu(index, x, y), add(), reorder(from, to) }
export function drawHome(grid, host) {
	grid.replaceChildren();
	const { pins, homeFile, paths } = host;
	pins.forEach((pin, i) => {
		const k = pinKind(pin.link);
		const path = k.kind === "note" ? pinPath(pin, paths, homeFile) : null;
		const kind = k.kind === "note" && /\.base$/i.test(path || k.target) ? "base" : k.kind;
		const tile = document.createElement("button");
		tile.type = "button";
		tile.className = "tile";
		tile.setAttribute("role", "listitem");
		tile.style.setProperty("--tc", pinColor(pin, i));
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
		tile.append(icon(kind), label);
		tile.addEventListener("click", () => host.open(pin, path));
		onMenu(tile, (x, y) => host.menu(i, x, y));
		// Drag to reorder (mouse): drop before the tile under the pointer, or
		// after it past its middle.
		tile.draggable = true;
		tile.addEventListener("dragstart", (e) => {
			e.dataTransfer.setData("application/x-wr1t3r-pin", String(i));
			e.dataTransfer.effectAllowed = "move";
			tile.classList.add("dragging");
		});
		tile.addEventListener("dragend", () => { tile.classList.remove("dragging"); clearMarks(grid); });
		tile.addEventListener("dragover", (e) => {
			if (!e.dataTransfer.types.includes("application/x-wr1t3r-pin")) return;
			e.preventDefault();
			const r = tile.getBoundingClientRect();
			const after = e.clientX > r.left + r.width / 2;
			clearMarks(grid);
			tile.classList.add(after ? "drop-after" : "drop-before");
		});
		tile.addEventListener("dragleave", () => tile.classList.remove("drop-before", "drop-after"));
		tile.addEventListener("drop", (e) => {
			const from = Number(e.dataTransfer.getData("application/x-wr1t3r-pin"));
			if (!Number.isInteger(from)) return;
			e.preventDefault();
			const after = tile.classList.contains("drop-after");
			clearMarks(grid);
			let to = i + (after ? 1 : 0);
			if (from < to) to--;
			if (to !== from) host.reorder(from, to);
		});
		grid.append(tile);
	});
	const add = document.createElement("button");
	add.type = "button";
	add.className = "tile tile-add";
	add.title = "Pin a note, folder, command or web page";
	add.setAttribute("aria-label", "Add a tile");
	const label = document.createElement("span");
	label.className = "tile-name";
	label.textContent = pins.length ? "Add" : "Pin notes, folders, commands and web pages here";
	add.append(icon("add"), label);
	add.addEventListener("click", () => host.add());
	grid.append(add);
}

function clearMarks(grid) {
	grid.querySelectorAll(".drop-before, .drop-after").forEach((t) => t.classList.remove("drop-before", "drop-after"));
}
