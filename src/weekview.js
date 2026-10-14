// Draws ```wr1t3r-week blocks (src/weekly.js works out what's in them): the
// week's title with buttons to step a week back or on, then the seven days,
// each with its calendar events, the tasks due that day (ticking one ticks
// its line wherever it's written) and a + to plan something on that day,
// which goes into this note as a task due then. Side by side on a wide
// screen; on a phone, one day under another with tabs down the right edge for
// the weeks around this one (a swipe steps a week too). Stepping only changes
// what's shown; the note stays this week's.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { dataviewBlocks, tick } from "./dataview.js";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { allNotes } from "./tasklistview.js";
import { isOpen } from "./drawnblocks.js";
import { isoDay } from "./tasks.js";
import { addDays } from "./habits.js";
import { byDay, timeLabel, EVENT_COLORS } from "./agenda.js";
import { WEEK_BLOCK, weekOf, noteWeek, datedTasks, tasksByDay, taskLabel, addPlan, hasReflect } from "./weekly.js";

const UNTRUSTED = /(^|\/)_(clippings|uploads)\//i;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Set by main.js: { on() -> whether the Weekly planner is on, events(from) ->
// Promise<events|null> for the seven days from that Monday, openDay(day)
// (the daily note, made if needed), reflect(view, from) (adds Reflect &
// recover to this note), openWeek(day) (that week's note, made if needed) }.
let host = null;
export const setWeekHost = (h) => { host = h; };

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const button = (cls, text, title, run) => {
	const b = el("button", cls, text);
	b.type = "button";
	if (title) b.title = title;
	b.addEventListener("mousedown", (e) => e.preventDefault());
	b.addEventListener("click", run);
	return b;
};

// The week each note's block shows (path -> Monday), kept while the app is open.
const shown = new Map();
// Events by week (Monday -> { at, events }), so redraws don't fetch again.
const eventCache = new Map();
const FRESH = 5 * 60000;
export const forgetWeekEvents = () => eventCache.clear();

const shortDay = (day) => { const d = new Date(day + "T12:00"); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };

class WeekWidget extends WidgetType {
	constructor(p) {
		super();
		Object.assign(this, p);
		this.key = JSON.stringify([p.path, p.from, p.today, p.reflected, p.tasks.map((t) => [t.path, t.line, t.text, t.done])]);
	}
	eq(o) { return o.key === this.key; }
	ignoreEvent() { return true; }

	toDOM(view) {
		const wrap = el("div", "week");
		this.wrap = wrap;
		this.view = view;
		this.draw(shown.get(this.path) || this.from);
		// A sideways swipe steps a week, on a phone.
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

	step(n) {
		this.draw(n ? addDays(shown.get(this.path) || this.from, 7 * n) : this.from);
	}

	// Draws the week starting `from` into the widget.
	draw(from) {
		if (from === this.from) shown.delete(this.path);
		else shown.set(this.path, from);
		const view = this.view, w = weekOf(from), own = from === this.from;
		const tasks = own ? this.tasks : datedTasks(allNotes(view.state), w.from, w.to);
		const byTask = tasksByDay(tasks, w.days, this.today);
		const ro = view.state.readOnly;

		const head = el("div", "week-head");
		const title = el("h1", "week-title", w.title);
		head.append(title);
		if (w.days.includes(this.today)) head.append(el("span", "planner-today", "This week"));
		const links = el("span", "week-links");
		links.append(button("planner-link week-step", "‹", "The week before", () => this.step(-1)));
		if (!own) links.append(button("planner-link", "Back to this note's week", "Show the week this note is for", () => this.step(0)));
		links.append(button("planner-link week-step", "›", "The week after", () => this.step(1)));
		if (!own) links.append(button("planner-link", "Open its note", "Open the weekly note for the week shown", () => host?.openWeek(from)));
		if (own && !ro && !this.reflected) links.append(button("planner-link", "Reflect & recover", "Add the week in numbers and questions for looking back and resting up", () => host?.reflect(view, this.from)));
		head.append(links);

		const days = el("div", "week-days");
		const cells = new Map();
		w.days.forEach((day, i) => {
			const cell = el("section", "week-day");
			if (day === this.today) cell.classList.add("today");
			else if (day < this.today) cell.classList.add("past");
			const top = el("div", "week-day-head");
			top.append(button("week-day-name", "", "Open this day's daily note", () => host?.openDay(day)));
			top.firstChild.append(el("span", "week-dow", WEEKDAYS[i]), el("span", "week-date", String(new Date(day + "T12:00").getDate())));
			if (!ro && own) top.append(button("week-add", "+", "Plan something on this day", () => this.adder(cell, day)));
			cell.append(top);
			const evs = el("ul", "week-events");
			cell.append(evs);
			const list = el("ul", "week-tasks");
			for (const t of byTask.get(day)) {
				const li = el("li", "week-task" + (t.done ? " done" : "") + (t.overdue ? " overdue" : ""));
				const box = el("input");
				box.type = "checkbox";
				box.checked = t.done;
				box.disabled = ro;
				box.addEventListener("change", () => { if (!tick(view, t.path, t.line, t.text, box.checked)) box.checked = !box.checked; });
				// Tags quieter than the words.
				const label = el("span", "week-task-text");
				for (const part of taskLabel(t.text).split(/((?:^|\s)#[\p{L}\p{N}_/-]+)/u)) {
					if (/^\s?#/.test(part)) label.append(" ", el("span", "week-tag", part.trim()));
					else if (part) label.append(part);
				}
				if (t.overdue) label.title = `Was due ${shortDay(t.due)}`;
				li.append(box, label);
				list.append(li);
			}
			cell.append(list);
			cells.set(day, { cell, evs });
			days.append(cell);
		});

		const body = el("div", "week-body");
		body.append(days, this.tabs(from));
		this.wrap.replaceChildren(head, body);
		this.fillEvents(w, cells);
	}

	// The tabs down the right edge on a phone: two weeks back to three on.
	tabs(from) {
		const box = el("nav", "week-tabs");
		box.setAttribute("aria-label", "Weeks");
		for (let n = -2; n <= 3; n++) {
			const mon = addDays(from, 7 * n);
			const b = button("week-tab" + (n === 0 ? " on" : "") + (weekOf(mon).days.includes(this.today) ? " now" : ""), shortDay(mon), `Week of ${shortDay(mon)}`, () => { if (n) this.draw(mon); });
			if (n === 0) b.setAttribute("aria-current", "true");
			box.append(b);
		}
		return box;
	}

	// The calendar's events, from the cache or loaded, into each day.
	async fillEvents(w, cells) {
		if (!host?.events) return;
		const put = (events) => {
			for (const d of byDay(events || [], new Date(w.from + "T00:00"), 7)) {
				const c = cells.get(d.key);
				if (!c) continue;
				c.evs.replaceChildren(...d.events.map((e) => {
					const li = el("li", "week-event");
					const color = EVENT_COLORS[e.colorId]?.[1] || e.color;
					if (/^#[0-9a-f]{3,8}$/i.test(color || "")) li.style.setProperty("--c", color);
					if (!e.allDay) li.append(el("span", "week-event-time", timeLabel(e).split("–")[0]));
					li.append(el("span", "week-event-title", e.title || "(no title)"));
					return li;
				}));
			}
		};
		const have = eventCache.get(w.from);
		if (have) put(have.events);
		if (have && Date.now() - have.at < FRESH) return;
		try {
			const events = await host.events(w.from);
			if (!events) return;
			eventCache.set(w.from, { at: Date.now(), events });
			if (this.wrap.isConnected && (shown.get(this.path) || this.from) === w.from) put(events);
		} catch {}
	}

	// A box for typing a plan on `day`; Enter adds it to this note.
	adder(cell, day) {
		if (cell.querySelector(".week-adder")) return cell.querySelector(".week-adder").focus();
		const input = el("input", "week-adder");
		input.placeholder = "Plan something…";
		input.setAttribute("aria-label", `Plan something on ${shortDay(day)}`);
		const done = () => input.remove();
		input.addEventListener("keydown", (e) => {
			if (e.key === "Escape") return done();
			if (e.key !== "Enter" || !input.value.trim()) return;
			e.preventDefault();
			const view = this.view, text = view.state.sliceDoc();
			const next = addPlan(text, day, input.value);
			view.dispatch({ changes: { from: 0, to: text.length, insert: next } });
		});
		input.addEventListener("blur", done);
		cell.querySelector(".week-tasks").before(input);
		input.focus();
	}
}

function build(state) {
	const b = new RangeSetBuilder();
	const path = state.facet(notePath), vault = state.facet(vaultHost);
	if (!vault || !path || UNTRUSTED.test(path) || (host && !host.on())) return b.finish();
	const blocks = dataviewBlocks(state, WEEK_BLOCK);
	if (!blocks.length) return b.finish();
	const today = isoDay(new Date());
	const from = noteWeek(path) || weekOf(today).from;
	const w = weekOf(from);
	const tasks = datedTasks(allNotes(state), w.from, w.to);
	const reflected = hasReflect(state.sliceDoc());
	for (const blk of blocks) {
		if (isOpen(state, blk)) continue;
		b.add(blk.from, blk.to, Decoration.replace({ widget: new WeekWidget({ path, from, today, tasks, reflected }), block: true }));
	}
	return b.finish();
}

export const weekBlocks = StateField.define({
	create: build,
	update(deco, tr) {
		if (tr.docChanged || tr.effects.some((e) => e.is(vaultChanged)) || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});
