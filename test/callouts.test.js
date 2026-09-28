import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { foldables } from "../src/callouts.js";
import { commentRanges } from "../src/editor.js";

test("callouts with - start folded, + start open, plain ones don't fold", () => {
	const doc = "> [!note]- Closed\n> body\n\n> [!tip]+ Open\n> body\n\n> [!info] Plain\n> body";
	const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
	ensureSyntaxTree(s, doc.length, 5000);
	assert.deepEqual(foldables(s).map((c) => [doc.slice(c.from, c.titleEnd), c.folded]), [["> [!note]- Closed", true], ["> [!tip]+ Open", false]]);
});

test("comments on one line or several", () => {
	const t = "a %%x%% b\n%%\nhidden\n%% c";
	assert.deepEqual(commentRanges(t).map(([f, e]) => t.slice(f, e)), ["%%x%%", "%%\nhidden\n%%"]);
});
