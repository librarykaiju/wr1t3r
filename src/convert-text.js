// The plain-text parts of converting uploads (see src/convert.js), kept
// apart so they can be tested without a browser.

// Rebuilds lines from pdf.js text items, and paragraphs from the vertical
// gaps between lines: a gap well over the usual line spacing, or a change of
// text size, starts a new one. Lines in bigger type become headings.
export function pdfPageText(items) {
	const lines = [];
	let cur = null;
	for (const it of items) {
		const y = it.transform[5];
		const h = Math.abs(it.transform[3]) || it.height || 10;
		if (!cur || Math.abs(cur.y - y) > h * 0.5) {
			if (cur) lines.push(cur);
			cur = { y, h, text: "" };
		}
		cur.text += it.str;
		cur.h = Math.max(cur.h, h);
		if (it.hasEOL) {
			lines.push(cur);
			cur = null;
		}
	}
	if (cur) lines.push(cur);
	const kept = lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() })).filter((l) => l.text);
	if (!kept.length) return "";

	// Body text size: the size covering the most characters.
	const bySize = new Map();
	for (const l of kept) bySize.set(Math.round(l.h), (bySize.get(Math.round(l.h)) || 0) + l.text.length);
	const body = [...bySize].sort((a, b) => b[1] - a[1])[0][0];
	// Usual line spacing: the lower quartile of gaps, so paragraph gaps don't skew it.
	const gaps = kept.slice(1).map((l, i) => kept[i].y - l.y).filter((g) => g > 0).sort((a, b) => a - b);
	const usual = gaps.length ? gaps[Math.floor((gaps.length - 1) / 4)] : body * 1.2;

	const heading = (l) => (l.h >= body * 1.5 ? "# " : l.h >= body * 1.2 ? "## " : "");
	const blocks = [];
	let block = null;
	for (let i = 0; i < kept.length; i++) {
		const l = kept[i];
		const prev = kept[i - 1];
		const gap = prev ? prev.y - l.y : 0;
		const sameStyle = prev && Math.abs(prev.h - l.h) < body * 0.15;
		if (!block || !sameStyle || gap > usual * 1.4 || gap < 0 || heading(l)) {
			block = { prefix: heading(l), text: l.text };
			blocks.push(block);
		} else if (/[A-Za-z]-$/.test(block.text) && /^[a-z]/.test(l.text)) {
			// A word hyphenated across the line break.
			block.text = block.text.slice(0, -1) + l.text;
		} else block.text += " " + l.text;
	}
	return blocks.map((b) => b.prefix + b.text).join("\n\n");
}

// A note name from a file name: no extension, and none of the characters
// Obsidian or Windows refuse in file names.
export function noteName(fileName) {
	const base = fileName.replace(/\.[^.]+$/, "") || "Upload";
	return base.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/^[.\s]+/, "").replace(/\s+$/, "").slice(0, 150) || "Upload";
}

// Notes the upload with a small frontmatter block, unless the file (a
// markdown upload) already has frontmatter of its own.
export function withFrontmatter(markdown, fileName, date = new Date()) {
	if (/^---\r?\n/.test(markdown)) return markdown;
	const day = date.toLocaleDateString("en-CA");
	return `---\nsource: ${JSON.stringify(fileName)}\nuploaded: ${day}\n---\n\n${markdown.replace(/^\s+/, "")}`;
}
