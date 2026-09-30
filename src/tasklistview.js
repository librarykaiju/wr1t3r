// Draws ```wr1t3r-tasks blocks (src/tasklists.js works out what's in them):
// the list's name and day, its tasks with boxes that tick the real line, each
// task's due date and the note it lives in, and a box to add one. The ⚙ menu
// sets the block up; each choice rewrites only the block's few YAML lines.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { dataviewBlocks, tick } from "./dataview.js";
import { TASKS_BLOCK, readConfig, writeConfig, taskList, shownText, newTaskLine, appendTask, listName, noteDay } from "./tasklists.js";
import { setDueChanges, isoDay } from "./tasks.js";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { linkOpener, resolveNote } from "./links.js";
import { menu } from "./basesui.js";

const UNTRUSTED = /(^|\/)_(clippings|uploads)\//i;
const baseName = (p) => p.split("/").pop().replace(/\.md$/i, "");

// Every note's text, the open one as it is in the editor.
function allNotes(state) {
	const host = state.facet(vaultHost), path = state.facet(notePath);
	const out = {};
	for (const p of host.paths()) out[p] = p === path ? state.sliceDoc() : host.text(p);
	if (path) out[path] = state.sliceDoc();
	return out;
}

// Rewrites the nth block's settings.
function saveConfig(view, n, cfg) {
	const b = dataviewBlocks(view.state, TASKS_BLOCK)[n];
	if (!b || view.state.readOnly) return;
	const text = writeConfig(cfg);
	view.dispatch({ changes: { from: b.codeFrom, to: b.codeTo, insert: b.code ? text : text + "\n" }, userEvent: "input.tasks" });
}

// Where a list's new tasks go: the block's inbox: note, else the list's own
// note ("Critical Tasks List.md") at the top of the notes, made if needed.
async function addTask(view, cfg, day, text) {
	const host = view.state.facet(vaultHost);
	const paths = host.paths();
	const line = newTaskLine(text, cfg.list, day);
	const title = cfg.title || listName(cfg.list).replace(/^#/, "");
	const root = paths.some((p) => p.startsWith("content/")) ? "content/" : "";
	const target = cfg.inbox ? resolveNote({ note: cfg.inbox.replace(/^\[\[|\]\]$/g, "").split("|")[0], heading: "", wiki: true }, view.state.facet(notePath), paths) : paths.find((p) => p.toLowerCase() === (root + title + ".md").toLowerCase());
	if (target) await host.write(target, (t) => appendTask(t, line));
	else await host.create(root, title.replace(/[\\/:*?"<>|]/g, ""), () => `# ${title}\n\n${line}\n`, { open: false });
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

class TaskListWidget extends WidgetType {
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
		if (!ro) tools.append(button("md-tl-btn", "⚙", "Set up this list", (e) => this.settings(view, e.clientX, e.clientY)));
		tools.append(button("md-tl-btn", "</>", "Show the block's settings as text", () => {
			let pos = this.from;
			try { pos = view.posAtDOM(wrap); } catch {}
			const line = view.state.doc.lineAt(pos);
			view.dispatch({ selection: { anchor: Math.min(line.to + 1, view.state.doc.length) }, scrollIntoView: true });
			view.focus();
		}));
		head.append(tools);
		wrap.append(head);

		for (const g of result.groups) {
			if (g.label) wrap.append(el("div", "md-tl-group", g.label));
			const ul = el("ul", "md-tl-list");
			for (const t of g.tasks) {
				const li = el("li", "md-tl-item" + (t.done ? " done" : ""));
				const box = el("input", "md-tl-box");
				box.type = "checkbox";
				box.checked = t.done;
				box.disabled = ro;
				box.addEventListener("mousedown", (e) => e.stopPropagation());
				box.addEventListener("change", () => { if (!tick(view, t.path, t.line, t.text, box.checked)) box.checked = !box.checked; });
				li.append(box, el("span", "md-tl-text", shownText(t.text, cfg.list)));
				if (t.due) li.append(el("span", `md-due md-due-${t.done ? "done" : t.due < today ? "overdue" : t.due === today ? "today" : "later"}`, "📅 " + t.due));
				if (t.path !== this.path) {
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
				ul.append(li);
			}
			wrap.append(ul);
		}
		if (!result.count) wrap.append(el("div", "md-tl-empty", result.day ? "Nothing for this day." : "Nothing here."));

		if (!ro) {
			const add = el("input", "md-tl-add");
			add.type = "text";
			add.placeholder = `Add to the ${result.title}` + (result.day ? " for this day" : "") + "…";
			add.enterKeyHint = "done";
			add.addEventListener("keydown", async (e) => {
				if (e.key !== "Enter" || !add.value.trim()) return;
				e.preventDefault();
				const text = add.value;
				add.value = "";
				await addTask(view, cfg, result.day, text);
			});
			wrap.append(add);
		}
		return wrap;
	}
	settings(view, x, y) {
		const cfg = this.cfg, n = this.n;
		const set = (patch) => saveConfig(view, n, { ...cfg, ...patch });
		const pick = (label, on) => (on ? "✓ " : " ") + label;
		const hasDay = !!noteDay(this.path);
		menu([
			[pick("Critical Tasks List (#crit)", cfg.list === "crit"), () => set({ list: "crit", title: null })],
			[pick("To Do's List (#todo)", cfg.list === "todo"), () => set({ list: "todo", title: null })],
			[pick("Another tag…", !["crit", "todo"].includes(cfg.list)), () => { const t = prompt("Tag (without #):", ["crit", "todo"].includes(cfg.list) ? "" : cfg.list); if (t && t.trim()) set({ list: t.trim().replace(/^#/, ""), title: null }); }],
			null,
			[pick("Open tasks", cfg.show === "open"), () => set({ show: "open" })],
			[pick("Open and done", cfg.show === "all"), () => set({ show: "all" })],
			[pick("Done tasks", cfg.show === "done"), () => set({ show: "done" })],
			null,
			...(hasDay ? [
				[pick("This day's tasks", cfg.day === "note"), () => set({ day: "note" })],
				[pick("Every task", cfg.day === "all"), () => set({ day: "all" })],
				null,
			] : []),
			[pick("No groups", cfg.group === "none"), () => set({ group: "none" })],
			[pick("Group by note", cfg.group === "note"), () => set({ group: "note" })],
			[pick("Group by due date", cfg.group === "due"), () => set({ group: "due" })],
			null,
			[pick("Sort by due date", cfg.sort === "due"), () => set({ sort: "due" })],
			[pick("Sort by note", cfg.sort === "note"), () => set({ sort: "note" })],
			[pick("Sort by text", cfg.sort === "text"), () => set({ sort: "text" })],
			null,
			["Rename the list…", () => { const t = prompt("List name (empty for the usual one):", cfg.title || ""); if (t != null) set({ title: t.trim() || null }); }],
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
	const sel = state.selection.ranges;
	const notes = allNotes(state);
	const today = isoDay(new Date());
	blocks.forEach((blk, n) => {
		if (sel.some((r) => r.to >= blk.from && r.from <= blk.to)) return; // being edited
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
