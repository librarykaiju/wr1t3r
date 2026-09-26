// Dev only: copies a folder of notes into the local (wrangler dev) R2 bucket.
//   node scripts/seed-local.js ../w3bz1n3 content _includes/snippets
import { getPlatformProxy } from "wrangler";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const [root, ...dirs] = process.argv.slice(2);
const { env, dispose } = await getPlatformProxy();
let n = 0;
async function walk(dir) {
	for (const e of await readdir(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) await walk(p);
		else {
			await env.VAULT.put(relative(root, p), await readFile(p));
			n++;
		}
	}
}
for (const d of dirs) await walk(join(root, d));
console.log(`Put ${n} files into the local bucket`);
await dispose();
