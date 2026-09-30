// The manuscript layout in the editor (see src/manuscript.js): the editor gets
// the class ms-layout while the note asks for it, and every line of a top-level
// paragraph gets ms-para, which the stylesheet double-spaces and indents.

import { RangeSetBuilder } from "@codemirror/state";
import { EditorView, ViewPlugin, Decoration } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { isManuscript } from "./manuscript.js";

// Only the properties at the top matter, so only the start of the note is read.
const on = (state) => {
	const head = state.sliceDoc(0, Math.min(state.doc.length, 4000));
	return head.startsWith("---") && isManuscript(head);
};

const para = Decoration.line({ class: "ms-para" });

function build(view) {
	const b = new RangeSetBuilder();
	if (!on(view.state)) return b.finish();
	const { doc } = view.state;
	let last = -1;
	for (const { from, to } of view.visibleRanges) {
		syntaxTree(view.state).iterate({
			from, to,
			enter(node) {
				if (node.name === "Document") return;
				if (node.name === "Paragraph" && node.node.parent?.name === "Document") {
					for (let n = doc.lineAt(node.from).number, end = doc.lineAt(node.to).number; n <= end; n++) {
						const line = doc.line(n), at = line.from;
						if (/^\[\^[^\]]+\]:/.test(line.text)) continue; // a footnote's text
						if (at > last) { b.add(at, at, para); last = at; }
					}
				}
				return false;
			},
		});
	}
	return b.finish();
}

export const manuscriptLayout = [
	EditorView.editorAttributes.compute(["doc"], (state) => (on(state) ? { class: "ms-layout" } : {})),
	ViewPlugin.define((view) => ({
		decorations: build(view),
		update(u) {
			if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view);
		},
	}), { decorations: (v) => v.decorations }),
];
