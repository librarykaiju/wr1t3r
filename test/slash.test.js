import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { slashSource, setSlashExtras } from "../src/slash.js";

const labels = (doc) => {
	const state = EditorState.create({ doc });
	const r = slashSource()(new CompletionContext(state, doc.length, false));
	return r ? r.options.map((o) => o.label) : [];
};

test("templates show up in the slash menu by name", () => {
	setSlashExtras(() => [{ label: "Book review", detail: "template", keywords: "template book review", run() {} }]);
	assert.ok(labels("/").includes("Book review"));
	assert.deepEqual(labels("/book"), ["Book review"]);
	assert.ok(labels("/templ").includes("Book review"));
	setSlashExtras(() => []);
	assert.ok(!labels("/").includes("Book review"));
});
