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
import { dataviewJs } from "./dataview.js";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { backlinks } from "./backlinks.js";
import { linkSource } from "./linkcomplete.js";
import { tableKeymap, tableStyle } from "./table.js";
import { blockStyle } from "./blocks.js";
import { dueDates } from "./due.js";
import { frontmatterStyle, tagHue, foldProperties } from "./frontmatter.js";
import { linkClicks, linkOpener } from "./links.js";
import { tableGrid } from "./tablegrid.js";
import { tableCalc } from "./tablecalc.js";
import { calloutFolds } from "./callouts.js";
import { webImages } from "./images.js";
import { prettyProperties } from "./pretty.js";
import { embeds, embedLook } from "./embeds.js";
import { livePreview } from "./livepreview.js";
import { bases } from "./basesview.js";
import { spellcheck, smartPunctuation } from "./writing.js";
import { pasteAndDrop } from "./paste.js";
import { manuscriptLayout } from "./manuscriptview.js";

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

// #tags in the body, as pills colored like the same tag in the properties.
const hashtags = (() => {
	const deco = new MatchDecorator({
		regexp: /(?<=^|\s)#[\p{L}_][\p{L}\p{N}_\/-]*/gu,
		decoration: (m) => Decoration.mark({ class: `md-hashtag md-tag-${tagHue(m[0].slice(1))}` }),
	});
	return ViewPlugin.define((view) => ({
		decorations: deco.createDeco(view),
		update(u) { this.decorations = deco.updateDeco(u, this.decorations); },
	}), { decorations: (v) => v.decorations });
})();

// Obsidian comments: %% like this %%, on one line or across several. Shown
// dimmed, since Obsidian and the site leave them out.
const commentMark = Decoration.mark({ class: "md-comment" });
export function commentRanges(text) {
	const out = [];
	for (const m of text.matchAll(/%%[\s\S]*?%%/g)) out.push([m.index, m.index + m[0].length]);
	return out;
}
const comments = ViewPlugin.define((view) => {
	const build = (state) => {
		const text = state.sliceDoc();
		if (!text.includes("%%")) return Decoration.none;
		return Decoration.set(commentRanges(text).map(([f, t]) => commentMark.range(f, t)));
	};
	return {
		decorations: build(view.state),
		update(u) { if (u.docChanged) this.decorations = build(u.state); },
	};
}, { decorations: (v) => v.decorations });

// Whether the cursor is on the first visual line (dir -1) or the last (dir 1).
function atEdge(view, dir) {
	const { state } = view, sel = state.selection.main;
	if (!sel.empty) return false;
	if (sel.head === (dir < 0 ? 0 : state.doc.length)) return true;
	const here = view.coordsAtPos(sel.head), end = view.coordsAtPos(dir < 0 ? 0 : state.doc.length);
	return !!here && !!end && Math.abs(here.top - end.top) < 2;
}

function lineSeparatorFor(text) {
	// Only when every line break is CRLF; mixed files fall back to LF once edited.
	return text.includes("\r\n") && !/(^|[^\r])\n/.test(text) ? "\r\n" : undefined;
}

export function createEditor(parent, { onChange, onUpdate, onLink, vault }) {
	let current = null; // path shown
	const states = new Map(); // path -> EditorState, so undo history survives switching notes

	// How markdown is drawn: shared by the editor, embedded notes' boxes and
	// the reference pane (which follows links with its own handler).
	const lookFor = (follow) => [
		EditorView.lineWrapping,
		tableStyle,
		blockStyle,
		dueDates,
		yamlFrontmatter({ content: markdown({ base: markdownLanguage }) }),
		syntaxHighlighting(style),
		marks(/\[\[[^\]\n]+\]\]/g, "md-wikilink"),
		marks(/==[^=\n]+==/g, "md-highlight"),
		marks(/\[\^[^\]\s]+\](?!:)/g, "md-footnote md-fn-ref"), // [^1] in the text
		marks(/^\[\^[^\]\s]+\]:/gm, "md-footnote"), // its definition
		marks(/\^\[[^\]\n]*\]/g, "md-footnote md-inline-note"), // ^[inline footnote]
		marks(/(?<=\s)\^[A-Za-z0-9-]+$/gm, "md-blockid"), // "... ^block-id" at a line's end
		marks(/<\/?[a-zA-Z][\w-]*(?:\s[^<>\n]*)?\/?>/g, "md-html"), // raw HTML tags
		hashtags,
		comments,
		linkClicks((link) => follow?.(link)),
		linkOpener.of((link) => follow?.(link)),
		tableGrid,
		calloutFolds,
		webImages,
		prettyProperties,
		livePreview,
		bases,
		...(vault ? [vaultHost.of(vault)] : []),
	];
	const look = lookFor(onLink);

	// Editing, shared by the editor and Scrivenings' sections.
	const core = [
		history(),
		drawSelection(),
		highlightSelectionMatches(),
		indentUnit.of("\t"),
		Prec.high(keymap.of(tableKeymap)),
		tableCalc,
		frontmatterStyle,
		look,
		embedLook.of(() => look),
		embeds,
		dataviewJs,
		spellcheck,
		smartPunctuation,
		pasteAndDrop,
		manuscriptLayout,
		autocompletion({ override: [slashSource(), linkSource], icons: false, activateOnTyping: true }),
		keymap.of([...completionKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
	];

	const base = [
		...core,
		highlightActiveLine(),
		backlinks,
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
		// The cursor starts just below the frontmatter, so typing right away can't break it.
		const fmEnd = note.binary ? 0 : text.length - stripFrontmatter(text).length;
		const head = text.slice(0, fmEnd);
		const start = head.length - (head.match(/\r\n/g) || []).length; // CodeMirror counts a CRLF as one position
		return EditorState.create({
			selection: { anchor: start },
			doc: note.binary ? "This note isn't valid UTF-8 text, so wr1t3r shows it read-only to keep its bytes intact." : text,
			extensions: [...base, notePath.of(note.path), ...(sep ? [EditorState.lineSeparator.of(sep)] : []), EditorState.readOnly.of(!!note.binary)],
		});
	}

	return {
		view,
		// A read-only view of notes in parent (the reference pane). Links in it
		// go to follow(link); its embeds work as in the editor.
		reader(parent, follow) {
			const ro = lookFor(follow);
			const make = (note) => EditorState.create({
				doc: note ? note.text : "",
				extensions: [ro, frontmatterStyle, embedLook.of(() => ro), embeds, EditorState.readOnly.of(true), EditorView.editable.of(false), ...(note ? [notePath.of(note.path)] : [])],
			});
			const rv = new EditorView({ parent, state: make(null) });
			let shown = null;
			return {
				view: rv,
				get path() { return shown; },
				show(note) {
					if (note && shown === note.path && rv.state.sliceDoc() === note.text) return;
					const same = note && shown === note.path;
					const top = rv.scrollDOM.scrollTop;
					shown = note?.path ?? null;
					rv.setState(make(note && !note.binary ? note : null));
					if (same) rv.scrollDOM.scrollTop = top;
					else rv.scrollDOM.scrollTop = 0;
				},
				refresh() { rv.dispatch({ effects: vaultChanged.of(null) }); },
			};
		},
		// One note of a folder shown as one long document (Scrivenings): an
		// editor that grows with its text instead of scrolling, with its
		// properties folded. edits(text) gets every change; edge(dir, view)
		// is asked about arrow keys past the first or last line (true: handled).
		section(parent, note, { edits, focus, edge }) {
			const arrows = Prec.high(keymap.of([
				{ key: "ArrowUp", run: (v) => atEdge(v, -1) && !!edge?.(-1, v) },
				{ key: "ArrowDown", run: (v) => atEdge(v, 1) && !!edge?.(1, v) },
			]));
			const make = (n) => {
				const sep = lineSeparatorFor(n.text);
				return EditorState.create({
					doc: n.text,
					extensions: [...core, arrows, notePath.of(n.path), ...(sep ? [EditorState.lineSeparator.of(sep)] : []),
						EditorView.updateListener.of((u) => {
							if (u.focusChanged && u.view.hasFocus) focus?.(u.view);
							if (!u.docChanged || u.transactions.some((tr) => tr.annotation(fromSync))) return;
							edits(u.state.sliceDoc());
						})],
				});
			};
			const sv = new EditorView({ parent, state: make(note) });
			foldProperties(sv);
			return {
				view: sv,
				text: () => sv.state.sliceDoc(),
				// A newer version from a sync (only when this device has no unsent edits to it).
				replace(n) {
					if (sv.state.sliceDoc() === n.text) return;
					if (lineSeparatorFor(n.text) !== (sv.state.lineBreak === "\r\n" ? "\r\n" : undefined)) { sv.setState(make(n)); foldProperties(sv); return; }
					sv.dispatch({ changes: { from: 0, to: sv.state.doc.length, insert: n.text }, annotations: [fromSync.of(true), Transaction.addToHistory.of(false)] });
				},
				destroy: () => sv.destroy(),
			};
		},
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
