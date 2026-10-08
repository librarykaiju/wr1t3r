// What a Dataview script sees of a note: its page object (frontmatter fields
// at the top level, plus file.path, file.name, file.folder, file.lists and so
// on), built from the note's text the way Dataview reads it. Plain data, so it
// can be handed to the sandbox that runs the script (src/dataview.js).

// A small YAML reader for frontmatter: scalars, quoted strings, [flow] lists
// and "- item" lists. Numbers and booleans come out typed, as in Dataview.
function scalar(raw) {
	const v = raw.trim();
	if (v === "" || v === "~" || v === "null") return null;
	if (/^"(.*)"$/.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
	if (/^'(.*)'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
	if (v === "true" || v === "false") return v === "true";
	if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v)) return Number(v);
	if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean).map(scalar);
	return v.replace(/\s+#.*$/, "");
}

export function parseFrontmatter(text) {
	const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
	const out = {};
	if (!m) return out;
	let list = null;
	const lines = m[1].split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const item = line.match(/^\s+-\s*(.*)$|^-\s+(.*)$/);
		if (item && list) { (out[list] ??= []).push(scalar(item[1] ?? item[2])); continue; }
		const kv = line.match(/^([^\s#:][^:]*):(?:\s+(.*)|\s*)$/);
		if (!kv) continue;
		const key = kv[1].trim();
		if (kv[2] == null || kv[2].trim() === "") { out[key] = null; list = key; continue; }
		list = null;
		const raw = kv[2].trim();
		// A quoted string that runs on over more lines, up to its closing quote.
		const q = raw[0];
		if ((q === '"' || q === "'") && !closes(raw.slice(1), q)) {
			const parts = [raw.slice(1)];
			while (i + 1 < lines.length) {
				const next = lines[++i];
				const end = closes(next, q);
				if (end) { parts.push(next.slice(0, end.index)); break; }
				parts.push(next);
			}
			const text = fold(parts);
			out[key] = q === "'" ? text.replace(/''/g, "'") : unescape(text);
			continue;
		}
		// A block string (| keeps line breaks, > folds them): the indented lines under it.
		if (/^[|>][+-]?\d?[+-]?$/.test(raw)) {
			const body = [];
			while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1].trim())) body.push(lines[++i]);
			while (body.length && !body[body.length - 1].trim()) body.pop();
			const indent = Math.min(...body.filter((b) => b.trim()).map((b) => b.match(/^\s*/)[0].length));
			const rows = body.map((b) => b.slice(indent));
			out[key] = raw[0] === "|" ? rows.join("\n") : fold(rows);
			continue;
		}
		out[key] = scalar(kv[2]);
	}
	return out;
}

// Where a quoted string's closing quote is in a line (a doubled '' or an
// escaped \" doesn't close it), or null.
export function closes(text, q) {
	for (let i = 0; i < text.length; i++) {
		if (q === '"' && text[i] === "\\") i++;
		else if (text[i] === q) { if (q === "'" && text[i + 1] === "'") i++; else return { index: i }; }
	}
	return null;
}

// Lines of a multi-line YAML string joined the way YAML folds them: a line
// break is a space, and each blank line is a line break.
function fold(lines) {
	let out = "", blanks = 0;
	for (const [i, l] of lines.map((x) => x.trim()).entries()) {
		if (!l) { if (i) blanks++; continue; }
		out += out ? (blanks ? "\n".repeat(blanks) : " ") + l : l;
		blanks = 0;
	}
	return out;
}

const unescape = (t) => { try { return JSON.parse('"' + t.replace(/\t/g, "\\t").replace(/\n/g, "\\n") + '"'); } catch { return t; } };

// "- text" and "1. text" items (not in code or frontmatter), with the heading
// they sit under as section.subpath, like Dataview's file.lists.
export function listItems(text) {
	const lines = text.split(/\r?\n/);
	const items = [];
	let heading = null, fence = null, i = 0;
	if (/^---[ \t]*$/.test(lines[0])) {
		for (i = 1; i < lines.length && !/^(?:---|\.\.\.)[ \t]*$/.test(lines[i]); i++);
		i++;
	}
	for (; i < lines.length; i++) {
		const line = lines[i];
		const f = line.match(/^\s*(`{3,}|~{3,})/);
		if (f) {
			if (!fence) fence = f[1];
			else if (f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length).trim()) fence = null;
			continue;
		}
		if (fence) continue;
		const h = line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
		if (h) { heading = h[1]; continue; }
		const li = line.match(/^(\s*)([-*+]|\d+[.)])(?:[ \t]+(.*))?$/);
		if (!li || /^(\s*[-*_]){3,}\s*$/.test(line)) continue;
		let body = li[3] ?? "";
		const task = body.match(/^\[(.)\](?:\s+|$)(.*)$/);
		if (task) body = task[2];
		items.push({
			text: body,
			line: i,
			task: !!task,
			status: task ? task[1] : undefined,
			completed: task ? task[1].toLowerCase() === "x" : false,
			section: heading ? { subpath: heading, type: "header" } : null,
			header: heading ? { subpath: heading, type: "header" } : null,
		});
	}
	return items;
}

export function pageFrom(path, text) {
	const fm = parseFrontmatter(text);
	const name = path.split("/").pop().replace(/\.md$/i, "");
	const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
	const lists = listItems(text);
	const tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? String(fm.tags).split(/[,\s]+/).filter(Boolean) : [];
	return {
		...fm,
		file: {
			path, name, folder, ext: "md", link: { path, type: "file" },
			frontmatter: fm, lists, tasks: lists.filter((l) => l.task),
			tags: tags.map((t) => "#" + String(t).replace(/^#/, "")), size: text.length,
		},
	};
}

// [[links]] and [text](links) in a note, for the pages its scripts may ask for.
export function linkedNames(text) {
	const out = new Set();
	for (const m of text.matchAll(/\[\[([^\]|#\n]+)/g)) out.add(m[1].trim());
	for (const m of text.matchAll(/\]\(([^)\s#]+\.md)\)/g)) { try { out.add(decodeURIComponent(m[1])); } catch {} }
	return [...out];
}
