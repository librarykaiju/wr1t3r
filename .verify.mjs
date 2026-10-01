import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { listItems, parseFrontmatter } from "./src/dvpage.js";
import { recipeSync, upsertRecipeRow, isRecipeSync } from "./src/recipe.js";
const R = "/home/user/w3bz1n3";
const git = (p) => execSync(`git -C ${R} show "origin/main:${p}"`, { maxBuffer: 1 << 26 }).toString();
const region = (t, start) => { const a = t.indexOf(start); const s = t.indexOf("```dataviewjs", t.indexOf("Sync to Nutrition Database", a + 10)); return [a, t.indexOf("\n```", s + 5) + 4]; };
const files = (function walk(d, o = []) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p, o); else if (p.endsWith(".md") && !e.startsWith("_")) o.push(p); } return o; })(join(R, "content/_recipes"));
let outside = 0, bad = [];
for (const p of files) {
	const before = git(relative(R, p)).replace(/\r\n/g, "\n"), after = readFileSync(p, "utf8").replace(/\r\n/g, "\n").replace("\npublish: false\n---\n", "\n---\n");
	const [a, e] = region(before, "## 🧮 Nutrition"), [b, f] = region(after, "## Nutrition (auto");
	if (before.slice(0, a) === after.slice(0, b) && before.slice(e) === after.slice(f)) outside++; else bad.push(basename(p));
}
console.log(`1. unchanged outside the section: ${outside}/${files.length}`, bad);
// 2. The new template scripts in a fake Obsidian vs the native sync.
const tpl = readFileSync(join(R, "content/_templates/Recipe Template.md"), "utf8");
const syncCode = [...tpl.matchAll(/```dataviewjs\n([\s\S]*?)\n```/g)].map((m) => m[1]).find((c) => c.includes("Sync to Nutrition Database"));
const db = readFileSync(join(R, "content/_docs/Nutrition Database.md"), "utf8");
let same = 0, empty = 0, diff = 0, detected = 0;
for (const p of files) {
	const text = readFileSync(p, "utf8");
	const blocks = [...text.matchAll(/```dataviewjs\n([\s\S]*?)\n```/g)].map((m) => m[1]);
	if (blocks.some(isRecipeSync)) detected++;
	const fm = parseFrontmatter(text) || {};
	let written = null, status;
	const el = () => { const o = { text: "", createEl: () => el(), setText: (t) => { o.text = t; } }; return o; };
	let button;
	const dv = { el: () => { const c = el(); let n = 0; c.createEl = () => { const x = el(); if (n++ === 0) button = x; else status = x; return x; }; return c; }, current: () => ({ ...fm, file: { name: basename(p, ".md"), lists: listItems(text) } }) };
	const app = { vault: { getAbstractFileByPath: (q) => ({ path: q }), read: async () => db, modify: async (f, t) => { written = t; } } };
	await new Function("dv", "app", `return (async () => { ${blocks.find((c) => c.includes("Sync to Nutrition Database"))}\n; await button.onclick(); })()`)(dv, app);
	const n = recipeSync(text, relative(R, p), db);
	if (written == null) { empty++; continue; }
	const tRow = written.split("\n").find((l) => l.split("|").map((c) => c.trim())[1]?.toLowerCase() === n.name.toLowerCase());
	if (tRow?.replace(/\s+/g, " ") === n.row.replace(/\s+/g, " ")) same++; else { diff++; console.log("DIFF", basename(p), tRow, n.row); }
}
console.log(`2. template script vs native row: same ${same}, no ingredients ${empty}, different ${diff}`);
console.log(`3. wr1t3r recognizes the sync block in ${detected}/${files.length} recipes`);
