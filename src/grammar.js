// Grammar check: a setting (off unless turned on, since it sends text out)
// that has LanguageTool (worker/grammar.js) look over each paragraph you edit
// once you pause, and underlines what it finds. Clicking an underline shows
// the problem and its fixes; a fix replaces the words, Ignore drops it for the
// session. "Check grammar in this note" looks over every paragraph.
//
// Only prose is sent: code, the properties, tables and HTML blocks are
// skipped, and Markdown marks, links' addresses, tags and inline code are
// blanked out (same length, so offsets still line up).

import { StateField, StateEffect } from "@codemirror/state";
import { ViewPlugin, Decoration, EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { stripFrontmatter } from "./count.js";

let on = false;
let check = null; // (text) => Promise<{matches}>
let warn = () => {};
export const grammarOn = () => on;

export function setupGrammar(api, onWarn) {
	check = api;
	warn = onWarn || warn;
}

// Same-length copy of a paragraph's Markdown with everything that isn't
// prose turned into spaces.
export function prose(text) {
	const blank = (s) => s.replace(/[^\n]/g, " ");
	return text
		.replace(/`+[^`\n]*`+/g, blank)
		.replace(/%%[\s\S]*?%%/g, blank)
		.replace(/<[^>\n]+>/g, blank)
		.replace(/!?\[\[([^\]|\n]*\|)?([^\]\n]*)\]\]/g, (m, target, label) => " ".repeat(m.length - label.length - 2) + label + "  ")
		.replace(/!?\[([^\]\n]*)\]\(([^)\n]*)\)/g, (m, label) => " ".repeat(m.indexOf("[") + 1) + label + " ".repeat(m.length - m.indexOf("[") - 1 - label.length))
		.replace(/\[\^[^\]\n]*\]/g, blank)
		.replace(/\bhttps?:\/\/\S+/g, blank)
		.replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, (m, sp) => sp + " ".repeat(m.length - sp.length))
		.replace(/[ \t]\^[\w-]+$/gm, blank)
		.replace(/^[ \t]*(?:>[ \t]*)*(?:\[![\w-]+\][+-]?[ \t]*)?/gm, blank)
		.replace(/^[ \t]*(?:#{1,6}[ \t]+|(?:[-*+]|\d+[.)])[ \t]+(?:\[.\][ \t]+)?)/gm, blank)
		.replace(/(?<![\p{L}\p{N}])(\*{1,3}|_{1,3}|~~|==)(?=\S)|(?<=\S)(\*{1,3}|_{1,3}|~~|==)(?![\p{L}\p{N}])/gu, blank);
}

const SKIP = /^(FencedCode|CodeBlock|HTMLBlock|CommentBlock|Table|Frontmatter|FrontmatterContent)$/;

// The paragraph around pos as {from, to}, or null when it isn't prose.
export function paragraphRange(state, pos) {
	const { doc } = state;
	const line = doc.lineAt(pos);
	if (!line.text.trim()) return null;
	const body = state.doc.length - stripFrontmatter(state.sliceDoc()).length;
	if (line.from < body) return null;
	let a = line.number, b = a;
	while (a > 1 && doc.line(a - 1).text.trim() && doc.line(a - 1).from >= body) a--;
	while (b < doc.lines && doc.line(b + 1).text.trim()) b++;
	const from = doc.line(a).from, to = doc.line(b).to;
	if (/^\s*(\||```|~~~|\$\$|<)/.test(doc.line(a).text)) return null;
	for (let n = syntaxTree(state).resolveInner(from, 1); n; n = n.parent) if (SKIP.test(n.name)) return null;
	return { from, to };
}

// Underlines: marks carrying the problem in spec.problem.
const setMarks = StateEffect.define(); // {from, to, marks: [{from, to, problem}]}
const dropMark = StateEffect.define(); // {from, to}
const clearAll = StateEffect.define();
const markOf = (problem) => Decoration.mark({ class: "cm-grammar", problem, attributes: { title: problem.short || problem.message } });

export const grammarMarks = StateField.define({
	create: () => Decoration.none,
	update(set, tr) {
		set = set.map(tr.changes);
		if (tr.docChanged) {
			// Editing inside or next to an underline takes it off until the
			// paragraph is checked again.
			const touched = [];
			tr.changes.iterChangedRanges((a, b, fromB, toB) => touched.push([fromB, toB]));
			set = set.update({ filter: (f, t) => !touched.some(([x, y]) => f <= y && t >= x) });
		}
		for (const e of tr.effects) {
			if (e.is(clearAll)) set = Decoration.none;
			else if (e.is(dropMark)) set = set.update({ filter: (f, t) => !(f === e.value.from && t === e.value.to) });
			else if (e.is(setMarks)) {
				const { from, to, marks } = e.value;
				set = set.update({ filter: (f, t) => t < from || f > to, add: marks.map((m) => markOf(m.problem).range(m.from, m.to)), sort: true });
			}
		}
		return set;
	},
	provide: (f) => EditorView.decorations.from(f),
});

// Problems the person chose to ignore this session: rule + the words.
const ignored = new Set();
const ignoreKey = (problem, words) => problem.rule + "\u0000" + words;

// Requests are spaced out: the public server allows about 20 a minute.
const GAP = 3500;
const queue = [];
let busy = false, lastAt = 0, pausedUntil = 0;

function enqueue(view, range) {
	const text = view.state.sliceDoc(range.from, range.to);
	const i = queue.findIndex((q) => q.view === view && q.from === range.from);
	if (i >= 0) queue.splice(i, 1);
	queue.push({ view, from: range.from, to: range.to, text });
	pump();
}

async function pump() {
	if (busy || !queue.length) return;
	busy = true;
	const wait = Math.max(lastAt + GAP, pausedUntil) - Date.now();
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	const job = queue.shift();
	lastAt = Date.now();
	try {
		if (on && check && job && job.view.dom.isConnected && job.view.state.sliceDoc(job.from, job.to) === job.text) {
			const sent = prose(job.text);
			if (sent.trim()) {
				const { matches } = await check(sent);
				apply(job, matches || []);
			} else apply(job, []);
		}
	} catch (e) {
		if (e.status === 429) pausedUntil = Date.now() + 60000;
		if (job) warn(e);
	}
	busy = false;
	pump();
}

function apply(job, matches) {
	const { view, from, to, text } = job;
	if (!on || !view.dom.isConnected || view.state.sliceDoc(from, to) !== text) return;
	const marks = [];
	for (const m of matches) {
		const a = from + m.offset, b = a + m.length;
		if (b > to || !text.slice(m.offset, m.offset + m.length).trim()) continue;
		if (ignored.has(ignoreKey(m, text.slice(m.offset, m.offset + m.length)))) continue;
		marks.push({ from: a, to: b, problem: m });
	}
	view.dispatch({ effects: setMarks.of({ from, to, marks }) });
}

// Checks every prose paragraph of the note.
export function checkNote(view) {
	const seen = new Set();
	for (let n = 1; n <= view.state.doc.lines; n++) {
		const line = view.state.doc.line(n);
		if (seen.has(line.from)) continue;
		const r = paragraphRange(view.state, line.from);
		if (!r) continue;
		for (let p = r.from; p <= r.to; p = view.state.doc.lineAt(p).to + 1) seen.add(view.state.doc.lineAt(p).from);
		enqueue(view, r);
	}
	return seen.size > 0;
}

export function setGrammar(view, value) {
	on = !!value;
	if (!on) {
		queue.length = 0;
		view?.dispatch({ effects: clearAll.of(null) });
	}
}

// Edited paragraphs are checked once typing pauses.
const PAUSE = 2000;
export const grammarCheck = ViewPlugin.fromClass(class {
	constructor(view) { this.view = view; this.dirty = []; this.timer = 0; }
	update(u) {
		if (!on || !u.docChanged) return;
		this.dirty = this.dirty.map((p) => u.changes.mapPos(p));
		u.changes.iterChangedRanges((a, b, fromB, toB) => this.dirty.push(fromB, toB));
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush(), PAUSE);
	}
	flush() {
		const { state } = this.view;
		const done = new Set();
		for (const p of this.dirty) {
			if (p > state.doc.length) continue;
			const r = paragraphRange(state, p);
			if (!r || done.has(r.from)) continue;
			done.add(r.from);
			enqueue(this.view, r);
		}
		this.dirty = [];
	}
	destroy() { clearTimeout(this.timer); }
});

// The box under a clicked underline.
let box = null;
function close() {
	box?.remove();
	box = null;
	document.removeEventListener("pointerdown", away, true);
	document.removeEventListener("keydown", esc, true);
}
const away = (e) => { if (box && !box.contains(e.target)) close(); };
const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
const make = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});

function markAt(state, pos) {
	let hit = null;
	state.field(grammarMarks, false)?.between(pos, pos, (from, to, deco) => { if (from <= pos && pos <= to) hit = { from, to, problem: deco.spec.problem }; });
	return hit;
}

function showProblem(view, hit) {
	close();
	const words = view.state.sliceDoc(hit.from, hit.to);
	box = make("div", "lookup-pop grammar-pop");
	box.setAttribute("role", "dialog");
	box.setAttribute("aria-label", "Grammar");
	box.append(make("div", "grammar-msg", hit.problem.message));
	const row = make("div", "lookup-syns");
	for (const r of hit.problem.replacements) {
		const b = make("button", "lookup-syn", r || "(remove)");
		b.type = "button";
		b.addEventListener("click", () => {
			if (view.state.sliceDoc(hit.from, hit.to) === words) view.dispatch({ changes: { from: hit.from, to: hit.to, insert: r }, selection: { anchor: hit.from + r.length }, userEvent: "input" });
			close();
			view.focus();
		});
		row.append(b);
	}
	if (row.childElementCount) box.append(row);
	const ignore = make("button", "grammar-ignore", "Ignore");
	ignore.type = "button";
	ignore.addEventListener("click", () => {
		ignored.add(ignoreKey(hit.problem, words));
		view.dispatch({ effects: dropMark.of({ from: hit.from, to: hit.to }) });
		close();
		view.focus();
	});
	box.append(ignore);
	document.body.append(box);
	const at = view.coordsAtPos(hit.from);
	if (at) {
		box.style.left = Math.max(8, Math.min(at.left - 20, innerWidth - box.offsetWidth - 8)) + "px";
		box.style.top = (at.bottom + 6 + box.offsetHeight > innerHeight ? Math.max(8, at.top - box.offsetHeight - 6) : at.bottom + 6) + "px";
	}
	document.addEventListener("pointerdown", away, true);
	document.addEventListener("keydown", esc, true);
}

// Opens the box for the underline at the cursor; false when there's none.
export function grammarAtCursor(view) {
	const hit = markAt(view.state, view.state.selection.main.head);
	if (hit) showProblem(view, hit);
	return !!hit;
}

export const grammarClicks = EditorView.domEventHandlers({
	click(e, view) {
		if (!on || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return false;
		const el = e.target.closest?.(".cm-grammar");
		if (!el) return false;
		const hit = markAt(view.state, view.posAtDOM(el, 0) + 1);
		if (hit) showProblem(view, hit);
		return false;
	},
});

export const grammar = [grammarMarks, grammarCheck, grammarClicks];
