// Word-processor typing help, each a setting (on unless turned off):
//  - Spellcheck: the browser's own, which CodeMirror turns off by default.
//  - Smart punctuation: " and ' become curly quotes as you type, -- between
//    words an em dash, and ... an ellipsis. Never in code, the properties,
//    [[links]], link addresses or HTML tags, so nothing that has to stay plain
//    text is touched. Backspace right after a change puts the typed characters
//    back, as in Word and Docs.

import { StateField, StateEffect, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { stripFrontmatter } from "./count.js";

let spell = true;
let smart = true;
const refresh = StateEffect.define();

export const spellcheckOn = () => spell;
export const smartOn = () => smart;

export function setSpellcheck(view, on) {
	spell = !!on;
	view?.dispatch({ effects: refresh.of(null) });
}
export function setSmartPunctuation(on) {
	smart = !!on;
}

// Read on every update, so a change of setting shows at once.
export const spellcheck = EditorView.contentAttributes.of(() => (spell ? { spellcheck: "true" } : { spellcheck: "false" }));

const CODE = /^(FencedCode|CodeBlock|InlineCode|CodeText|HTMLBlock|HTMLTag|CommentBlock|URL|Autolink|Frontmatter|FrontmatterContent)$/;

// Whether text typed at pos must stay exactly as typed.
export function plainAt(state, pos) {
	const doc = state.sliceDoc();
	if (pos < doc.length - stripFrontmatter(doc).length) return true;
	for (let n = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (CODE.test(n.name)) return true;
	const line = state.doc.lineAt(pos);
	const before = line.text.slice(0, pos - line.from);
	if (/^\s*(```|~~~)/.test(line.text)) return true;
	if ((before.match(/`/g) || []).length % 2) return true; // an inline code span still open
	if (before.lastIndexOf("[[") > before.lastIndexOf("]]")) return true; // [[Note's name]]
	if (before.lastIndexOf("](") > before.lastIndexOf(")")) return true; // [text](address
	if (/<[a-zA-Z/!%][^>]*$/.test(before)) return true; // <span style="..."> and <% templater %>
	return false;
}

const OPENS = /[\s([{<“‘—–-]/;
const WORD = /[\p{L}\p{N}]/u;
const ENDS = /[\p{L}\p{N}”’.,!?)*_]/u; // how the word before " -- " can end

// The change typing text at [from, to) makes, if it's one smart punctuation
// can improve: {from, to, insert, typed}, where typed is what the user's
// keys would have left there. Else null.
export function smartEdit(state, from, to, text) {
	if (text.length !== 1 || from !== to) return null;
	const line = state.doc.lineAt(from);
	const before = line.text.slice(0, from - line.from);
	const prev = before.slice(-1);
	if (text === '"' || text === "'") {
		if (plainAt(state, from)) return null;
		const open = !prev || OPENS.test(prev);
		// An apostrophe after a letter (don't, it's) closes like a right quote.
		const insert = text === '"' ? (open ? "“" : "”") : (open ? "‘" : "’");
		return { from, to, insert, typed: text };
	}
	if (text === "." && before.endsWith("..") && !before.endsWith("...")) {
		const lead = before.slice(0, -2);
		if (!lead || !WORD.test(lead.slice(-1)) || plainAt(state, from)) return null;
		return { from: from - 2, to, insert: "…", typed: "..." };
	}
	// "word--x" or "word -- x": the dashes become one, once the next character shows they aren't a rule or a comment.
	if (text !== "-" && text !== ">" && before.endsWith("--") && !before.endsWith("---")) {
		const lead = before.slice(0, -2);
		const c = lead.slice(-1);
		if (!lead.trim() || !(WORD.test(c) || c === " ") || /^\s*\|/.test(line.text) || plainAt(state, from)) return null;
		if (c === " " && !ENDS.test(lead.trimEnd().slice(-1))) return null;
		return { from: from - 2, to, insert: "—" + text, typed: "--" + text };
	}
	return null;
}

// The last smart change, so Backspace right after it can undo it.
const setLast = StateEffect.define();
const lastSmart = StateField.define({
	create: () => null,
	update(v, tr) {
		for (const e of tr.effects) if (e.is(setLast)) return e.value;
		return tr.docChanged || tr.selection ? null : v;
	},
});

const input = EditorView.inputHandler.of((view, from, to, text) => {
	if (!smart || view.composing || view.state.readOnly) return false;
	const e = smartEdit(view.state, from, to, text);
	if (!e) return false;
	const end = e.from + e.insert.length;
	view.dispatch({
		changes: { from: e.from, to: e.to, insert: e.insert },
		selection: { anchor: end },
		effects: setLast.of({ from: e.from, to: end, typed: e.typed }),
		userEvent: "input.type",
		scrollIntoView: true,
	});
	return true;
});

const backspace = Prec.high(keymap.of([{
	key: "Backspace",
	run(view) {
		const last = view.state.field(lastSmart, false);
		const sel = view.state.selection.main;
		if (!last || !sel.empty || sel.head !== last.to) return false;
		view.dispatch({
			changes: { from: last.from, to: last.to, insert: last.typed },
			selection: { anchor: last.from + last.typed.length },
			userEvent: "delete.backward",
		});
		return true;
	},
}]));

export const smartPunctuation = [lastSmart, input, backspace];
