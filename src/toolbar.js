// The formatting toolbar above the note (a setting, on unless turned off;
// wide screens only, since phones have the keyboard bar, src/kbbar.js). Each
// button does what its hotkey or slash command does, so the note gets the
// same markdown either way. Buttons act on mousedown with the default
// prevented, so the editor keeps its selection.

import { undo, redo } from "@codemirror/commands";
import { EDIT_ACTIONS } from "./hotkeys.js";
import { COMMANDS } from "./slash.js";
import { runCommand, headingEdit } from "./kbbar.js";
import { choosePictures } from "./paste.js";
import { underline, colorMenu, alignMenu } from "./format.js";

const cmd = (label) => (view) => runCommand(view, COMMANDS.find((c) => c.label === label));
const lines = (fn) => (view) => view.dispatch(fn(view.state), { userEvent: "input", scrollIntoView: true });

// A list prefix on or off for every line the selection touches.
export function listEdit(state, kind) {
	const seen = new Set();
	const lines = [];
	for (const r of state.selection.ranges) {
		for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
			if (!seen.has(n)) { seen.add(n); lines.push(state.doc.line(n)); }
		}
	}
	const PREFIX = { bullet: /^(\s*)[-*+] (?!\[[ xX]\] )/, number: /^(\s*)\d+[.)] /, quote: /^(\s*)> ?/ };
	const all = lines.every((l) => PREFIX[kind].test(l.text));
	let i = 0;
	return {
		changes: lines.map((l) => {
			const m = l.text.match(PREFIX[kind]);
			if (all) return { from: l.from + m[1].length, to: l.from + m[0].length, insert: "" };
			// Swap another list's marker for this one.
			const other = l.text.match(/^(\s*)(?:[-*+] (?:\[[ xX]\] )?|\d+[.)] |> ?)/);
			const indent = l.text.match(/^\s*/)[0].length;
			const insert = kind === "bullet" ? "- " : kind === "number" ? `${++i}. ` : "> ";
			return { from: l.from + indent, to: other ? l.from + other[0].length : l.from + indent, insert };
		}),
	};
}

const ICON = {
	undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
	redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
	link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
	image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
	bullet: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
	number: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4h1.5v4M4 8h3"/><path d="M4 14.5a1.5 1.5 0 0 1 3 0c0 1-3 2.5-3 3.5h3"/>',
	task: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8 12 3 3 5-6"/>',
	quote: '<path d="M4 7h16M8 12h12M8 17h12M4 12v5"/>',
	table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 10h17M3.5 15h17M9.5 4.5v15M15 4.5v15"/>',
	book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v15H6.5a2.5 2.5 0 0 0 0 5H20"/><path d="M9 7h7"/>',
	align: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
	print: '<path d="M6 9V3h12v6"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
};

// [label, title, text or icon, action]; null draws a divider.
const BUTTONS = [
	["Undo", "Undo (Ctrl/Cmd+Z)", "undo", undo],
	["Redo", "Redo (Ctrl/Cmd+Shift+Z)", "redo", redo],
	null,
	["Heading", "Heading level: none, 1, 2, 3", "H", lines(headingEdit)],
	["Bold", "Bold (Ctrl/Cmd+B)", "B", EDIT_ACTIONS.Bold],
	["Italic", "Italic (Ctrl/Cmd+I)", "I", EDIT_ACTIONS.Italic],
	["Strikethrough", "Strikethrough", "S", EDIT_ACTIONS.Strikethrough],
	["Highlight", "Highlight", "ab", EDIT_ACTIONS.Highlight],
	["Underline", "Underline", "U", underline],
	["Text color", "Text color", "A", colorMenu],
	["Align", "Align left, center, right or justify", "align", alignMenu],
	null,
	["Link", "Link (Ctrl/Cmd+K)", "link", EDIT_ACTIONS.Link],
	["Picture", "Add a picture (or paste or drop one)", "image", choosePictures],
	["Table", "Table", "table", cmd("Table")],
	null,
	["Bulleted list", "Bulleted list", "bullet", lines((s) => listEdit(s, "bullet"))],
	["Numbered list", "Numbered list", "number", lines((s) => listEdit(s, "number"))],
	["Checklist", "Checklist (Ctrl/Cmd+Enter)", "task", EDIT_ACTIONS.Task],
	["Quote", "Quote", "quote", lines((s) => listEdit(s, "quote"))],
];

// bar: the element to fill. getView: the editor now. print: opens Export.
export function setupToolbar(bar, getView, { print, lookUp } = {}) {
	bar.setAttribute("role", "toolbar");
	bar.setAttribute("aria-label", "Formatting");
	const all = [...BUTTONS, null, ["Look up", "Look up the word in the dictionary and thesaurus", "book", (view) => lookUp?.(view)], ["Print or export", "Print or export this note (PDF, Word, HTML)", "print", () => print?.()]];
	for (const b of all) {
		if (!b) { bar.append(Object.assign(document.createElement("span"), { className: "tb-sep" })); continue; }
		const [label, title, face, run] = b;
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "quiet tb-" + label.toLowerCase().replace(/\W+/g, "-");
		btn.title = title;
		btn.setAttribute("aria-label", label);
		if (ICON[face]) btn.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[face]}</svg>`;
		else btn.textContent = face;
		btn.addEventListener("mousedown", (e) => e.preventDefault());
		btn.addEventListener("click", () => {
			const view = getView();
			if (!view || (view.state.readOnly && label !== "Print or export")) return;
			run(view, btn);
			view.focus();
		});
		bar.append(btn);
	}
}
