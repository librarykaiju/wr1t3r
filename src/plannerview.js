// Draws ```wr1t3r-planner blocks (src/planner.js works out what's in them):
// a banner and the day's title, four health buttons (Food, Water, Meds,
// Mood) that write to the day's health note, then two columns, the timeline
// from 9 AM to 9 PM beside the day's task lists. Everything under the block
// (the note's "# Notes") is the note as usual.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { dataviewBlocks, blockBodyChange } from "./dataview.js";
import {
	PLANNER, readPlanner, writePlanner, setEntryColor, timelineRows, setEntry, addEvents, hourLabel, clock, healthPathFor,
	parseNutrition, searchFoods, addFoodRow, healthDay, syncHealth, toggleMeds, addUnder, removeLine, foodLine,
	mealAt, MEALS, WATER, MOOD, EXERCISE, moodLine, moodChoice, exerciseLine, cardColor, editPlannerBlock, CARD_COLORS,
} from "./planner.js";
import { readConfig, taskList, noteDay } from "./tasklists.js";
import { TaskListWidget, allNotes } from "./tasklistview.js";
import { isoDay } from "./tasks.js";
import { imageRef } from "./pretty.js";
import { resolveNote } from "./links.js";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { propertiesFolded, setPropertiesHidden } from "./frontmatter.js";
import { openPanel, redrawPanel } from "./basesui.js";
import { onMenu } from "./homeview.js";
import { EVENT_COLORS } from "./agenda.js";
import { menu } from "./basesui.js";

const UNTRUSTED = /(^|\/)_(clippings|uploads)\//i;

// Set by main.js: { healthNote(dailyPath) -> Promise<path> (made from the
// template if needed), events(day) -> Promise<events|null>, image(ref, from),
// open(path), toast(text), usda(query) -> Promise<foods> (worker/usda.js) }.
let host = null;
export const setPlannerHost = (h) => { host = h; };

// The health note writes waiting their turn (see health$).
let healthWrites = Promise.resolve();

// The Nutrition Database's foods, read again only when its text changes.
let foodCache = { text: null, foods: [] };
function nutrition(state, cfg) {
	const vault = state.facet(vaultHost), paths = vault.paths();
	const path = cfg.nutrition
		? resolveNote({ note: cfg.nutrition.replace(/^\[\[|\]\]$/g, "").split("|")[0], heading: "", wiki: true }, state.facet(notePath), paths)
		: paths.filter((p) => /(^|\/)Nutrition Database\.md$/i.test(p)).sort((a, b) => a.length - b.length)[0];
	const text = path ? vault.text(path) : null;
	if (text !== foodCache.text) foodCache = { text, foods: parseNutrition(text), path };
	return foodCache;
}

// Rewrites the nth planner block's settings (the timeline lives there too).
// The card colors every day shares: the Daily template's planner block's,
// read again only when the template changes. -> { colors, path } (path null
// when there's no template).
let sharedCache = { text: undefined, colors: {}, path: null };
const TEMPLATE = /(^|\/)_templates\/Daily\.md$/i;
function sharedColors(vault) {
	const path = vault.paths().filter((p) => TEMPLATE.test(p)).sort((a, b) => a.length - b.length)[0] || null;
	const text = path ? vault.text(path) : null;
	if (text !== sharedCache.text || path !== sharedCache.path) {
		const code = text && String(text).match(/```wr1t3r-planner[ \t]*\r?\n([\s\S]*?)\r?\n?```/)?.[1];
		sharedCache = { text, path, colors: code != null ? readPlanner(code).colors : {} };
	}
	return sharedCache;
}

function saveBlock(view, n, cfg) {
	const b = dataviewBlocks(view.state, PLANNER)[n];
	if (!b || view.state.readOnly) return;
	const text = writePlanner(cfg);
	view.dispatch({ changes: blockBodyChange(view.state, b, text), userEvent: "input.planner" });
}

// Adds calendar events to the note's (first) planner Timeline, skipping ones
// already there: { added }, or null when the note has no planner.
export function importEvents(view, events) {
	const b = dataviewBlocks(view.state, PLANNER)[0];
	if (!b) return null;
	const cfg = readPlanner(b.code);
	const r = addEvents(cfg.timeline, events);
	if (r.added || r.colored) saveBlock(view, 0, { ...cfg, timeline: r.timeline });
	return { added: r.added };
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = (n) => Math.round(n).toLocaleString();

class PlannerWidget extends WidgetType {
	constructor(p) {
		super();
		Object.assign(this, p);
		const h = p.health;
		this.key = JSON.stringify([p.propsHidden, p.cfg, p.shared, p.n, p.path, p.day, h, p.foodsCount, p.tasks.map((t) => [t.cfg, t.result.groups.map((g) => [g.label, g.tasks.map((x) => [x.path, x.line, x.text, x.status])])])]);
	}
	eq(o) { return o.key === this.key; }

	toDOM(view) {
		const wrap = el("div", "planner");
		const ro = view.state.readOnly;
		wrap.append(...this.top(view), this.buttons(view, ro), this.columns(view, ro));
		const edit = el("button", "md-dv-edit planner-edit", "</>");
		edit.type = "button";
		edit.title = "Edit the planner's settings";
		edit.addEventListener("mousedown", (e) => {
			e.preventDefault();
			let pos = this.from;
			try { pos = view.posAtDOM(wrap); } catch {}
			const line = view.state.doc.lineAt(pos);
			view.dispatch({ selection: { anchor: Math.min(line.to + 1, view.state.doc.length) }, scrollIntoView: true });
			view.focus();
		});
		wrap.append(edit);
		return wrap;
	}

	// The banner (when the block names one) and the title.
	top(view) {
		const out = [];
		const ref = this.cfg.banner && imageRef(this.cfg.banner);
		if (ref && host) {
			const fig = el("div", "planner-banner");
			const img = el("img");
			img.alt = "";
			img.decoding = "async";
			Promise.resolve(host.image(ref, this.path)).then((src) => { if (src) img.src = src; else fig.remove(); }).catch(() => fig.remove());
			fig.append(img);
			out.push(fig);
		}
		const d = this.day && new Date(this.day + "T12:00");
		const title = this.cfg.title || (d ? d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : this.path.split("/").pop().replace(/\.md$/i, ""));
		const head = el("div", "planner-head");
		head.append(el("h1", "planner-title", title));
		if (d && this.day === isoDay(new Date())) head.append(el("span", "planner-today", "Today"));
		const links = el("span", "planner-links");
		const link = (text, title, run) => {
			const b = el("button", "planner-link", text);
			b.type = "button";
			b.title = title;
			b.addEventListener("mousedown", (e) => e.preventDefault());
			b.addEventListener("click", run);
			links.append(b);
		};
		if (this.day && host) link("Health note", "Open this day's health note", async () => { const p = await host.healthNote(this.path); if (p) host.open(p); });
		const hidden = propertiesFolded(view.state);
		link(hidden ? "Properties" : "Hide properties", hidden ? "Show this note's properties" : "Hide this note's properties", () => setPropertiesHidden(view, !hidden));
		head.append(links);
		out.push(head);
		return out;
	}

	// ---- Health buttons -----------------------------------------------------

	buttons(view, ro) {
		const h = this.health, cfg = this.cfg;
		const grid = el("div", "planner-buttons");
		const off = ro || !this.day || !host;
		const tile = (kind, emoji, label, status, run, { pressed = null, pct = null } = {}) => {
			const b = el("button", `planner-btn planner-${kind}`);
			b.type = "button";
			b.disabled = off;
			if (pressed != null) b.setAttribute("aria-pressed", String(pressed));
			b.append(el("span", "planner-btn-icon", emoji), el("span", "planner-btn-label", label), el("span", "planner-btn-status", status));
			if (pct != null) {
				const bar = el("span", "planner-btn-bar");
				const fill = el("span");
				fill.style.width = Math.min(100, Math.max(0, pct)) + "%";
				bar.append(fill);
				b.append(bar);
			}
			b.addEventListener("mousedown", (e) => e.preventDefault());
			b.addEventListener("click", (e) => run(b, e));
			grid.append(b);
			return b;
		};
		const cal = h.totals.calories;
		tile("food", "🍎", "Food", `${fmt(cal)} cal`, (b) => this.foodPanel(view, b), { pct: (cal / cfg.calories_target) * 100 }).title = `${fmt(cal)} of ${fmt(cfg.calories_target)} calories`;
		const water = tile("water", "💧", "Water", `${fmt(h.waterOz)} / ${fmt(cfg.water_target)} oz`, (b) => {
			b.classList.remove("planner-pop");
			void b.offsetWidth;
			b.classList.add("planner-pop");
			this.health$(view, (t) => addUnder(t, WATER.heading, String(cfg.water_step), { parent: WATER.parent }));
		}, { pct: (h.waterOz / cfg.water_target) * 100 });
		if (!off) onMenu(water, (x, y) => menu([
			[`Add ${cfg.water_step} oz`, () => this.health$(view, (t) => addUnder(t, WATER.heading, String(cfg.water_step), { parent: WATER.parent }))],
			...(h.water.length ? [["Remove the last one", () => this.health$(view, (t) => { const w = healthDay(t, []).water.at(-1); return w ? removeLine(t, w.line, w.text) : t; })]] : []),
			null,
			["Open the health note", () => host.open(healthPathFor(this.path))],
		], x, y));
		tile("meds", "💊", "Meds", h.meds ? "Taken ✓" : "Not yet", () => this.health$(view, toggleMeds), { pressed: h.meds });
		const last = h.moods.at(-1);
		const ex = [h.steps ? `${fmt(h.steps)} steps` : "", h.kcal ? `${fmt(h.kcal)} cal` : ""].filter(Boolean).join(" · ");
		tile("exercise", "👟", "Exercise", ex || "Get moving", (b) => this.exercisePanel(view, b), { pct: (h.steps / cfg.steps_target) * 100 }).title = `${fmt(h.steps)} of ${fmt(cfg.steps_target)} steps, ${fmt(h.kcal)} of ${fmt(cfg.activity_target)} cal burned`;
		const lastMood = last && moodChoice(last.mood);
		tile("mood", lastMood?.[0] || "🙂", "Mood", last ? `${lastMood[1]}${last.time ? " · " + timeText(last.time) : ""}` : "How are you?", (b) => this.moodPanel(view, b));
		if (!this.day) grid.title = "The health buttons work in a daily note (named YYYY-MM-DD).";
		return grid;
	}

	// Writes to the day's health note (made first if needed), then copies its
	// totals into its properties. Writes run one at a time, in order, so quick
	// clicks can't both make the note or write over each other.
	health$(view, fn) {
		if (!host || !this.day) return Promise.resolve();
		const vault = view.state.facet(vaultHost);
		const run = async () => {
			try {
				const path = await host.healthNote(this.path);
				if (!path) return;
				const { foods } = nutrition(view.state, this.cfg);
				await vault.write(path, (t) => syncHealth(fn(t), foods, this.cfg));
				redrawPanel(this.panelKey);
			} catch (e) {
				host.toast?.("Couldn't write to the health note: " + (e?.message || e));
			}
		};
		healthWrites = healthWrites.then(run, run);
		return healthWrites;
	}

	get panelKey() { return "planner:" + this.path; }

	// The health note as it is now (the widget may be a moment behind).
	now(view) {
		const vault = view.state.facet(vaultHost);
		const { foods } = nutrition(view.state, this.cfg);
		return healthDay(vault.text(healthPathFor(this.path)), foods);
	}

	foodPanel(view, anchor) {
		// usda: null, or the USDA search being shown: { q, results, error, loading }.
		const st = { q: "", meal: mealAt(new Date()), servings: "1", usda: null };
		openPanel(this.panelKey, "food", anchor, (box) => {
			box.classList.add("planner-panel");
			const { foods, path: dbPath } = nutrition(view.state, this.cfg);
			box.append(el("div", "planner-panel-title", "Log food"));
			if (!dbPath) {
				box.append(el("p", "planner-panel-empty", this.cfg.nutrition ? `Couldn't find ${this.cfg.nutrition}.` : "There's no Nutrition Database.md in the vault."));
				return;
			}
			const row = el("div", "planner-food-opts");
			const meal = el("select");
			for (const m of MEALS) meal.append(new Option(m.replace(/^(\p{Extended_Pictographic}️?)/u, "$1 "), m));
			meal.value = st.meal;
			meal.addEventListener("change", () => { st.meal = meal.value; });
			const serv = el("input");
			Object.assign(serv, { type: "number", min: "0", step: "0.25", value: st.servings, title: "Servings" });
			serv.dataset.focus = "servings";
			serv.addEventListener("input", () => { st.servings = serv.value; });
			const sl = el("label", "planner-servings");
			sl.append(serv, " servings");
			row.append(meal, sl);
			const q = el("input", "planner-search");
			Object.assign(q, { type: "search", placeholder: `Search ${foods.length} foods…`, value: st.q, enterKeyHint: "done" });
			q.dataset.focus = "q";
			const list = el("div", "planner-results");
			list.setAttribute("role", "listbox");
			const log = async (f) => {
				const n = Number(st.servings) > 0 ? Number(st.servings) : 1;
				await this.health$(view, (t) => addUnder(t, st.meal, foodLine(f, n)));
				host.toast?.(`Logged ${f.name}${n === 1 ? "" : ` ×${n}`} under ${st.meal.replace(/^\p{Extended_Pictographic}️?/u, "")}.`);
			};
			const usdaSearch = async () => {
				const q = st.q.trim();
				const asked = st.usda = { q, loading: true, results: [] };
				redrawPanel(this.panelKey);
				let done;
				try { done = { q, results: await host.usda(q) }; }
				catch (e) { done = { q, results: [], error: e?.message || String(e) }; }
				// Only if the search is still the one on screen (not typed over or backed out of).
				if (st.usda !== asked) return;
				st.usda = done;
				redrawPanel(this.panelKey);
			};
			const addAndLog = async (f) => {
				const vault = view.state.facet(vaultHost);
				await vault.write(dbPath, (t) => addFoodRow(t, f));
				await log({ name: f.name });
				st.usda = null;
				redrawPanel(this.panelKey);
			};
			const fill = () => {
				list.replaceChildren();
				if (st.usda) {
					const back = el("button", "planner-result planner-usda-back", "← Your foods");
					back.type = "button";
					back.addEventListener("click", () => { st.usda = null; fill(); });
					list.append(back);
					if (st.usda.loading) list.append(el("p", "planner-panel-empty", `Searching USDA for “${st.usda.q}”…`));
					else if (st.usda.error) list.append(el("p", "planner-panel-empty", st.usda.error));
					else if (!st.usda.results.length) list.append(el("p", "planner-panel-empty", `USDA has nothing for “${st.usda.q}”.`));
					for (const f of st.usda.results) {
						const b = el("button", "planner-result");
						b.type = "button";
						b.setAttribute("role", "option");
						b.title = `${f.name}: ${f.serving}, ${fmt(f.calories)} cal, ${f.fat} g fat, ${f.carbs} g carbs, ${f.protein} g protein, ${f.fiber} g fiber (${f.dataType}). Adds it to the Nutrition Database and logs it.`;
						b.append(el("span", "planner-result-name", f.name), el("span", "planner-result-meta", `${f.serving} · ${fmt(f.calories)} cal`));
						b.addEventListener("click", () => addAndLog(f));
						list.append(b);
					}
					return;
				}
				const hits = searchFoods(foods, st.q, 40);
				for (const f of hits) {
					const b = el("button", "planner-result");
					b.type = "button";
					b.setAttribute("role", "option");
					b.append(el("span", "planner-result-name", f.name), el("span", "planner-result-meta", `${f.serving} · ${fmt(f.calories)} cal`));
					b.addEventListener("click", () => log(f));
					list.append(b);
				}
				if (!hits.length) list.append(el("p", "planner-panel-empty", "None of your foods match."));
				if (st.q.trim() && host?.usda) {
					const b = el("button", "planner-result planner-usda", `Search USDA for “${st.q.trim()}”`);
					b.type = "button";
					b.addEventListener("click", usdaSearch);
					list.append(b);
				}
			};
			q.addEventListener("input", () => { st.q = q.value; st.usda = null; fill(); });
			q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); list.querySelector("button")?.click(); } });
			fill();
			box.append(q, row, list);

			const day = this.now(view);
			const logged = day.meals.filter((m) => m.items.length);
			if (logged.length) {
				box.append(el("div", "planner-panel-sub", `Today · ${fmt(day.totals.calories)} cal · ${fmt(day.totals.protein)} g protein · ${fmt(day.totals.carbs)} g carbs · ${fmt(day.totals.fat)} g fat · ${fmt(day.totals.fiber)} g fiber`));
				for (const m of logged) {
					box.append(el("div", "planner-log-head", m.meal));
					for (const it of m.items) box.append(this.logRow(view, `${it.name}${it.servings === 1 ? "" : ` ×${it.servings}`}`, it.food ? `${fmt(it.food.calories * it.servings)} cal` : "not in the database", it));
				}
			}
			setTimeout(() => { if (!box.contains(document.activeElement)) q.focus(); });
		});
	}

	moodPanel(view, anchor) {
		const st = { note: "" };
		openPanel(this.panelKey, "mood", anchor, (box) => {
			box.classList.add("planner-panel");
			box.append(el("div", "planner-panel-title", "How are you feeling?"));
			const note = el("input", "planner-search");
			Object.assign(note, { type: "text", placeholder: "A note (optional)", value: st.note });
			note.dataset.focus = "note";
			note.addEventListener("input", () => { st.note = note.value; });
			const grid = el("div", "planner-moods");
			for (const m of this.cfg.moods.map(moodChoice)) {
				const b = el("button", "planner-moodpick");
				b.type = "button";
				b.append(el("span", "planner-mood-emoji", m[0] || "•"), el("span", null, m[1]));
				b.addEventListener("click", async () => {
					await this.health$(view, (t) => addUnder(t, MOOD.heading, moodLine(m, st.note)));
					st.note = "";
					redrawPanel(this.panelKey);
				});
				grid.append(b);
			}
			box.append(grid, note);
			const moods = this.now(view).moods;
			if (moods.length) {
				box.append(el("div", "planner-panel-sub", "Today"));
				for (const it of [...moods].reverse()) box.append(this.logRow(view, `${timeText(it.time)} · ${it.mood}`, it.note, it));
			}
		});
	}

	exercisePanel(view, anchor) {
		const st = { kind: null, steps: "", kcal: "", note: "" };
		openPanel(this.panelKey, "exercise", anchor, (box) => {
			box.classList.add("planner-panel");
			box.append(el("div", "planner-panel-title", "Log exercise"));
			const grid = el("div", "planner-moods");
			for (const k of this.cfg.exercises) {
				const [emoji, label] = moodChoice(k);
				const b = el("button", "planner-moodpick");
				b.type = "button";
				b.setAttribute("aria-pressed", String(st.kind === k));
				b.append(el("span", "planner-mood-emoji", emoji || "•"), el("span", null, label));
				b.addEventListener("click", () => { st.kind = k; redrawPanel(this.panelKey); });
				grid.append(b);
			}
			const field = (key, label, type, placeholder) => {
				const wrap = el("label", "planner-field");
				const input = el("input");
				Object.assign(input, { type, placeholder, value: st[key] });
				if (type === "number") Object.assign(input, { min: "0", step: "1", inputMode: "numeric" });
				input.dataset.focus = key;
				input.addEventListener("input", () => { st[key] = input.value; });
				wrap.append(el("span", null, label), input);
				return wrap;
			};
			const nums = el("div", "planner-food-opts");
			nums.append(field("steps", "Steps", "number", "0"), field("kcal", "Calories burned", "number", "0"));
			const note = field("note", "Note", "text", "Optional");
			note.classList.add("planner-field-wide");
			const go = el("button", "planner-log-btn", st.kind ? `Log ${moodChoice(st.kind)[1]}` : "Pick an exercise");
			go.type = "button";
			go.disabled = !st.kind;
			go.addEventListener("click", async () => {
				if (!st.kind) return;
				const line = exerciseLine(st.kind, st);
				await this.health$(view, (t) => addUnder(t, EXERCISE.heading, line, { parent: EXERCISE.parent }));
				Object.assign(st, { kind: null, steps: "", kcal: "", note: "" });
				redrawPanel(this.panelKey);
			});
			box.append(grid, nums, note, go);
			const day = this.now(view);
			if (day.exercise.length) {
				box.append(el("div", "planner-panel-sub", `Today · ${fmt(day.steps)} steps · ${fmt(day.kcal)} cal burned`));
				for (const it of [...day.exercise].reverse()) {
					const meta = [it.steps ? `${fmt(it.steps)} steps` : "", it.kcal ? `${fmt(it.kcal)} cal` : "", it.note].filter(Boolean).join(" · ");
					box.append(this.logRow(view, `${it.time ? timeText(it.time) + " · " : ""}${it.kind}`, meta, it));
				}
			}
		});
	}

	// A logged line in a panel, with × to take it out of the health note.
	logRow(view, text, meta, it) {
		const row = el("div", "planner-log");
		row.append(el("span", "planner-log-text", text));
		if (meta) row.append(el("span", "planner-log-meta", meta));
		const x = el("button", "planner-log-x", "×");
		x.type = "button";
		x.title = "Remove";
		x.addEventListener("click", () => this.health$(view, (t) => removeLine(t, it.line, it.text)));
		row.append(x);
		return row;
	}

	// ---- Timeline and tasks --------------------------------------------------

	columns(view, ro) {
		const cols = el("div", "planner-cols" + (this.tasks.length ? "" : " planner-one"));
		cols.append(this.timeline(view, ro));
		if (this.tasks.length) {
			const right = el("div", "planner-tasks");
			for (const t of this.tasks) right.append(this.colored(view, ro, new TaskListWidget(t.cfg, t.result, null, this.from, this.path).toDOM(view), t.cfg.list));
			cols.append(right);
		}
		return cols;
	}

	// A card in its color, with a dot in its head that picks it. The pick
	// goes in the Daily template's planner block, so every day shares it (and
	// any color this note's own block sets for the card is dropped).
	colored(view, ro, card, key) {
		const c = cardColor(this.cfg, this.shared, key);
		if (c) { card.classList.add("planner-colored"); card.style.setProperty("--card-c", `var(--f${c})`); }
		const head = card.querySelector(".md-tl-head");
		if (!head || ro) return card;
		const dot = el("button", "planner-card-dot" + (c ? "" : " none"));
		dot.type = "button";
		dot.title = "Card color";
		dot.setAttribute("aria-label", "Card color");
		dot.addEventListener("mousedown", (e) => e.preventDefault());
		dot.addEventListener("click", () => {
			const r = dot.getBoundingClientRect();
			cardColorPicker(c, r.left, r.bottom + 6, (pick) => this.setColor(view, key, pick));
		});
		head.append(dot);
		return card;
	}

	async setColor(view, key, color) {
		const vault = view.state.facet(vaultHost);
		const set = (cfg) => {
			const colors = { ...cfg.colors };
			if (color) colors[key] = color; else delete colors[key];
			return { ...cfg, colors };
		};
		const { path } = sharedColors(vault);
		const own = readPlanner(dataviewBlocks(view.state, PLANNER)[this.n]?.code);
		if (!path) return saveBlock(view, this.n, set(own));
		if (key in own.colors) { const { [key]: _, ...rest } = own.colors; saveBlock(view, this.n, { ...own, colors: rest }); }
		try {
			await vault.write(path, (t) => editPlannerBlock(t, set) ?? t);
		} catch (e) {
			host?.toast?.("Couldn't save the color: " + (e?.message || e));
		}
	}

	timeline(view, ro) {
		const cfg = this.cfg;
		const card = el("div", "md-tl planner-timeline");
		const head = el("div", "md-tl-head");
		head.append(el("span", "md-tl-title", "Timeline"));
		const tools = el("span", "md-tl-tools");
		if (!ro && host && this.day) {
			const imp = el("button", "md-tl-btn", "Import");
			imp.type = "button";
			imp.title = "Add this day's events from the calendar picked under Aa > Daily note timeline";
			imp.addEventListener("mousedown", (e) => e.preventDefault());
			imp.addEventListener("click", async () => {
				imp.disabled = true;
				try {
					const events = await host.events(new Date(this.day + "T12:00"));
					if (!events) return;
					const cur = readPlanner(dataviewBlocks(view.state, PLANNER)[this.n]?.code);
					const r = addEvents(cur.timeline, events);
					if (r.added || r.colored) saveBlock(view, this.n, { ...cur, timeline: r.timeline });
					host.toast?.(r.added ? `Added ${r.added} event${r.added === 1 ? "" : "s"} to the timeline.` : events.length ? "The timeline already has every event." : "No events that day.");
				} finally { imp.disabled = false; }
			});
			tools.append(imp);
		}
		head.append(tools);
		card.append(head);
		this.colored(view, ro, card, "timeline");

		const { allDay, rows } = timelineRows(cfg.timeline, cfg);
		const save = (i, text, hour) => {
			const cur = readPlanner(dataviewBlocks(view.state, PLANNER)[this.n]?.code);
			const next = setEntry(cur.timeline, i, text, hour);
			if (JSON.stringify(next) !== JSON.stringify(cur.timeline)) saveBlock(view, this.n, { ...cur, timeline: next });
		};
		const grid = el("div", "planner-hours");
		const line = (label, items, hour) => {
			const r = el("div", "planner-hour" + (hour != null && isNow(this.day, hour) ? " now" : ""));
			r.append(el("span", "planner-hour-label", label));
			const cell = el("div", "planner-hour-items");
			for (const e of items) {
				const onSlot = hour != null && e.start === hour * 60 && (e.end == null || e.end === hour * 60 + 60);
				const item = el("span", "planner-entry");
				if (e.color) item.style.setProperty("--ev", e.color);
				if (!ro && host) onMenu(item, (x, y) => colorPicker(e.color, x, y, (color) => {
					const cur = readPlanner(dataviewBlocks(view.state, PLANNER)[this.n]?.code);
					saveBlock(view, this.n, { ...cur, timeline: setEntryColor(cur.timeline, e.index, color) });
				}));
				if (!onSlot && !e.allDay && e.start != null) item.append(el("span", "planner-entry-time", timeText(clock(e.start)) + (e.end != null ? `–${timeText(clock(e.end))}` : "")));
				item.append(el("span", "planner-entry-text", e.text));
				if (!ro) item.addEventListener("click", (ev) => { ev.stopPropagation(); this.editEntry(item, e, hour ?? cfg.start, save); });
				cell.append(item);
			}
			if (!ro && hour != null) {
				cell.addEventListener("click", () => this.editEntry(null, null, hour, save, cell));
				cell.title = "Click to add";
			}
			r.append(cell);
			grid.append(r);
		};
		if (allDay.length) line("All day", allDay, null);
		for (const r of rows) line(hourLabel(r.hour), r.items, r.hour);
		card.append(grid);
		return card;
	}

	// An entry's text as an input (a new one when e is null): Enter or leaving
	// it saves, Escape puts it back, an empty entry is removed.
	editEntry(item, e, hour, save, cell) {
		const input = el("input", "planner-entry-input");
		input.type = "text";
		input.value = e ? (e.allDay || (e.start === hour * 60 && (e.end == null || e.end === hour * 60 + 60)) ? e.text : `${clock(e.start)}${e.end != null ? " - " + clock(e.end) : ""} | ${e.text}`) : "";
		input.placeholder = `${hourLabel(hour)}…`;
		input.enterKeyHint = "done";
		let done = false;
		const finish = (keep) => {
			if (done) return;
			done = true;
			if (keep && (e ? input.value.trim() !== input.dataset.was : input.value.trim())) save(e ? e.index : null, input.value, hour);
			else input.replaceWith(...(item ? [item] : []));
		};
		input.dataset.was = input.value.trim();
		input.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
			else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finish(false); }
		});
		input.addEventListener("blur", () => finish(true));
		input.addEventListener("click", (ev) => ev.stopPropagation());
		if (item) item.replaceWith(input);
		else cell.append(input);
		input.focus();
	}

	ignoreEvent() { return true; }
	get estimatedHeight() { return 900; }
}

// Google Calendar's event colors as swatches, and No color (the accent):
// pick(color or null). Right-click or long-press an entry to open it.
function colorPicker(current, x, y, pick) {
	document.querySelector(".item-menu")?.remove();
	const box = el("div", "item-menu planner-colors");
	box.setAttribute("role", "dialog");
	box.setAttribute("aria-label", "Entry color");
	const row = el("div", "swatches");
	const swatch = (color, label) => {
		const b = el("button", "swatch" + (color ? "" : " none"));
		b.type = "button";
		b.title = label;
		b.setAttribute("aria-label", label);
		b.setAttribute("aria-pressed", String((current || null) === color));
		if (color) b.style.setProperty("--sw", color);
		b.addEventListener("click", () => { close(); pick(color); });
		row.append(b);
	};
	swatch(null, "No color");
	for (const [label, color] of Object.values(EVENT_COLORS)) swatch(color.toLowerCase(), label);
	box.append(row);
	document.body.append(box);
	const r = box.getBoundingClientRect();
	box.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
	box.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
	const away = (ev) => { if (!box.contains(ev.target)) close(); };
	const esc = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } };
	function close() {
		box.remove();
		document.removeEventListener("pointerdown", away, true);
		document.removeEventListener("keydown", esc, true);
	}
	setTimeout(() => { document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", esc, true); });
	box.querySelector("[aria-pressed=true]")?.focus();
}

// The theme's rainbow (--f1..--f7) and Default, for a card.
function cardColorPicker(current, x, y, pick) {
	document.querySelector(".item-menu")?.remove();
	const box = el("div", "item-menu planner-colors");
	box.setAttribute("role", "dialog");
	box.setAttribute("aria-label", "Card color");
	const row = el("div", "swatches");
	const swatch = (n, label) => {
		const b = el("button", "swatch" + (n ? "" : " none"));
		b.type = "button";
		b.title = label;
		b.setAttribute("aria-label", label);
		b.setAttribute("aria-pressed", String((current || null) === n));
		if (n) b.style.setProperty("--sw", `var(--f${n})`);
		b.addEventListener("click", () => { close(); pick(n); });
		row.append(b);
	};
	swatch(null, "Default");
	for (let n = 1; n <= CARD_COLORS; n++) swatch(n, `Color ${n}`);
	box.append(row);
	document.body.append(box);
	const r = box.getBoundingClientRect();
	box.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
	box.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
	const away = (ev) => { if (!box.contains(ev.target)) close(); };
	const esc = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } };
	function close() {
		box.remove();
		document.removeEventListener("pointerdown", away, true);
		document.removeEventListener("keydown", esc, true);
	}
	setTimeout(() => { document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", esc, true); });
	box.querySelector("[aria-pressed=true]")?.focus();
}

function timeText(hhmm) {
	if (!hhmm) return "";
	const [h, m] = hhmm.split(":").map(Number);
	return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
}

function isNow(day, hour) {
	const d = new Date();
	return day === isoDay(d) && d.getHours() === hour;
}

function build(state) {
	const b = new RangeSetBuilder();
	const path = state.facet(notePath), vault = state.facet(vaultHost);
	if (!vault || !path || UNTRUSTED.test(path)) return b.finish();
	const blocks = dataviewBlocks(state, PLANNER);
	if (!blocks.length) return b.finish();
	const sel = state.selection.ranges;
	const today = isoDay(new Date());
	const day = noteDay(path);
	let notes = null;
	blocks.forEach((blk, n) => {
		// Being edited: the cursor inside it. A cursor just before it (where a
		// daily note opens) leaves the planner drawn.
		if (sel.some((r) => r.to > blk.from && r.from <= blk.to)) return;
		const cfg = readPlanner(blk.code);
		const { foods } = nutrition(state, cfg);
		const health = healthDay(day ? vault.text(healthPathFor(path)) : null, foods);
		if (cfg.tasks.length && !notes) notes = allNotes(state);
		const tasks = cfg.tasks.map((tag) => {
			const tcfg = readConfig(`list: ${tag}`);
			return { cfg: tcfg, result: taskList(notes, tcfg, { path, today }) };
		});
		b.add(blk.from, blk.to, Decoration.replace({ widget: new PlannerWidget({ cfg, n, from: blk.from, path, day, health, shared: sharedColors(vault).colors, propsHidden: propertiesFolded(state), foodsCount: foods.length, tasks }), block: true }));
	});
	return b.finish();
}

// The Food panel without a planner on screen, for "Log food" (main.js): the
// day's planner block's settings when its daily note has one, else the
// defaults. anchor: anything with getBoundingClientRect(), under which it opens.
export function openFoodPanel(view, dailyPath, dailyText, anchor) {
	const code = String(dailyText || "").match(/```wr1t3r-planner[ \t]*\r?\n([\s\S]*?)\r?\n```/)?.[1] ?? "";
	const w = new PlannerWidget({ cfg: readPlanner(code), n: 0, path: dailyPath, day: noteDay(dailyPath), health: null, tasks: [] });
	w.foodPanel(view, anchor);
}

export const plannerBlocks = StateField.define({
	create: build,
	update(deco, tr) {
		const vault = tr.effects.some((e) => e.is(vaultChanged));
		if (tr.docChanged || tr.selection || vault || propertiesFolded(tr.startState) !== propertiesFolded(tr.state) || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});
