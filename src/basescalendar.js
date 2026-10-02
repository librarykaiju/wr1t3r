// Calendar and Timeline layouts for boards (src/basesview.js draws the rest).
// Both place notes by a date property, chosen in Layout and saved in the
// view's wr1t3r: keys (date, end), so Obsidian keeps the view and ignores them.
//
// Calendar: a month of days with each note on its day. Drag a note to another
// day to change its date; + on a day makes a new note dated that day.
// Timeline: each note as a bar from its date to its end date (one day when it
// has none), across a scale of days, with today marked.

import { toDate, setProperty, noteKey, BDate } from "./bases.js";
import { el, button } from "./basesui.js";

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The first value of a property as a date, or null.
export function dateOf(v) {
	if (Array.isArray(v)) v = v[0];
	return v == null || v === "" ? null : toDate(v instanceof BDate ? v : String(v));
}

// The value to write when a note moves to `day` ("YYYY-MM-DD"), keeping a
// time of day it had.
export function movedValue(old, day) {
	const d = dateOf(old);
	if (!d || d.dateOnly) return day;
	const t = new Date(d.ms);
	return `${day}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

// The 6 weeks of days shown for a month (Sunday first), as Date objects.
export function monthGrid(year, month) {
	const first = new Date(year, month, 1);
	const start = new Date(year, month, 1 - first.getDay());
	return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

const shown = new Map(); // board key -> { y, m }, the month on screen

export function calendar(ctx, r, editable, wrap, dateId) {
	if (!dateId) {
		wrap.append(el("div", "md-base-empty", editable ? "Pick the date property the calendar uses (Calendar > Date from)." : "This calendar view has no date property set."));
		return;
	}
	const byDay = new Map();
	let undated = 0;
	for (const row of r.rows) {
		const d = dateOf(row.value(dateId));
		if (!d) { undated++; continue; }
		const k = iso(new Date(d.ms));
		if (!byDay.has(k)) byDay.set(k, []);
		byDay.get(k).push(row);
	}
	const now = new Date();
	if (!shown.has(ctx.key)) {
		// Opens on this month, or the next month that has notes if this one has none.
		const first = [...byDay.keys()].sort().find((k) => k >= iso(new Date(now.getFullYear(), now.getMonth(), 1)));
		const has = [...byDay.keys()].some((k) => k.startsWith(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`));
		const at = !has && first ? new Date(first + "T00:00") : now;
		shown.set(ctx.key, { y: at.getFullYear(), m: at.getMonth() });
	}
	const key = noteKey(dateId);
	const box = el("div", "md-base-cal");
	wrap.append(box);

	function draw() {
		const { y, m } = shown.get(ctx.key);
		box.replaceChildren();
		const head = el("div", "md-base-cal-head");
		const go = (step) => { const d = new Date(y, m + step, 1); shown.set(ctx.key, { y: d.getFullYear(), m: d.getMonth() }); draw(); };
		head.append(
			button("md-base-cal-nav", "‹", () => go(-1), "Previous month"),
			el("span", "md-base-cal-title", `${MONTHS[m]} ${y}`),
			button("md-base-cal-nav", "›", () => go(1), "Next month"),
			button("md-base-cal-today", "Today", () => { shown.set(ctx.key, { y: now.getFullYear(), m: now.getMonth() }); draw(); }),
		);
		box.append(head);
		const grid = el("div", "md-base-cal-grid");
		for (const w of WEEKDAYS) grid.append(el("div", "md-base-cal-wd", w));
		const today = iso(now);
		for (const d of monthGrid(y, m)) {
			const k = iso(d);
			const cell = el("div", "md-base-cal-day" + (d.getMonth() !== m ? " out" : "") + (k === today ? " today" : ""));
			cell.dataset.day = k;
			const top = el("div", "md-base-cal-num");
			top.append(el("span", null, String(d.getDate())));
			if (editable && ctx.host?.create && key) top.append(button("md-base-cal-add", "+", () => ctx.newNote({ [key]: k }), `New note on ${k}`));
			cell.append(top);
			for (const row of byDay.get(k) || []) {
				const chip = el("button", "md-base-cal-note", row.file.name);
				chip.type = "button";
				chip.title = row.file.name;
				chip.addEventListener("click", () => ctx.open(row.path));
				if (editable && key && ctx.host?.write) {
					chip.draggable = true;
					chip.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/x-wr1t3r-note", row.path); e.dataTransfer.effectAllowed = "move"; });
				}
				cell.append(chip);
			}
			if (editable && key && ctx.host?.write) {
				cell.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/x-wr1t3r-note")) { e.preventDefault(); cell.classList.add("drop"); } });
				cell.addEventListener("dragleave", () => cell.classList.remove("drop"));
				cell.addEventListener("drop", (e) => {
					e.preventDefault();
					cell.classList.remove("drop");
					const path = e.dataTransfer.getData("text/x-wr1t3r-note");
					const row = r.rows.find((x) => x.path === path);
					if (!row) return;
					const old = row.value(dateId);
					if (dateOf(old) && iso(new Date(dateOf(old).ms)) === k) return;
					ctx.host.write(path, (text) => setProperty(text, key, movedValue(old, k)));
				});
			}
			grid.append(cell);
		}
		box.append(grid);
		if (undated) box.append(el("div", "md-base-note", `${undated} ${undated === 1 ? "note has" : "notes have"} no date, so ${undated === 1 ? "it isn't" : "they aren't"} on the calendar.`));
	}
	draw();
}

// The bars of a timeline: [{ row, start, end }] (ms, end inclusive of its day),
// sorted by start, plus the range they span.
export function timelineBars(rows, value, startId, endId) {
	const bars = [];
	for (const row of rows) {
		const s = dateOf(value(row, startId));
		if (!s) continue;
		const e = endId ? dateOf(value(row, endId)) : null;
		const start = new Date(new Date(s.ms).toDateString()).getTime();
		const end = e && e.ms >= s.ms ? new Date(new Date(e.ms).toDateString()).getTime() : start;
		bars.push({ row, start, end });
	}
	bars.sort((a, b) => a.start - b.start || a.end - b.end);
	const from = bars.length ? Math.min(...bars.map((b) => b.start)) : null;
	const to = bars.length ? Math.max(...bars.map((b) => b.end)) : null;
	return { bars, from, to };
}

export function timeline(ctx, r, editable, wrap, dateId, endId) {
	if (!dateId) {
		wrap.append(el("div", "md-base-empty", editable ? "Pick the date property the timeline starts from (Timeline > Date from)." : "This timeline view has no date property set."));
		return;
	}
	const { bars, from, to } = timelineBars(r.rows, (row, id) => row.value(id), dateId, endId);
	if (!bars.length) { wrap.append(el("div", "md-base-empty", "No notes have a date yet.")); return; }
	const today = new Date(new Date().toDateString()).getTime();
	// A week of room either side, and today in view when it's near.
	let start = from - 7 * DAY, end = to + 7 * DAY;
	if (today >= start - 60 * DAY && today < start) start = today - 7 * DAY;
	if (today <= end + 60 * DAY && today > end) end = today + 7 * DAY;
	start = new Date(new Date(start).getFullYear(), new Date(start).getMonth(), 1).getTime(); // whole months
	const days = Math.round((end - start) / DAY) + 1;
	const px = days > 240 ? 6 : days > 90 ? 14 : 28; // width of a day
	const x = (ms) => Math.round((ms - start) / DAY) * px;

	const box = el("div", "md-base-tl");
	const track = el("div", "md-base-tl-track");
	track.style.width = days * px + "px";
	const scale = el("div", "md-base-tl-scale");
	for (let d = new Date(start); d.getTime() <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
		const tick = el("span", "md-base-tl-month", `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`);
		tick.style.left = x(d.getTime()) + "px";
		scale.append(tick);
	}
	track.append(scale);
	if (today >= start && today <= end) {
		const line = el("div", "md-base-tl-today");
		line.style.left = x(today) + px / 2 + "px";
		line.title = "Today";
		track.append(line);
	}
	for (const b of bars) {
		const lane = el("div", "md-base-tl-row");
		const bar = el("button", "md-base-tl-bar", b.row.file.name);
		bar.type = "button";
		bar.style.left = x(b.start) + "px";
		bar.style.width = Math.max(px, x(b.end) - x(b.start) + px) + "px";
		bar.title = `${b.row.file.name}: ${iso(new Date(b.start))}${b.end > b.start ? " to " + iso(new Date(b.end)) : ""}`;
		bar.addEventListener("click", () => ctx.open(b.row.path));
		lane.append(bar);
		track.append(lane);
	}
	box.append(track);
	wrap.append(box);
	const undated = r.rows.length - bars.length;
	if (undated) wrap.append(el("div", "md-base-note", `${undated} ${undated === 1 ? "note has" : "notes have"} no date, so ${undated === 1 ? "it isn't" : "they aren't"} on the timeline.`));
	// Opens scrolled to today, or the first bar.
	requestAnimationFrame(() => { box.scrollLeft = Math.max(0, (today >= start && today <= end ? x(today) : x(from)) - 80); });
}
