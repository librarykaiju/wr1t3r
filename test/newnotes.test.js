import { test } from "node:test";
import assert from "node:assert/strict";
import { NEW_NOTE_KINDS, kindForTemplate, kindFolder, noteFileName, freeNotePath } from "../src/newnotes.js";
import { renderTemplate } from "../src/daily.js";

const kind = (t) => NEW_NOTE_KINDS.find((k) => k.template === t);

test("each kind files into its folder, the logs into the media lookups' folders when the Worker names one", () => {
	assert.equal(kindFolder(kind("Journal"), "content/"), "content/journal/");
	assert.equal(kindFolder(kind("Microblog"), "content/"), "content/microblog/");
	assert.equal(kindFolder(kind("Note"), "content/"), "content/notes/");
	assert.equal(kindFolder(kind("Series"), "content/"), "content/logs/movies-tv/");
	assert.equal(kindFolder(kind("Book"), "content/", [{ kind: "book", folder: "content/reading" }]), "content/reading/");
	assert.equal(kindFolder(kind("Journal"), "content/", [{ kind: "book", folder: "content/reading" }]), "content/journal/");
	assert.equal(kindForTemplate("content/_templates/Book.md"), kind("Book"));
	assert.equal(kindForTemplate("Podcast"), kind("Podcast"));
	assert.equal(kindForTemplate("Recipe Template"), null);
});

test("names: Obsidian-safe, and numbered when taken", () => {
	assert.equal(noteFileName('Dune: Part "Two"?'), "Dune Part Two");
	assert.equal(freeNotePath("content/journal/", "Today", ["content/journal/today.md", "content/journal/Today 2.md"]), "content/journal/Today 3.md");
	assert.equal(freeNotePath("content/journal/", "New", []), "content/journal/New.md");
});

test("the vault's templates fill in as Templater and Media Notes would", () => {
	const journal = `<%* let t = tp.file.title; if (t.startsWith("Untitled")) { t = (await tp.system.prompt("Title")) || t; await tp.file.rename(t); } -%>
---
title: "<% t %>"
publish: false
date: "<% tp.date.now("YYYY-MM-DD") %>"
---
`;
	const book = `---
title: "{{ title }}"
author: "{{ author }}"
genre: "{{ LIST:genres }}"
date: "{{date:YYYY-MM-DD}}"
---
`;
	const date = new Date(2026, 8, 30);
	assert.equal(renderTemplate(journal, { title: "Dune: Part Two", date }).text, '---\ntitle: "Dune: Part Two"\npublish: false\ndate: "2026-09-30"\n---\n');
	assert.equal(renderTemplate(book, { title: "Dune", date }).text, '---\ntitle: "Dune"\nauthor: ""\ngenre: ""\ndate: "2026-09-30"\n---\n');
});
