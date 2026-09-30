// Footnotes, as Obsidian's "Insert footnote" does them: the next free number
// goes in the text as [^n] and its definition "[^n]: ..." goes at the bottom
// of the note, after any footnotes already there. A small box by the cursor
// takes the footnote's text; Enter places it, Escape cancels. With the box
// left empty, Enter still places the footnote and moves the cursor to its
// definition to type there.

import { EditorSelection } from "@codemirror/state";

const LABEL = /\[\^(\d+)\]/g;
const DEF = /^\[\^[^\]\s]+\]:/;

// One more than the highest numbered footnote in the text, in the text or in
// a definition; [^named] ones don't count.
export function nextFootnote(text) {
	let max = 0;
	for (const m of text.matchAll(LABEL)) max = Math.max(max, Number(m[1]));
	return max + 1;
}

// Whether the note's last paragraph is a footnote definition (or a line
// continuing one), so a new definition joins that block instead of starting
// its own.
function endsWithFootnotes(lines) {
	for (let i = lines.length - 1; i >= 0; i--) {
		const l = lines[i];
		if (!l.trim()) continue;
		if (DEF.test(l)) return true;
		if (!/^( {2,}|\t)/.test(l)) return false; // an indented line continues the one above
	}
	return false;
}

// The edit that inserts footnote n with this text: the marker after the
// selection, the definition at the end, before any trailing blank lines so the
// file keeps its ending. The cursor stays after the marker, or goes to the
// definition when there's no text.
export function footnoteEdit(state, text = "", n = nextFootnote(state.doc.toString())) {
	const doc = state.doc.toString();
	const at = state.selection.main.to;
	const marker = `[^${n}]`;
	const body = doc.replace(/(?:\n[ \t]*)+$/, "");
	const end = body.length;
	// The marker goes in before the end when the cursor is in the trailing blank lines.
	const markerAt = Math.min(at, end);
	const withMarker = body.slice(0, markerAt) + marker + body.slice(markerAt);
	const sep = !withMarker.trim() ? "" : endsWithFootnotes(withMarker.split("\n")) ? "\n" : "\n\n";
	const def = `${sep}[^${n}]: ${text.replace(/\s*\n\s*/g, " ").trim()}`;
	const changes = [{ from: markerAt, insert: marker }, { from: end, insert: def }];
	const defEnd = end + marker.length + def.length;
	const anchor = text.trim() ? markerAt + marker.length : defEnd;
	return { changes, selection: EditorSelection.cursor(anchor), scrollIntoView: true, userEvent: "input" };
}

let open = null;

// The command (slash menu, toolbar, palette, keyboard bar): asks for the
// footnote's text next to the cursor.
export function insertFootnote(view) {
	if (view.state.readOnly) return false;
	open?.close();
	const n = nextFootnote(view.state.doc.toString());
	const box = document.createElement("div");
	box.className = "footnote-box";
	box.setAttribute("role", "dialog");
	box.setAttribute("aria-label", `Footnote ${n}`);
	const label = document.createElement("label");
	label.textContent = `Footnote ${n}`;
	const input = document.createElement("input");
	input.type = "text";
	input.placeholder = "Footnote text, then Enter";
	input.setAttribute("aria-label", `Text of footnote ${n}`);
	label.append(input);
	box.append(label);

	const head = view.state.selection.main.to;
	const c = view.coordsAtPos(head) || view.dom.getBoundingClientRect();
	const vw = document.documentElement.clientWidth;
	box.style.top = `${Math.round(c.bottom + 6)}px`;
	box.style.left = `${Math.round(Math.max(8, Math.min(c.left, vw - 328)))}px`;
	document.body.append(box);

	const close = (restore = true) => {
		if (open !== self) return;
		open = null;
		box.remove();
		document.removeEventListener("pointerdown", outside, true);
		if (restore) view.focus();
	};
	const self = { close };
	const outside = (e) => { if (!box.contains(e.target)) close(false); };
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.isComposing) {
			e.preventDefault();
			const text = input.value;
			close();
			view.dispatch(footnoteEdit(view.state, text, nextFootnote(view.state.doc.toString())));
		} else if (e.key === "Escape") {
			e.preventDefault();
			close();
		}
	});
	document.addEventListener("pointerdown", outside, true);
	open = self;
	input.focus();
	return true;
}
