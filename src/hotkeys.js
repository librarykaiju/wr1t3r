// Obsidian's default editing hotkeys: Ctrl/Cmd+B bold, +I italic, +K link and
// +Enter to cycle a checkbox. (+] and +[ indent come with CodeMirror's own keys.)
// The app-wide ones (new note, search, settings) are in main.js.

import { EditorSelection } from "@codemirror/state";

// Wraps each selection in mark, or takes the mark off when it's already there
// (inside the selection or just around it). With nothing selected, the cursor
// lands between a new pair of marks.
export function toggleMark(state, mark) {
	const n = mark.length;
	const around = (from, to) => {
		if (state.sliceDoc(from - n, from) !== mark || state.sliceDoc(to, to + n) !== mark) return false;
		// "*" next to "**" is bold, not italic (unless it's ***both***).
		if (mark === "*") {
			const outer = state.sliceDoc(from - 2, from - 1) === "*" && state.sliceDoc(to + 1, to + 2) === "*";
			const triple = state.sliceDoc(from - 3, from - 2) === "*" && state.sliceDoc(to + 2, to + 3) === "*";
			if (outer && !triple) return false;
		}
		return true;
	};
	return state.changeByRange((r) => {
		const text = state.sliceDoc(r.from, r.to);
		if (!r.empty && text.length >= 2 * n && text.startsWith(mark) && text.endsWith(mark) && !(mark === "*" && text.startsWith("**") && !text.startsWith("***"))) {
			return {
				changes: [{ from: r.from, to: r.from + n }, { from: r.to - n, to: r.to }],
				range: EditorSelection.range(r.from, r.to - 2 * n),
			};
		}
		if (around(r.from, r.to)) {
			return {
				changes: [{ from: r.from - n, to: r.from }, { from: r.to, to: r.to + n }],
				range: EditorSelection.range(r.from - n, r.to - n),
			};
		}
		return {
			changes: [{ from: r.from, insert: mark }, { from: r.to, insert: mark }],
			range: EditorSelection.range(r.from + n, r.to + n),
		};
	});
}

// [text]() with the cursor in the (), or []() with it in the [].
export function insertLink(state) {
	return state.changeByRange((r) => {
		const text = state.sliceDoc(r.from, r.to);
		const at = text ? r.from + text.length + 3 : r.from + 1;
		return { changes: { from: r.from, to: r.to, insert: `[${text}]()` }, range: EditorSelection.cursor(at) };
	});
}

// Obsidian's "Toggle checkbox status": a plain line or bullet becomes "- [ ] ",
// an open box gets ticked, a ticked one is opened again.
export function cycleCheckbox(state) {
	const seen = new Set();
	const changes = [];
	for (const r of state.selection.ranges) {
		for (let n = state.doc.lineAt(r.from).number, last = state.doc.lineAt(r.to).number; n <= last; n++) {
			if (seen.has(n)) continue;
			seen.add(n);
			const line = state.doc.line(n);
			const m = line.text.match(/^(\s*(?:>\s*)*)(?:([-*+]|\d+[.)]) (?:\[([^\]])\] )?)?/);
			const lead = line.from + m[1].length;
			if (m[3] !== undefined) {
				const box = lead + m[2].length + 2; // the character inside [ ]
				changes.push({ from: box, to: box + 1, insert: m[3] === " " ? "x" : " " });
			} else if (m[2]) changes.push({ from: lead + m[2].length + 1, insert: "[ ] " });
			else changes.push({ from: lead, insert: "- [ ] " });
		}
	}
	return { changes };
}

const run = (edit) => (view) => {
	if (view.state.readOnly) return false;
	view.dispatch(view.state.update(edit(view.state), { scrollIntoView: true, userEvent: "input" }));
	return true;
};

export const hotkeys = [
	{ key: "Mod-b", run: run((s) => toggleMark(s, "**")) },
	{ key: "Mod-i", run: run((s) => toggleMark(s, "*")) },
	{ key: "Mod-k", run: run(insertLink) },
	{ key: "Mod-Enter", run: run(cycleCheckbox) },
];
