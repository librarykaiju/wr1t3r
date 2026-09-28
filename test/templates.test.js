import { test } from "node:test";
import assert from "node:assert/strict";
import { templatesIn, insertTemplate } from "../src/templates.js";

const apply = (s, cs) => { for (const c of [...cs].sort((a, b) => b.from - a.from)) s = s.slice(0, c.from) + c.insert + s.slice(c.to); return s; };

test("templatesIn lists _templates notes by name", () => {
	assert.deepEqual(templatesIn(["content/_templates/Movie.md", "content/Movie.md", "content/_templates/snippets/Checklist.md", "content/_templates/Book.md"]).map((t) => t.name), ["Book", "Movie", "snippets/Checklist"]);
});

test("insertTemplate adds the body at the cursor and only missing properties", () => {
	const note = "---\ntitle: Mine\ntags:\n  - a\n---\nHello\n";
	const tmpl = "---\ntitle: T\nrating: 5\ncast:\n  - x\n---\n\n## Notes\n";
	assert.equal(apply(note, insertTemplate(note, tmpl, note.length)), "---\ntitle: Mine\ntags:\n  - a\nrating: 5\ncast:\n  - x\n---\nHello\n## Notes\n");
	assert.equal(apply("Hi\n", insertTemplate("Hi\n", tmpl, 3)), "---\ntitle: T\nrating: 5\ncast:\n  - x\n---\nHi\n## Notes\n");
	assert.equal(apply(note, insertTemplate(note, "- [ ] ", 2)), "---\ntitle: Mine\ntags:\n  - a\n---\n- [ ] Hello\n");
});
