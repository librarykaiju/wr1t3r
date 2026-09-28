import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate, findTemplate, formatDate, isoDate } from "../src/daily.js";

const date = new Date(2026, 8, 28, 9, 5);

test("dates and titles fill in, and -%> drops the newline after", () => {
	const t = '---\ndate: "<% tp.date.now("YYYY-MM-DD") %>"\n---\n[[<% tp.file.title.replace(/ Health$/, "") %>]]\n<%* let x = 1; -%>\nbody\n';
	assert.equal(renderTemplate(t, { title: "2026-09-28 Health", date }).text, '---\ndate: "2026-09-28"\n---\n[[2026-09-28]]\nbody\n');
});

test("the Daily script block becomes its companion note and link, never run", () => {
	const t = [
		"<%*",
		"let dailyName = tp.file.title;",
		'const healthName = dailyName + " Health";',
		'if (!x) await tp.file.create_new(tp.file.find_tfile("_templates/Daily Health"), healthName, false, "/");',
		"tR += `🍎 [[${healthName}|Nutrition Log →]]`;",
		"-%>",
		"",
		"rest",
	].join("\n");
	const r = renderTemplate(t, { title: "2026-09-28", date });
	assert.equal(r.text, "🍎 [[2026-09-28 Health|Nutrition Log →]]\nrest");
	assert.deepEqual(r.companion, [{ name: "2026-09-28 Health", template: "_templates/Daily Health" }]);
});

test("unknown expressions come out empty", () => {
	assert.equal(renderTemplate("a<% tp.system.prompt('x') %>b", { title: "t", date }).text, "ab");
});

test("date formats", () => {
	assert.equal(formatDate("dddd, MMMM D YYYY [at] HH:mm", date), "Monday, September 28 2026 at 09:05");
	assert.equal(isoDate(date), "2026-09-28");
});

test("finds the template and the vault root, ignoring case", () => {
	assert.deepEqual(findTemplate(["content/_templates/Daily.md", "content/x.md"]), { path: "content/_templates/Daily.md", root: "content/" });
	assert.equal(findTemplate(["content/x.md"]), null);
	assert.equal(findTemplate(["content/_templates/Daily Health.md"], "_templates/Daily Health.md").root, "content/");
});

test("renderTemplate fills script variables set from the title", () => {
	const tmpl = '<%* let t = tp.file.title; if (t.startsWith("Untitled")) { t = (await tp.system.prompt("Title")) || t; await tp.file.rename(t); } -%>\n---\ntitle: "<% t %>"\npublish: false\ndate: "<% tp.date.now("YYYY-MM-DD") %>"\ntags:\n  - ""\n---\n\n';
	const { text } = renderTemplate(tmpl, { title: "What's the best advice you ignored?", date: new Date(2026, 8, 28) });
	assert.equal(text, '---\ntitle: "What\'s the best advice you ignored?"\npublish: false\ndate: "2026-09-28"\ntags:\n  - ""\n---\n\n');
});
