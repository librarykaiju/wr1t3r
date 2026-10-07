import { test } from "node:test";
import assert from "node:assert/strict";
import { vaultRoot, templatesFolderOf, planVault, noteText, followRenames, pluginFeatures, defaultTarget, report, MAX_FILE } from "../src/obsidianimport.js";

test("a picked folder's name comes off the paths", () => {
	const r = vaultRoot([{ path: "My Vault/a.md" }, { path: "My Vault/.obsidian/app.json" }, { path: "My Vault/Pics/x.png" }]);
	assert.equal(r.name, "My Vault");
	assert.deepEqual(r.entries.map((e) => e.path), ["a.md", ".obsidian/app.json", "Pics/x.png"]);
});

test("a zip with no wrapping folder is named after the zip, and __MACOSX is dropped", () => {
	const r = vaultRoot([{ path: "a.md" }, { path: "Notes/" }, { path: "Notes/b.md" }, { path: "__MACOSX/._a.md" }], "Vault.zip");
	assert.equal(r.name, "Vault");
	assert.deepEqual(r.entries.map((e) => e.path), ["a.md", "Notes/b.md"]);
});

test("the templates folder comes from Obsidian's settings, then Templater's, then a Templates folder", () => {
	assert.equal(templatesFolderOf([], { templates: { folder: "/Meta/Templates/" } }), "Meta/Templates/");
	assert.equal(templatesFolderOf([], { templater: { templates_folder: "tpl" } }), "tpl/");
	assert.equal(templatesFolderOf(["templates/Daily.md", "a.md"]), "templates/");
	assert.equal(templatesFolderOf(["a.md"]), null);
});

test("what happens to each file", () => {
	const paths = [
		"Home.md", "Books.base", "Templates/Daily.md", "Templates/Sub/Book.md", "Pics/x.png", "Big.mp4",
		".obsidian/app.json", ".trash/old.md", "Notes/.DS_Store", "Map.canvas", "notes.txt", "Drawing.excalidraw.md",
	];
	const plan = planVault(paths, { sizes: new Map([["Big.mp4", MAX_FILE + 1]]), templates: "Templates/" });
	assert.deepEqual(plan.notes, [
		{ from: "Home.md", to: "Home.md" },
		{ from: "Books.base", to: "Books.board" },
		{ from: "Templates/Daily.md", to: "_templates/Daily.md" },
		{ from: "Templates/Sub/Book.md", to: "_templates/Sub/Book.md" },
		{ from: "Drawing.excalidraw.md", to: "Drawing.excalidraw.md" },
	]);
	assert.deepEqual(plan.files, [{ from: "Pics/x.png", to: "Pics/x.png" }]);
	assert.equal(plan.renames.length, 3);
	assert.equal(plan.hidden, 3);
	assert.deepEqual(plan.skipped.map((s) => s.path), ["Big.mp4", "Map.canvas", "notes.txt"]);
	assert.match(plan.skipped[0].why, /20 MB/);
});

test("note bytes stay exactly as they were, BOM and CRLF included; non-UTF-8 is null", () => {
	const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x2d, 0x2d, 0x2d, 0x0d, 0x0a]);
	const t = noteText(bytes);
	assert.deepEqual([...new TextEncoder().encode(t)], [...bytes]);
	assert.equal(noteText(new Uint8Array([0xff, 0xfe, 0x00])), null);
});

test("links to bases and spelled-out template paths follow the renames; the rest is untouched", () => {
	const plan = planVault(["Home.md", "Books.base", "Templates/Daily.md", "Other.md"], { templates: "Templates/" });
	const home = "---\ntitle: Home\nlist:  [a,b]\n---\n![[Books.base]] and [[Books.base#Shelf|shelf]] and [t](Templates/Daily.md)\r\n";
	const other = "---\nx: 1\n---\nJust [[Home]].\n";
	const out = followRenames(plan, new Map([["Home.md", home], ["Books.base", "views: []\n"], ["Templates/Daily.md", "# {{date}}\n"], ["Other.md", other]]));
	assert.equal(out.get("Home.md"), "---\ntitle: Home\nlist:  [a,b]\n---\n![[Books.board]] and [[Books.board#Shelf|shelf]] and [t](_templates/Daily.md)\r\n");
	assert.equal(out.get("Other.md"), other);
	assert.equal(out.get("Books.board"), "views: []\n");
	assert.equal(out.get("_templates/Daily.md"), "# {{date}}\n");
});

test("plugin features kept as text", () => {
	assert.deepEqual(pluginFeatures("---\nkanban-plugin: basic\n---\n## Todo\n"), ["Kanban board (shows as lists)"]);
	assert.deepEqual(pluginFeatures("```tasks\nnot done\n```\n```dataview\nLIST\n```"), ["Tasks query"]);
	assert.deepEqual(pluginFeatures("---\nexcalidraw-plugin: parsed\n---\n"), ["Excalidraw drawing"]);
	assert.deepEqual(pluginFeatures("```ad-note\nhi\n```"), ["Admonition block"]);
	assert.deepEqual(pluginFeatures("plain"), []);
});

test("the vault goes to the top unless something there has the same name", () => {
	assert.equal(defaultTarget(["a.md"], new Set(["content/b.md"]), "content/", "V"), "content/");
	assert.equal(defaultTarget(["a.md", "B.md"], new Set(["content/b.md"]), "content/", "V"), "content/V/");
});

test("the report lists what came in and what didn't", () => {
	const r = report({
		vaultName: "V", date: "2026-10-07", target: "V/", hidden: 2,
		done: { notes: 3, boards: 1, templates: 0, files: 1 },
		skipped: [{ path: "Map.canvas", why: "canvases don't open in wr1t3r" }],
		plugins: [{ path: "Board.md", features: ["Kanban board (shows as lists)"] }],
	});
	assert.match(r, /Imported 3 notes, 1 board and 1 picture or file from “V” on 2026-10-07 into V\./);
	assert.match(r, /- Map\.canvas: canvases/);
	assert.match(r, /\[\[V\/Board\|Board\]\]: Kanban/);
	assert.match(r, /Left out 2 files in hidden folders/);
	assert.doesNotMatch(r, /Settings > Templates/);
});
