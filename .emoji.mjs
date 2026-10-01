import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
const EMO = /(?:\p{Extended_Pictographic}|[☀-➿])️?(?:‍(?:\p{Extended_Pictographic}|[☀-➿])️?)*/gu;
const files = ["/home/user/w3bz1n3/content/_templates/Recipe Template.md", ...(function walk(d, o = []) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p, o); else if (p.endsWith(".md")) o.push(p); } return o; })("/home/user/w3bz1n3/content/_recipes")];
const where = new Map();
for (const p of files) {
	let inCode = false;
	readFileSync(p, "utf8").split("\n").forEach((l) => {
		if (/^```/.test(l)) { inCode = !inCode; return; }
		for (const m of l.matchAll(EMO)) {
			const k = `${m[0]}  ${inCode ? "script" : "text"}: ${l.trim().slice(0, 70)}`;
			const e = where.get(k) || new Set(); e.add(basename(p)); where.set(k, e);
		}
	});
}
for (const [k, s] of [...where].sort((a, b) => b[1].size - a[1].size)) console.log(String(s.size).padStart(3), k, s.size < 4 ? [...s] : "");
