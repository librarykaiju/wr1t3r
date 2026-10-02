import { test } from "node:test";
import assert from "node:assert/strict";
import { Text, EditorState } from "@codemirror/state";
import { deleteCharBackward, deleteGroupBackward } from "@codemirror/commands";
import { notePath } from "../src/vault.js";
import { frontmatterStyle, propertiesFolded, bodyStart, imagePropertyLines, IMAGE_KEYS, frontmatterLines, propertyEdit, propertyCount, propertyEnter, tagsIn, tagHue, tagAddEdit, tagRemoveEdit, tagName, newNoteFrontmatter, yamlItem } from "../src/frontmatter.js";

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
	assert.equal(fm, '---\ntitle: "Say \\"hi\\""\npublish: false\ntags:\nstatus: seed\ndate: "2026-09-28"\nsticky: false\neyebrow:\n---\n');
	assert.deepEqual(frontmatterLines(doc(fm)), { open: 1, close: 9 });
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
	// The properties are drawn: Backspace can't reach into them, or glue the
	// body onto the closing fence; a selection over the whole note still deletes it.
	assert.equal(run(deleteCharBackward, doc.indexOf("A") + 1), doc);
	assert.equal(run(deleteCharBackward, doc.indexOf("Body"), doc.indexOf("Body") - 2), doc);
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

test("the properties box starts hidden, except in logs, sketchbooks and catalog", () => {
	const hidden = (path, doc = "---\ntitle: T\n---\nBody") => propertiesFolded(EditorState.create({ doc, extensions: [frontmatterStyle, notePath.of(path)] }));
	assert.equal(hidden("content/journal/Entry.md"), true);
	assert.equal(hidden("content/_daily/2026-09-30.md"), true);
	assert.equal(hidden("content/logs/books/Dune.md"), false);
	assert.equal(hidden("content/sketchbooks/Summer.md"), false);
	assert.equal(hidden("content/info/catalog/Destroy.md"), false);
	assert.equal(hidden("content/logs/Plan.md", "---\ntitle: T\n---\n```wr1t3r-planner\n```\n"), true);
});

test("withTitleHeading puts the title as a heading under the frontmatter", async () => {
	const { withTitleHeading } = await import("../src/frontmatter.js");
	const fm = newNoteFrontmatter('Say "hi"', "2026-10-02");
	assert.equal(withTitleHeading(fm, "x"), fm + '# Say "hi"\n\n');
	assert.equal(withTitleHeading("---\ntitle: Dune\n---\n# Notes\n\nok\n", "f"), "---\ntitle: Dune\n---\n# Dune\n\n# Notes\n\nok\n");
	const done = "---\ntitle: Dune\n---\n\n# Dune\n\ntext";
	assert.equal(withTitleHeading(done, "f"), done);
	assert.equal(withTitleHeading("---\ntitle:\n---\n", "File name"), "---\ntitle:\n---\n# File name\n\n");
	assert.equal(withTitleHeading("", "Plain"), "# Plain\n\n");
});
