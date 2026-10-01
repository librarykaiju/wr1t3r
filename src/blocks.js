// Block styling for source mode: what the slash menu inserts gets drawn like
// the thing it is, while the markdown stays visible and byte-for-byte as typed.
// Task boxes become real checkboxes (clicking one flips the [ ] / [x] in the
// text), callouts and quotes get a boxed container, code blocks a shaded one,
// and dividers a rule. Quote markers (">") are hidden, with the box's darker
// left edge in their place, and a callout's "[!type]" becomes its icon. The
// styling stays while editing; Backspace just after an icon removes the tag. Only decorations: nothing here rewrites the note
// except the checkbox click.

import { EditorView, ViewPlugin, Decoration, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { doneStampChanges } from "./tasks.js";
import { snippet } from "@codemirror/autocomplete";
import { openPalette } from "./palette.js";

// Obsidian's callout types and aliases, grouped by the color Obsidian gives them.
const CALLOUT_GROUPS = {
	blue: "note info todo",
	cyan: "abstract summary tldr tip hint important",
	green: "success check done",
	yellow: "question help faq",
	orange: "warning caution attention",
	red: "failure fail missing danger error bug",
	purple: "example",
	gray: "quote cite",
};
const CALLOUT_COLOR = Object.fromEntries(
	Object.entries(CALLOUT_GROUPS).flatMap(([color, names]) => names.split(" ").map((n) => [n, color])),
);

// Icons per type, from Lucide (lucide.dev, ISC license), as SVG path data.
const CIRCLE = "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20";
const ICON_PATHS = {
	pencil: ["M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"],
	clipboard: ["M9 2h6v4H9z", "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2", "M12 11h4", "M12 16h4", "M8 11h.01", "M8 16h.01"],
	info: [CIRCLE, "M12 16v-4", "M12 8h.01"],
	todo: [CIRCLE, "m9 12 2 2 4-4"],
	flame: ["M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"],
	check: ["M20 6 9 17l-5-5"],
	help: [CIRCLE, "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"],
	alert: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"],
	x: ["M18 6 6 18", "m6 6 12 12"],
	zap: ["M13 2 3 14h9l-1 8 10-12h-9l1-8z"],
	bug: ["M8 10a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0z", "M12 20v-9", "M4 13h4", "M16 13h4", "M5 20l3-2", "M19 20l-3-2", "M9 6 7 4", "M15 6l2-2"],
	list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
	quote: ["M3 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h3c0 3-1 5-4 5z", "M15 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h3c0 3-1 5-4 5z"],
};
const ICON_GROUPS = {
	pencil: "note", clipboard: "abstract summary tldr", info: "info", todo: "todo",
	flame: "tip hint important", check: "success check done", help: "question help faq",
	alert: "warning caution attention", x: "failure fail missing", zap: "danger error",
	bug: "bug", list: "example", quote: "quote cite",
};
const CALLOUT_ICON = Object.fromEntries(
	Object.entries(ICON_GROUPS).flatMap(([icon, names]) => names.split(" ").map((n) => [n, icon])),
);

// The callout picker (the "Callout" slash command and "Insert callout" in
// the palette): one row per kind, its aliases as the detail; picking one
// puts "> [!kind] Title" at the cursor, or around the selected lines.
export const CALLOUT_KINDS = Object.entries(ICON_GROUPS).map(([, names]) => {
	const [kind, ...aliases] = names.split(" ");
	return { kind, aliases };
});
export function pickCallout(view) {
	const sel = view.state.selection.main;
	openPalette({
		placeholder: "Callout type…",
		items: CALLOUT_KINDS.map(({ kind, aliases }) => ({
			label: kind[0].toUpperCase() + kind.slice(1),
			detail: aliases.join(", "),
			keywords: [kind, ...aliases, CALLOUT_COLOR[kind]].join(" "),
			run: () => {
				view.focus();
				const doc = view.state.doc;
				if (!sel.empty) {
					const first = doc.lineAt(sel.from), last = doc.lineAt(sel.to);
					const body = doc.sliceString(first.from, last.to).split("\n").map((l) => "> " + l).join("\n");
					const text = `> [!${kind}]\n${body}`;
					view.dispatch({ changes: { from: first.from, to: last.to, insert: text }, selection: { anchor: first.from + 5 + kind.length }, scrollIntoView: true });
					return;
				}
				const line = doc.lineAt(sel.head);
				const lead = line.text.trim() && sel.head > line.from ? "\n" : "";
				snippet(`${lead}> [!${kind}] \${title}\n> \${}`)(view, null, sel.head, sel.head);
			},
		})),
	});
}

// "> [!warning]- Title" -> { type: "warning", color: "orange", icon: "alert", fold: "-",
// tag: [start, end) of "[!warning]- " in the line, title: "Title" }. Unknown types look like notes.
const CALLOUT = /^(\s*>\s*)(\[!([\w-]+)\]([+-]?) ?)(.*)$/;
export function calloutOf(lineText) {
	const m = lineText.match(CALLOUT);
	if (!m) return null;
	const type = m[3].toLowerCase();
	const start = m[1].length;
	return {
		type, color: CALLOUT_COLOR[type] || "blue", icon: CALLOUT_ICON[type] || "pencil", fold: m[4],
		tag: [start, start + m[2].length], title: m[5].trim(),
	};
}

// The edits that flip the task box whose "[" is at pos (with the Tasks plugin's
// "✅ date" added or taken off), or null if there isn't one.
export function toggleTask(state, pos, date = new Date()) {
	const box = state.sliceDoc(pos, pos + 3);
	if (!/^\[[ xX]\]$/.test(box)) return null;
	const flip = { from: pos + 1, to: pos + 2, insert: box[1] === " " ? "x" : " " };
	const line = state.doc.lineAt(pos);
	return [flip, ...doneStampChanges(line.text, line.from, box[1] === " ", date)];
}

class CheckboxWidget extends WidgetType {
	constructor(checked) { super(); this.checked = checked; }
	eq(other) { return other.checked === this.checked; }
	toDOM() {
		const box = document.createElement("input");
		box.type = "checkbox";
		box.className = "md-task-box";
		box.checked = this.checked;
		box.setAttribute("aria-label", this.checked ? "Done task" : "Task");
		return box;
	}
	ignoreEvent() { return false; }
}

const SVG = "http://www.w3.org/2000/svg";
class CalloutIconWidget extends WidgetType {
	// label: the type's name, shown when the callout has no title (as Obsidian does).
	constructor(icon, label) { super(); this.icon = icon; this.label = label; }
	eq(other) { return other.icon === this.icon && other.label === this.label; }
	toDOM() {
		const wrap = document.createElement("span");
		wrap.className = "md-callout-icon";
		const svg = document.createElementNS(SVG, "svg");
		for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
		for (const d of ICON_PATHS[this.icon]) {
			const p = document.createElementNS(SVG, "path");
			p.setAttribute("d", d);
			svg.append(p);
		}
		wrap.append(svg);
		if (this.label) wrap.append(this.label);
		return wrap;
	}
}

// A list's "-", "*" or "+" drawn as a dot, in its depth's color. The text keeps its marker.
class BulletWidget extends WidgetType {
	constructor(depth) { super(); this.depth = depth; }
	eq(o) { return o.depth === this.depth; }
	toDOM() {
		const s = document.createElement("span");
		s.className = `md-bullet md-bullet-${this.depth} md-dot`;
		s.textContent = "•";
		return s;
	}
}
const dots = Array.from({ length: 7 }, (_, i) => Decoration.replace({ widget: new BulletWidget(i), atomic: true }));

const hide = Decoration.replace({ atomic: true });
const line = (cls) => Decoration.line({ class: cls });
const doneText = Decoration.mark({ class: "md-task-done" });
const calloutHead = Decoration.mark({ class: "md-callout-title" });
const bullet = Array.from({ length: 7 }, (_, i) => Decoration.mark({ class: `md-bullet md-bullet-${i}` }));

function build(view) {
	const { state } = view;
	const doc = state.doc;
	const lines = new Map(); // line start -> class names, merged so nested blocks don't fight
	const marks = []; // [from, to, decoration]
	const addLine = (from, to, cls, ends = true) => {
		for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last; n++) {
			const at = doc.line(n).from;
			const pos = ends && n === doc.lineAt(from).number ? " md-first" : "";
			const end = ends && n === last ? " md-last" : "";
			lines.set(at, (lines.get(at) ? lines.get(at) + " " : "") + cls + pos + end);
		}
	};

	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from, to,
			enter(node) {
				switch (node.name) {
				case "Blockquote": {
					if (node.node.parent?.name === "Blockquote" || node.node.parent?.parent?.name === "Blockquote") {
						addLine(node.from, node.to, "md-nested", false); // inner quote: a second edge inside the outer box
						return;
					}
					const first = doc.lineAt(node.from);
					const c = calloutOf(first.text);
					if (c) {
						addLine(node.from, node.to, `md-callout md-co-${c.color}`);
						const label = c.title ? "" : c.type[0].toUpperCase() + c.type.slice(1);
						marks.push([first.from + c.tag[0], first.from + c.tag[1], Decoration.replace({ widget: new CalloutIconWidget(c.icon, label), atomic: true })]);
						if (first.from + c.tag[1] < first.to) marks.push([first.from + c.tag[1], first.to, calloutHead]);
					} else {
						addLine(node.from, node.to, "md-bq");
					}
					return;
				}
				case "QuoteMark": {
					// Always hidden; the box's darker left edge stands in for it. Backspace
					// at the start of a line still deletes it.
					const space = state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0;
					marks.push([node.from, node.to + space, hide]);
					return false;
				}
				case "FencedCode":
				case "CodeBlock":
					addLine(node.from, node.to, "md-codeblock");
					return false;
				case "HorizontalRule":
					addLine(node.from, node.from, "md-hr");
					return false;
				case "ListMark": {
					// Bullets and numbers take the theme's rainbow by depth.
					let depth = -1;
					for (let p = node.node.parent; p; p = p.parent) if (p.name === "BulletList" || p.name === "OrderedList") depth++;
					if (depth < 0) return false;
					// The list's own indent: the typed spaces give way to a step per level
					// (style.css), and wrapped lines hang under the text.
					const ln = doc.lineAt(node.from);
					const lead = state.sliceDoc(ln.from, node.from);
					if (/^[ \t]*$/.test(lead)) {
						addLine(ln.from, ln.from, `md-li md-li-${Math.min(depth, 6)}`, false);
						if (lead) marks.push([ln.from, node.from, hide]);
					}
					if (node.node.parent?.parent?.name !== "BulletList") { marks.push([node.from, node.to, bullet[depth % 7]]); return false; }
					// A task's checkbox stands in for its bullet; other bullets are dots.
					const after = state.sliceDoc(node.to, node.to + 5);
					if (/^\s\[[^\]\n]\]/.test(after)) marks.push([node.from, node.to + 1, hide]);
					else marks.push([node.from, node.to, dots[depth % 7]]);
					return false;
				}
				case "TaskMarker": {
					const checked = /x/i.test(state.sliceDoc(node.from, node.to));
					marks.push([node.from, node.to, Decoration.replace({ widget: new CheckboxWidget(checked) })]);
					if (checked) {
						const rest = doc.lineAt(node.from);
						const start = node.to + (rest.text.slice(node.to - rest.from).length - rest.text.slice(node.to - rest.from).trimStart().length);
						if (rest.to > start) marks.push([start, rest.to, doneText]);
					}
					return false;
				}
				}
			},
		});
	}

	// Line decorations first at each position, then marks, all in document order.
	const all = [
		...[...lines].map(([at, cls]) => [at, at, line(cls)]),
		...marks,
	].sort((a, b) => a[0] - b[0] || (a[0] === a[1] ? -1 : 0) - (b[0] === b[1] ? -1 : 0));
	const builder = new RangeSetBuilder();
	for (const [f, t, d] of all) builder.add(f, t, d);
	return builder.finish();
}

// Replaced ranges (task boxes, hidden markers, callout icons), so the cursor steps over them in one go.
function boxes(set) {
	const b = new RangeSetBuilder();
	set.between(0, Infinity, (from, to, value) => { if (value.spec.widget || value.spec.atomic) b.add(from, to, value); });
	return b.finish();
}

export const blockStyle = ViewPlugin.define((view) => ({
	decorations: build(view),
	update(u) {
		if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view);
	},
}), {
	decorations: (v) => v.decorations,
	provide: (plugin) => EditorView.atomicRanges.of((view) => boxes(view.plugin(plugin)?.decorations || Decoration.none)),
	eventHandlers: {
		mousedown(e, view) {
			if (!e.target.classList?.contains("md-task-box")) return false;
			e.preventDefault(); // keep the cursor where it was
			if (view.state.readOnly) return true;
			const change = toggleTask(view.state, view.posAtDOM(e.target));
			if (change) view.dispatch({ changes: change, userEvent: "input.toggle" });
			view.focus(); // so Ctrl+Z undoes the click
			return true;
		},
		click(e) {
			// The mousedown already flipped the text; the redraw sets the box.
			if (e.target.classList?.contains("md-task-box")) e.preventDefault();
		},
	},
});
