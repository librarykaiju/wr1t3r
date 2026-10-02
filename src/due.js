// Due dates on tasks, stored as the Tasks plugin writes them ("📅 2026-10-03",
// src/tasks.js) so Obsidian reads them too. In the editor the date shows as a
// pill: red once it's past and the task is still open, accented on the day.
// Clicking the pill, the "Due date" slash command (also on the keyboard bar's
// swipe list and in the palette), or right-clicking a task's box opens a date
// picker. The text is only changed by picking a date.

import { ViewPlugin, Decoration } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { dueMark, dueOf, setDueChanges, taskMark, isoDay } from "./tasks.js";
import { menu } from "./basesui.js";
import { reminderMark, setReminderChanges, DEFAULT_TIME } from "./reminders.js";

const pill = Object.fromEntries(["overdue", "today", "done", "later"].map((s) => [s, Decoration.mark({ class: `md-due md-due-${s}` })]));

const remindPill = Object.fromEntries(["past", "done", "later"].map((s) => [s, Decoration.mark({ class: `md-remind md-remind-${s}` })]));
const pad = (n) => String(n).padStart(2, "0");
const stampOf = (d) => `${isoDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

function build(view) {
	const b = new RangeSetBuilder();
	const today = isoDay(new Date());
	const nowStamp = stampOf(new Date());
	for (const { from, to } of view.visibleRanges) {
		for (let pos = from; pos <= to;) {
			const line = view.state.doc.lineAt(pos);
			// Both pills, in line order (a range set must be added in order).
			const marks = [];
			if (line.text.includes("📅")) {
				const m = dueMark(line.text, today);
				if (m) marks.push([m.from, m.to, pill[m.state]]);
			}
			if (line.text.includes("(@")) {
				const r = reminderMark(line.text);
				if (r) marks.push([r.from, r.to, taskMark(line.text)?.char !== " " ? remindPill.done : `${r.day} ${r.time || DEFAULT_TIME}` < nowStamp ? remindPill.past : remindPill.later]);
			}
			for (const [f, t, d] of marks.sort((a, c) => a[0] - c[0])) b.add(line.from + f, line.from + t, d);
			pos = line.to + 1;
		}
	}
	return b.finish();
}

// Sets (or, with null, takes off) the due date of the task on the line at pos.
function setDue(view, pos, day) {
	const line = view.state.doc.lineAt(pos);
	const changes = setDueChanges(line.text, line.from, day);
	if (changes.length) view.dispatch({ changes, userEvent: "input.due" });
}

// A native date picker over the line at pos, starting on the task's due date
// (or today). Picking a day sets it; clearing it takes the date off.
export function pickDue(view, pos) {
	const line = view.state.doc.lineAt(pos);
	if (!taskMark(line.text)) return false;
	document.querySelector(".md-due-picker")?.remove();
	const input = document.createElement("input");
	input.type = "date";
	input.className = "md-due-picker";
	input.value = dueOf(line.text) || isoDay(new Date());
	const at = view.coordsAtPos(Math.min(line.to, pos)) || view.coordsAtPos(line.from);
	input.style.left = Math.max(8, Math.min((at?.left ?? 40), innerWidth - 180)) + "px";
	input.style.top = Math.min((at?.bottom ?? 80) + 4, innerHeight - 48) + "px";
	document.body.append(input);
	const lineNo = line.number;
	let done = false;
	const finish = (apply) => {
		if (done) return;
		done = true;
		input.remove();
		if (apply && lineNo <= view.state.doc.lines) setDue(view, view.state.doc.line(lineNo).from, input.value || null);
		view.focus();
	};
	input.addEventListener("change", () => finish(true));
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") { e.preventDefault(); finish(true); }
		if (e.key === "Escape") { e.preventDefault(); finish(false); }
	});
	input.addEventListener("blur", () => setTimeout(() => finish(false), 150));
	input.focus();
	try { input.showPicker(); } catch {} // the input itself stays usable where showPicker isn't
	return true;
}

// The slash command: the cursor's line becomes a task if it isn't one, then
// the picker opens for it.
export function dueCommand(view) {
	const { head } = view.state.selection.main;
	const line = view.state.doc.lineAt(head);
	if (!taskMark(line.text)) {
		const m = line.text.match(/^(\s*)(?:([-*+]|\d+[.)]) )?/);
		const changes = m[2] ? { from: line.from + m[0].length, insert: "[ ] " } : { from: line.from + m[1].length, insert: "- [ ] " };
		view.dispatch({ changes, userEvent: "input" });
	}
	pickDue(view, view.state.doc.lineAt(view.state.selection.main.head).from);
}

// Reminders ("(@2026-10-03 14:30)", src/reminders.js): the same kind of
// picker with a time.
function setReminder(view, pos, when) {
	const line = view.state.doc.lineAt(pos);
	const changes = setReminderChanges(line.text, line.from, when);
	if (changes.length) view.dispatch({ changes, userEvent: "input.remind" });
}

export function pickReminder(view, pos) {
	const line = view.state.doc.lineAt(pos);
	if (!taskMark(line.text)) return false;
	document.querySelector(".md-due-picker")?.remove();
	const r = reminderMark(line.text);
	const input = document.createElement("input");
	input.type = "datetime-local";
	input.className = "md-due-picker";
	const soon = new Date(Date.now() + 3600000);
	soon.setMinutes(0);
	input.value = r ? `${r.day}T${r.time || DEFAULT_TIME}` : `${dueOf(line.text) || isoDay(soon)}T${dueOf(line.text) ? DEFAULT_TIME : `${pad(soon.getHours())}:00`}`;
	const at = view.coordsAtPos(Math.min(line.to, pos)) || view.coordsAtPos(line.from);
	input.style.left = Math.max(8, Math.min((at?.left ?? 40), innerWidth - 240)) + "px";
	input.style.top = Math.min((at?.bottom ?? 80) + 4, innerHeight - 48) + "px";
	document.body.append(input);
	const lineNo = line.number;
	let done = false;
	const finish = (apply) => {
		if (done) return;
		done = true;
		input.remove();
		if (apply && lineNo <= view.state.doc.lines) setReminder(view, view.state.doc.line(lineNo).from, input.value ? input.value.replace("T", " ") : null);
		view.focus();
	};
	// A date-and-time picker changes on every part picked, so it applies on
	// Enter or when it closes, not on change.
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") { e.preventDefault(); finish(true); }
		if (e.key === "Escape") { e.preventDefault(); finish(false); }
	});
	// Leaving it half-filled (the value reads empty) changes nothing.
	input.addEventListener("blur", () => setTimeout(() => finish(!!input.value), 150));
	input.focus();
	try { input.showPicker(); } catch {}
	return true;
}

// The "Reminder" slash command and palette command.
export function reminderCommand(view) {
	const { head } = view.state.selection.main;
	const line = view.state.doc.lineAt(head);
	if (!taskMark(line.text)) {
		const m = line.text.match(/^(\s*)(?:([-*+]|\d+[.)]) )?/);
		const changes = m[2] ? { from: line.from + m[0].length, insert: "[ ] " } : { from: line.from + m[1].length, insert: "- [ ] " };
		view.dispatch({ changes, userEvent: "input" });
	}
	pickReminder(view, view.state.doc.lineAt(view.state.selection.main.head).from);
}

// Quick picks for the right-click menu.
function dueMenu(view, pos, x, y) {
	const line = view.state.doc.lineAt(pos);
	const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
	menu([
		["Due date…", () => pickDue(view, pos)],
		["Due today", () => setDue(view, pos, inDays(0))],
		["Due tomorrow", () => setDue(view, pos, inDays(1))],
		["Due in a week", () => setDue(view, pos, inDays(7))],
		null,
		["Remind me…", () => pickReminder(view, pos)],
		["Remind me in an hour", () => setReminder(view, pos, stampOf(new Date(Date.now() + 3600000)))],
		["Remind me tomorrow morning", () => setReminder(view, pos, `${inDays(1)} ${DEFAULT_TIME}`)],
		...(dueOf(line.text) || reminderMark(line.text) ? [null] : []),
		...(dueOf(line.text) ? [["Remove due date", () => setDue(view, pos, null), "danger"]] : []),
		...(reminderMark(line.text) ? [["Remove reminder", () => setReminder(view, pos, null), "danger"]] : []),
	], x, y);
}

export const dueDates = ViewPlugin.define((view) => ({
	decorations: build(view),
	day: isoDay(new Date()),
	update(u) {
		const day = isoDay(new Date());
		if (u.docChanged || u.viewportChanged || day !== this.day) { this.day = day; this.decorations = build(u.view); }
	},
}), {
	decorations: (v) => v.decorations,
	eventHandlers: {
		mousedown(e, view) {
			const el = e.target.closest?.(".md-due, .md-remind");
			if (!el || e.button !== 0 || e.metaKey || e.ctrlKey || view.state.readOnly) return false;
			e.preventDefault();
			(el.classList.contains("md-remind") ? pickReminder : pickDue)(view, view.posAtDOM(el));
			return true;
		},
		contextmenu(e, view) {
			const el = e.target.closest?.(".md-task-box, .md-due, .md-remind");
			if (!el || view.state.readOnly) return false;
			e.preventDefault();
			dueMenu(view, view.posAtDOM(el), e.clientX, e.clientY);
			return true;
		},
	},
});
