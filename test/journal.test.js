import { test } from "node:test";
import assert from "node:assert/strict";
import { entryDay, snippet, entries, onThisDay, dayHealth, trends, series, period, reviewNote, yearsAgo } from "../src/journal.js";
import { healthDay } from "../src/planner.js";
import { readHabits } from "../src/habits.js";

test("which notes are journal entries, and for what day", () => {
	assert.equal(entryDay("_daily/2025-10-13.md", ""), "2025-10-13");
	assert.equal(entryDay("journal/2024-05-03 Lake trip.md", ""), "2024-05-03");
	assert.equal(entryDay("journal/A good day.md", "---\ndate: 2023-10-13\n---\nHi"), "2023-10-13");
	assert.equal(entryDay("journal/A good day.md", "Hi"), null);
	assert.equal(entryDay("notes/Ideas.md", "---\ndate: 2023-10-13\n---\n"), null);
	assert.equal(entryDay("_daily/2025-10-13 Health.md", ""), null);
	assert.equal(entryDay("_templates/2025-10-13.md", ""), null);
	assert.equal(entryDay("journal/2024-05-03 Old.md", "---\nstatus: Archived\n---\n"), null);
	assert.equal(entryDay("reviews/2026-W42 Review.md", ""), null);
	assert.equal(entryDay("pics/2024-05-03.png", ""), null);
});

test("a snippet is the note's own words", () => {
	const daily = "---\ndate: 2025-10-13\n---\n\n```wr1t3r-planner\ntasks: [crit]\n```\n\n## Notes\n\n- Walked to the **lake** with [[Sam|Sam]].\n";
	assert.equal(snippet(daily), "Walked to the lake with Sam.");
	assert.equal(snippet("---\ndate: 2025-10-13\n---\n\n```wr1t3r-planner\n```\n\n## Notes\n\n"), "");
	assert.equal(snippet("%% hidden %%\n> [!note] Title\n> Quoted"), "Title Quoted");
	assert.ok(snippet("word ".repeat(100), 30).endsWith("…"));
	assert.ok(snippet("word ".repeat(100), 30).length <= 31);
});

test("On this day finds earlier years' entries for today", () => {
	const list = entries([
		{ path: "_daily/2025-10-13.md", text: "## Notes\n\nRainy." },
		{ path: "_daily/2024-10-13.md", text: "```wr1t3r-planner\n```\n## Notes\n" },
		{ path: "journal/2023-10-13 Moving day.md", text: "Boxes everywhere." },
		{ path: "journal/Fall.md", text: "---\ntitle: First frost\ndate: 2022-10-13\n---\nCold." },
		{ path: "journal/2026-10-13 Today.md", text: "Not a look back." },
		{ path: "journal/2025-10-12 Yesterday.md", text: "Off by a day." },
	]);
	const hits = onThisDay(list, "2026-10-13");
	assert.deepEqual(hits.map((h) => [h.day, h.years, h.title]), [["2025-10-13", 1, "2025-10-13"], ["2023-10-13", 3, "Moving day"], ["2022-10-13", 4, "First frost"]]);
	assert.equal(hits[0].snippet, "Rainy.");
	assert.equal(yearsAgo(1), "1 year ago");
	assert.equal(yearsAgo(3), "3 years ago");
	const leap = entries([{ path: "journal/2024-02-29 Leap.md", text: "Extra day." }]);
	assert.equal(onThisDay(leap, "2025-02-28").length, 1);
	assert.equal(onThisDay(leap, "2028-02-28").length, 0);
	assert.equal(onThisDay(leap, "2028-02-29").length, 1);
});

const healthNote = (mood, sleep, weight) => [
	"## Mood Log", `- 09:00 | ${mood}`, "",
	...(sleep ? ["## 😴 Sleep", `- ${sleep}`, ""] : []),
	...(weight ? ["## ⚖️ Weight", `- 07:00 | ${weight}`, ""] : []),
].join("\n");

test("trends read mood, sleep and weight over the days", () => {
	const days = new Map([
		["2026-10-01", dayHealth(healthDay(healthNote("🙂 Good", "8h", "180 lb"), []))],
		["2026-10-02", dayHealth(healthDay(healthNote("😕 Low", "5.5h"), []))],
		["2026-10-03", dayHealth(healthDay(healthNote("🙂 Good", "7h", "178.5 lb"), []))],
		["2026-10-04", dayHealth(healthDay(healthNote("😕 Low", "6.5h"), []))],
	]);
	assert.deepEqual(days.get("2026-10-01").mood, ["🙂", "Good"]);
	assert.equal(days.get("2026-10-01").sleep, 8);
	const t = trends(days, "2026-10-01", "2026-10-05");
	assert.equal(t.days.length, 5);
	assert.equal(t.days[4].mood, null);
	assert.deepEqual(t.moods, [{ emoji: "🙂", label: "Good", n: 2 }, { emoji: "😕", label: "Low", n: 2 }]);
	assert.deepEqual(t.sleep, { avg: 6.8, nights: 4 });
	assert.deepEqual(t.weight, { first: 180, last: 178.5, change: -1.5, unit: "lb", n: 2 });
	assert.deepEqual(t.byMood, [{ emoji: "🙂", label: "Good", sleep: 7.5, nights: 2 }, { emoji: "😕", label: "Low", sleep: 6, nights: 2 }]);
	assert.equal(trends(new Map(), "2026-10-01", "2026-10-02").weight, null);
	assert.deepEqual(series(t.days, "weight"), [{ label: "Oct 1", value: 180, title: "Oct 1: 180" }, { label: "Oct 3", value: 178.5, title: "Oct 3: 178.5" }]);
	assert.deepEqual(series(t.days, "sleep", "week"), [{ label: "Sep 28", value: 6.8, title: "Week of Sep 28: 6.8 h (average of 4)" }]);
	assert.deepEqual(series(t.days, "sleep", "month").map((p) => [p.label, p.value]), [["Oct", 6.8]]);
});

test("periods for reviews", () => {
	assert.deepEqual(period("week", "2026-10-13"), { kind: "week", from: "2026-10-12", to: "2026-10-18", name: "2026-W42 Review", title: "Week of October 12, 2026", word: "week" });
	assert.equal(period("week", "2026-10-18").from, "2026-10-12");
	assert.equal(period("week", "2027-01-01").name, "2026-W53 Review");
	assert.equal(period("week", "2025-12-30").name, "2026-W01 Review");
	assert.deepEqual(period("month", "2024-02-10"), { kind: "month", from: "2024-02-01", to: "2024-02-29", name: "2024-02 Review", title: "February 2024", word: "month" });
	assert.equal(period("year", "2026-10-13").to, "2026-12-31");
});

test("a review gathers the period's entries and numbers", () => {
	const p = period("week", "2026-10-13");
	const notes = [
		{ path: "_daily/2026-10-12.md", text: "## Notes\n\nGood start." },
		{ path: "_daily/2026-10-13.md", text: "```wr1t3r-planner\n```\n" },
		{ path: "journal/2026-10-14 Big news.md", text: "It happened." },
		{ path: "journal/2026-10-01 Earlier.md", text: "Not this week." },
		{ path: "logs/books/Dune.md", text: "---\ntitle: Dune\nstatus: Finished\nfinished: 2026-10-15\nrating: 4.5\n---\n" },
		{ path: "notes/Dune.md", text: "Thoughts on the sandworms." },
		{ path: "logs/books/Emma.md", text: "---\ntitle: Emma\nstatus: Reading\nfinished: \n---\n" },
	];
	const days = new Map([
		["2026-10-12", healthDay(healthNote("🙂 Good", "8h") + "\n## ✅ Habits\n- 07:00 | Stretch\n\n## ✍️ Words written\n- abc | 400\n", [])],
		["2026-10-13", healthDay(healthNote("😕 Low", "6h"), [])],
	]);
	const text = reviewNote(p, { notes, days, habits: readHabits(["Stretch"]), today: "2026-10-13" });
	assert.match(text, /^---\ntitle: "Week of October 12, 2026 review"\ndate: 2026-10-18\nperiod: week\n/);
	assert.match(text, /- \*\*Entries:\*\* 2\n/);
	assert.match(text, /- \*\*Words written:\*\* 400\n/);
	assert.match(text, /- \*\*Stretch:\*\* 1 of 2 days\n/);
	assert.match(text, /- \*\*Mood:\*\* 🙂 Good ×1, 😕 Low ×1\n/);
	assert.match(text, /- \*\*Sleep:\*\* 7 h a night on average \(2 nights logged\)\n/);
	assert.match(text, /- Oct 12: \[\[2026-10-12\]\] — Good start\.\n- Oct 14: \[\[2026-10-14 Big news\|Big news\]\]\n/);
	assert.match(text, /## Finished\n\n- Oct 15: \[\[logs\/books\/Dune\]\] ★★★★½\n/);
	assert.doesNotMatch(text, /Emma|Earlier/);
	assert.match(text, /## What went well this week\?\n/);
	const own = reviewNote(p, { notes: [], days: new Map(), template: "---\ntags: [x]\n---\n## Gratitude\n\n" });
	assert.match(own, /## Gratitude\n$/);
	assert.doesNotMatch(own, /What went well/);
});
