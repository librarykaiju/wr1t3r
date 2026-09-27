// The editor: CodeMirror 6 in source mode. Saving never reformats anything;
// the text written back is exactly what's in the editor, with the note's own
// line endings (CRLF notes stay CRLF).

import { EditorState, Transaction, Annotation, Prec } from "@codemirror/state";
import {
	EditorView, keymap, drawSelection, highlightActiveLine, placeholder,
	MatchDecorator, ViewPlugin, Decoration,
} from "@codemirror/view";
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { syntaxHighlighting, HighlightStyle, indentUnit } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { tags as t } from "@lezer/highlight";
import { slashSource } from "./slash.js";
import { stripFrontmatter } from "./count.js";
import { tableKeymap, tableStyle } from "./table.js";

const fromSync = Annotation.define();

const style = HighlightStyle.define([
	{ tag: t.heading1, class: "md-h1" },
	{ tag: t.heading2, class: "md-h2" },
	{ tag: [t.heading3, t.heading4, t.heading5, t.heading6], class: "md-h3" },
	{ tag: t.strong, fontWeight: "700" },
	{ tag: t.emphasis, fontStyle: "italic" },
	{ tag: t.strikethrough, textDecoration: "line-through" },
	{ tag: [t.link, t.url], class: "md-link" },
	{ tag: t.monospace, class: "md-code" },
	{ tag: t.quote, class: "md-quote" },
	{ tag: [t.processingInstruction, t.meta, t.contentSeparator], class: "md-mark" },
	{ tag: [t.propertyName, t.definition(t.propertyName)], class: "md-key" },
	{ tag: [t.string, t.number, t.bool], class: "md-value" },
	{ tag: t.comment, class: "md-mark" },
]);

// Obsidian bits the markdown grammar doesn't know: [[wikilinks]], ==highlights==,
// and footnotes ([^1], and "[^1]:" definitions).
function marks(re, cls) {
	const deco = new MatchDecorator({ regexp: re, decoration: Decoration.mark({ class: cls }) });
	return ViewPlugin.define((view) => ({
		decorations: deco.createDeco(view),
		update(u) { this.decorations = deco.updateDeco(u, this.decorations); },
	}), { decorations: (v) => v.decorations });
}

function lineSeparatorFor(text) {
	// Only when every line break is CRLF; mixed files fall back to LF once edited.
	return text.includes("\r\n") && !/(^|[^\r])\n/.test(text) ? "\r\n" : undefined;
}

export function createEditor(parent, { onChange, onUpdate }) {
	let current = null; // path shown
	const states = new Map(); // path -> EditorState, so undo history survives switching notes

	const base = [
		history(),
		drawSelection(),
		highlightActiveLine(),
		highlightSelectionMatches(),
		EditorView.lineWrapping,
		indentUnit.of("\t"),
		Prec.high(keymap.of(tableKeymap)),
		tableStyle,
		yamlFrontmatter({ content: markdown({ base: markdownLanguage }) }),
		syntaxHighlighting(style),
		marks(/\[\[[^\]\n]+\]\]/g, "md-wikilink"),
		marks(/==[^=\n]+==/g, "md-highlight"),
		marks(/\[\^[^\]\s]+\]:?/g, "md-footnote"),
		autocompletion({ override: [slashSource()], icons: false, activateOnTyping: true }),
		keymap.of([...completionKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
		placeholder("Type / for formatting"),
		EditorView.updateListener.of((u) => {
			if (u.docChanged || u.selectionSet) onUpdate?.();
			if (!u.docChanged || !current) return;
			if (u.transactions.some((tr) => tr.annotation(fromSync))) return;
			onChange(current, u.state.sliceDoc());
		}),
	];

	const view = new EditorView({ parent, state: EditorState.create({ extensions: [...base, EditorState.readOnly.of(true)] }) });

	function makeState(note) {
		const text = note.binary ? "" : note.text;
		const sep = note.binary ? undefined : lineSeparatorFor(text);
		return EditorState.create({
			doc: note.binary ? "This note isn't valid UTF-8 text, so wr1t3r shows it read-only to keep its bytes intact." : text,
			extensions: [...base, ...(sep ? [EditorState.lineSeparator.of(sep)] : []), EditorState.readOnly.of(!!note.binary)],
		});
	}

	return {
		view,
		get path() { return current; },
		open(note) {
			if (current) states.set(current, view.state);
			current = note?.path ?? null;
			if (!note) {
				view.setState(EditorState.create({ extensions: [...base, EditorState.readOnly.of(true)] }));
				return;
			}
			const kept = states.get(note.path);
			view.setState(kept && !note.binary && kept.sliceDoc() === note.text ? kept : makeState(note));
			view.focus();
		},
		// A sync brought a new version of the open note (only ever when it had no
		// unsent local edits). Swap the text without firing onChange.
		replace(note) {
			if (note.path !== current || note.binary) return this.open(note);
			const text = note.text;
			if (view.state.sliceDoc() === text) return;
			if (lineSeparatorFor(text) !== (view.state.lineBreak === "\r\n" ? "\r\n" : undefined)) {
				view.setState(makeState(note));
				return;
			}
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: text },
				annotations: [fromSync.of(true), Transaction.addToHistory.of(false)],
			});
		},
		forget(path) {
			states.delete(path);
		},
		text() {
			return view.state.sliceDoc();
		},
		// A line of text at the cursor, as if typed there: on its own line, and
		// never inside the frontmatter (a cursor that hasn't moved sits at the
		// very top, which would push the frontmatter down and break it).
		insert(line) {
			const { state } = view;
			const doc = state.sliceDoc();
			const fmEnd = doc.length - stripFrontmatter(doc).length;
			let { from, to } = state.selection.main;
			if (from < fmEnd) from = to = fmEnd;
			const nl = state.lineBreak;
			const insert = state.doc.lineAt(from).from === from ? line + nl : nl + line;
			view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
			view.focus();
		},
		selected() {
			const { state } = view;
			return state.selection.ranges.filter((r) => !r.empty).map((r) => state.sliceDoc(r.from, r.to)).join("\n");
		},
	};
}
