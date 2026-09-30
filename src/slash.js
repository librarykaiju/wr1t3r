// The slash menu: type "/" at the start of a line or after a space, then a few
// letters to filter. Each command is plain data so the list can later be made
// editable. In templates, ${} marks where the cursor lands and ${name} a
// placeholder you can Tab to (CodeMirror snippet syntax).

import { snippet } from "@codemirror/autocomplete";
import { addProperty } from "./frontmatter.js";
import { editBanner, editCover } from "./pretty.js";
import { insertFootnote } from "./footnotes.js";
import { dueCommand } from "./due.js";
import { inTable, addRow, addColumn, deleteRow, deleteColumn, formatTable } from "./table.js";

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time

export const COMMANDS = [
	{ label: "Heading 1", template: "# ${}" , keywords: "h1 title" },
	{ label: "Heading 2", template: "## ${}", keywords: "h2" },
	{ label: "Heading 3", template: "### ${}", keywords: "h3" },
	{ label: "Bullet list", template: "- ${}", keywords: "ul unordered" },
	{ label: "Numbered list", template: "1. ${}", keywords: "ol ordered" },
	{ label: "Task", template: "- [ ] ${}", keywords: "todo checkbox" },
	{ label: "Quote", template: "> ${}", keywords: "blockquote" },
	{ label: "Callout", template: "> [!${note}] ${title}\n> ${}", keywords: "admonition note warning tip" },
	{ label: "Code block", template: "```${lang}\n${}\n```", keywords: "fence pre" },
	{ label: "Table", template: "| ${Column} | Column |\n| --- | --- |\n| ${} |  |", keywords: "grid" },
	{ label: "Divider", template: "---\n${}", keywords: "hr rule line" },
	{ label: "Link", template: "[${text}](${url})", keywords: "url href" },
	{ label: "Wikilink", template: "[[${}]]", keywords: "internal note" },
	{ label: "Image", template: "![${alt}](${url})", keywords: "picture img" },
	{ label: "Footnote", run: insertFootnote, keywords: "reference note footnote endnote cite", hug: true },
	{ label: "Bold", template: "**${}**", keywords: "strong" },
	{ label: "Italic", template: "*${}*", keywords: "emphasis" },
	{ label: "Strikethrough", template: "~~${}~~", keywords: "strike delete" },
	{ label: "Highlight", template: "==${}==", keywords: "mark" },
	{ label: "Inline code", template: "`${}`", keywords: "code" },
	{ label: "Add property", run: addProperty, keywords: "frontmatter yaml properties metadata tags" },
	{ label: "Banner image", run: editBanner, keywords: "banner header picture properties pretty" },
	{ label: "Cover image", run: editCover, keywords: "cover poster picture properties pretty" },
	{ label: "Date", template: () => today() + "${}", keywords: "today" },
	{ label: "Due date", run: dueCommand, keywords: "task deadline due calendar tasks 📅" },
	// Only offered with the cursor in a table.
	{ label: "Add row below", run: addRow, keywords: "table insert", table: true },
	{ label: "Add column after", run: addColumn, keywords: "table insert col", table: true },
	{ label: "Delete row", run: deleteRow, keywords: "table remove", table: true },
	{ label: "Delete column", run: deleteColumn, keywords: "table remove col", table: true },
	{ label: "Format table", run: formatTable, keywords: "table align tidy", table: true },
];

// Commands that come and go with the vault (a command per template), set by
// main.js: () => [{ label, detail, keywords, run }].
let extras = () => [];
export function setSlashExtras(fn) {
	extras = fn;
}

// Matches "/filter" at the start of a line or after whitespace, ending at the cursor.
const TRIGGER = /(?:^|\s)\/([\w-]*)$/;

export function slashSource(commands) {
	return (context) => {
		const list = commands || [...COMMANDS, ...extras()];
		const line = context.state.doc.lineAt(context.pos);
		const before = line.text.slice(0, context.pos - line.from);
		const m = before.match(TRIGGER);
		if (!m) return null;
		const slashAt = context.pos - m[1].length - 1;
		const q = m[1].toLowerCase();
		const atDocStart = slashAt === 0;
		const table = inTable(context.state);
		const options = list
			.filter((c) => !c.docStart || atDocStart)
			.filter((c) => !c.table || table)
			.filter((c) => !q || c.label.toLowerCase().includes(q) || (c.keywords || "").includes(q))
			.map((c, i) => ({
				label: c.label,
				detail: c.detail,
				// Prefix matches first, then list order.
				boost: (c.table ? 100 : 0) + (c.label.toLowerCase().startsWith(q) ? 50 - i : -i),
				apply: (view, completion, from, to) => {
					if (c.run) {
						// A footnote sits right after the word: drop the space typed to open the menu.
						const at = c.hug && /\S $/.test(view.state.sliceDoc(slashAt - 2, slashAt)) ? slashAt - 1 : slashAt;
						view.dispatch({ changes: { from: at, to }, selection: { anchor: at } });
						c.run(view);
						return;
					}
					const t = typeof c.template === "function" ? c.template() : c.template;
					snippet(t)(view, completion, slashAt, to); // replaces the "/filter" too
				},
			}));
		if (!options.length) return null;
		// filter: false -- we filtered already, and the typed text includes the "/".
		return { from: slashAt + 1, options, filter: false };
	};
}
