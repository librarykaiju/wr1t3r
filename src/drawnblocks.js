// The planner, task list and board blocks stay drawn: the cursor steps over
// them and typing, pasting or deleting can't reach into them (a Backspace
// just under one does nothing). Their own buttons edit them, and their </>
// button opens one as text on purpose: it stays text until the cursor
// leaves it.

import { StateField, StateEffect, EditorState } from "@codemirror/state";
import { EditorView, Decoration } from "@codemirror/view";
import { dataviewBlocks } from "./dataview.js";

export const DRAWN_FENCES = ["wr1t3r-planner", "wr1t3r-tasks", "board", "base"];

// Opens the block starting at pos as text.
export const openBlock = StateEffect.define();

// Starts of the blocks opened as text (kept in place through edits).
const opened = StateField.define({
	create: () => [],
	update(list, tr) {
		let next = tr.docChanged ? list.map((p) => tr.changes.mapPos(p)) : list;
		for (const e of tr.effects) if (e.is(openBlock) && !next.includes(e.value)) next = [...next, e.value];
		if (next.length && (tr.selection || tr.docChanged)) {
			// Closed again once the cursor is outside it.
			const blocks = dataviewBlocks(tr.state, DRAWN_FENCES);
			const sel = tr.state.selection.ranges;
			next = next.filter((p) => {
				const b = blocks.find((x) => x.from === p);
				return b && sel.some((r) => r.to >= b.from && r.from <= b.to);
			});
		}
		return next.length === list.length && next.every((p, i) => p === list[i]) ? list : next;
	},
});

// Whether a block (from dataviewBlocks) is open as text.
export const isOpen = (state, blk) => (state.field(opened, false) || []).includes(blk.from);

// The drawn blocks of these fences: [{ from, to }].
function drawn(state, fences = DRAWN_FENCES) {
	return dataviewBlocks(state, fences).filter((b) => !isOpen(state, b));
}

// Typing, pasting, dropping and deleting that would change a drawn block are
// dropped. The blocks' own edits (their buttons) carry other user events.
const TYPING = ["input.type", "input.paste", "input.drop", "input.complete", "delete", "move"];
const guard = EditorState.transactionFilter.of((tr) => {
	if (!tr.docChanged || !TYPING.some((e) => tr.isUserEvent(e))) return tr;
	const blocks = drawn(tr.startState);
	if (!blocks.length) return tr;
	const doc = tr.startState.doc;
	const blankAt = (pos) => pos >= 0 && pos <= doc.length && !doc.lineAt(pos).text.trim();
	let hit = false;
	tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		const text = inserted.toString();
		for (const b of blocks) {
			// Taking out a blank line just above or below it is fine: the
			// fences stay on lines of their own.
			if (toA === b.from && fromA === b.from - 1 && blankAt(fromA)) continue;
			if (fromA === b.to && toA === b.to + 1 && blankAt(toA)) continue;
			// Deleting into it, or the line breaks on either side of it (which
			// would glue a line onto a fence and undo the block).
			if (toA > fromA && fromA < b.to + 1 && toA > b.from - 1) hit = true;
			// Typing inside it, or onto a fence's line (a new line is fine).
			if (toA === fromA && fromA > b.from && fromA < b.to) hit = true;
			if (toA === fromA && fromA === b.from && !text.endsWith("\n")) hit = true;
			if (toA === fromA && fromA === b.to && !text.startsWith("\n")) hit = true;
		}
	});
	return hit ? [] : tr;
});

// The cursor steps over drawn blocks in one go.
const atomic = EditorView.atomicRanges.of((view) => {
	const blocks = drawn(view.state);
	return Decoration.set(blocks.map((b) => Decoration.mark({}).range(b.from, b.to)).filter((r) => r.from < r.to), true);
});

// Opens the block that holds pos as text, with the cursor on its first line
// of settings (the </> buttons).
export function openAsText(view, pos) {
	const blk = dataviewBlocks(view.state, DRAWN_FENCES).find((b) => pos >= b.from && pos <= b.to);
	if (!blk) return false;
	const line = view.state.doc.lineAt(blk.from);
	view.dispatch({ effects: openBlock.of(blk.from), selection: { anchor: Math.min(line.to + 1, view.state.doc.length) }, scrollIntoView: true });
	view.focus();
	return true;
}

export const drawnBlocks = [opened, guard, atomic];
