import { test } from "node:test";
import assert from "node:assert/strict";
import { projectFiles, PROJECT_KINDS } from "../src/projects.js";
import { builtinTemplate, writingTemplates } from "../src/builtintemplates.js";
import { renderTemplate } from "../src/daily.js";
import { binderOrder, readBinder } from "../src/binder.js";
import { compileMarkdown } from "../src/compile.js";
import { readingOrder } from "../src/scrivenings.js";

const template = (name, title) => {
	const t = builtinTemplate(name);
	return t == null ? null : renderTemplate(t, { title, date: new Date(2026, 9, 7) }).text;
};

const make = (kind, variant, title = "The Long Winter", folder = "content/The Long Winter/") =>
	projectFiles({ kind, variant, title, folder, template, paths: ["content/Other/Chapter 1.md"] });

test("every kind of project has its template notes, a Notes folder and a binder", () => {
	for (const k of PROJECT_KINDS) {
		for (const v of k.variants || [null]) {
			const files = make(k.id, v?.id);
			const paths = files.map((f) => f.path);
			assert.ok(paths.every((p) => p.startsWith("content/The Long Winter/")), k.id);
			assert.equal(paths.at(-1), "content/The Long Winter/_Binder.md");
			assert.ok(paths.some((p) => p.includes("/Notes/")), k.id);
			for (const f of files.filter((f) => f.path.includes("/Notes/"))) assert.match(f.text, /^---\n[\s\S]*compile: false\n[\s\S]*---\n/, f.path);
			for (const f of files) assert.doesNotMatch(f.text, /<%|%>/, f.path);
		}
	}
});

test("a novel: chapters in order, compiled with chapter headings and planning notes left out", () => {
	const files = make("novel");
	const text = new Map(files.map((f) => [f.path, f.text]));
	const binder = text.get("content/The Long Winter/_Binder.md");
	assert.deepEqual(readBinder(binder).compile, { title: "The Long Winter", headings: "title", separator: "page", layout: "manuscript" });
	const paths = [...text.keys()];
	const order = (folder) => binderOrder(folder, paths, text.get(folder + "_Binder.md") ?? null);
	assert.deepEqual(order("content/The Long Winter/").map((it) => it.path.split("/").slice(2).join("/")), ["Chapter 1.md", "Chapter 2.md", "Chapter 3.md", "Notes/"]);
	const parts = readingOrder("content/The Long Winter/", order);
	const md = compileMarkdown(parts, readBinder(binder).compile, (p) => text.get(p), { titlePage: false }).markdown;
	assert.match(md, /^# Chapter 1\n/);
	assert.doesNotMatch(md, /Notes|Style sheet|Outline|Main character/);
});

test("a research paper uses its style's template; MLA has no title page", () => {
	const mla = make("essay", "mla");
	assert.match(mla[0].text, /style: MLA/);
	assert.match(mla[0].text, /## Works Cited/);
	assert.equal(mla[0].path, "content/The Long Winter/The Long Winter.md");
	assert.equal(readBinder(mla.at(-1).text).compile.title, undefined);
	const apa = make("essay", "apa");
	assert.match(apa[0].text, /## References/);
	assert.equal(readBinder(apa.at(-1).text).compile.title, "The Long Winter");
	assert.match(make("essay", "chicago")[0].text, /## Bibliography/);
	assert.match(make("essay", "essay")[0].text, /tags: \[essay\]/);
});

test("scripts: acts in screenplay format, TV adds a cold open and tag, comics go by page", () => {
	const sp = make("script", "screenplay");
	assert.deepEqual(sp.slice(0, 3).map((f) => f.path.split("/").pop()), ["Act One.md", "Act Two.md", "Act Three.md"]);
	assert.match(sp[0].text, /cssclasses:\n  - script/);
	assert.equal(readBinder(sp.at(-1).text).compile.layout, "script");
	const tv = make("script", "tv");
	assert.deepEqual(tv.slice(0, 5).map((f) => f.path.split("/").pop().replace(".md", "")), ["Cold Open", "Act One", "Act Two", "Act Three", "Tag"]);
	const comic = make("script", "comic");
	assert.match(comic[0].text, /## Page 1\n\n### Panel 1/);
});

test("the notebook's own template wins over the built-in one", () => {
	const own = (name, title) => (name === "Chapter" ? `my chapter: ${title}\n` : template(name, title));
	const files = projectFiles({ kind: "novel", title: "X", folder: "X/", template: own });
	assert.equal(files[0].text, "my chapter: Chapter 1\n");
});

test("writing templates are listed and found by name", () => {
	const names = writingTemplates().map((t) => t.name);
	for (const n of ["Scene", "Chapter", "Character", "Style sheet", "Essay", "Research paper (MLA)", "Research paper (APA)", "Research paper (Chicago)", "Screenplay", "TV script", "Comic script"]) assert.ok(names.includes(n), n);
	assert.equal(builtinTemplate("content/_templates/research paper (mla).md"), writingTemplates().find((t) => t.name === "Research paper (MLA)").text);
	for (const t of writingTemplates()) assert.match(t.text, /^---\n[\s\S]*?\n---\n\n/, t.name);
});
