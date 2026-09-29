// Hotkeys: Obsidian's defaults (Ctrl/Cmd+B bold, +I italic, +K link, +Enter to
// cycle a checkbox, +] / +[ indent, +O, +P, +Shift+F ...), which anyone can
// change on their device under Settings > Hotkeys. This file has the editing
// actions and the key handling; main.js has the commands and runs the keys.

import { EditorSelection } from "@codemirror/state";
import { indentMore, indentLess } from "@codemirror/commands";

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

const edit = (fn) => (view) => {
	if (view.state.readOnly) return false;
	view.dispatch(view.state.update(fn(view.state), { scrollIntoView: true, userEvent: "input" }));
	return true;
};

// Editing actions the hotkeys run, by the command label they stand in for.
export const EDIT_ACTIONS = {
	"Bold": edit((s) => toggleMark(s, "**")),
	"Italic": edit((s) => toggleMark(s, "*")),
	"Strikethrough": edit((s) => toggleMark(s, "~~")),
	"Highlight": edit((s) => toggleMark(s, "==")),
	"Inline code": edit((s) => toggleMark(s, "`")),
	"Link": edit(insertLink),
	"Task": edit(cycleCheckbox),
	"Indent": (view) => indentMore(view),
	"Outdent": (view) => indentLess(view),
};

// Obsidian's defaults, by command label. Keys are written the way
// CodeMirror writes them: modifiers (Mod, Ctrl, Alt, Shift), then the key.
export const DEFAULT_KEYS = {
	"Open a note": "Mod-o",
	"Run a command": "Mod-p",
	"Search notes": "Mod-Shift-f",
	"Find in note": "Mod-f",
	"Toggle Live Preview": "Mod-e",
	"Settings": "Mod-,",
	"Sync now": "Mod-s",
	"Bold": "Mod-b",
	"Italic": "Mod-i",
	"Link": "Mod-k",
	"Task": "Mod-Enter",
	"Indent": "Mod-]",
	"Outdent": "Mod-[",
};

// Punctuation by physical key, so Shift doesn't turn "[" into "{".
const CODES = {
	BracketLeft: "[", BracketRight: "]", Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
	Semicolon: ";", Quote: "'", Minus: "-", Equal: "=", Backquote: "`", Space: "Space",
};
const MODS = new Set(["Control", "Meta", "Alt", "Shift", "OS", "AltGraph", "CapsLock"]);

// A keydown as a key name ("Mod-Shift-f"), or null for a lone modifier. On a
// Mac, Cmd is Mod and Control stays Ctrl; elsewhere Control is Mod.
export function keyName(e, mac) {
	if (MODS.has(e.key)) return null;
	let key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase()
		: /^Digit\d$/.test(e.code) ? e.code.slice(5)
		: CODES[e.code] || (e.key.length === 1 ? e.key.toLowerCase() : e.key);
	const mods = [];
	if (mac ? e.metaKey : e.ctrlKey) mods.push("Mod");
	if (mac && e.ctrlKey) mods.push("Ctrl");
	if (e.altKey) mods.push("Alt");
	if (e.shiftKey) mods.push("Shift");
	return [...mods, key].join("-");
}

// A key name as people read it: "Ctrl+Shift+F", or "⌘⇧F" on a Mac.
export function showKey(name, mac) {
	if (!name) return "";
	const parts = name.split("-");
	// "Mod--" is Mod and the minus key.
	const key = name.endsWith("--") ? "-" : parts.pop();
	const mods = name.endsWith("--") ? parts.slice(0, -2) : parts;
	const label = key.length === 1 ? key.toUpperCase() : key === "ArrowUp" ? "↑" : key === "ArrowDown" ? "↓" : key === "ArrowLeft" ? "←" : key === "ArrowRight" ? "→" : key;
	const names = mac ? { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" } : { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
	return mac ? mods.map((m) => names[m]).join("") + label : [...mods.map((m) => names[m]), label].join("+");
}

// Whether a key can be a hotkey: it needs Ctrl/Cmd or Alt, unless it's F1-F12.
export function usableKey(name) {
	return !!name && (/(^|-)(Mod|Ctrl|Alt)-/.test(name) || /(^|-)F\d{1,2}$/.test(name));
}

// The key for each command: the defaults with this device's changes on top
// (a change of "" removes the key). Returns { byLabel, byKey }.
export function bindings(changes = {}, defaults = DEFAULT_KEYS) {
	const byLabel = { ...defaults };
	for (const [label, key] of Object.entries(changes)) {
		if (key) byLabel[label] = key;
		else delete byLabel[label];
	}
	const byKey = new Map();
	for (const [label, key] of Object.entries(byLabel)) if (!byKey.has(key)) byKey.set(key, label);
	return { byLabel, byKey };
}

// Changes after giving label the key (null resets it to its default). A
// command that had that key loses it, so no key does two things.
export function rebind(changes, label, key, defaults = DEFAULT_KEYS) {
	const next = { ...changes };
	if (key === null) key = defaults[label] || "";
	next[label] = key;
	if (key) {
		const { byLabel } = bindings(next, defaults);
		for (const [other, k] of Object.entries(byLabel)) {
			if (other !== label && k === key) next[other] = "";
		}
	}
	// Tidy: a change that matches the default isn't a change.
	for (const [l, k] of Object.entries(next)) if ((defaults[l] || "") === k) delete next[l];
	return next;
}
