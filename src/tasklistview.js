// Draws ```wr1t3r-tasks blocks (src/tasklists.js works out what's in them):
// the list's name and day, its tasks with boxes that tick the real line, each
// task's due date and the note it lives in, and a box to add one. The ⚙ menu
// sets the block up; each choice rewrites only the block's few YAML lines.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { dataviewBlocks, tick, blockBodyChange } from "./dataview.js";
import { TASKS_BLOCK, readConfig, writeConfig, taskList, shownText, newTaskLine, appendTask, listName, noteDay, TASK_TAGS, itemTags, tagFor } from "./tasklists.js";
import { setDueChanges, isoDay } from "./tasks.js";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { linkOpener, resolveNote } from "./links.js";
import { menu, cardColorPicker } from "./basesui.js";
import { isOpen, openAsText } from "./drawnblocks.js";
import { isArchived } from "./search.js";

const UNTRUSTED = /(^|\/)_(clippings|uploads)\//i;
const baseName = (p) => p.split("/").pop().replace(/\.md$/i, "");

// Every note's text, the open one as it is in the editor.
export function allNotes(state) {
	const host = state.facet(vaultHost), path = state.facet(notePath);
	const out = {};
	// Archived notes' tasks aren't listed (only a search that asks finds them).
	for (const p of host.paths()) {
		const t = p === path ? state.sliceDoc() : host.text(p);
		if (p === path || !isArchived(t)) out[p] = t;
	}
	if (path) out[path] = state.sliceDoc();
	return out;
}

// Rewrites the nth block's settings.
function saveConfig(view, n, cfg) {
	const b = dataviewBlocks(view.state, TASKS_BLOCK)[n];
	if (!b || view.state.readOnly) return;
	const text = writeConfig(cfg);
	view.dispatch({ changes: blockBodyChange(view.state, b, text), userEvent: "input.tasks" });
}

// Where a list's new items go: the block's inbox: note, else the list's own
// note ("Shopping.md", "Critical Tasks.md", or the older "Critical Tasks
// List.md") wherever it is, else made in _docs/. tag: which of the card's
// lists it's for.
async function addTask(view, cfg, tag, day, text) {
	const host = view.state.facet(vaultHost);
	const paths = host.paths();
	const line = newTaskLine(text, tag, day);
	const own = cfg.lists.length === 1 && cfg.title;
	cfg = { ...cfg, title: own || null };
	const title = own || listName(tag);
	const root = paths.some((p) => p.startsWith("content/")) ? "content/" : "";
	const file = title.replace(/[\\/:*?"<>|]/g, "") + ".md";
	// The lists were "… List" once; a note by that name is still theirs.
	const names = [file, ...(cfg.title ? [] : [file.replace(/\.md$/, " List.md")])].map((f) => f.toLowerCase());
	const target = cfg.inbox ? resolveNote({ note: cfg.inbox.replace(/^\[\[|\]\]$/g, "").split("|")[0], heading: "", wiki: true }, view.state.facet(notePath), paths)
		: names.map((f) => paths.filter((p) => p.split("/").pop().toLowerCase() === f && !/(^|\/)_templates\//i.test(p)).sort((a, b) => a.length - b.length)[0]).find(Boolean);
	if (target) await host.write(target, (t) => appendTask(t, line));
	else await host.create(host.listsFolder?.() ?? root + "_docs/", file.slice(0, -3), () => `# ${title}\n\n${line}\n`, { open: false });
}

function setTaskDue(view, t, day) {
	const host = view.state.facet(vaultHost);
	host.write(t.path, (text) => {
		const lines = text.split(/\r?\n/), nl = text.includes("\r\n") ? "\r\n" : "\n";
		const l = lines[t.line];
		if (l == null || !l.includes(t.text.trim())) return text;
		const changes = setDueChanges(l, 0, day).sort((a, b) => b.from - a.from);
		let s = l;
		for (const c of changes) s = s.slice(0, c.from) + c.insert + s.slice(c.to ?? c.from);
		lines[t.line] = s;
		return lines.join(nl);
	});
}

// n: the block's place among the note's task blocks, or null for a list drawn
// inside another block (the planner), which has no settings of its own.
export class TaskListWidget extends WidgetType {
	constructor(cfg, result, n, from, path) {
		super();
		Object.assign(this, { cfg, result, n, from, path });
		this.key = JSON.stringify([cfg, result.title, result.day, result.groups.map((g) => [g.label, g.tasks.map((t) => [t.path, t.line, t.text, t.status])]), n, path]);
	}
	eq(o) { return o.key === this.key; }
	toDOM(view) {
		const { cfg, result } = this;
		const ro = view.state.readOnly;
		const today = isoDay(new Date());
		const wrap = document.createElement("div");
		wrap.className = "md-tl";
		const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
		const button = (cls, text, title, run) => {
			const b = el("button", cls, text);
			b.type = "button";
			b.title = title;
			b.addEventListener("mousedown", (e) => e.preventDefault());
			b.addEventListener("click", (e) => run(e));
			return b;
		};

		const head = el("div", "md-tl-head");
		head.append(el("span", "md-tl-title", result.title));
		if (result.day) head.append(el("span", "md-tl-day", result.day === today ? "Today" : new Date(result.day + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })));
		head.append(el("span", "md-tl-count", String(result.count)));
		const tools = el("span", "md-tl-tools");
		if (!ro && this.n != null) tools.append(button("md-tl-btn", "⚙", "Set up this list", (e) => this.settings(view, e.clientX, e.clientY)));
		// The card's color (a list block's own; the planner colors its cards itself).
		if (this.n != null && cfg.color) { wrap.classList.add("planner-colored"); wrap.style.setProperty("--card-c", `var(--f${cfg.color})`); }
		if (!ro && this.n != null) {
			const dot = el("button", "planner-card-dot" + (cfg.color ? "" : " none"));
			dot.type = "button";
			dot.title = "Card color";
			dot.setAttribute("aria-label", "Card color");
			dot.addEventListener("mousedown", (e) => e.preventDefault());
			dot.addEventListener("click", () => {
				const r = dot.getBoundingClientRect();
				cardColorPicker(cfg.color, r.left, r.bottom + 6, (c) => saveConfig(view, this.n, { ...cfg, color: c }));
			});
			tools.append(dot);
		}
		if (this.n != null) tools.append(button("md-tl-btn", "</>", "Show the block's settings as text", () => {
			let pos = this.from;
			try { pos = view.posAtDOM(wrap); } catch {}
			openAsText(view, pos);
		}));
		head.append(tools);
		wrap.append(head);

		const item = (t) => {
			const li = el("li", "md-tl-item" + (t.done ? " done" : ""));
			const box = el("input", "md-tl-box");
			box.type = "checkbox";
			box.checked = t.done;
			box.disabled = ro;
			box.addEventListener("mousedown", (e) => e.stopPropagation());
			box.addEventListener("change", () => { if (!tick(view, t.path, t.line, t.text, box.checked)) box.checked = !box.checked; });
			li.append(box, el("span", "md-tl-text", shownText(t.text, t.tag || cfg.list)));
			if (t.due) li.append(el("span", `md-due md-due-${t.done ? "done" : t.due < today ? "overdue" : t.due === today ? "today" : "later"}`, "📅 " + t.due));
			// Where it's written, unless that's here or the list's own note.
			if (t.path !== this.path && baseName(t.path).replace(/ List$/, "") !== listName(t.tag || cfg.list)) {
				const a = el("a", "md-tl-src", baseName(t.path));
				a.href = "#" + encodeURIComponent(t.path);
				a.addEventListener("mousedown", (e) => e.preventDefault());
				a.addEventListener("click", (e) => { e.preventDefault(); view.state.facet(linkOpener)?.({ note: t.path, heading: "", wiki: true }); });
				li.append(a);
			}
			if (!ro) li.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				const inDays = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return isoDay(x); };
				menu([
					["Due today", () => setTaskDue(view, t, inDays(0))],
					["Due tomorrow", () => setTaskDue(view, t, inDays(1))],
					["Due in a week", () => setTaskDue(view, t, inDays(7))],
					...(t.due ? [["Remove due date", () => setTaskDue(view, t, null)]] : []),
					null,
					["Open its note", () => view.state.facet(linkOpener)?.({ note: t.path, heading: "", wiki: true })],
				], e.clientX, e.clientY);
			});
			return li;
		};
		// The add box for one list (tag), or for the card with a picker of its lists.
		const adder = (tag) => {
			const row = el("div", "md-tl-adder");
			let pick = null;
			if (!tag && cfg.lists.length > 1) {
				pick = el("select", "md-tl-addto");
				pick.title = "Which list it goes on";
				for (const t of cfg.lists) pick.append(new Option(listName(t), t));
				row.append(pick);
			}
			const add = el("input", "md-tl-add");
			add.type = "text";
			const name = tag ? listName(tag) : cfg.lists.length > 1 ? null : result.title;
			add.placeholder = (name ? `Add to ${name}` : "Add an item") + (result.day ? " for this day" : "") + "…";
			add.enterKeyHint = "done";
			add.addEventListener("keydown", async (e) => {
				if (e.key !== "Enter" || !add.value.trim()) return;
				e.preventDefault();
				const text = add.value;
				add.value = "";
				await addTask(view, cfg, tag || pick?.value || cfg.list, result.day, text);
			});
			row.append(add);
			return row;
		};

		// Columns: each list side by side (stacked when narrow), each with its own add box.
		const columns = cfg.layout === "columns" && cfg.lists.length > 1 && result.groups.every((g) => g.tag);
		if (columns) {
			wrap.classList.add("md-tl-columns");
			const cols = el("div", "md-tl-cols");
			for (const g of result.groups) {
				const col = el("div", "md-tl-col");
				col.append(el("div", "md-tl-group", `${g.label} · ${g.tasks.length}`));
				const ul = el("ul", "md-tl-list");
				for (const t of g.tasks) ul.append(item(t));
				col.append(ul);
				if (!g.tasks.length) col.append(el("div", "md-tl-empty", "Nothing here."));
				if (!ro) col.append(adder(g.tag));
				cols.append(col);
			}
			wrap.append(cols);
			return wrap;
		}
		for (const g of result.groups) {
			if (g.label) wrap.append(el("div", "md-tl-group", g.label));
			const ul = el("ul", "md-tl-list");
			for (const t of g.tasks) ul.append(item(t));
			wrap.append(ul);
		}
		if (!result.count) wrap.append(el("div", "md-tl-empty", result.day ? "Nothing for this day." : "Nothing here."));
		if (!ro) wrap.append(adder(null));
		return wrap;
	}
	settings(view, x, y) {
		const cfg = this.cfg, n = this.n;
		const set = (patch) => saveConfig(view, n, { ...cfg, ...patch });
		const pick = (label, on) => (on ? "✓ " : " ") + label;
		const hasDay = !!noteDay(this.path);
		const lists = cfg.lists;
		const has = (t) => lists.some((x) => x.toLowerCase() === t.toLowerCase());
		const setLists = (next) => set({ lists: next, list: next[0] });
		// Lists to tick: the task lists, the card's own, then the tags the
		// vault's checkbox items use most.
		const offered = [...TASK_TAGS];
		for (const t of [...lists, ...itemTags(allNotes(view.state)).map((x) => x.tag)]) if (offered.length < 12 && !offered.some((o) => o.toLowerCase() === t.toLowerCase())) offered.push(t);
		const multi = lists.length > 1;
		menu([
			...offered.map((t) => [pick(`${listName(t)} (#${t})`, has(t)), () => {
				if (!has(t)) return setLists([...lists, t]);
				if (lists.length > 1) setLists(lists.filter((x) => x.toLowerCase() !== t.toLowerCase()));
			}]),
			["New list…", () => {
				const name = prompt("List name (Shopping, Wishlist, Packing…):", "");
				const tag = tagFor(name);
				if (tag && !has(tag)) setLists([...lists, tag]);
			}],
			null,
			...(multi ? [
				[pick("Lists grouped", cfg.layout !== "columns"), () => set({ layout: "grouped" })],
				[pick("Lists in columns", cfg.layout === "columns"), () => set({ layout: "columns", group: "list" })],
				null,
			] : []),
			[pick("Open items", cfg.show === "open"), () => set({ show: "open" })],
			[pick("Open and done", cfg.show === "all"), () => set({ show: "all" })],
			[pick("Done items", cfg.show === "done"), () => set({ show: "done" })],
			null,
			...(hasDay ? [
				[pick("This day's items", cfg.day === "note"), () => set({ day: "note" })],
				[pick("Every item", cfg.day === "all"), () => set({ day: "all" })],
				null,
			] : []),
			...(cfg.layout === "columns" && multi ? [] : [
				[pick("No groups", cfg.group === "none"), () => set({ group: "none" })],
				...(multi ? [[pick("Group by list", cfg.group === "list"), () => set({ group: "list" })]] : []),
				[pick("Group by note", cfg.group === "note"), () => set({ group: "note" })],
				[pick("Group by due date", cfg.group === "due"), () => set({ group: "due" })],
				null,
			]),
			[pick("Sort by due date", cfg.sort === "due"), () => set({ sort: "due" })],
			[pick("Sort by note", cfg.sort === "note"), () => set({ sort: "note" })],
			[pick("Sort by text", cfg.sort === "text"), () => set({ sort: "text" })],
			null,
			["Rename the card…", () => { const t = prompt("Card name (empty for the usual one):", cfg.title || ""); if (t != null) set({ title: t.trim() || null }); }],
		], x, y);
	}
	ignoreEvent() { return true; }
	get estimatedHeight() { return 160; }
}

function build(state) {
	const b = new RangeSetBuilder();
	const path = state.facet(notePath);
	if (!state.facet(vaultHost) || !path || UNTRUSTED.test(path)) return b.finish();
	const blocks = dataviewBlocks(state, TASKS_BLOCK);
	if (!blocks.length) return b.finish();
	const notes = allNotes(state);
	const today = isoDay(new Date());
	blocks.forEach((blk, n) => {
		if (isOpen(state, blk)) return; // opened as text with its </> button
		const cfg = readConfig(blk.code);
		b.add(blk.from, blk.to, Decoration.replace({ widget: new TaskListWidget(cfg, taskList(notes, cfg, { path, today }), n, blk.from, path), block: true }));
	});
	return b.finish();
}

export const taskLists = StateField.define({
	create: build,
	update(deco, tr) {
		const vault = tr.effects.some((e) => e.is(vaultChanged));
		if (tr.docChanged || tr.selection || vault || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});
