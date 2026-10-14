import { test } from "node:test";
import assert from "node:assert/strict";
import { marksPath, marksMonth, newMarks, readMarks, marksByDay, addMark, removeMark, inkedEvent } from "../src/calmarks.js";

test("one marks note per month", () => {
	assert.equal(marksPath("n/_wr1t3r/Calendar marks/", "2026-10-15"), "n/_wr1t3r/Calendar marks/Marks 2026-10.md");
	assert.equal(marksMonth("n/_wr1t3r/Calendar marks/Marks 2026-10.md"), "2026-10");
	assert.equal(marksMonth("n/Marks.md"), null);
	assert.equal(newMarks("2026-10-15"), "# October 2026: penciled in and stickers\n\n");
});

test("pencils and stickers are read from their lines, times and all", () => {
	const t = "# Oct\n\n- 2026-10-15 pencil 14:00 Coffee with Sam\n- 2026-10-15 pencil Market?\n- 2026-10-15 sticker 🎉\n- 2026-10-15 pencil 9:05 Early\nnot a mark\n- 2026-10-16 sticker \n";
	const m = readMarks(t);
	assert.deepEqual(m.map((x) => [x.kind, x.time, x.text, x.line]), [["pencil", "14:00", "Coffee with Sam", 2], ["pencil", null, "Market?", 3], ["sticker", null, "🎉", 4], ["pencil", "09:05", "Early", 5]]);
	const by = marksByDay(m).get("2026-10-15");
	assert.deepEqual(by.pencils.map((p) => p.text), ["Early", "Coffee with Sam", "Market?"]);
	assert.deepEqual(by.stickers.map((s) => s.text), ["🎉"]);
});

test("marks are added at the end and removed by line, or by match when lines moved", () => {
	let t = newMarks("2026-10-15");
	t = addMark(t, "2026-10-15", "pencil", "  Coffee   with Sam ", "14:00");
	t = addMark(t, "2026-10-17", "sticker", "🎂");
	t = addMark(t, "2026-10-17", "pencil", "   ");
	assert.equal(t, "# October 2026: penciled in and stickers\n- 2026-10-15 pencil 14:00 Coffee with Sam\n- 2026-10-17 sticker 🎂\n");
	const [coffee, cake] = readMarks(t);
	assert.equal(removeMark(t, cake), "# October 2026: penciled in and stickers\n- 2026-10-15 pencil 14:00 Coffee with Sam\n");
	const moved = "- added on another device\n" + t;
	assert.equal(removeMark(moved, coffee), "- added on another device\n# October 2026: penciled in and stickers\n- 2026-10-17 sticker 🎂\n");
	assert.equal(removeMark("nothing here\n", coffee), "nothing here\n");
});

test("inking makes an hour-long event, or an all-day one without a time", () => {
	assert.deepEqual(inkedEvent({ day: "2026-10-15", text: "Coffee", time: "23:30" }), { title: "Coffee", allDay: false, date: "2026-10-15", startTime: "23:30", endTime: "00:30" });
	assert.equal(inkedEvent({ day: "2026-10-15", text: "Market", time: null }).allDay, true);
});
