// Track changes in the editor (the markup itself is src/trackchanges.js).
// Insertions show underlined in green, deletions struck through in red, and
// the CriticMarkup around them is hidden (the cursor steps over it). While
// tracking is on, typing, pasting and deleting are rewritten as tracked
// changes; formatting commands, ticking boxes and other edits aren't. Right-
// click a change to accept or reject it.

import { EditorState, StateField, StateEffect, Annotation, Transaction, EditorSelection, RangeSetBuilder } from "@codemirror/state";
import { EditorView, ViewPlugin, Decoration, WidgetType } from "@codemirror/view";
import { changesIn, resolveChange, resolveAll, trackEdit, changeAt, commentEdit } from "./trackchanges.js";
import { menu } from "./basesui.js";

const setTrackingEffect = StateEffect.define();
const setFinalEffect = StateEffect.define();
const tracked = Annotation.define();

// Whether this note's edits are being tracked.
export const trackingField = StateField.define({
	create: () => false,
	update: (v, tr) => { for (const e of tr.effects) if (e.is(setTrackingEffect)) v = e.value; return v; },
});
// "Final" view: deletions hidden and insertions plain, as the text will read.
const finalField = StateField.define({
	create: () => false,
	update: (v, tr) => { for (const e of tr.effects) if (e.is(setFinalEffect)) v = e.value; return v; },
	provide: (f) => EditorView.editorAttributes.from(f, (on) => (on ? { class: "tc-final" } : {})),
});

export const isTracking = (view) => !!view?.state.field(trackingField, false);
export const isFinalView = (view) => !!view?.state.field(finalField, false);
export function setTracking(view, on) { if (view) view.dispatch({ effects: setTrackingEffect.of(!!on) }); }
export function setFinalView(view, on) { if (view) view.dispatch({ effects: setFinalEffect.of(!!on) }); }

// Typing, pasting, dropping and deleting, rewritten as tracked changes.
const filter = EditorState.transactionFilter.of((tr) => {
	if (!tr.docChanged || tr.annotation(tracked) || !tr.startState.field(trackingField, false)) return tr;
	if (!(tr.isUserEvent("input.type") || tr.isUserEvent("input.paste") || tr.isUserEvent("input.drop") || tr.isUserEvent("delete"))) return tr;
	if (tr.startState.selection.ranges.length > 1) return tr;
	const parts = [];
	tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => parts.push({ fromA, toA, fromB, toB, text: inserted.toString() }));
	if (parts.length !== 1) return tr;
	const [c] = parts;
	const head = tr.newSelection.main.head;
	const cursor = head >= c.fromB && head <= c.toB ? head - c.fromB : null;
	const doc = tr.startState.doc.toString();
	const backward = tr.isUserEvent("delete.backward") || tr.isUserEvent("delete.selection") || tr.isUserEvent("delete.cut");
	const r = trackEdit(doc, { from: c.fromA, to: c.toA, insert: c.text, backward, cursor });
	if (!r) return tr;
	const userEvent = tr.annotation(Transaction.userEvent);
	if (r.noop) return { selection: EditorSelection.cursor(r.cursor), scrollIntoView: true, userEvent: "select" };
	// Unchanged by tracking (typing inside an insertion): let the edit through
	// as it is, which keeps phone keyboards' word-in-progress intact.
	const plain = doc.slice(r.from, c.fromA) + c.text + doc.slice(c.toA, r.to);
	if (plain === r.insert && r.cursor === r.from + (c.fromA - r.from) + (cursor ?? c.text.length)) return tr;
	return { changes: { from: r.from, to: r.to, insert: r.insert }, selection: EditorSelection.cursor(r.cursor), annotations: tracked.of(true), userEvent, scrollIntoView: true };
});

class CommentWidget extends WidgetType {
	constructor(text) { super(); this.text = text; }
	eq(o) { return o.text === this.text; }
	toDOM() {
		const s = document.createElement("span");
		s.className = "tc-comment-icon";
		s.textContent = "💬";
		s.title = this.text || "(empty comment)";
		return s;
	}
	ignoreEvent() { return false; }
}

const hide = Decoration.replace({ atomic: true });
const ins = Decoration.mark({ class: "tc-ins" });
const del = Decoration.mark({ class: "tc-del" });
const marked = Decoration.mark({ class: "tc-mark" });
const commentText = Decoration.mark({ class: "tc-comment" });

function build(view) {
	const text = view.state.doc.toString();
	if (!/\{(\+\+|--|~~|==|>>)/.test(text)) return Decoration.none;
	const head = view.state.selection.main.head;
	const ranges = [];
	const add = (f, t, d) => { if (t > f || d.spec.widget) ranges.push([f, t, d]); };
	for (const c of changesIn(text)) {
		if (c.type === "ins" || c.type === "del") {
			add(c.from, c.from + 3, hide);
			add(c.from + 3, c.to - 3, c.type === "ins" ? ins : del);
			add(c.to - 3, c.to, hide);
		} else if (c.type === "sub") {
			const mid = c.from + 3 + c.old.length;
			add(c.from, c.from + 3, hide);
			add(c.from + 3, mid, del);
			add(mid, mid + 2, hide);
			add(mid + 2, c.to - 3, ins);
			add(c.to - 3, c.to, hide);
		} else if (c.type === "mark") {
			add(c.from, c.from + 3, hide);
			add(c.from + 3, c.to - 3, marked);
			add(c.to - 3, c.to, hide);
		} else if (head > c.from && head < c.to) {
			// A comment being edited shows its text between faint markers.
			add(c.from + 3, c.to - 3, commentText);
		} else ranges.push([c.from, c.to, Decoration.replace({ widget: new CommentWidget(c.text), atomic: true })]);
	}
	ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const b = new RangeSetBuilder();
	for (const [f, t, d] of ranges) b.add(f, t, d);
	return b.finish();
}

function atomic(set) {
	const b = new RangeSetBuilder();
	set.between(0, Infinity, (f, t, v) => { if (v.spec.atomic) b.add(f, t, v); });
	return b.finish();
}

const looks = ViewPlugin.define((view) => ({
	decorations: build(view),
	update(u) { if (u.docChanged || u.selectionSet) this.decorations = build(u.view); },
}), {
	decorations: (v) => v.decorations,
	provide: (p) => EditorView.atomicRanges.of((view) => atomic(view.plugin(p)?.decorations || Decoration.none)),
	eventHandlers: {
		contextmenu(e, view) {
			if (!e.target.closest?.(".tc-ins, .tc-del, .tc-comment-icon, .tc-mark") || view.state.readOnly) return false;
			e.preventDefault();
			const pos = view.posAtDOM(e.target);
			reviewMenu(view, e.clientX, e.clientY, pos);
			return true;
		},
	},
});

// ---- Reviewing --------------------------------------------------------------

function resolveAt(view, pos, accept) {
	const c = changeAt(view.state.doc.toString(), pos);
	if (!c) return false;
	view.dispatch({ changes: resolveChange(c, accept), userEvent: "input.review", annotations: tracked.of(true) });
	return true;
}
export const acceptChange = (view) => resolveAt(view, view.state.selection.main.head, true);
export const rejectChange = (view) => resolveAt(view, view.state.selection.main.head, false);

export function resolveEvery(view, accept) {
	const r = resolveAll(view.state.doc.toString(), accept);
	if (r.count) view.dispatch({ changes: r.changes, userEvent: "input.review", annotations: tracked.of(true) });
	return r.count;
}

// Moves to the next (dir 1) or previous (-1) change, wrapping around.
export function gotoChange(view, dir) {
	const list = changesIn(view.state.doc.toString()).filter((c) => c.type !== "mark");
	if (!list.length) return false;
	const at = view.state.selection.main.head;
	const c = dir > 0 ? list.find((x) => x.from > at) || list[0] : [...list].reverse().find((x) => x.to < at) || list.at(-1);
	view.dispatch({ selection: EditorSelection.cursor(c.from + 3), scrollIntoView: true });
	view.focus();
	return true;
}

export function addComment(view) {
	const { from, to } = view.state.selection.main;
	const r = commentEdit(view.state.doc.toString(), from, to);
	view.dispatch({ changes: { from: r.from, to: r.to, insert: r.insert }, selection: EditorSelection.cursor(r.cursor), annotations: tracked.of(true), userEvent: "input.comment", scrollIntoView: true });
	view.focus();
}

export function countChanges(view) {
	return changesIn(view.state.doc.toString()).filter((c) => c.type === "ins" || c.type === "del" || c.type === "sub").length;
}

function reviewMenu(view, x, y, pos) {
	const c = changeAt(view.state.doc.toString(), pos) || changesIn(view.state.doc.toString()).find((k) => pos >= k.from && pos <= k.to);
	const entries = [];
	if (c && c.type === "comment") entries.push(["Delete comment", () => view.dispatch({ changes: { from: c.from, to: c.to, insert: "" }, annotations: tracked.of(true), userEvent: "input.review" })], ["Edit comment", () => { view.dispatch({ selection: EditorSelection.cursor(c.from + 3) }); view.focus(); }]);
	else if (c && c.type === "mark") entries.push(["Remove highlight", () => view.dispatch({ changes: resolveChange(c, true), annotations: tracked.of(true), userEvent: "input.review" })]);
	else if (c) entries.push(["Accept change", () => resolveAt(view, pos, true)], ["Reject change", () => resolveAt(view, pos, false)]);
	entries.push(null, ["Accept all changes", () => resolveEvery(view, true)], ["Reject all changes", () => resolveEvery(view, false), "danger"]);
	menu(entries, x, y);
}

export const trackChanges = [trackingField, finalField, filter, looks];
