// The calendar page: a ```wr1t3r-calendar block (in _wr1t3r/Calendar.md,
// opened from the palette or the agenda) drawn as a whole calendar. Month
// or Week on a wide screen; in a narrow column (a phone), always a short
// agenda for one week with the weeks as tabs down the right edge (a swipe
// steps a week too). Each day shows its stickers, calendar events, penciled-in
// plans (src/calmarks.js) and the tasks due that day. A day's + pencils
// something in, adds an event or a sticker; a penciled-in plan can be inked
// into the calendar or erased; the date opens the daily note.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { dataviewBlocks, tick } from "./dataview.js";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { allNotes } from "./tasklistview.js";
import { isOpen } from "./drawnblocks.js";
import { isoDay } from "./tasks.js";
import { addDays } from "./habits.js";
import { byDay, EVENT_COLORS } from "./agenda.js";
import { weekOf, datedTasks, tasksByDay, taskLabel } from "./weekly.js";
import { readMarks, marksByDay, marksMonth } from "./calmarks.js";
import { menu, openPanel, closePanel, redrawPanel } from "./basesui.js";

export const CALENDAR_BLOCK = "wr1t3r-calendar";
const UNTRUSTED = /(^|\/)_(clippings|uploads)\//i;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NARROW = 620;
const MODE_KEY = "wr1t3r-calendar-mode", RECENT_KEY = "wr1t3r-recent-stickers";
const MONTH_ITEMS = 4; // per day in the month grid, before "+ n more"

// Set by main.js: { on() -> whether the calendar page is on, events(from, days)
// -> Promise<events|null>, openDay(day), addEvent(day), ink(mark) (opens the
// add-event form filled in from it; the mark goes once it's added),
// mark(day, kind, text, time) and unmark(mark) (write the month's marks note) }.
let host = null;
export const setCalendarHost = (h) => { host = h; };

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const button = (cls, text, title, run) => {
	const b = el("button", cls, text);
	b.type = "button";
	if (title) b.title = title;
	b.addEventListener("mousedown", (e) => e.preventDefault());
	b.addEventListener("click", (e) => { e.stopPropagation(); run(e); });
	return b;
};
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const shortDay = (day) => { const d = new Date(day + "T12:00"); return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`; };
const longDay = (day) => new Date(day + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

// The Monday on or before the 1st, and six weeks from it: the month grid.
function monthGrid(month) {
	const first = month.slice(0, 7) + "-01";
	return addDays(first, -((new Date(first + "T12:00").getDay() + 6) % 7));
}

// Events by range ("from|days" -> { at, events }), kept between redraws.
const eventCache = new Map();
const FRESH = 5 * 60000;
export const forgetCalendarEvents = () => eventCache.clear();

// What the page shows, kept while the app is open.
let anchor = null; // a day in the month or week shown

class CalendarWidget extends WidgetType {
	constructor(p) {
		super();
		Object.assign(this, p);
		this.key = JSON.stringify([p.path, p.today, p.version]);
	}
	eq(o) { return o.key === this.key; }
	ignoreEvent() { return true; }

	toDOM(view) {
		const wrap = el("div", "cal");
		this.wrap = wrap;
		this.view = view;
		this.narrow = null;
		this.ro = new ResizeObserver(() => {
			const narrow = wrap.clientWidth < NARROW;
			if (narrow !== this.narrow) this.draw();
		});
		this.ro.observe(wrap);
		let x0 = null, y0 = null;
		wrap.addEventListener("touchstart", (e) => { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } }, { passive: true });
		wrap.addEventListener("touchend", (e) => {
			if (x0 == null) return;
			const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
			x0 = null;
			if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) this.step(dx < 0 ? 1 : -1);
		});
		return wrap;
	}
	destroy() { this.ro?.disconnect(); }

	get mode() { return this.narrow ? "agenda" : read(MODE_KEY, "month") === "week" ? "week" : "month"; }

	step(n) {
		const a = anchor || this.today;
		if (!n) anchor = null;
		else if (this.mode === "month") { const d = new Date(a.slice(0, 7) + "-01T12:00"); d.setMonth(d.getMonth() + n); anchor = isoDay(d); }
		else anchor = addDays(a, 7 * n);
		this.draw();
	}

	// The days shown: { from, days: [...], title }.
	range() {
		const a = anchor || this.today;
		if (this.mode === "month") {
			const from = monthGrid(a);
			const d = new Date(a + "T12:00");
			return { from, days: Array.from({ length: 42 }, (_, i) => addDays(from, i)), title: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, month: a.slice(0, 7) };
		}
		const w = weekOf(a);
		return { from: w.from, days: w.days, title: w.title };
	}

	draw() {
		if (!this.wrap) return;
		this.narrow = this.wrap.clientWidth > 0 && this.wrap.clientWidth < NARROW;
		const view = this.view, r = this.range(), mode = this.mode;
		const state = view.state, vault = state.facet(vaultHost);
		const tasks = tasksByDay(datedTasks(allNotes(state), r.days[0], r.days[r.days.length - 1]), r.days, this.today);
		const marks = marksFor(vault, r.days);
		const ro = state.readOnly;

		const head = el("div", "cal-head");
		head.append(el("h1", "cal-title", r.title));
		const nav = el("span", "cal-nav");
		nav.append(
			button("planner-link cal-step", "‹", mode === "month" ? "The month before" : "The week before", () => this.step(-1)),
			button("planner-link", "Today", "Back to today", () => this.step(0)),
			button("planner-link cal-step", "›", mode === "month" ? "The month after" : "The week after", () => this.step(1)),
		);
		head.append(nav);
		if (mode !== "agenda") {
			const modes = el("span", "cal-modes");
			modes.setAttribute("role", "group");
			for (const [m, label] of [["month", "Month"], ["week", "Week"]]) {
				const b = button("cal-mode" + (mode === m ? " on" : ""), label, `Show a ${m}`, () => { write(MODE_KEY, m); this.draw(); });
				b.setAttribute("aria-pressed", String(mode === m));
				modes.append(b);
			}
			head.append(modes);
		}

		const cells = new Map();
		const grid = el("div", `cal-grid cal-${mode}`);
		this.wrap.className = `cal is-${mode}`;
		if (mode === "month") for (const d of WEEKDAYS) grid.append(el("div", "cal-dow-head", d));
		for (const day of r.days) {
			const cell = this.dayCell(day, { mode, r, tasks: tasks.get(day) || [], marks: marks.get(day) || { pencils: [], stickers: [] }, ro });
			cells.set(day, cell);
			grid.append(cell);
		}
		const body = el("div", "cal-body");
		body.append(grid);
		if (mode === "agenda") body.append(this.tabs(r.from));
		this.wrap.replaceChildren(head, body);
		this.fillEvents(r, cells, mode);
	}

	dayCell(day, { mode, r, tasks, marks, ro }) {
		const cell = el("section", "cal-day");
		if (day === this.today) cell.classList.add("today");
		else if (day < this.today) cell.classList.add("past");
		if (mode === "month" && day.slice(0, 7) !== r.month) cell.classList.add("other");
		const top = el("div", "cal-day-head");
		const date = button("cal-date", "", "Open this day's daily note", () => host?.openDay(day));
		const n = new Date(day + "T12:00");
		if (mode !== "month") date.append(el("span", "cal-dow", WEEKDAYS[(n.getDay() + 6) % 7]));
		date.append(el("span", "cal-num", String(n.getDate())));
		top.append(date);
		const stickers = el("span", "cal-stickers");
		for (const s of marks.stickers) {
			const b = button("cal-sticker", s.text, ro ? "" : "Remove this sticker", (e) => { if (!ro) menu([["Remove sticker", () => host?.unmark(s)]], e.clientX, e.clientY); });
			stickers.append(b);
		}
		top.append(stickers);
		if (!ro) top.append(button("cal-add", "+", `Add to ${shortDay(day)}`, (e) => this.dayMenu(e.currentTarget, day)));
		cell.append(top);

		const list = el("ul", "cal-items");
		const items = [];
		for (const p of marks.pencils) {
			const li = el("li", "cal-item cal-pencil");
			if (p.time) li.append(el("span", "cal-time", clock(p.time)));
			li.append(el("span", "cal-text", p.text));
			if (!ro) {
				li.tabIndex = 0;
				li.title = "Penciled in. Ink it into the calendar, or erase it";
				const open = (e) => menu([["Ink it into the calendar", () => host?.ink(p)], ["Erase", () => host?.unmark(p)]], e.clientX || li.getBoundingClientRect().left, e.clientY || li.getBoundingClientRect().bottom);
				li.addEventListener("click", open);
				li.addEventListener("keydown", (e) => { if (e.key === "Enter") open(e); });
			}
			items.push(["pencil", p.time || "99", li]);
		}
		for (const t of tasks) {
			const li = el("li", "cal-item cal-task" + (t.done ? " done" : "") + (t.overdue ? " overdue" : ""));
			const box = el("input");
			box.type = "checkbox";
			box.checked = t.done;
			box.disabled = ro;
			box.addEventListener("change", () => { if (!tick(this.view, t.path, t.line, t.text, box.checked)) box.checked = !box.checked; });
			li.append(box, el("span", "cal-text", taskLabel(t.text).replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, "").trim()));
			if (t.overdue) li.title = `Was due ${shortDay(t.due)}`;
			items.push(["task", "98", li]);
		}
		// Events go in first, in time order, once they've loaded.
		cell._items = items;
		cell._list = list;
		cell._mode = mode;
		cell._day = day;
		this.fillItems(cell, []);
		cell.append(list);
		if (mode === "month" && !ro) cell.addEventListener("click", (e) => { if (e.target === cell || e.target === list) this.dayMenu(cell.querySelector(".cal-add"), day); });
		return cell;
	}

	// The day's list: events, then pencils and tasks by time; in the month
	// grid, the first few and a "+ n more" that shows that week.
	fillItems(cell, events) {
		const evs = events.map((e) => {
			const li = el("li", "cal-item cal-event");
			const color = EVENT_COLORS[e.colorId]?.[1] || e.color;
			if (/^#[0-9a-f]{3,8}$/i.test(color || "")) li.style.setProperty("--c", color);
			if (!e.allDay) { const d = new Date(e.start); li.append(el("span", "cal-time", clock(`${d.getHours()}:${d.getMinutes()}`))); }
			li.append(el("span", "cal-text", e.title || "(no title)"));
			return li;
		});
		const all = [...evs, ...cell._items.sort((a, b) => a[1].localeCompare(b[1])).map((x) => x[2])];
		let shown = all;
		if (cell._mode === "month" && all.length > MONTH_ITEMS) {
			shown = all.slice(0, MONTH_ITEMS - 1);
			const more = el("li", "cal-more");
			more.append(button("cal-more-btn", `+ ${all.length - shown.length} more`, "Show this week", () => { anchor = cell._day; write(MODE_KEY, "week"); this.draw(); }));
			shown = [...shown, more];
		}
		cell._list.replaceChildren(...shown);
	}

	// The tabs down the right edge in the agenda: two weeks back to three on.
	tabs(from) {
		const box = el("nav", "cal-tabs");
		box.setAttribute("aria-label", "Weeks");
		for (let n = -2; n <= 3; n++) {
			const mon = addDays(from, 7 * n);
			const b = button("cal-tab" + (n === 0 ? " on" : "") + (weekOf(mon).days.includes(this.today) ? " now" : ""), shortDay(mon), `Week of ${shortDay(mon)}`, () => { if (n) { anchor = mon; this.draw(); } });
			if (n === 0) b.setAttribute("aria-current", "true");
			box.append(b);
		}
		return box;
	}

	async fillEvents(r, cells) {
		if (!host?.events) return;
		const key = r.days[0] + "|" + r.days.length;
		const put = (events) => {
			for (const d of byDay(events || [], new Date(r.days[0] + "T00:00"), r.days.length)) {
				const c = cells.get(d.key);
				if (c) this.fillItems(c, d.events);
			}
		};
		const have = eventCache.get(key);
		if (have) put(have.events);
		if (have && Date.now() - have.at < FRESH) return;
		try {
			const events = await host.events(r.days[0], r.days.length);
			if (!events) return;
			eventCache.set(key, { at: Date.now(), events });
			if (this.wrap.isConnected && this.range().from === r.from) put(events);
		} catch {}
	}

	// What + on a day offers: pencil something in (with a time if you like),
	// add a real event, add a sticker, or open the daily note.
	dayMenu(anchorEl, day) {
		if (!anchorEl) return;
		openPanel("cal-day:" + day, "cal-day", anchorEl, (box) => {
			box.classList.add("cal-panel");
			box.append(el("div", "cal-panel-title", longDay(day)));
			const row = el("div", "cal-pencil-row");
			const text = el("input", "cal-pencil-input");
			text.placeholder = "Pencil something in…";
			text.dataset.focus = "text";
			const time = el("input", "cal-pencil-time");
			time.type = "time";
			time.setAttribute("aria-label", "Time (optional)");
			const go = () => {
				if (!text.value.trim()) return text.focus();
				host?.mark(day, "pencil", text.value, time.value);
				closePanel();
			};
			text.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
			row.append(text, time, button("cal-btn primary", "Pencil in", "Add it in pencil: a maybe, with no reminder", go));
			box.append(row);
			const acts = el("div", "cal-panel-acts");
			acts.append(
				button("cal-btn", "Add event…", "Add a calendar event on this day", () => { closePanel(); host?.addEvent(day); }),
				button("cal-btn", "Add sticker…", "Put a sticker on this day", () => { closePanel(); stickerPicker(anchorEl, (s) => host?.mark(day, "sticker", s)); }),
				button("cal-btn", "Daily note", "Open this day's daily note", () => { closePanel(); host?.openDay(day); }),
			);
			box.append(acts);
			setTimeout(() => text.focus(), 0);
		});
	}
}

const clock = (hhmm) => {
	const [h, m] = hhmm.split(":").map(Number);
	return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "a" : "p"}`;
};

// The marks for the days shown, from the months' marks notes.
function marksFor(vault, days) {
	const months = new Set(days.map((d) => d.slice(0, 7)));
	const list = [];
	for (const p of vault?.paths() || []) {
		const m = marksMonth(p);
		if (m && months.has(m)) list.push(...readMarks(vault.text(p)).map((x) => ({ ...x, path: p })));
	}
	return marksByDay(list);
}

// ---- Stickers ----------------------------------------------------------------
// The OpenMoji set (src/openmoji.json: [emoji, group, words], every emoji the
// app's emoji font draws, OpenMoji's own extras too), loaded the first time
// the picker opens. Recently used ones come first.

const GROUPS = [["recent", "🕘", "Recent"], ["faces", "😀", "Faces"], ["people", "🙋", "People"], ["nature", "🌿", "Nature"], ["food", "🍓", "Food"], ["activities", "⚽", "Activities"], ["places", "🏠", "Places"], ["objects", "💡", "Objects"], ["symbols", "💟", "Symbols"], ["extras", "🦄", "OpenMoji extras"], ["flags", "🏳️", "Flags"]];
const STARTERS = ["⭐", "🎉", "❤️", "😀", "😴", "🤒", "☀️", "🌧️", "🎂", "✈️", "🏃", "📚", "💊", "🍕", "💪", "✅"];
let stickers = null;

function recent() {
	try { const v = JSON.parse(read(RECENT_KEY, "[]")); return Array.isArray(v) && v.length ? v : STARTERS; } catch { return STARTERS; }
}

export function stickerPicker(anchorEl, pick) {
	let group = "recent", query = "";
	const load = stickers ? null : import("./openmoji.json").then((m) => { stickers = m.default; redrawPanel("stickers"); });
	openPanel("stickers", "stickers", anchorEl, (box) => {
		box.classList.add("cal-panel", "sticker-panel");
		const search = el("input", "sticker-search");
		search.type = "search";
		search.placeholder = "Search stickers";
		search.dataset.focus = "search";
		search.value = query;
		search.addEventListener("input", () => { query = search.value; redrawPanel("stickers"); });
		const tabs = el("div", "sticker-tabs");
		for (const [id, icon, label] of GROUPS) {
			const b = button("sticker-tab" + (group === id && !query ? " on" : ""), icon, label, () => { group = id; query = ""; redrawPanel("stickers"); });
			tabs.append(b);
		}
		const grid = el("div", "sticker-grid");
		let list;
		if (query.trim()) {
			const words = query.toLowerCase().trim().split(/\s+/);
			list = (stickers || []).filter((s) => words.every((w) => s[2].includes(w))).slice(0, 160).map((s) => [s[0], s[2]]);
		} else if (group === "recent") list = recent().map((e) => [e, (stickers || []).find((s) => s[0] === e)?.[2] || ""]);
		else list = (stickers || []).filter((s) => s[1] === group).map((s) => [s[0], s[2]]);
		for (const [e, words] of list) {
			const b = button("sticker", e, words.split(" ").slice(0, 3).join(" ") || e, () => {
				write(RECENT_KEY, JSON.stringify([e, ...recent().filter((x) => x !== e)].slice(0, 24)));
				closePanel();
				pick(e);
			});
			grid.append(b);
		}
		if (!list.length) grid.append(el("p", "sticker-none", stickers ? "No stickers match." : "Loading stickers…"));
		const credit = el("p", "sticker-credit");
		credit.append("Stickers by ", Object.assign(el("a", null, "OpenMoji"), { href: "https://openmoji.org", target: "_blank", rel: "noopener" }), " · CC BY-SA 4.0");
		box.append(search, tabs, grid, credit);
	});
	return load;
}

// ---- The block ----------------------------------------------------------------

function build(state) {
	const b = new RangeSetBuilder();
	const path = state.facet(notePath), vault = state.facet(vaultHost);
	if (!vault || !path || UNTRUSTED.test(path) || (host && !host.on())) return b.finish();
	const blocks = dataviewBlocks(state, CALENDAR_BLOCK);
	if (!blocks.length) return b.finish();
	const today = isoDay(new Date());
	// Redrawn when any note changes (tasks and marks live in other notes).
	const version = vaultVersion(vault, state);
	for (const blk of blocks) {
		if (isOpen(state, blk)) continue;
		b.add(blk.from, blk.to, Decoration.replace({ widget: new CalendarWidget({ path, today, version }), block: true }));
	}
	return b.finish();
}

// A short fingerprint of the tasks and marks the page could show.
function vaultVersion(vault, state) {
	let h = 5381;
	const add = (s) => { for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; };
	for (const p of vault.paths()) {
		const t = vault.text(p);
		if (t == null || !(marksMonth(p) || t.includes("📅"))) continue;
		add(p);
		add(t);
	}
	add(state.sliceDoc());
	return h;
}

export const calendarBlocks = StateField.define({
	create: build,
	update(deco, tr) {
		if (tr.docChanged || tr.effects.some((e) => e.is(vaultChanged)) || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});
