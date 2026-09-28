// A one-tap bar above the phone keyboard (web apps can't add keys to the
// keyboard itself): / opens the formatting menu, then a task box, heading
// level, [[link]] and undo. Shown only on touch screens while the keyboard
// is up. Buttons act on mousedown with the default prevented, so the editor
// keeps focus and the keyboard stays open.

import { EditorSelection } from "@codemirror/state";
import { startCompletion } from "@codemirror/autocomplete";
import { undo } from "@codemirror/commands";

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

const BUTTONS = [
	["/", "Formatting menu", (view) => { view.dispatch(slashEdit(view.state), { userEvent: "input.type" }); startCompletion(view); }],
	["☐", "Task box", (view) => view.dispatch(taskEdit(view.state), { userEvent: "input" })],
	["H", "Heading level", (view) => view.dispatch(headingEdit(view.state), { userEvent: "input" })],
	["[[", "Link to a note", (view) => view.dispatch(wikiEdit(view.state), { userEvent: "input" })],
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
	for (const [label, name, run] of BUTTONS) {
		const b = document.createElement("button");
		b.type = "button";
		b.textContent = label;
		b.setAttribute("aria-label", name);
		b.addEventListener("mousedown", (e) => e.preventDefault());
		b.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
		b.addEventListener("touchend", (e) => { e.preventDefault(); act(); });
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

	const place = () => {
		const view = getView();
		// The keyboard is up when the visible area is well short of the window.
		const keyboard = window.innerHeight - vv.height > 120;
		const show = touch.matches && keyboard && !!view?.hasFocus && !view.state.readOnly;
		bar.hidden = !show;
		app.classList.toggle("kb-open", show);
		if (show) bar.style.top = `${vv.offsetTop + vv.height - bar.offsetHeight}px`;
	};
	vv.addEventListener("resize", place);
	vv.addEventListener("scroll", place);
	document.addEventListener("focusin", place);
	document.addEventListener("focusout", () => setTimeout(place, 50));
	return place;
}
