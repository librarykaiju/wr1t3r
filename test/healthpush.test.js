import test from "node:test";
import assert from "node:assert/strict";
import { num, readPush, applyPush, healthNotePath, newHealthNote } from "../src/healthpush.js";
import { healthDay } from "../src/planner.js";
import { parseFrontmatter } from "../src/dvpage.js";

test("numbers as Shortcuts send them", () => {
	assert.equal(num(8432), 8432);
	assert.equal(num("8,432"), 8432);
	assert.equal(num("208.4 lb"), 208.4);
	assert.equal(num(""), null);
	assert.equal(num(null), null);
	assert.equal(num("-3"), null);
});

test("readPush: sleep minutes to hours, empty and zero numbers dropped, date defaults to today", () => {
	const p = readPush({ steps: "0", active_kcal: "", sleep_min: 444, weight: "", weight_unit: "lb" }, "2026-11-20");
	assert.deepEqual(p, { day: "2026-11-20", steps: null, kcal: null, sleepH: 7.4, weight: null, unit: "lb" });
	assert.equal(readPush({ date: "2026-11-19", weight: "95 kg" }, "2026-11-20").unit, "kg");
	assert.equal(readPush({ date: "yesterday" }, "2026-11-20").day, "2026-11-20");
});

const NOTE = newHealthNote("content/daily/2026-11-20 Health.md", "2026-11-20", null);

test("applyPush writes lines the planner reads, and properties", () => {
	const out = applyPush(NOTE, readPush({ steps: 8432, active_kcal: 412.6, sleep_min: 444, weight: 208.44 }, "2026-11-20"));
	assert.match(out, /## Activity Log\n### 🏃 Exercise\n- ⌚ Apple Health \| 8432 steps \| 413 cal/);
	assert.match(out, /## 😴 Sleep\n- 7\.4 h \| Apple Health/);
	assert.match(out, /## ⚖️ Weight\n- 208\.4 lb \| Apple Health/);
	const d = healthDay(out, []);
	assert.equal(d.steps, 8432);
	assert.equal(d.sleepHours, 7.4);
	assert.equal(d.weight, 208.4);
	const fm = parseFrontmatter(out);
	assert.equal(fm.steps, 8432);
	assert.equal(fm.activity_kcal, 413);
	assert.equal(fm.sleep_h, 7.4);
	assert.equal(fm.weight, 208.4);
	assert.equal(fm.date, "2026-11-20");
});

test("pushing again replaces the Apple Health lines, keeps hand-logged ones, and keeps what wasn't sent", () => {
	let t = NOTE.replace("## Mood Log", "## Activity Log\n### 🏃 Exercise\n- 07:30 | 🚶 Walk | 2000 steps\n\n## Mood Log");
	t = applyPush(t, readPush({ steps: 5000, active_kcal: 200, sleep_min: 420 }, "2026-11-20"));
	t = applyPush(t, readPush({ steps: 9000, sleep_min: 450 }, "2026-11-20"));
	assert.equal((t.match(/Apple Health/g) || []).length, 2);
	assert.match(t, /- 07:30 \| 🚶 Walk \| 2000 steps\n- ⌚ Apple Health \| 9000 steps \| 200 cal\n/);
	assert.match(t, /- 7\.5 h \| Apple Health/);
	assert.equal(parseFrontmatter(t).steps, 11000);
	assert.equal(applyPush(t, readPush({ steps: 9000, sleep_min: 450 }, "2026-11-20")), t, "same numbers, same note");
});

test("healthNotePath: the day's note wherever it is, else beside the daily note", () => {
	assert.deepEqual(healthNotePath(["content/Journal/2026-11-20 health.md"], "2026-11-20"), { path: "content/Journal/2026-11-20 health.md", exists: true });
	assert.deepEqual(healthNotePath(["content/_templates/Daily.md", "content/daily/2026-11-19.md"], "2026-11-20"), { path: "content/daily/2026-11-20 Health.md", exists: false });
	assert.deepEqual(healthNotePath(["content/_daily/2026-11-19.md", "content/a.md"], "2026-11-20"), { path: "content/_daily/2026-11-20 Health.md", exists: false });
	assert.deepEqual(healthNotePath(["notes.md"], "2026-11-20"), { path: "daily/2026-11-20 Health.md", exists: false });
});

test("a new note comes from the Daily Health template when there is one", () => {
	const t = newHealthNote("daily/2026-11-20 Health.md", "2026-11-20", "---\ndate: <% tp.date.now(\"YYYY-MM-DD\") %>\n---\n# <% tp.file.title %>\n");
	assert.equal(t, "---\ndate: 2026-11-20\n---\n# 2026-11-20 Health\n");
});
