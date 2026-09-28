// A one-tap bar above the phone keyboard (web apps can't add keys to the
// keyboard itself), scrolling sideways like Apple Notes: / opens the
// formatting menu, then a task box, heading level, [[link]] and undo, then
// every slash-menu command (table ones only with the cursor in a table).
// Shown only on touch screens while the keyboard is up. Buttons act on mousedown with the default prevented, so the editor
// keeps focus and the keyboard stays open.

import { EditorSelection } from "@codemirror/state";
import { startCompletion, snippet } from "@codemirror/autocomplete";
import { undo } from "@codemirror/commands";
import { COMMANDS } from "./slash.js";
import { inTable } from "./table.js";

// "/" where the slash menu will see it: at a line start or after a space.
export function slashEdit(state) {
	const { from, to } = state.selection.main;
	const before = from > state.doc.lineAt(from).from ? state.sliceDoc(from - 1, from) : "";
	const insert = before && !/\s/.test(before) ? " /" : "/";
	return { changes: { from, to, insert }, selection: EditorSelection.cursor(from + insert.length) };
}

// Each line's start, once, for the lines the selection touches.
function lineStarts(state) {
	const seen = new Set();
	for (const r of state.selection.ranges) {
		for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) seen.add(state.doc.line(n));
	}
	return [...seen];
}

// Task box on or off: "text" -> "- [ ] text", "- text" -> "- [ ] text", "- [ ] text" -> "text".
export function taskEdit(state) {
	return {
		changes: lineStarts(state).map((line) => {
			const m = line.text.match(/^(\s*)(?:([-*+]) (\[[ xX]\] )?)?/);
			const indent = m[1].length;
			if (m[3]) return { from: line.from + indent, to: line.from + m[0].length, insert: "" };
			if (m[2]) return { from: line.from + m[0].length, insert: "[ ] " };
			return { from: line.from + indent, insert: "- [ ] " };
		}),
	};
}

// Heading level, cycling: none -> # -> ## -> ### -> none.
export function headingEdit(state) {
	return {
		changes: lineStarts(state).map((line) => {
			const m = line.text.match(/^(#{1,6}) /);
			const level = m ? m[1].length : 0;
			const next = level >= 3 ? "" : "#".repeat(level + 1) + " ";
			return { from: line.from, to: line.from + (m ? m[0].length : 0), insert: next };
		}),
	};
}

// [[]] with the cursor inside (or around the selected text).
export function wikiEdit(state) {
	const { from, to } = state.selection.main;
	const text = state.sliceDoc(from, to);
	return { changes: { from, to, insert: `[[${text}]]` }, selection: EditorSelection.cursor(from + 2 + text.length) };
}

// Line-level templates go on their own line when the cursor is mid-text.
const BLOCK = /^(#|- |1\. |> |```|\||---)/;
const escape = (t) => t.replace(/[{}]/g, "\\$&");

// A slash-menu command's template, applied at the cursor: selected text goes
// where the cursor would land (so Bold wraps it), and a block starts a new
// line unless the cursor is at the start of one.
export function commandSnippet(state, template) {
	const { from, to } = state.selection.main;
	const line = state.doc.lineAt(from);
	const selected = state.sliceDoc(from, to);
	let t = selected && !selected.includes("\n") ? template.replace("${}", escape(selected) + "${}") : template;
	if (BLOCK.test(template) && state.sliceDoc(line.from, from).trim()) t = "\n" + t;
	return { template: t, from, to };
}

function runCommand(view, c) {
	if (c.run) return c.run(view);
	const raw = typeof c.template === "function" ? c.template() : c.template;
	const { template, from, to } = commandSnippet(view.state, raw);
	snippet(template)(view, { label: c.label }, from, to);
}

// Short names for the bar; anything not listed shows its menu label.
const SHORT = {
	"Heading 1": "H1", "Heading 2": "H2", "Heading 3": "H3", "Bullet list": "• List", "Numbered list": "1. List",
	"Code block": "Code", "Divider": "―", "Inline code": "`code`", "Add property": "Property",
	"Bold": "B", "Italic": "I", "Strikethrough": "S", "Add row below": "+ Row", "Add column after": "+ Col",
	"Delete row": "− Row", "Delete column": "− Col", "Format table": "Tidy",
};
const QUICK_DUPES = new Set(["Task", "Wikilink"]);

const BUTTONS = [
	["/", "Formatting menu", (view) => { view.dispatch(slashEdit(view.state), { userEvent: "input.type" }); startCompletion(view); }],
	["☐", "Task box", (view) => view.dispatch(taskEdit(view.state), { userEvent: "input" })],
	["H", "Heading level", (view) => view.dispatch(headingEdit(view.state), { userEvent: "input" })],
	["[[", "Link to a note", (view) => { view.dispatch(wikiEdit(view.state), { userEvent: "input" }); startCompletion(view); }],
	["↶", "Undo", (view) => undo(view)],
];

export function setupKeyboardBar(app, getView) {
	const touch = matchMedia("(pointer: coarse)");
	const vv = window.visualViewport;
	if (!vv) return;
	const bar = document.createElement("div");
	bar.id = "kbbar";
	bar.hidden = true;
	bar.setAttribute("role", "toolbar");
	bar.setAttribute("aria-label", "Formatting");
	const all = [
		...BUTTONS.map(([label, name, run]) => ({ label, name, run })),
		...COMMANDS.filter((c) => !QUICK_DUPES.has(c.label)).map((c) => ({
			label: SHORT[c.label] || c.label, name: c.label, table: c.table, run: (view) => runCommand(view, c),
			cls: { Bold: "b", Italic: "i", Strikethrough: "s" }[c.label],
		})),
	];
	const tableButtons = [];
	for (const [i, { label, name, run, table, cls }] of all.entries()) {
		const b = document.createElement("button");
		b.type = "button";
		b.textContent = label;
		b.setAttribute("aria-label", name);
		if (cls) b.classList.add(cls);
		if (i === BUTTONS.length - 1) b.classList.add("kb-last-quick");
		if (table) tableButtons.push(b);
		b.addEventListener("mousedown", (e) => e.preventDefault());
		// Touches don't take focus from the editor; a touch that scrolled the bar isn't a tap.
		let startX = 0;
		b.addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; }, { passive: true });
		b.addEventListener("touchend", (e) => {
			e.preventDefault();
			if (Math.abs(e.changedTouches[0].clientX - startX) < 10) act();
		});
		b.addEventListener("click", act);
		function act() {
			const view = getView();
			if (!view || view.state.readOnly) return;
			run(view);
			view.focus();
		}
		bar.append(b);
	}
	app.append(bar);

	// Table commands only while the cursor is in a table.
	let wasTable = null;
	const refresh = () => {
		const view = getView();
		const t = !!view && inTable(view.state);
		if (t === wasTable) return;
		wasTable = t;
		for (const b of tableButtons) b.hidden = !t;
	};

	const place = () => {
		const view = getView();
		// The keyboard is up when the visible area is well short of the window.
		const keyboard = window.innerHeight - vv.height > 120;
		const show = touch.matches && keyboard && !!view?.hasFocus && !view.state.readOnly;
		bar.hidden = !show;
		app.classList.toggle("kb-open", show);
		refresh();
		if (show) bar.style.top = `${vv.offsetTop + vv.height - bar.offsetHeight}px`;
	};
	vv.addEventListener("resize", place);
	vv.addEventListener("scroll", place);
	document.addEventListener("focusin", place);
	document.addEventListener("focusout", () => setTimeout(place, 50));
	return () => { refresh(); place(); };
}
