import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { backlinks } from "../src/backlinks.js";
import { vaultHost, notePath } from "../src/vault.js";

test("links to are rescanned only when an edit touches link or code syntax", () => {
	const texts = { "A.md": "Plain line\n\nSee [[B]].", "B.md": "", "C.md": "" };
	const host = { paths: () => Object.keys(texts), text: (p) => texts[p] };
	let s = EditorState.create({ doc: texts["A.md"], extensions: [vaultHost.of(host), notePath.of("A.md"), backlinks] });
	const names = (st) => st.field(backlinks).v.to.map((l) => l.name);
	assert.deepEqual(names(s), ["B"]);

	const before = s.field(backlinks).v;
	s = s.update({ changes: { from: 5, insert: "typed " } }).state;
	assert.equal(s.field(backlinks).v, before, "plain typing keeps the list");

	s = s.update({ changes: { from: 0, insert: "[[C]] " } }).state;
	assert.deepEqual(names(s), ["B", "C"]);

	// Deleting the brackets on the link's own line drops it again.
	const at = s.doc.toString().indexOf("[[C]]");
	s = s.update({ changes: { from: at, to: at + 6 } }).state;
	assert.deepEqual(names(s), ["B"]);
});
