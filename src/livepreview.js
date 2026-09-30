// Live Preview (a setting, off by default): markdown symbols are hidden on
// every line except the ones the cursor is on, as in Obsidian's Live Preview.
// **bold** shows as bold, [text](url) as the link text, [[Note|alias]] as
// "alias", [^1] as a raised 1, ## as a heading, `code` as code, ==marks== as a highlight. Moving
// onto a line shows its markdown again, so it's still edited as typed. Code
// blocks, tables and the properties box are left as they are. Nothing here
// changes the note.

import { StateEffect } from "@codemirror/state";
import { EditorView, ViewPlugin, Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

let enabled = false;
const refresh = StateEffect.define();

export function livePreviewOn() { return enabled; }

// Turns it on or off; view is redrawn right away.
export function setLivePreview(view, on) {
	enabled = !!on;
	view?.dispatch({ effects: refresh.of(null) });
}

const SKIP = /^(FencedCode|CodeBlock|Table|HTMLBlock|CommentBlock|Frontmatter|FrontmatterContent)$/;
const INLINE = /(\[\[)([^\[\]\n|]+\|)?[^\[\]\n]+?(\]\])|(==)[^=\n]+?(==)|(\[\^)[^\]\s]+\](?!:)/g;

// The spans to hide in [from, to) of state, skipping lines in cursorLines
// (a Set of line numbers): [[from, to]], sorted.
export function hiddenRanges(state, from, to, cursorLines = new Set()) {
	const out = [];
	const doc = state.doc;
	const visible = (pos) => !cursorLines.has(doc.lineAt(pos).number);
	const code = [];
	syntaxTree(state).iterate({
		from, to,
		enter(n) {
			if (SKIP.test(n.name)) { code.push([n.from, n.to]); return false; }
			if (n.name === "InlineCode") code.push([n.from, n.to]);
			if (n.name === "Image") return false;
			if (!visible(n.from)) return;
			const parent = n.node.parent?.name || "";
			if (n.name === "HeaderMark" && parent.startsWith("ATXHeading")) {
				// "## " at the start; a closing "##" too.
				const line = doc.lineAt(n.from);
				let end = n.to;
				while (end < line.to && /[ \t]/.test(doc.sliceString(end, end + 1))) end++;
				if (n.from === line.from || n.from > line.from && !doc.sliceString(line.from, n.from).trim()) out.push([n.from, end]);
				else { let start = n.from; while (start > line.from && /[ \t]/.test(doc.sliceString(start - 1, start))) start--; out.push([start, n.to]); }
			} else if (n.name === "EmphasisMark" || n.name === "StrikethroughMark" || (n.name === "CodeMark" && parent === "InlineCode")) {
				out.push([n.from, n.to]);
			} else if (n.name === "Link") {
				const url = n.node.getChild("URL");
				const marks = n.node.getChildren("LinkMark");
				if (!url || marks.length < 3 || state.sliceDoc(n.from, n.from + 2) === "[^") return false;
				if (doc.lineAt(n.from).number !== doc.lineAt(n.to).number) return false;
				out.push([n.from, n.from + 1], [marks[1].from, n.to]); // "[" and "](url)"
			}
		},
	});
	const inCode = (a, b) => code.some(([f, t]) => a < t && b > f);
	for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last; n++) {
		if (cursorLines.has(n)) continue;
		const line = doc.line(n);
		if (!line.text.includes("[[") && !line.text.includes("==") && !line.text.includes("[^")) continue;
		for (const m of line.text.matchAll(INLINE)) {
			const a = line.from + m.index, b = a + m[0].length;
			if (inCode(a, b) || (m[1] && line.text[m.index - 1] === "!")) continue; // ![[embeds]] are drawn elsewhere
			if (m[6]) out.push([a, a + 2], [b - 1, b]); // [^1] -> 1, drawn raised
			else if (m[1]) out.push([a, a + 2 + (m[2] ? m[2].length : 0)], [b - 2, b]);
			else out.push([a, a + 2], [b - 2, b]);
		}
	}
	return out.filter(([a, b]) => b > a && !out.some(([c, d]) => (c < a && d >= b) || (c <= a && d > b))).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

const hide = Decoration.replace({});

function build(view) {
	if (!enabled) return Decoration.none;
	const cursor = new Set();
	if (view.state.facet(EditorView.editable)) {
		for (const r of view.state.selection.ranges) {
			for (let n = view.state.doc.lineAt(r.from).number, last = view.state.doc.lineAt(r.to).number; n <= last; n++) cursor.add(n);
		}
	}
	const all = [];
	for (const { from, to } of view.visibleRanges) {
		for (const [a, b] of hiddenRanges(view.state, from, to, cursor)) if (!all.length || a >= all[all.length - 1][1]) all.push([a, b]);
	}
	return Decoration.set(all.map(([a, b]) => hide.range(a, b)));
}

export const livePreview = ViewPlugin.fromClass(class {
	constructor(view) { this.decorations = build(view); }
	update(u) {
		if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state) || u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))) {
			this.decorations = build(u.view);
		}
	}
}, { decorations: (v) => v.decorations });
