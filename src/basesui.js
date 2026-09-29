// Small pieces of the bases screen that aren't about bases: a menu, a panel
// that drops down from a toolbar button, and the typed boxes a cell turns
// into while it's edited (a checkbox, a date, a number, a list of values,
// text with suggestions).

import { show, BDate } from "./bases.js";

export function el(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text != null) e.textContent = text;
	return e;
}

export function button(cls, text, run, title) {
	const b = el("button", cls, text);
	b.type = "button";
	if (title) { b.title = title; b.setAttribute("aria-label", title); }
	if (run) b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); run(e); });
	return b;
}

// Right-click, or a long press on a touch screen.
export function onMenu(target, fn) {
	target.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); fn(e.clientX, e.clientY); });
	let timer = null, opened = false;
	target.addEventListener("touchstart", (e) => {
		opened = false;
		const t = e.touches[0];
		timer = setTimeout(() => { opened = true; fn(t.clientX, t.clientY); }, 550);
	}, { passive: true });
	const cancel = () => clearTimeout(timer);
	target.addEventListener("touchmove", cancel, { passive: true });
	target.addEventListener("touchend", (e) => { cancel(); if (opened) e.preventDefault(); });
	target.addEventListener("click", (e) => { if (opened) { e.preventDefault(); e.stopPropagation(); opened = false; } }, true);
}

// ---- Menu -------------------------------------------------------------------

// entries: [label, run, cls?] or null (a divider). Closes on a pick, Escape,
// or a press elsewhere.
export function menu(entries, x, y) {
	closePanel();
	document.querySelector(".item-menu")?.remove();
	const box = el("div", "item-menu");
	box.setAttribute("role", "menu");
	for (const entry of entries) {
		if (!entry) { box.append(el("hr", "menu-rule")); continue; }
		const [label, run, cls] = entry;
		const b = button(cls || "", label, () => { close(); run(); });
		b.setAttribute("role", "menuitem");
		box.append(b);
	}
	document.body.append(box);
	place(box, x, y);
	const away = (e) => { if (!box.contains(e.target)) close(); };
	const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
	function close() {
		box.remove();
		document.removeEventListener("pointerdown", away, true);
		document.removeEventListener("keydown", esc, true);
	}
	setTimeout(() => {
		document.addEventListener("pointerdown", away, true);
		document.addEventListener("keydown", esc, true);
	});
	box.querySelector("button")?.focus();
}

function place(box, x, y) {
	const r = box.getBoundingClientRect();
	box.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
	box.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
}

// ---- Panels -----------------------------------------------------------------

// One panel open at a time. It belongs to a base (key) and a kind ("filter",
// "sort"...); when the base redraws, the new toolbar asks panelFor() whether
// its button's panel is open, so the panel stays put while the base changes
// under it.
let panel = null; // { key, kind, box, render, x, y }

export function openPanel(key, kind, anchor, render) {
	const same = panel && panel.key === key && panel.kind === kind;
	closePanel();
	document.querySelector(".item-menu")?.remove();
	if (same) return; // a second press on the button closes it
	const r = anchor.getBoundingClientRect();
	const box = el("div", "base-panel");
	box.setAttribute("role", "dialog");
	panel = { key, kind, box, render, x: r.left, y: r.bottom + 6 };
	document.body.append(box);
	draw();
	const away = (e) => {
		if (!panel || panel.box !== box) return;
		if (box.contains(e.target) || e.target.closest?.(".item-menu") || e.target.closest?.(`[data-panel="${kind}"]`)) return;
		closePanel();
	};
	const esc = (e) => { if (e.key === "Escape" && panel?.box === box) { e.stopPropagation(); closePanel(); } };
	panel.off = () => {
		document.removeEventListener("pointerdown", away, true);
		document.removeEventListener("keydown", esc, true);
	};
	setTimeout(() => {
		document.addEventListener("pointerdown", away, true);
		document.addEventListener("keydown", esc, true);
	});
}

export function closePanel() {
	if (!panel) return;
	panel.off?.();
	panel.box._off?.();
	panel.box.remove();
	panel = null;
}

// Draws the open panel again (after a change it made, or the base changed).
export function redrawPanel(key) {
	if (panel && (key == null || panel.key === key)) draw();
}
export const panelOpen = (key, kind) => !!panel && panel.key === key && (kind == null || panel.kind === kind);

function draw() {
	const { box, render } = panel;
	const focus = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
	box._off?.();
	box._off = null;
	box.replaceChildren();
	if (render(box) === false) return closePanel();
	box.style.left = "0px";
	box.style.top = "0px";
	place(box, panel.x, panel.y);
	if (focus) box.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus();
}

// A <select> from [value, label] pairs.
export function select(options, value, onChange, cls = "") {
	const s = el("select", cls);
	for (const [v, label] of options) {
		const o = el("option", null, label);
		o.value = v;
		if (v === value) o.selected = true;
		s.append(o);
	}
	s.addEventListener("change", () => onChange(s.value));
	return s;
}

let listId = 0;
// A <datalist> of suggestions, returned with its id.
export function suggestions(values) {
	const list = el("datalist");
	list.id = "base-sugg-" + ++listId;
	for (const v of values.slice(0, 300)) { const o = el("option"); o.value = v; list.append(o); }
	return list;
}

// ---- Cell editors -----------------------------------------------------------

// Every distinct value a column has (lists spread out), for suggestions.
export function valuesOf(values) {
	const seen = new Set();
	for (const v of values) for (const x of Array.isArray(v) ? v : [v]) { const s = show(x).trim(); if (s) seen.add(s); }
	return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

const dateText = (v) => {
	if (!(v instanceof BDate)) return typeof v === "string" ? v.slice(0, 10) : "";
	const t = new Date(v.ms), p = (n) => String(n).padStart(2, "0");
	return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}` + (v.dateOnly ? "" : `T${p(t.getHours())}:${p(t.getMinutes())}`);
};

// Turns cell into an editor for value (of kind type). save(newValue) is
// called once with what to write (null clears); cancel() puts the cell back.
export function editValue(cell, { type, value, options = [], save, cancel }) {
	let done = false;
	const finish = (write, v) => {
		if (done) return;
		done = true;
		if (write) save(v); else cancel();
	};
	if (type === "list") return editList(cell, value, options, finish);
	const input = el("input", "md-base-input");
	if (type === "number") { input.type = "number"; input.step = "any"; input.value = value == null ? "" : show(value); }
	else if (type === "date") {
		const text = dateText(value);
		input.type = text.includes("T") ? "datetime-local" : "date";
		input.value = text;
	} else {
		input.value = value == null ? "" : show(value);
		if (options.length) { const list = suggestions(options); cell.append(list); input.setAttribute("list", list.id); }
	}
	const before = input.value;
	const read = () => {
		const s = input.value.trim();
		if (!s) return null;
		if (type === "number") return Number.isFinite(Number(s)) ? Number(s) : s;
		if (type === "date") return s.replace("T", " ");
		return s;
	};
	cell.replaceChildren(input, ...cell.querySelectorAll("datalist"));
	input.focus();
	if (type !== "date") input.select?.();
	input.addEventListener("keydown", (e) => {
		e.stopPropagation();
		if (e.key === "Enter") { e.preventDefault(); finish(input.value !== before, read()); }
		else if (e.key === "Escape") { e.preventDefault(); finish(false); }
	});
	input.addEventListener("blur", () => finish(input.value !== before, read()));
}

// A list: its values as pills with ×, and a box to add one (suggesting
// values other notes use). Enter adds, Backspace in the empty box takes the
// last one off; leaving the cell saves.
function editList(cell, value, options, finish) {
	const items = (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]).map(show);
	const before = JSON.stringify(items);
	const box = el("div", "md-base-listedit");
	const input = el("input", "md-base-input");
	input.placeholder = "Add…";
	const list = suggestions(options);
	input.setAttribute("list", list.id);
	const drawPills = () => {
		box.querySelectorAll(".md-base-pill").forEach((p) => p.remove());
		items.forEach((v, i) => {
			const pill = el("span", "md-base-pill", v);
			const x = button("md-base-pill-x", "×", () => { items.splice(i, 1); drawPills(); input.focus(); }, "Remove " + v);
			x.tabIndex = -1;
			pill.append(x);
			box.insertBefore(pill, input);
		});
	};
	box.append(input, list);
	drawPills();
	cell.replaceChildren(box);
	input.focus();
	const add = () => {
		for (const part of input.value.split(",")) { const v = part.trim(); if (v && !items.includes(v)) items.push(v); }
		input.value = "";
		drawPills();
	};
	const typed = (s) => (/^[-+]?\d+(\.\d+)?$/.test(s) ? Number(s) : s);
	const out = () => { add(); return items.map(typed); };
	input.addEventListener("keydown", (e) => {
		e.stopPropagation();
		if (e.key === "Enter") { e.preventDefault(); if (input.value.trim()) add(); else finish(JSON.stringify(items) !== before, out()); }
		else if (e.key === "Escape") { e.preventDefault(); finish(false); }
		else if (e.key === "Backspace" && !input.value && items.length) { items.pop(); drawPills(); }
	});
	// Picking a suggestion from the list fills the box; take it as a value.
	input.addEventListener("input", (e) => { if (!e.inputType || e.inputType === "insertReplacementText") add(); });
	box.addEventListener("focusout", (e) => {
		if (e.relatedTarget && box.contains(e.relatedTarget)) return;
		setTimeout(() => { if (!box.contains(document.activeElement)) finish(JSON.stringify(out().map(show)) !== before, items.map(typed)); });
	});
}
