import test from "node:test";
import assert from "node:assert/strict";
import { captureEntry, appendCapture, stamp } from "../src/capture.js";

const W = "2026-10-02 08:45";

test("a shared link with a title", () => {
	assert.equal(captureEntry({ title: "A page", url: "https://e.com/a b" }, W), "- [ ] 2026-10-02 08:45 [A page](https://e.com/a%20b)");
});

test("a link that came in the text, as share sheets do", () => {
	assert.equal(captureEntry({ text: "https://e.com/x" }, W), "- [ ] 2026-10-02 08:45 <https://e.com/x>");
	assert.equal(captureEntry({ title: "T", text: "Look at this https://e.com/x", url: "https://e.com/x" }, W), "- [ ] 2026-10-02 08:45 [T](https://e.com/x) · Look at this");
});

test("several lines of text stay under the task", () => {
	assert.equal(captureEntry({ text: "first\nsecond\n\nthird" }, W), "- [ ] 2026-10-02 08:45 first\n  second\n\n  third");
});

test("nothing to capture", () => {
	assert.equal(captureEntry({ text: "  " }, W), "");
});

test("appends to the Inbox, making it if needed", () => {
	assert.match(appendCapture(null, "- [ ] x"), /^# Inbox\n[\s\S]*\n\n- \[ \] x\n$/);
	assert.equal(appendCapture("# Inbox\n\n- [ ] a\n\n\n", "- [ ] b"), "# Inbox\n\n- [ ] a\n- [ ] b\n");
	assert.equal(appendCapture("# Inbox\n\n- [ ] a\n  more", "- [ ] b"), "# Inbox\n\n- [ ] a\n  more\n- [ ] b\n");
});

test("stamp uses the given time zone", () => {
	assert.equal(stamp(new Date("2026-10-02T13:45:00Z"), "America/Chicago"), "2026-10-02 08:45");
});
