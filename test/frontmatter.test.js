import { test } from "node:test";
import assert from "node:assert/strict";
import { Text, EditorState } from "@codemirror/state";
import { deleteCharBackward, deleteGroupBackward } from "@codemirror/commands";
import { notePath } from "../src/vault.js";
import { frontmatterStyle, propertiesFolded, bodyStart, imagePropertyLines, IMAGE_KEYS, frontmatterLines, propertyEdit, propertyCount, propertyEnter, tagsIn, tagHue, tagAddEdit, tagRemoveEdit, tagName, newNoteFrontmatter, propertiesIn, valueText, yamlItem } from "../src/frontmatter.js";

const doc = (s) => Text.of(s.split("\n"));

test("finds the frontmatter fences", () => {
	assert.deepEqual(frontmatterLines(doc("---\ntitle: A\ntags:\n  - x\n---\nBody")), { open: 1, close: 5 });
	assert.deepEqual(frontmatterLines(doc("---\na: 1\n...\n")), { open: 1, close: 3 });
	assert.equal(frontmatterLines(doc("Body\n---\n")), null);
	assert.equal(frontmatterLines(doc("---\nnever closed")), null);
});

test("adding a property inserts one line above the closing fence", () => {
	const d = doc("---\ntitle: A\n---\nBody");
	assert.deepEqual(propertyEdit(d), { at: d.line(3).from, text: "${key}: ${}\n" });
});

test("a note without frontmatter gets a new block at the top", () => {
	assert.deepEqual(propertyEdit(doc("Body")), { at: 0, text: "---\n${key}: ${}\n---\n" });
});

test("counts top-level keys only", () => {
	const d = doc("---\ntitle: A\ntags:\n  - x\n# note\n- y\ndate: 2026\n---");
	assert.equal(propertyCount(d, frontmatterLines(d)), 3);
});

test("Enter at the end of a property line starts the next one", () => {
	const d = doc("---\ntitle: A\ntags:\n  - novel\n  - \n---\nBody");
	const end = (n) => d.line(n).to;
	assert.deepEqual(propertyEnter(d, end(2)), { from: end(2), to: end(2), template: "\n${key}: ${}" });
	// tags: the items are pills, so Enter goes past them
	assert.deepEqual(propertyEnter(d, end(3)), { from: end(5), to: end(5), template: "\n${key}: ${}" });
	const a = doc("---\naliases:\n  - One\n  - \n---");
	assert.deepEqual(propertyEnter(a, a.line(2).to), { from: a.line(2).to, to: a.line(2).to, template: "\n  - ${}" });
	assert.deepEqual(propertyEnter(a, a.line(3).to), { from: a.line(3).to, to: a.line(3).to, template: "\n- ${}" }); // snippet adds the indent
	assert.deepEqual(propertyEnter(a, a.line(4).to), { from: a.line(4).from, to: a.line(4).to, template: "${key}: ${}" });
	assert.equal(propertyEnter(d, end(2) - 1), null); // mid-line: normal Enter
	assert.equal(propertyEnter(d, end(7)), null); // body
	assert.equal(propertyEnter(d, end(6)), null); // closing fence
});

test("reads tags in list, flow and bare forms", () => {
	const t = (s) => { const d = doc(s); return tagsIn(d, frontmatterLines(d)); };
	assert.deepEqual(t("---\ntitle: A\ntags:\n  - novel\n  - \"draft\"\nx: 1\n---").tags, ["novel", "draft"]);
	assert.deepEqual(t("---\ntags:\n  - novel\n  - draft\n---"), { form: "list", first: 2, last: 4, from: 9, to: 29, tags: ["novel", "draft"], items: [3, 4], indent: "  ", blank: null });
	assert.deepEqual(t("---\ntags: [novel, '#draft']\n---").tags, ["novel", "draft"]);
	assert.deepEqual(t("---\ntags: novel draft\n---").tags, ["novel", "draft"]);
	assert.deepEqual(t("---\ntags:\n---").tags, []);
	assert.equal(t("---\ntitle: A\n---"), null);
	assert.equal(tagHue("Novel"), tagHue("novel"));
});

test("adding and removing tags edits only that property", () => {
	const apply = (s, edit) => s.slice(0, edit.from) + edit.insert + s.slice(edit.to);
	const run = (s, f) => { const d = doc(s); return apply(s, f(d, tagsIn(d, frontmatterLines(d)))); };
	const list = "---\ntags:\n  - novel\n  - draft\nx: 1\n---\nBody";
	assert.equal(run(list, (d, t) => tagAddEdit(d, t, "plot")), "---\ntags:\n  - novel\n  - draft\n  - plot\nx: 1\n---\nBody");
	assert.equal(run(list, (d, t) => tagRemoveEdit(d, t, 0)), "---\ntags:\n  - draft\nx: 1\n---\nBody");
	assert.equal(run("---\ntags:\n---", (d, t) => tagAddEdit(d, t, "a")), "---\ntags:\n  - a\n---");
	assert.equal(run("---\ntags: [a, b]\n---", (d, t) => tagAddEdit(d, t, "c")), "---\ntags: [a, b, c]\n---");
	assert.equal(run("---\ntags: a, b\n---", (d, t) => tagRemoveEdit(d, t, 0)), "---\ntags: b\n---");
	assert.equal(run("---\ntags: a b\n---", (d, t) => tagAddEdit(d, t, "c")), "---\ntags: a b c\n---");
	assert.equal(tagName(" #big idea "), "big-idea");
});

test("new notes get the Note template's properties with a fixed date", () => {
	const fm = newNoteFrontmatter('Say "hi"', "2026-09-28");
	assert.equal(fm, '---\ntitle: "Say \\"hi\\""\npublish: false\ntags:\nstatus: seed\ndate: "2026-09-28"\nsticky: false\ncallout:\n---\n');
	assert.deepEqual(frontmatterLines(doc(fm)), { open: 1, close: 9 });
});

test("propertiesIn reads booleans, dates and lists from the text", () => {
	const d = doc('---\ntitle: A\npublish: false\nsticky: True\ndate: "2026-09-28"\nat: 2026-09-28 14:05\ndue:\nnote:\ncategories:\n  - ""\ncast: [Ann, "Bo: b"]\nquoted: "true"\ntags:\n  - x\n---');
	const ps = propertiesIn(d, frontmatterLines(d));
	assert.deepEqual(ps.map((p) => [p.key, p.type, p.value ?? p.list.tags]), [
		["publish", "bool", "false"], ["sticky", "bool", "True"], ["date", "date", "2026-09-28"],
		["at", "datetime", "2026-09-28 14:05"], ["due", "date", ""], ["categories", "list", []], ["cast", "list", ["Ann", "Bo: b"]],
	]);
});

test("valueText keeps quotes, capitals and date-time style", () => {
	assert.equal(valueText({ type: "bool", value: "True", quote: "" }, false), "False");
	assert.equal(valueText({ type: "bool", value: "false", quote: "" }, true), "true");
	assert.equal(valueText({ type: "date", value: "2026-09-28", quote: '"' }, "2026-10-01"), '"2026-10-01"');
	assert.equal(valueText({ type: "date", value: "2026-09-28", quote: '"' }, ""), '""');
	assert.equal(valueText({ type: "datetime", value: "2026-09-28 14:05", quote: "" }, "2026-09-29T09:30"), "2026-09-29 09:30");
	assert.equal(valueText({ type: "datetime", value: "2026-09-28T14:05:00", quote: "" }, "2026-09-29T09:30"), "2026-09-29T09:30:00");
});

test("list properties: adding fills a blank item, flow items keep their quotes", () => {
	const apply = (s, e) => s.slice(0, e.from) + e.insert + s.slice(e.to);
	const run = (s, f) => { const d = doc(s); const p = propertiesIn(d, frontmatterLines(d))[0]; return apply(s, f(d, p.list)); };
	assert.equal(run('---\ncategories:\n  - ""\n---', (d, t) => tagAddEdit(d, t, "essay")), "---\ncategories:\n  - essay\n---");
	assert.equal(run('---\ncast: [Ann, "Bo: b"]\n---', (d, t) => tagRemoveEdit(d, t, 0)), '---\ncast: ["Bo: b"]\n---');
	assert.equal(run('---\ncast: [Ann]\n---', (d, t) => tagAddEdit(d, t, yamlItem("C, D", true))), '---\ncast: [Ann, "C, D"]\n---');
	assert.equal(yamlItem("plain words"), "plain words");
	assert.equal(yamlItem("a: b"), '"a: b"');
	assert.equal(yamlItem("#x"), '"#x"');
});

test("flow lists don't split on commas inside quotes", () => {
	const d = doc('---\ncast: [Ann, "C, D", \'E, F\']\n---');
	assert.deepEqual(propertiesIn(d, frontmatterLines(d))[0].list.tags, ["Ann", "C, D", "E, F"]);
});

test("deleting from the body stops at the properties", () => {
	const doc = "---\ntitle: A\n---\nBody\nmore";
	const run = (cmd, anchor, head = anchor) => {
		let state = EditorState.create({ doc, selection: { anchor, head }, extensions: frontmatterStyle });
		cmd({ state, dispatch: (tr) => { state = tr.state; } });
		return state.sliceDoc();
	};
	const start = doc.indexOf("Body");
	assert.equal(bodyStart(Text.of(doc.split("\n"))), start);
	assert.equal(run(deleteCharBackward, start), doc);
	assert.equal(run(deleteGroupBackward, start), doc);
	assert.equal(run(deleteCharBackward, start + 2), "---\ntitle: A\n---\nBdy\nmore");
	// In the properties, and selections reaching into them, delete as usual.
	assert.equal(run(deleteCharBackward, doc.indexOf("A") + 1), "---\ntitle: \n---\nBody\nmore");
	assert.equal(run(deleteCharBackward, 0, doc.length), "");
});

test("banner and cover properties are found to hide", () => {
	const d = Text.of("---\ntitle: T\nbanner: x.png\nbanner_position: 30\ncover:\n  - y.png\nimage:\nthumbnail: \"\"\n---\nBody".split("\n"));
	assert.deepEqual(imagePropertyLines(d, frontmatterLines(d)), [{ first: 3, last: 3 }, { first: 4, last: 4 }, { first: 5, last: 6 }]);
	assert.deepEqual(IMAGE_KEYS, ["banner", "banner_position", "cover", "coverImage", "image", "thumbnail"]);
});

test("the properties box draws notes with empty properties and hidden images", () => {
	// An empty tags: or date is a zero-length widget; building the box threw
	// on it, so those notes wouldn't open.
	for (const doc of [
		"---\ntitle: T\ntags:\n---\nBody",
		"---\ncoverImage:\ngenre:\ntags:\nrating:\n---\n",
		"---\ndate:\nbanner: x.png\ncover: y.png\ntags:\n---\nBody",
	]) assert.doesNotThrow(() => EditorState.create({ doc, extensions: [frontmatterStyle, notePath.of("content/logs/books/B.md")] }), doc);
});

test("the properties box starts hidden, except in logs and sketchbooks", () => {
	const hidden = (path, doc = "---\ntitle: T\n---\nBody") => propertiesFolded(EditorState.create({ doc, extensions: [frontmatterStyle, notePath.of(path)] }));
	assert.equal(hidden("content/journal/Entry.md"), true);
	assert.equal(hidden("content/_daily/2026-09-30.md"), true);
	assert.equal(hidden("content/logs/books/Dune.md"), false);
	assert.equal(hidden("content/sketchbooks/Summer.md"), false);
	assert.equal(hidden("content/logs/Plan.md", "---\ntitle: T\n---\n```wr1t3r-planner\n```\n"), true);
});
