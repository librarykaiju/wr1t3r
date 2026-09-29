// Media notes as text: the properties the Worker looked up (worker/media.js)
// written out as frontmatter the way the Media Notes Obsidian plugin writes
// them, so the two make the same file.

const BAD_NAME = /[\\/:*?"<>|#^[\]]/g;

// "Title (Year)", without the characters a file name can't have.
export function mediaNoteName(title, year) {
	const t = String(title || "").replace(BAD_NAME, "").replace(/\s+/g, " ").trim() || "Untitled";
	return year ? `${t} (${String(year).replace(BAD_NAME, "").trim()})` : t;
}

// A scalar, quoted when YAML would read it as something else.
function scalar(s) {
	return /^\s|\s$|^$|["':#{}[\],&*!|>%@`]|^(true|false|null|~|-?\d+(\.\d+)?)$/i.test(s) || s.includes(": ") || s.includes("\n")
		? `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`
		: s;
}

// One object in a list (an album's tracks), as "- key: value" lines.
function listObject(obj, indent) {
	const first = " ".repeat(indent), rest = " ".repeat(indent + 2), out = [];
	Object.entries(obj).forEach(([k, v], i) => {
		const lead = i === 0 ? `${first}- ` : rest;
		if (Array.isArray(v)) {
			out.push(`${lead}${k}:`);
			for (const x of v) out.push(`${rest}  - ${scalar(String(x))}`);
		} else if (v == null || v === "") out.push(`${lead}${k}:`);
		else if (typeof v === "number") out.push(`${lead}${k}: ${v}`);
		else out.push(`${lead}${k}: ${scalar(String(v))}`);
	});
	return out;
}

export function frontmatter(fields) {
	const out = ["---"];
	for (const [k, v] of Object.entries(fields)) {
		if (v == null) out.push(`${k}:`);
		else if (typeof v === "boolean" || typeof v === "number") out.push(`${k}: ${v}`);
		else if (Array.isArray(v)) {
			out.push(`${k}:`);
			if (v.length && typeof v[0] === "object") for (const o of v) out.push(...listObject(o, 2));
			else for (const x of v) out.push(`  - ${scalar(String(x))}`);
		} else out.push(v === "" ? `${k}:` : `${k}: ${scalar(String(v))}`);
	}
	out.push("---", "");
	return out.join("\n");
}

// The whole note: properties, then an empty heading to write under.
export function mediaNote(fields, heading = "Notes") {
	return frontmatter(fields) + `\n## ${heading}\n`;
}
