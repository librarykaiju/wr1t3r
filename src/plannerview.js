// Draws ```wr1t3r-planner blocks (src/planner.js works out what's in them):
// a banner and the day's title, the health buttons (Food, Water, Meds,
// Exercise, Mood, Sleep, Weight: the ones the block's buttons: picks) that
// write to the day's health note, then two columns, the timeline
// from 9 AM to 9 PM beside the day's task lists. Everything under the block
// (the note's "# Notes") is the note as usual. The health note gets the same
// title row, with a pill back to the daily note (healthHeader below).
// A planner not set up yet shows a card that walks through the buttons,
// targets (src/targets.js), medications (src/meds.js) and task lists; the
// "Planner" pill opens each of those on its own later.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { dataviewBlocks, blockBodyChange } from "./dataview.js";
import {
	PLANNER, readPlanner, writePlanner, setEntryColor, timelineRows, setEntry, addEvents, hourLabel, clock, healthPathFor,
	parseNutrition, searchFoods, addFoodRow, healthDay, syncHealth, toggleMeds, addUnder, removeLine, foodLine,
	mealAt, MEALS, WATER, MOOD, EXERCISE, moodLine, moodChoice, exerciseLine, cardColor, editPlannerBlock,
	dailyPathFor, healthDayOf, BUTTONS, SLEEP, WEIGHT, MEDS, sleepLine, hoursText, weightLine, HABITS, untick,
} from "./planner.js";
import { readHabits, parseHabit, habitLine, habitTickLine, progress, streak, dueOn } from "./habits.js";
import { parseMeds, dosesOn, doseStatus, overdue, medTakenLine, putMed, removeMed, parseTime, daysText } from "./meds.js";
import { workOut, readGoal, needsRecalc, ACTIVITY, PLANS, SEXES } from "./targets.js";
import { readConfig, taskList, noteDay } from "./tasklists.js";
import { TaskListWidget, allNotes } from "./tasklistview.js";
import { isoDay } from "./tasks.js";
import { imageRef } from "./pretty.js";
import { resolveNote } from "./links.js";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { propertiesFolded, setPropertiesHidden, frontmatterLines } from "./frontmatter.js";
import { openPanel, redrawPanel, closePanel } from "./basesui.js";
import { onMenu } from "./homeview.js";
import { EVENT_COLORS } from "./agenda.js";
import { menu, cardColorPicker } from "./basesui.js";
import { isOpen, openAsText } from "./drawnblocks.js";

const UNTRUSTED = /(^|\/)_(clippings|uploads)\//i;

// Set by main.js: { healthNote(dailyPath) -> Promise<path> (made from the
// template if needed), medsNote() -> Promise<path> (made if needed),
// dailyTemplate() -> Promise<path|null> (the built-in one saved to the vault
// if it isn't there), settings(tab), events(day) -> Promise<events|null>,
// image(ref, from), open(path), toast(text), usda(query) -> Promise<foods>
// (worker/usda.js) }.
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

// What every day shares: the Daily template's planner block (its card colors,
// and the SHARED settings readPlanner takes from it), read again only when
// the template changes. -> { colors, code, path } (code null when the
// template has no planner block, path null when there's no template).
let sharedCache = { text: undefined, colors: {}, code: null, path: null };
const TEMPLATE = /(^|\/)_templates\/Daily\.md$/i;
function sharedColors(vault) {
	const path = vault.paths().filter((p) => TEMPLATE.test(p)).sort((a, b) => a.length - b.length)[0] || null;
	const text = path ? vault.text(path) : null;
	if (text !== sharedCache.text || path !== sharedCache.path) {
		const code = text && String(text).match(/```wr1t3r-planner[ \t]*\r?\n([\s\S]*?)\r?\n?```/)?.[1];
		sharedCache = { text, path, code: code ?? null, colors: code != null ? readPlanner(code).colors : {} };
	}
	return sharedCache;
}

// The medicine list: the note the block names, else the vault's
// Medications.md. -> { path (null when there's none), meds }.
let medsCache = { text: undefined, path: undefined, meds: [] };
const MEDS_PATH = /(^|\/)Medications\.md$/i;
function medsList(state, cfg) {
	const vault = state.facet(vaultHost), paths = vault.paths();
	const path = (cfg.medications
		? resolveNote({ note: cfg.medications.replace(/^\[\[|\]\]$/g, "").split("|")[0], heading: "", wiki: true }, state.facet(notePath), paths)
		: paths.filter((p) => MEDS_PATH.test(p) && !/(^|\/)_templates\//i.test(p)).sort((a, b) => a.length - b.length)[0]) || null;
	const text = path ? vault.text(path) : null;
	if (text !== medsCache.text || path !== medsCache.path) medsCache = { text, path, meds: parseMeds(text) };
	return medsCache;
}

// Every health note's habit log (Map "YYYY-MM-DD" -> src/habits.js dayOf),
// each note read again only when its text changes, for streaks.
const habitCache = new Map();
function habitHistory(vault) {
	const days = new Map();
	for (const p of vault.paths()) {
		const day = healthDayOf(p);
		if (!day) continue;
		const text = vault.text(p);
		let c = habitCache.get(p);
		if (!c || c.text !== text) { c = { text, d: healthDay(text, []).habits }; habitCache.set(p, c); }
		days.set(day, c.d);
	}
	return days;
}

// The Habits card's rows for a day: [{ h, p (progress), s (streak), due }].
function habitRows(vault, habits, day) {
	if (!day || !habits.length) return [];
	const hist = habitHistory(vault);
	return habits.map((h) => ({ h, p: progress(h, hist.get(day)), s: streak(h, hist, day, { weeks: 1 }), due: dueOn(h, day) }));
}

// Rewrites the nth planner block's settings (the timeline lives there too).
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

// "2026-09-30" -> "Tuesday, September 30, 2026".
const dayTitle = (day) => new Date(day + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

// The title row: the title, "Today" when day is today, then pill buttons on
// the right. links: [[text, title, run]].
function titleRow(title, day, links) {
	const head = el("div", "planner-head");
	head.append(el("h1", "planner-title", title));
	if (day && day === isoDay(new Date())) head.append(el("span", "planner-today", "Today"));
	const box = el("span", "planner-links");
	for (const [text, title, run] of links) {
		const b = el("button", "planner-link", text);
		b.type = "button";
		b.title = title;
		b.addEventListener("mousedown", (e) => e.preventDefault());
		b.addEventListener("click", run);
		box.append(b);
	}
	head.append(box);
	return head;
}

// The Properties pill both headers share.
function propertiesLink(view) {
	const hidden = propertiesFolded(view.state);
	return [hidden ? "Properties" : "Hide properties", hidden ? "Show this note's properties" : "Hide this note's properties", () => setPropertiesHidden(view, !hidden)];
}

class PlannerWidget extends WidgetType {
	constructor(p) {
		super();
		Object.assign(this, p);
		const h = p.health;
		this.meds ??= { path: null, meds: [] };
		this.doses ??= [];
		this.habits ??= [];
		this.key = JSON.stringify([p.propsHidden, p.cfg, p.shared, p.n, p.path, p.day, h, p.foodsCount, this.meds.path, this.meds.meds, this.doses, this.habits.map((r) => [r.h, r.p, r.s.current, r.s.best, r.due]), p.day && p.day === isoDay(new Date()) ? new Date().getHours() : 0, p.tasks.map((t) => [t.cfg, t.result.groups.map((g) => [g.label, g.tasks.map((x) => [x.path, x.line, x.text, x.status])])])]);
	}
	eq(o) { return o.key === this.key; }

	toDOM(view) {
		const wrap = el("div", "planner");
		const ro = view.state.readOnly;
		const card = !ro && host && this.day && this.cfg.setup !== "done" ? this.setupCard(view) : null;
		wrap.append(...this.top(view), ...(card ? [card] : []), this.buttons(view, ro), this.columns(view, ro));
		const edit = el("button", "md-dv-edit planner-edit", "</>");
		edit.type = "button";
		edit.title = "Edit the planner's settings";
		edit.addEventListener("mousedown", (e) => {
			e.preventDefault();
			let pos = this.from;
			try { pos = view.posAtDOM(wrap); } catch {}
			openAsText(view, pos);
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
		const links = [];
		if (this.day && host) links.push(["Health note", "Open this day's health note", async () => { const p = await host.healthNote(this.path); if (p) host.open(p); }]);
		if (this.day && host && !view.state.readOnly) links.push(["Planner", "Choose the buttons, set targets and medications", (e) => {
			const r = e.currentTarget.getBoundingClientRect();
			const anchor = e.currentTarget;
			menu([
				["Choose buttons…", () => this.buttonsPanel(view, anchor)],
				["Set my targets…", () => this.targetsPanel(view, anchor)],
				["Medications…", () => this.medsPanel(view, anchor, { edit: !medsList(view.state, this.cfg).meds.length })],
				["Habits…", () => this.habitsPanel(view, anchor)],
				null,
				["Set up the planner…", () => this.setupPanel(view, anchor)],
			], r.left, r.bottom + 6);
		}]);
		links.push(propertiesLink(view));
		const title = this.cfg.title || (this.day ? dayTitle(this.day) : this.path.split("/").pop().replace(/\.md$/i, ""));
		out.push(titleRow(title, this.day, links));
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
		const healthMenu = (b, extra = []) => {
			if (!off) onMenu(b, (x, y) => menu([...extra, ...(extra.length ? [null] : []), ["Open the health note", () => host.open(healthPathFor(this.path))]], x, y));
		};
		const draw = {
			food: () => {
				const cal = h.totals.calories;
				const b = tile("food", "🍎", "Food", `${fmt(cal)} cal`, (b) => this.foodPanel(view, b), { pct: (cal / cfg.calories_target) * 100 });
				b.title = `${fmt(cal)} of ${fmt(cfg.calories_target)} calories` + (cfg.macros ? macroText(h.totals, cfg, ", ") : "");
				healthMenu(b);
			},
			water: () => {
				const water = tile("water", "💧", "Water", `${fmt(h.waterOz)} / ${fmt(cfg.water_target)} oz`, (b) => {
					b.classList.remove("planner-pop");
					void b.offsetWidth;
					b.classList.add("planner-pop");
					this.health$(view, (t) => addUnder(t, WATER.heading, String(cfg.water_step), { parent: WATER.parent }));
				}, { pct: (h.waterOz / cfg.water_target) * 100 });
				healthMenu(water, [
					[`Add ${cfg.water_step} oz`, () => this.health$(view, (t) => addUnder(t, WATER.heading, String(cfg.water_step), { parent: WATER.parent }))],
					...(h.water.length ? [["Remove the last one", () => this.health$(view, (t) => { const w = healthDay(t, []).water.at(-1); return w ? removeLine(t, w.line, w.text) : t; })]] : []),
				]);
			},
			meds: () => {
				const { meds, path } = this.meds;
				const st = this.doses.length ? doseStatus(this.doses, h.medsTaken) : null;
				let b;
				if (st) {
					const late = overdue(st, this.day);
					b = tile("meds", "💊", "Meds", st.done === st.due ? "All taken ✓" : `${st.done} of ${st.due}`, (b) => this.medsPanel(view, b), { pressed: st.done === st.due, pct: (st.done / st.due) * 100 });
					if (late.length) { b.classList.add("planner-late"); b.title = `Not taken yet: ${late.map((d) => `${d.name} (${timeText(d.time)})`).join(", ")}`; }
				} else if (meds.length) {
					b = tile("meds", "💊", "Meds", h.medsTaken.length ? `${h.medsTaken.length} taken` : "As needed", (b) => this.medsPanel(view, b));
				} else {
					b = tile("meds", "💊", "Meds", h.meds ? "Taken ✓" : "Not yet", () => this.health$(view, toggleMeds), { pressed: h.meds });
				}
				healthMenu(b, [
					[meds.length ? "Medications…" : "Set up medications…", () => this.medsPanel(view, b, { edit: !meds.length })],
					...(path ? [["Open the medications list", () => host.open(path)]] : []),
				]);
			},
			exercise: () => {
				const ex = [h.steps ? `${fmt(h.steps)} steps` : "", h.kcal ? `${fmt(h.kcal)} cal` : ""].filter(Boolean).join(" · ");
				const b = tile("exercise", "👟", "Exercise", ex || "Get moving", (b) => this.exercisePanel(view, b), { pct: (h.steps / cfg.steps_target) * 100 });
				b.title = `${fmt(h.steps)} of ${fmt(cfg.steps_target)} steps, ${fmt(h.kcal)} of ${fmt(cfg.activity_target)} cal burned`;
				healthMenu(b);
			},
			mood: () => {
				const last = h.moods.at(-1);
				const lastMood = last && moodChoice(last.mood);
				healthMenu(tile("mood", lastMood?.[0] || "🙂", "Mood", last ? `${lastMood[1]}${last.time ? " · " + timeText(last.time) : ""}` : "How are you?", (b) => this.moodPanel(view, b)));
			},
			sleep: () => {
				const b = tile("sleep", "😴", "Sleep", h.sleepHours ? hoursText(h.sleepHours) : "Log sleep", (b) => this.sleepPanel(view, b), { pct: (h.sleepHours / cfg.sleep_target) * 100 });
				b.title = `${hoursText(h.sleepHours)} of ${hoursText(cfg.sleep_target)} sleep`;
				healthMenu(b);
			},
			weight: () => {
				const unit = h.weights.at(-1)?.unit || cfg.units;
				const b = tile("weight", "⚖️", "Weight", h.weight != null ? `${h.weight} ${unit}` : "Log weight", (b) => this.weightPanel(view, b));
				if (h.weight != null && needsRecalc(cfg.goal, h.weight)) { b.classList.add("planner-nudge"); b.title = "Your weight has moved since your targets were set. Open to update them."; }
				healthMenu(b);
			},
		};
		for (const id of cfg.buttons) draw[id]?.();
		grid.style.setProperty("--n", Math.max(1, grid.children.length));
		const n = grid.children.length;
		grid.style.setProperty("--n-phone", n <= 3 ? Math.max(1, n) : n === 4 ? 2 : n <= 6 ? 3 : 4);
		if (!this.day) grid.title = "The health buttons work in a daily note (named YYYY-MM-DD).";
		return grid;
	}

	// The day's scheduled doses from the list as it is now (the widget may be
	// a moment behind).
	dosesNow(view) {
		return this.day ? dosesOn(medsList(view.state, this.cfg).meds, this.day) : [];
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
				const doses = this.dosesNow(view);
				await vault.write(path, (t) => syncHealth(fn(t), foods, this.cfg, doses, this.day));
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
				box.append(el("div", "planner-panel-sub", `Today · ${fmt(day.totals.calories)} of ${fmt(this.cfg.calories_target)} cal` + (this.cfg.macros ? macroText(day.totals, this.cfg) : ` · ${fmt(day.totals.protein)} g protein · ${fmt(day.totals.carbs)} g carbs · ${fmt(day.totals.fat)} g fat`) + ` · ${fmt(day.totals.fiber)} g fiber`));
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

	// ---- Medications --------------------------------------------------------

	// Today's doses with a Take button each, then the as-needed ones; or,
	// with edit (or no list yet), the list itself to add to and change.
	medsPanel(view, anchor, { edit = false } = {}) {
		const st = { edit, form: null };
		openPanel(this.panelKey, "meds", anchor, (box) => {
			box.classList.add("planner-panel");
			const { meds, path } = medsList(view.state, this.cfg);
			if (st.form || st.edit || !meds.length) {
				box.append(el("div", "planner-panel-title", "Your medications"));
				this.medsEditor(view, box, st);
				if (!st.form && meds.length) box.append(panelButton("planner-log-btn", "Done", () => { st.edit = false; redrawPanel(this.panelKey); }));
				return;
			}
			box.append(el("div", "planner-panel-title", "Medications"));
			const day = this.now(view);
			const status = doseStatus(this.dosesNow(view), day.medsTaken);
			const take = (dose, forTime) => this.health$(view, (t) => addUnder(t, MEDS.heading, medTakenLine(dose, forTime)));
			if (status.doses.length) {
				const late = new Set(overdue(status, this.day));
				const mins = new Date().getHours() * 60 + new Date().getMinutes();
				const dueNow = status.doses.filter((d) => !d.taken && this.day === isoDay(new Date()) && Number(d.time.slice(0, 2)) * 60 + Number(d.time.slice(3)) <= mins + 30);
				box.append(el("div", "planner-panel-sub", `Today · ${status.done} of ${status.due} taken`));
				for (const d of status.doses) {
					const row = el("div", "planner-dose" + (d.taken ? " taken" : late.has(d) ? " late" : ""));
					row.append(el("span", "planner-dose-time", timeText(d.time)), el("span", "planner-log-text", d.name + (d.dose ? ` · ${d.dose}` : "")));
					if (d.taken) {
						row.append(el("span", "planner-log-meta", `✓ ${d.taken.time ? timeText(d.taken.time) : "taken"}`));
						const x = panelButton("planner-log-x", "×", () => this.health$(view, (t) => removeLine(t, d.taken.line, d.taken.text)));
						x.title = "Not taken after all";
						row.append(x);
					} else row.append(panelButton("planner-take", "Take", () => take(d, d.time)));
					box.append(row);
				}
				if (dueNow.length > 1) box.append(panelButton("planner-log-btn", `Take all due now (${dueNow.length})`, async () => {
					for (const d of dueNow) await take(d, d.time);
				}));
			}
			const prn = meds.filter((m) => m.asNeeded);
			if (prn.length) {
				box.append(el("div", "planner-panel-sub", "As needed"));
				for (const m of prn) {
					const row = el("div", "planner-dose");
					row.append(el("span", "planner-log-text", m.name + (m.dose ? ` · ${m.dose}` : "")), panelButton("planner-take", "Take", () => take(m, null)));
					box.append(row);
				}
			}
			if (status.extra.length) {
				box.append(el("div", "planner-panel-sub", "Also taken today"));
				for (const it of status.extra) box.append(this.logRow(view, `${it.time ? timeText(it.time) + " · " : ""}${it.name}`, it.dose, it));
			}
			const foot = el("div", "planner-panel-foot");
			foot.append(panelButton("planner-link", "Edit the list", () => { st.edit = true; redrawPanel(this.panelKey); }));
			if (path) foot.append(panelButton("planner-link", "Open the list note", () => { closePanel(); host.open(path); }));
			box.append(foot);
		});
	}

	// The medicine list with Edit and × on each, an Add button, and the form
	// (st.form) for one. Writes straight to the list note.
	medsEditor(view, box, st) {
		const vault = view.state.facet(vaultHost);
		const { meds, path } = medsList(view.state, this.cfg);
		const redraw = () => redrawPanel(this.panelKey);
		const write = async (fn) => {
			try {
				const p = path || await host.medsNote();
				if (p) await vault.write(p, fn);
			} catch (e) {
				host.toast?.("Couldn't save the medications list: " + (e?.message || e));
			}
		};
		if (st.form) {
			const f = st.form;
			const field = (key, label, placeholder) => {
				const wrap = el("label", "planner-field");
				const input = el("input");
				Object.assign(input, { type: "text", placeholder, value: f[key] });
				input.dataset.focus = "med-" + key;
				input.addEventListener("input", () => { f[key] = input.value; });
				wrap.append(el("span", null, label), input);
				return wrap;
			};
			const row = el("div", "planner-food-opts");
			row.append(field("name", "Medicine", "Lisinopril"), field("dose", "Dose", "10 mg"));
			box.append(row);
			const prn = el("label", "planner-check");
			const cb = el("input");
			cb.type = "checkbox";
			cb.checked = f.asNeeded;
			cb.addEventListener("change", () => { f.asNeeded = cb.checked; redraw(); });
			prn.append(cb, " Only as needed (no set times)");
			box.append(prn);
			if (!f.asNeeded) {
				box.append(field("times", "Times (comma between them)", "8am, 8pm"));
				const days = el("div", "planner-days");
				for (const d of [1, 2, 3, 4, 5, 6, 0]) {
					const b = panelButton("planner-day", ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d], () => { f.days.has(d) ? f.days.delete(d) : f.days.add(d); redraw(); });
					b.setAttribute("aria-pressed", String(f.days.has(d)));
					days.append(b);
				}
				box.append(days);
			}
			if (f.error) box.append(el("p", "planner-panel-error", f.error));
			const foot = el("div", "planner-panel-foot");
			foot.append(panelButton("planner-link", "Cancel", () => { st.form = null; redraw(); }), panelButton("planner-log-btn", f.line == null ? "Add" : "Save", async () => {
				const name = f.name.trim();
				const parts = f.times.split(/\s*,\s*/).filter(Boolean);
				const times = f.asNeeded ? [] : parts.map(parseTime);
				if (!name) f.error = "Give it a name.";
				else if (!f.asNeeded && (!times.length || times.some((t) => !t))) f.error = "Times look like 8am, 8:30pm or 20:00.";
				else if (!f.asNeeded && !f.days.size) f.error = "Pick at least one day.";
				else {
					st.form = null;
					await write((t) => putMed(t, { name, dose: f.dose.trim(), times: [...new Set(times)].sort(), days: f.days.size === 7 ? null : [...f.days].sort() }, f.line));
				}
				redraw();
			}));
			box.append(foot);
			setTimeout(() => { if (!box.contains(document.activeElement)) box.querySelector("input")?.focus(); });
			return;
		}
		const open = (m) => {
			st.form = m
				? { line: m.line, name: m.name, dose: m.dose, times: m.times.map(timeText).join(", "), asNeeded: m.asNeeded, days: new Set(m.days || [0, 1, 2, 3, 4, 5, 6]), error: "" }
				: { line: null, name: "", dose: "", times: "", asNeeded: false, days: new Set([0, 1, 2, 3, 4, 5, 6]), error: "" };
			redraw();
		};
		if (!meds.length) box.append(el("p", "planner-panel-empty", "Nothing listed yet. Add each medicine with its dose and when you take it, and the Meds button counts the day's doses."));
		for (const m of meds) {
			const row = el("div", "planner-log");
			const when = m.asNeeded ? "as needed" : m.times.map(timeText).join(", ") + (m.days ? ` · ${daysText(m.days)}` : "");
			row.append(el("span", "planner-log-text", m.name + (m.dose ? ` · ${m.dose}` : "")), el("span", "planner-log-meta", when));
			row.append(panelButton("planner-link", "Edit", () => open(m)));
			const x = panelButton("planner-log-x", "×", () => { if (confirm(`Take ${m.name} off the list?`)) write((t) => removeMed(t, m.line)); });
			x.title = "Take it off the list";
			row.append(x);
			box.append(row);
		}
		box.append(panelButton("planner-log-btn", "Add a medicine", () => open(null)));
		const rem = el("label", "planner-check");
		const cb = el("input");
		cb.type = "checkbox";
		cb.checked = this.cfg.med_reminders;
		cb.addEventListener("change", () => { this.cfg = { ...this.cfg, med_reminders: cb.checked }; this.saveShared(view, { med_reminders: cb.checked }); });
		rem.append(cb, " Remind me at each dose's time");
		box.append(rem, el("p", "planner-panel-hint", "Reminders need reminders turned on under Settings (on the paid app they show while wr1t3r is open)."));
	}

	// ---- Sleep and weight -----------------------------------------------------

	sleepPanel(view, anchor) {
		const last = this.health.sleep.at(-1);
		const st = { bed: last?.bed || "23:00", wake: last?.wake || "07:00", note: "" };
		openPanel(this.panelKey, "sleep", anchor, (box) => {
			box.classList.add("planner-panel");
			box.append(el("div", "planner-panel-title", "How did you sleep?"));
			const row = el("div", "planner-food-opts");
			const time = (key, label) => {
				const wrap = el("label", "planner-field");
				const input = el("input");
				Object.assign(input, { type: "time", value: st[key] });
				input.dataset.focus = key;
				input.addEventListener("input", () => { st[key] = input.value; hours.textContent = preview(); });
				wrap.append(el("span", null, label), input);
				return wrap;
			};
			const preview = () => { const h = sleepHoursOf(st.bed, st.wake); return h == null ? "" : `${hoursText(h)} of ${hoursText(this.cfg.sleep_target)}`; };
			const hours = el("div", "planner-panel-sub", preview());
			row.append(time("bed", "Went to bed"), time("wake", "Woke up"));
			const note = el("label", "planner-field planner-field-wide");
			const ni = el("input");
			Object.assign(ni, { type: "text", placeholder: "Optional", value: st.note });
			ni.dataset.focus = "note";
			ni.addEventListener("input", () => { st.note = ni.value; });
			note.append(el("span", null, "Note"), ni);
			const go = panelButton("planner-log-btn", "Log sleep", async () => {
				if (sleepHoursOf(st.bed, st.wake) == null) return;
				await this.health$(view, (t) => addUnder(t, SLEEP.heading, sleepLine(st.bed, st.wake, st.note)));
				st.note = "";
			});
			box.append(row, hours, note, go);
			const day = this.now(view);
			if (day.sleep.length) {
				box.append(el("div", "planner-panel-sub", `Today · ${hoursText(day.sleepHours)}`));
				for (const it of day.sleep) box.append(this.logRow(view, it.bed ? `${timeText(it.bed)}–${timeText(it.wake)}` : "Sleep", [hoursText(it.hours), it.note].filter(Boolean).join(" · "), it));
			}
		});
	}

	weightPanel(view, anchor) {
		const vault = view.state.facet(vaultHost);
		const before = this.day ? lastWeight(vault, this.day) : null;
		const st = { value: String(this.health.weight ?? before?.value ?? "") };
		openPanel(this.panelKey, "weight", anchor, (box) => {
			box.classList.add("planner-panel");
			box.append(el("div", "planner-panel-title", "Log weight"));
			const unit = this.cfg.units;
			const row = el("div", "planner-food-opts");
			const wrap = el("label", "planner-servings");
			const input = el("input");
			Object.assign(input, { type: "number", min: "0", step: "0.1", inputMode: "decimal", value: st.value });
			input.dataset.focus = "weight";
			input.addEventListener("input", () => { st.value = input.value; });
			input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go.click(); } });
			wrap.append(input, ` ${unit}`);
			const go = panelButton("planner-log-btn", "Log", async () => {
				const v = Number(st.value);
				if (!(v > 0)) return;
				await this.health$(view, (t) => addUnder(t, WEIGHT.heading, weightLine(v, unit)));
			});
			row.append(wrap, go);
			box.append(row);
			const day = this.now(view);
			const now = day.weight ?? null;
			if (before && now != null && (before.unit || unit) === (day.weights.at(-1)?.unit || unit)) {
				const diff = Math.round((now - before.value) * 10) / 10;
				box.append(el("div", "planner-panel-sub", `${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${Math.abs(diff)} ${unit} since ${new Date(before.day + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}`));
			}
			if (now != null && needsRecalc(this.cfg.goal, now)) {
				box.append(el("p", "planner-panel-hint", `Your targets were worked out at ${readGoal(this.cfg.goal).weight} ${unit}. Update them for ${now} ${unit}?`));
				box.append(panelButton("planner-link", "Update my targets", () => this.targetsPanel(view, anchor, { weight: now })));
			}
			if (day.weights.length) {
				box.append(el("div", "planner-panel-sub", "Today"));
				for (const it of [...day.weights].reverse()) box.append(this.logRow(view, `${it.time ? timeText(it.time) + " · " : ""}${it.value} ${it.unit || unit}`, "", it));
			}
			setTimeout(() => { if (!box.contains(document.activeElement)) input.focus(); });
		});
	}

	// ---- Settings every day shares ------------------------------------------

	// Saves settings to the Daily template's planner block (made from the
	// built-in one if the vault has none), so every day has them, and takes
	// them out of this note's own block so they don't hide the template's.
	// tasks is saved to both (each day keeps its own copy). With no template
	// to write to (or on the template itself), this note's block gets them.
	async saveShared(view, values) {
		const vault = view.state.facet(vaultHost);
		const own = () => readPlanner(dataviewBlocks(view.state, PLANNER)[this.n]?.code);
		try {
			let path = sharedColors(vault).path;
			if (!path && host?.dailyTemplate) path = await host.dailyTemplate();
			const text = path && path !== this.path ? vault.text(path) : null;
			if (text == null || editPlannerBlock(text, (c) => c) == null) return saveBlock(view, this.n, { ...own(), ...values });
			await vault.write(path, (t) => editPlannerBlock(t, (c) => ({ ...c, ...values })) ?? t);
			const cur = own(), next = { ...cur };
			for (const k of Object.keys(values)) next[k] = k === "tasks" ? values.tasks : undefined;
			if (writePlanner(next) !== writePlanner(cur)) saveBlock(view, this.n, next);
		} catch (e) {
			host?.toast?.("Couldn't save the planner settings: " + (e?.message || e));
		}
	}

	// Ticks for which buttons show, with arrows to move them.
	// list: [{ id, on }] in order; change(list) after each change.
	buttonsPicker(box, list, change) {
		list.forEach((b, i) => {
			const [, emoji, label] = BUTTONS.find(([id]) => id === b.id);
			const row = el("div", "planner-pick");
			const lab = el("label", "planner-check");
			const cb = el("input");
			cb.type = "checkbox";
			cb.checked = b.on;
			cb.addEventListener("change", () => { list[i] = { ...b, on: cb.checked }; change(list); });
			lab.append(cb, ` ${emoji} ${label}`);
			const move = (d) => { const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; change(list); };
			const up = panelButton("planner-arrow", "↑", () => move(-1));
			const down = panelButton("planner-arrow", "↓", () => move(1));
			up.title = "Move left";
			down.title = "Move right";
			up.disabled = i === 0;
			down.disabled = i === list.length - 1;
			row.append(lab, up, down);
			box.append(row);
		});
	}

	buttonList() {
		return [...this.cfg.buttons.map((id) => ({ id, on: true })), ...BUTTONS.filter(([id]) => !this.cfg.buttons.includes(id)).map(([id]) => ({ id, on: false }))];
	}

	buttonsPanel(view, anchor) {
		const st = { list: this.buttonList() };
		openPanel(this.panelKey, "buttons", anchor, (box) => {
			box.classList.add("planner-panel");
			box.append(el("div", "planner-panel-title", "Buttons on the daily note"));
			this.buttonsPicker(box, st.list, (list) => {
				st.list = list;
				this.saveShared(view, { buttons: list.filter((b) => b.on).map((b) => b.id) });
				redrawPanel(this.panelKey);
			});
			box.append(el("p", "planner-panel-hint", "Every daily note uses these."));
		});
	}

	// The goal form and the targets, editable. -> st as targetsForm keeps it.
	targetsState({ weight } = {}) {
		const c = this.cfg, g = readGoal(c.goal);
		const units = g?.units || c.units;
		const height = g?.height ?? "";
		return {
			units, sex: g?.sex || "female", age: g?.age ?? "", weight: weight ?? g?.weight ?? "",
			ft: units === "lb" && height ? Math.floor(height / 12) : "", inch: units === "lb" && height ? Math.round(height % 12) : "", cm: units === "kg" ? height : "",
			activity: g?.activity || "light", plan: g?.plan || "maintain",
			calories_target: c.calories_target, water_target: c.water_target, steps_target: c.steps_target, sleep_target: c.sleep_target,
			macros: c.macros, protein_target: c.protein_target ?? "", fat_target: c.fat_target ?? "", carbs_target: c.carbs_target ?? "",
			note: weight != null && g ? "Weight updated. Press Work out my targets for the new numbers." : "", worked: false,
		};
	}

	goalOf(st) {
		const height = st.units === "lb" ? (Number(st.ft) || 0) * 12 + (Number(st.inch) || 0) : Number(st.cm);
		return readGoal({ units: st.units, sex: st.sex, age: st.age, height, weight: st.weight, activity: st.activity, plan: st.plan });
	}

	// The values targetsForm's state saves as.
	targetValues(st) {
		const n = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
		const goal = this.goalOf(st);
		const out = { units: st.units, macros: !!st.macros };
		if (goal) out.goal = goal;
		for (const k of ["calories_target", "water_target", "steps_target", "sleep_target"]) if (n(st[k])) out[k] = n(st[k]);
		for (const k of ["protein_target", "fat_target", "carbs_target"]) out[k] = st.macros ? n(st[k]) : this.cfg[k] ?? null;
		return out;
	}

	targetsForm(box, st, redraw) {
		const sel = (key, label, options) => {
			const wrap = el("label", "planner-field");
			const s = el("select");
			for (const [v, text] of options) s.append(new Option(text, v));
			s.value = st[key];
			s.addEventListener("change", () => { st[key] = s.value; redraw(); });
			wrap.append(el("span", null, label), s);
			return wrap;
		};
		const num = (key, label, step = "1") => {
			const wrap = el("label", "planner-field");
			const input = el("input");
			Object.assign(input, { type: "number", min: "0", step, inputMode: "decimal", value: st[key] });
			input.dataset.focus = "t-" + key;
			input.addEventListener("input", () => { st[key] = input.value; });
			wrap.append(el("span", null, label), input);
			return wrap;
		};
		const row = (...kids) => { const r = el("div", "planner-food-opts"); r.append(...kids); return r; };
		box.append(el("div", "planner-panel-sub", "About you"));
		box.append(row(sel("units", "Units", [["lb", "lb, ft/in"], ["kg", "kg, cm"]]), sel("sex", "Sex", SEXES), num("age", "Age")));
		box.append(st.units === "lb" ? row(num("ft", "Height ft"), num("inch", "in"), num("weight", "Weight lb", "0.1")) : row(num("cm", "Height cm"), num("weight", "Weight kg", "0.1")));
		box.append(row(sel("activity", "Activity", ACTIVITY.map(([k, label]) => [k, label]))), row(sel("plan", "Goal", PLANS.map(([k, lb, kg]) => [k, st.units === "kg" ? kg : lb]))));
		box.append(panelButton("planner-link", "Work out my targets", () => {
			const r = workOut(this.goalOf(st), { water_step: this.cfg.water_step });
			if (!r) st.note = "Fill in age, height and weight first.";
			else {
				Object.assign(st, { calories_target: r.calories_target, water_target: r.water_target, protein_target: r.protein_target, fat_target: r.fat_target, carbs_target: r.carbs_target, worked: true });
				st.note = r.floored ? `That goal would go under ${fmt(r.calories_target)} calories a day, so it stops there. A slower goal is safer.` : `About ${fmt(r.rest)} calories at rest; the targets below are worked out from that. Change any of them.`;
			}
			redraw();
		}));
		if (st.note) box.append(el("p", "planner-panel-hint", st.note));
		box.append(el("div", "planner-panel-sub", "Daily targets"));
		box.append(row(num("calories_target", "Calories"), num("water_target", "Water oz")), row(num("steps_target", "Steps"), num("sleep_target", "Sleep hours", "0.25")));
		const mac = el("label", "planner-check");
		const cb = el("input");
		cb.type = "checkbox";
		cb.checked = !!st.macros;
		cb.addEventListener("change", () => {
			st.macros = cb.checked;
			const r = st.macros && !st.protein_target && workOut(this.goalOf(st), { water_step: this.cfg.water_step });
			if (r) Object.assign(st, { protein_target: r.protein_target, fat_target: r.fat_target, carbs_target: r.carbs_target });
			redraw();
		});
		mac.append(cb, " Protein, fat and carbs targets too");
		box.append(mac);
		if (st.macros) box.append(row(num("protein_target", "Protein g"), num("fat_target", "Fat g"), num("carbs_target", "Carbs g")));
	}

	targetsPanel(view, anchor, opts = {}) {
		const st = this.targetsState(opts);
		openPanel(this.panelKey, "targets", anchor, (box) => {
			box.classList.add("planner-panel");
			box.append(el("div", "planner-panel-title", "Your targets"));
			this.targetsForm(box, st, () => redrawPanel(this.panelKey));
			box.append(panelButton("planner-log-btn", "Save targets", async () => {
				closePanel();
				await this.saveShared(view, this.targetValues(st));
				host.toast?.("Targets saved for every day.");
			}));
		});
	}

	// ---- Setup ---------------------------------------------------------------

	setupCard(view) {
		const card = el("div", "planner-setup");
		card.append(el("div", "planner-setup-text", "Set up your planner: pick your buttons, habits, targets and medications."));
		const start = panelButton("planner-log-btn", "Start", () => this.setupPanel(view, start));
		card.append(start, panelButton("planner-link", "Not now", () => this.saveShared(view, { setup: "done" })));
		return card;
	}

	setupPanel(view, anchor) {
		const st = { step: 0, buttons: this.buttonList(), targets: this.targetsState(), meds: { edit: true, form: null }, habits: { list: [...this.cfg.habits], form: null }, tasks: this.cfg.tasks.join(", ") };
		const steps = () => ["buttons", "targets", ...(st.buttons.some((b) => b.id === "meds" && b.on) ? ["meds"] : []), "habits", "tasks"];
		const redraw = () => redrawPanel(this.panelKey);
		const save = {
			buttons: () => this.saveShared(view, { buttons: st.buttons.filter((b) => b.on).map((b) => b.id) }),
			targets: () => this.saveShared(view, this.targetValues(st.targets)),
			meds: () => {},
			habits: () => {},
			tasks: () => this.saveShared(view, { tasks: st.tasks.split(/[\s,]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean) }),
		};
		openPanel(this.panelKey, "setup", anchor, (box) => {
			box.classList.add("planner-panel");
			const list = steps();
			const i = Math.min(st.step, list.length - 1), step = list[i];
			box.append(el("div", "planner-panel-title", ["Your buttons", "Your targets", "Your medications", "Your habits", "Task lists and calendar"][["buttons", "targets", "meds", "habits", "tasks"].indexOf(step)]));
			box.append(el("div", "planner-panel-sub", `Step ${i + 1} of ${list.length}`));
			if (step === "buttons") {
				box.append(el("p", "planner-panel-hint", "Tick the buttons you want on every daily note."));
				this.buttonsPicker(box, st.buttons, (l) => { st.buttons = l; redraw(); });
			} else if (step === "targets") {
				this.targetsForm(box, st.targets, redraw);
			} else if (step === "meds") {
				this.medsEditor(view, box, st.meds);
			} else if (step === "habits") {
				this.habitsEditor(view, box, st.habits);
			} else {
				const wrap = el("label", "planner-field planner-field-wide");
				const input = el("input");
				Object.assign(input, { type: "text", value: st.tasks, placeholder: "todo, crit" });
				input.dataset.focus = "tasks";
				input.addEventListener("input", () => { st.tasks = input.value; });
				wrap.append(el("span", null, "Task lists: the tags whose tasks show beside the timeline"), input);
				box.append(wrap, el("p", "planner-panel-hint", "To fill the timeline from a calendar, pick one under Settings > Tasks and daily note."));
				box.append(panelButton("planner-link", "Open that setting", () => { closePanel(); host.settings?.("tasks"); }));
			}
			if ((st.meds.form && step === "meds") || (st.habits.form && step === "habits")) return;
			const foot = el("div", "planner-panel-foot");
			if (i > 0) foot.append(panelButton("planner-link", "Back", () => { st.step = i - 1; redraw(); }));
			foot.append(panelButton("planner-link", "Skip", () => {
				if (i === list.length - 1) { closePanel(); this.saveShared(view, { setup: "done" }); }
				else { st.step = i + 1; redraw(); }
			}));
			foot.append(panelButton("planner-log-btn", i === list.length - 1 ? "Finish" : "Next", async () => {
				await save[step]();
				if (i === list.length - 1) {
					closePanel();
					await this.saveShared(view, { setup: "done" });
					host.toast?.("Your planner is set up. Planner (top right) changes any of it later.");
				} else { st.step = i + 1; redraw(); }
			}));
			box.append(foot);
		});
	}

	// ---- Habits -------------------------------------------------------------

	// The Habits card: each habit with a check, how far along it is today and
	// its streak. A tap ticks it (a second tap on a once-a-day habit unticks
	// it); a words habit ticks itself from the words written (main.js). The
	// name opens its stats.
	habitsCard(view, ro) {
		const card = el("div", "md-tl planner-habits");
		const off = ro || !host || !this.day;
		const head = el("div", "md-tl-head");
		const due = this.habits.filter((r) => r.due);
		head.append(el("span", "md-tl-title", "Habits"), el("span", "md-tl-count", `${due.filter((r) => r.p.done).length}/${due.length}`));
		const tools = el("span", "md-tl-tools");
		if (!off) {
			const edit = panelButton("md-tl-btn", "Edit", () => this.habitsPanel(view, edit));
			edit.title = "Add, change or remove habits";
			tools.append(edit);
		}
		head.append(tools);
		card.append(head);
		const list = el("ul", "md-tl-list planner-habit-list");
		for (const { h, p, s, due: isDue } of this.habits) {
			const li = el("li", "planner-habit" + (p.done ? " done" : "") + (isDue ? "" : " off"));
			const check = el("button", "planner-habit-check", p.done ? "✓" : h.words ? "✍" : "");
			check.type = "button";
			check.disabled = off || h.words;
			check.setAttribute("aria-pressed", String(p.done));
			check.setAttribute("aria-label", (p.done ? "Done: " : "Tick: ") + h.name);
			check.title = h.words ? `Ticks itself once you've written ${fmt(h.goal)} words today` : h.goal > 1 ? `Add one (${p.n} of ${h.goal})` : p.done ? "Done. Tap to untick" : "Tick it off";
			check.addEventListener("mousedown", (e) => e.preventDefault());
			check.addEventListener("click", () => {
				check.classList.remove("planner-pop");
				void check.offsetWidth;
				check.classList.add("planner-pop");
				this.health$(view, (t) => (h.goal === 1 && p.done ? untick(t, h.name) : addUnder(t, HABITS.heading, habitTickLine(h.name))));
			});
			const name = el("button", "planner-habit-name", h.name);
			name.type = "button";
			name.title = "See its streak and history";
			name.disabled = !this.day || !host;
			name.addEventListener("mousedown", (e) => e.preventDefault());
			name.addEventListener("click", () => this.habitStats(view, name, h));
			const meta = el("span", "planner-habit-meta", h.words ? `${fmt(p.n)} / ${fmt(h.goal)} words` : h.goal > 1 ? `${p.n} / ${h.goal}` : isDue ? "" : "not today");
			li.append(check, name, meta);
			if (s.current) {
				const fire = el("span", "planner-habit-streak", `🔥 ${s.current}`);
				fire.title = `${s.current} day${s.current === 1 ? "" : "s"} in a row (best ${s.best})`;
				li.append(fire);
			}
			if (h.goal > 1 && !h.words) {
				const bar = el("span", "planner-habit-bar");
				const fill = el("span");
				fill.style.width = Math.min(100, (p.n / h.goal) * 100) + "%";
				bar.append(fill);
				li.append(bar);
			}
			if (!off) onMenu(li, (x, y) => menu([
				...(p.n && !h.words ? [["Take one off", () => this.health$(view, (t) => untick(t, h.name))]] : []),
				["Streak and history…", () => this.habitStats(view, name, h)],
				["Edit habits…", () => this.habitsPanel(view, name)],
			], x, y));
			list.append(li);
		}
		card.append(list);
		return card;
	}

	// One habit's record: its streak, best run, the last 30 days and a grid of
	// the last 16 weeks, read from the health notes.
	habitStats(view, anchor, h) {
		openPanel(this.panelKey, "habit", anchor, (box) => {
			box.classList.add("planner-panel", "planner-habit-stats");
			const hist = habitHistory(view.state.facet(vaultHost));
			const s = streak(h, hist, this.day, { weeks: 16 });
			box.append(el("div", "planner-panel-title", h.name));
			const when = [h.words ? `${fmt(h.goal)} words a day` : h.goal > 1 ? `${h.goal} times a day` : "Once a day", daysText(h.days)].filter(Boolean).join(" · ");
			box.append(el("div", "planner-panel-sub", when));
			const nums = el("div", "planner-habit-nums");
			const num = (n, label) => { const d = el("div"); d.append(el("b", null, n), el("span", null, label)); nums.append(d); };
			num(`🔥 ${s.current}`, s.current === 1 ? "day in a row" : "days in a row");
			num(String(s.best), "best run");
			num(s.due ? Math.round((s.done / s.due) * 100) + "%" : "–", `last 30 days (${s.done} of ${s.due})`);
			box.append(nums);
			const grid = el("div", "planner-habit-grid");
			grid.setAttribute("role", "img");
			grid.setAttribute("aria-label", `The last 16 weeks: ${s.grid.filter((g) => g.state === "done").length} days done`);
			for (const g of s.grid) {
				const c = el("span", "hg-" + g.state);
				c.title = new Date(g.day + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + ": " + { done: "done", missed: "missed", off: "not due", today: "not yet", before: "before you started", future: "" }[g.state];
				grid.append(c);
			}
			box.append(grid);
			const key = el("div", "planner-habit-key");
			for (const [cls, label] of [["done", "Done"], ["missed", "Missed"], ["off", "Not due"]]) {
				const k = el("span");
				k.append(el("span", "hg-" + cls), " " + label);
				key.append(k);
			}
			box.append(key);
		});
	}

	habitsPanel(view, anchor) {
		const st = { list: [...this.cfg.habits], form: null };
		openPanel(this.panelKey, "habits", anchor, (box) => {
			box.classList.add("planner-panel");
			box.append(el("div", "planner-panel-title", "Your habits"));
			this.habitsEditor(view, box, st);
		});
	}

	// The habit list with Edit and × on each, arrows to order them, an Add
	// button, and the form (st.form) for one. Saved to the Daily template's
	// planner block, so every day has them. st.list: the habit lines.
	habitsEditor(view, box, st) {
		const redraw = () => redrawPanel(this.panelKey);
		const save = (list) => { st.list = list; this.saveShared(view, { habits: list }); redraw(); };
		const habits = st.list.map(parseHabit).filter(Boolean);
		if (st.form) {
			const f = st.form;
			const name = el("label", "planner-field planner-field-wide");
			const ni = el("input");
			Object.assign(ni, { type: "text", placeholder: "🧘 Stretch", value: f.name });
			ni.dataset.focus = "habit-name";
			ni.addEventListener("input", () => { f.name = ni.value; });
			name.append(el("span", null, "Habit"), ni);
			box.append(name);
			const row = el("div", "planner-food-opts");
			const kind = el("select");
			for (const [v, label] of [["tick", "Once a day"], ["count", "A number of times"], ["words", "Words written"]]) kind.append(new Option(label, v));
			kind.value = f.kind;
			kind.addEventListener("change", () => { f.kind = kind.value; if (f.kind === "words" && Number(f.goal) < 50) f.goal = "500"; if (f.kind === "count" && Number(f.goal) > 99) f.goal = "3"; redraw(); });
			row.append(kind);
			if (f.kind !== "tick") {
				const g = el("label", "planner-servings");
				const gi = el("input");
				Object.assign(gi, { type: "number", min: "1", step: "1", value: f.goal });
				gi.dataset.focus = "habit-goal";
				gi.addEventListener("input", () => { f.goal = gi.value; });
				g.append(gi, f.kind === "words" ? " words a day" : " times a day");
				row.append(g);
			}
			box.append(row);
			if (f.kind === "words") box.append(el("p", "planner-panel-hint", "Counts what you write in any note that day, on every device, and ticks itself at the goal."));
			const days = el("div", "planner-days");
			for (const d of [1, 2, 3, 4, 5, 6, 0]) {
				const b = panelButton("planner-day", ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d], () => { f.days.has(d) ? f.days.delete(d) : f.days.add(d); redraw(); });
				b.setAttribute("aria-pressed", String(f.days.has(d)));
				days.append(b);
			}
			box.append(days);
			if (f.error) box.append(el("p", "planner-panel-error", f.error));
			const foot = el("div", "planner-panel-foot");
			foot.append(panelButton("planner-link", "Cancel", () => { st.form = null; redraw(); }), panelButton("planner-log-btn", f.at == null ? "Add" : "Save", () => {
				const n = f.name.trim(), goal = Math.round(Number(f.goal));
				const clash = habits.some((h, i) => i !== f.at && h.name.trim().toLowerCase() === n.toLowerCase());
				if (!n) f.error = "Give it a name.";
				else if (clash) f.error = "There's a habit with that name already.";
				else if (f.kind !== "tick" && !(goal >= 1)) f.error = "The goal is a number, 1 or more.";
				else if (!f.days.size) f.error = "Pick at least one day.";
				else {
					const line = habitLine({ name: n, goal: f.kind === "tick" ? 1 : goal, words: f.kind === "words", days: f.days.size === 7 ? null : [...f.days].sort() });
					const list = [...st.list];
					if (f.at == null) list.push(line); else list[f.at] = line;
					st.form = null;
					return save(list);
				}
				redraw();
			}));
			box.append(foot);
			setTimeout(() => { if (!box.contains(document.activeElement)) ni.focus(); });
			return;
		}
		const open = (h, at) => {
			st.form = h
				? { at, name: h.name, kind: h.words ? "words" : h.goal > 1 ? "count" : "tick", goal: String(h.goal), days: new Set(h.days || [0, 1, 2, 3, 4, 5, 6]), error: "" }
				: { at: null, name: "", kind: "tick", goal: "1", days: new Set([0, 1, 2, 3, 4, 5, 6]), error: "" };
			redraw();
		};
		if (!habits.length) box.append(el("p", "planner-panel-empty", "Nothing yet. Add the things you mean to do each day, and the Habits card on the daily note keeps count and keeps your streaks."));
		habits.forEach((h, i) => {
			const row = el("div", "planner-log");
			const when = [h.words ? `${fmt(h.goal)} words` : h.goal > 1 ? `${h.goal}× a day` : "", daysText(h.days)].filter(Boolean).join(" · ");
			row.append(el("span", "planner-log-text", h.name), el("span", "planner-log-meta", when));
			const move = (d) => { const j = i + d; if (j < 0 || j >= st.list.length) return; const list = [...st.list]; [list[i], list[j]] = [list[j], list[i]]; save(list); };
			const up = panelButton("planner-arrow", "↑", () => move(-1));
			up.title = "Move up";
			up.disabled = i === 0;
			row.append(up, panelButton("planner-link", "Edit", () => open(h, i)));
			const x = panelButton("planner-log-x", "×", () => { if (confirm(`Stop tracking ${h.name}? What's already logged stays in the health notes.`)) save(st.list.filter((_, j) => j !== i)); });
			x.title = "Remove it";
			row.append(x);
			box.append(row);
		});
		box.append(panelButton("planner-log-btn", "Add a habit", () => open(null)));
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
		const habits = this.habits.length ? this.colored(view, ro, this.habitsCard(view, ro), "habits") : null;
		const cols = el("div", "planner-cols" + (this.tasks.length || habits ? "" : " planner-one"));
		cols.append(this.timeline(view, ro));
		if (this.tasks.length || habits) {
			const right = el("div", "planner-tasks");
			if (habits) right.append(habits);
			for (const t of this.tasks) right.append(this.colored(view, ro, new TaskListWidget(t.cfg, t.result, null, this.from, this.path).toDOM(view), t.cfg.lists.join("+")));
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
			imp.title = "Add this day's events from the calendar picked under Settings > Tasks and daily note > Timeline calendar";
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

// A panel button that doesn't take the editor's focus.
function panelButton(cls, text, run) {
	const b = el("button", cls, text);
	b.type = "button";
	b.addEventListener("mousedown", (e) => e.preventDefault());
	b.addEventListener("click", run);
	return b;
}

function sleepHoursOf(bed, wake) {
	return /^\d{2}:\d{2}$/.test(bed || "") && /^\d{2}:\d{2}$/.test(wake || "") ? ((Number(wake.slice(0, 2)) * 60 + Number(wake.slice(3)) - Number(bed.slice(0, 2)) * 60 - Number(bed.slice(3)) + 1440) % 1440) / 60 : null;
}

// The last weight logged before `day` in any health note (the 90 before it
// at most): { value, unit, day } or null.
function lastWeight(vault, day) {
	const days = vault.paths().map((p) => [p, healthDayOf(p)]).filter(([, d]) => d && d < day).sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 90);
	for (const [p, d] of days) {
		const w = healthDay(vault.text(p), []).weights.at(-1);
		if (w) return { value: w.value, unit: w.unit, day: d };
	}
	return null;
}

// " · 80 / 150 g protein · ..." for the macros switch (targets left unset
// show the amount alone).
function macroText(totals, cfg, sep = " · ") {
	const one = (k, label) => `${sep}${fmt(totals[k])}${cfg[k + "_target"] ? ` / ${fmt(cfg[k + "_target"])}` : ""} g ${label}`;
	return one("protein", "protein") + one("carbs", "carbs") + one("fat", "fat");
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
	const today = isoDay(new Date());
	const day = noteDay(path);
	let notes = null;
	blocks.forEach((blk, n) => {
		// Opened as text with its </> button (src/drawnblocks.js).
		if (isOpen(state, blk)) return;
		const shared = sharedColors(vault);
		const cfg = readPlanner(blk.code, shared.path === path ? null : shared.code);
		const { foods } = nutrition(state, cfg);
		const health = healthDay(day ? vault.text(healthPathFor(path)) : null, foods);
		const meds = medsList(state, cfg);
		const doses = day ? dosesOn(meds.meds, day) : [];
		const habits = habitRows(vault, readHabits(cfg.habits), day);
		if (cfg.tasks.length && !notes) notes = allNotes(state);
		const tasks = cfg.tasks.map((tag) => {
			const tcfg = readConfig(`list: ${tag}`);
			return { cfg: tcfg, result: taskList(notes, tcfg, { path, today }) };
		});
		b.add(blk.from, blk.to, Decoration.replace({ widget: new PlannerWidget({ cfg, n, from: blk.from, path, day, health, shared: shared.colors, propsHidden: propertiesFolded(state), foodsCount: foods.length, tasks, meds: { path: meds.path, meds: meds.meds }, doses, habits }), block: true }));
	});
	return b.finish();
}

// The Food panel without a planner on screen, for "Log food" (main.js): the
// day's planner block's settings when its daily note has one, else the
// defaults. anchor: anything with getBoundingClientRect(), under which it opens.
export function openFoodPanel(view, dailyPath, dailyText, anchor) {
	const code = String(dailyText || "").match(/```wr1t3r-planner[ \t]*\r?\n([\s\S]*?)\r?\n```/)?.[1] ?? "";
	const vault = view.state.facet(vaultHost);
	const w = new PlannerWidget({ cfg: readPlanner(code, vault ? sharedColors(vault).code : null), n: 0, path: dailyPath, day: noteDay(dailyPath), health: null, tasks: [] });
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

// ---- A health note's header -------------------------------------------------
// "…/2026-09-30 Health.md" opens with the planner's title row: the date, then
// a "Daily planner" pill back to "…/2026-09-30.md" and the Properties pill.
// It's drawn over the template's link line ("📅 [[2026-09-30|← Daily
// Planner]]") when the body starts with one, which shows as text again while
// the cursor is in it; without one it sits above the body.

const BACK_LINK = /^\s*(?:📅\s*)?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]\s*$/u;

class HealthHeadWidget extends WidgetType {
	constructor(day, path, propsHidden) {
		super();
		Object.assign(this, { day, path, propsHidden });
	}
	eq(o) { return o.day === this.day && o.path === this.path && o.propsHidden === this.propsHidden; }
	toDOM(view) {
		const daily = dailyPathFor(this.path);
		const open = () => {
			const vault = view.state.facet(vaultHost);
			const have = vault?.paths().find((p) => p.toLowerCase() === daily.toLowerCase());
			if (have) host?.open(have);
			else host?.toast?.(`There's no daily note for ${this.day}.`);
		};
		const wrap = el("div", "planner health-head");
		wrap.append(titleRow(dayTitle(this.day), this.day, [["Daily planner", "Open this day's daily note", open], propertiesLink(view)]));
		return wrap;
	}
	ignoreEvent() { return true; }
}

function buildHealthHead(state) {
	const path = state.facet(notePath), day = healthDayOf(path);
	if (!day || !host || UNTRUSTED.test(path)) return Decoration.none;
	const doc = state.doc, fm = frontmatterLines(doc);
	const n = fm ? fm.close + 1 : 1;
	const widget = new HealthHeadWidget(day, path, propertiesFolded(state));
	if (n > doc.lines) return Decoration.set(Decoration.widget({ widget, block: true, side: 1 }).range(doc.length));
	const line = doc.line(n);
	const target = line.text.match(BACK_LINK)?.[1];
	const isBack = target && target.trim().split("/").pop().replace(/\.md$/i, "").replace(/\./g, "-") === day;
	// A cursor at the line's start (where a note opens) leaves it drawn.
	const touched = state.selection.ranges.some((r) => r.to > line.from && r.from <= line.to);
	if (isBack && !touched) return Decoration.set(Decoration.replace({ widget, block: true }).range(line.from, line.to));
	return Decoration.set(Decoration.widget({ widget, block: true, side: -1 }).range(line.from));
}

export const healthHeader = StateField.define({
	create: buildHealthHead,
	update(deco, tr) {
		if (tr.docChanged || tr.selection || propertiesFolded(tr.startState) !== propertiesFolded(tr.state)) return buildHealthHead(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});
