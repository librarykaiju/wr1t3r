// Block styling for source mode: what the slash menu inserts gets drawn like
// the thing it is, while the markdown stays visible and byte-for-byte as typed.
// Task boxes become real checkboxes (clicking one flips the [ ] / [x] in the
// text), callouts and quotes get a boxed container, code blocks a shaded one,
// and dividers a rule. Only decorations: nothing here rewrites the note except
// the checkbox click.

import { EditorView, ViewPlugin, Decoration, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

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

// "> [!warning]- Title" -> { type: "warning", color: "orange", fold: "-" }. Unknown types look like notes.
const CALLOUT = /^\s*>\s*\[!([\w-]+)\]([+-]?)/;
export function calloutOf(lineText) {
	const m = lineText.match(CALLOUT);
	if (!m) return null;
	const type = m[1].toLowerCase();
	return { type, color: CALLOUT_COLOR[type] || "blue", fold: m[2] };
}

// The edit that flips the task box whose "[" is at pos, or null if there isn't one.
export function toggleTask(state, pos) {
	const box = state.sliceDoc(pos, pos + 3);
	if (!/^\[[ xX]\]$/.test(box)) return null;
	return { from: pos + 1, to: pos + 2, insert: box[1] === " " ? "x" : " " };
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

const line = (cls) => Decoration.line({ class: cls });
const doneText = Decoration.mark({ class: "md-task-done" });
const calloutHead = Decoration.mark({ class: "md-callout-title" });

function build(view) {
	const { state } = view;
	const doc = state.doc;
	const lines = new Map(); // line start -> class names, merged so nested blocks don't fight
	const marks = []; // [from, to, decoration]
	const addLine = (from, to, cls) => {
		for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last; n++) {
			const at = doc.line(n).from;
			const pos = n === doc.lineAt(from).number ? " md-first" : "";
			const end = n === last ? " md-last" : "";
			lines.set(at, (lines.get(at) ? lines.get(at) + " " : "") + cls + pos + end);
		}
	};

	for (const { from, to } of view.visibleRanges) {
		syntaxTree(state).iterate({
			from, to,
			enter(node) {
				switch (node.name) {
				case "Blockquote": {
					if (node.node.parent?.name === "Blockquote") return; // inner quote: the outer box covers it
					const first = doc.lineAt(node.from);
					const c = calloutOf(first.text);
					if (c) {
						addLine(node.from, node.to, `md-callout md-co-${c.color}`);
						const tag = first.text.indexOf("[!");
						marks.push([first.from + tag, first.to, calloutHead]);
					} else {
						addLine(node.from, node.to, "md-bq");
					}
					return;
				}
				case "FencedCode":
				case "CodeBlock":
					addLine(node.from, node.to, "md-codeblock");
					return false;
				case "HorizontalRule":
					addLine(node.from, node.from, "md-hr");
					return false;
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

// Task boxes that are replaced by a checkbox, so the cursor steps over "[ ]" in one go.
function boxes(set) {
	const b = new RangeSetBuilder();
	set.between(0, Infinity, (from, to, value) => { if (value.spec.widget) b.add(from, to, value); });
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
