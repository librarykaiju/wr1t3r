import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, listItems, pageFrom, linkedNames } from "../src/dvpage.js";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { dataviewBlocks } from "../src/dataview.js";

test("frontmatter values come out typed, as Dataview reads them", () => {
	const fm = parseFrontmatter('---\ntitle: Daily Timeline\npublish: false\ndate: "2026-09-28"\nmeds:\nfiber_g: 0\nsteps_health: 5234\ntags: [a, b]\naliases:\n  - One\n  - Two\n---\nbody');
	assert.deepEqual(fm, { title: "Daily Timeline", publish: false, date: "2026-09-28", meds: null, fiber_g: 0, steps_health: 5234, tags: ["a", "b"], aliases: ["One", "Two"] });
});

test("list items carry the heading they sit under, skipping code and frontmatter", () => {
	const items = listItems("---\na: 1\n---\n## Hydration Log\n### 💧 Water\n- 2 bottles\n- \n```js\n- not a list\n```\n### 👟 Steps\n- [x] 4200\n-\n---\n");
	assert.deepEqual(items.map((i) => [i.text, i.section?.subpath, i.task]), [["2 bottles", "💧 Water", false], ["", "💧 Water", false], ["4200", "👟 Steps", true], ["", "👟 Steps", false]]);
});

test("page object", () => {
	const p = pageFrom("content/_daily/2026-09-28.md", "---\ncalories: 190\n---\n[[2026-09-28 Health|Log]]\n");
	assert.equal(p.calories, 190);
	assert.equal(p.file.name, "2026-09-28");
	assert.equal(p.file.folder, "content/_daily");
	assert.deepEqual(linkedNames("[[2026-09-28 Health|Log]] and [x](Other%20Note.md)"), ["2026-09-28 Health", "Other Note.md"]);
});

test("finds closed dataviewjs fences only", () => {
	const doc = "a\n```dataviewjs\nconst x = 1;\n```\n```js\nno\n```\n```dataviewjs\nopen";
	const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
	ensureSyntaxTree(state, state.doc.length, 5000);
	const b = dataviewBlocks(state);
	assert.equal(b.length, 1);
	assert.equal(b[0].code, "const x = 1;");
	assert.equal(doc.slice(b[0].from, b[0].to), "```dataviewjs\nconst x = 1;\n```");
});
