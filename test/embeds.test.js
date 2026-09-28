import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { embedsIn } from "../src/embeds.js";

test("embedsIn finds note embeds alone on a line, not attachments", () => {
	const s = EditorState.create({ doc: "![[Note]]\ntext ![[Inline]]\n  ![[Folder/B#Head|Shown]]\n![[pic.png]]\n![[Doc.md#^id]]" });
	assert.deepEqual(embedsIn(s).map((e) => [e.note, e.part, e.label]), [["Note", "", ""], ["Folder/B", "Head", "Shown"], ["Doc.md", "^id", ""]]);
});
