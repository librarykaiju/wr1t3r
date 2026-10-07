// New project: a folder for a piece of long-form writing, filled with starter
// notes from the writing templates (src/builtintemplates.js, or the
// notebook's own template of the same name), in storyboard order, with
// Compile already set up for it. Planning notes go in a Notes folder and stay
// out of the compile.

import { writeBinder, binderPath } from "./binder.js";
import { writeCompileSettings } from "./compile.js";

export const PROJECT_KINDS = [
	{ id: "story", noun: "short story", label: "Short story", detail: "Three scenes and a character sheet" },
	{ id: "novel", noun: "novel", label: "Novel", detail: "Chapters, characters, an outline and a style sheet" },
	{
		id: "essay", label: "Essay", detail: "A draft and a place for sources",
		variants: [
			{ id: "essay", noun: "essay", label: "Essay", detail: "No set citation style" },
			{ id: "mla", noun: "research paper", label: "Research paper, MLA", detail: "Works Cited, author and page citations" },
			{ id: "apa", noun: "research paper", label: "Research paper, APA", detail: "Title page, References, author and year citations" },
			{ id: "chicago", noun: "research paper", label: "Research paper, Chicago", detail: "Footnotes and a Bibliography" },
		],
	},
	{
		id: "script", label: "Script", detail: "Screenplay, TV episode or comic",
		variants: [
			{ id: "screenplay", noun: "screenplay", label: "Screenplay", detail: "Three acts in screenplay format" },
			{ id: "tv", noun: "TV episode", label: "TV episode", detail: "A cold open, acts and a tag" },
			{ id: "comic", noun: "comic", label: "Comic", detail: "Pages and panels, captions and balloons" },
		],
	},
];

// What each project holds: notes [name, template] in order (a "/" puts it in
// a subfolder), planning notes, and the compile settings.
const PLANS = {
	story: { notes: [["01 Opening", "Scene"], ["02 Trouble", "Scene"], ["03 Turn", "Scene"]], extra: [["Main character", "Character"]], compile: { headings: "none", separator: "scene", layout: "manuscript" } },
	novel: { notes: [["Chapter 1", "Chapter"], ["Chapter 2", "Chapter"], ["Chapter 3", "Chapter"]], extra: [["Outline", null], ["Main character", "Character"], ["Style sheet", "Style sheet"]], compile: { headings: "title", separator: "page", layout: "manuscript" } },
	essay: { notes: [[null, "Essay"]], extra: [["Sources", null]], compile: { headings: "none", separator: "blank", layout: "manuscript" } },
	mla: { notes: [[null, "Research paper (MLA)"]], extra: [["Sources", null]], compile: { headings: "none", separator: "blank", layout: "manuscript" }, noTitlePage: true },
	apa: { notes: [[null, "Research paper (APA)"]], extra: [["Sources", null]], compile: { headings: "none", separator: "blank", layout: "manuscript" } },
	chicago: { notes: [[null, "Research paper (Chicago)"]], extra: [["Sources", null]], compile: { headings: "none", separator: "blank", layout: "manuscript" } },
	screenplay: { notes: [["Act One", "Screenplay"], ["Act Two", "Script scene"], ["Act Three", "Script scene"]], extra: [["Beat sheet", null], ["Main character", "Character"]], compile: { headings: "none", separator: "blank", layout: "script" } },
	tv: { notes: [["Cold Open", "Screenplay"], ["Act One", "Script scene"], ["Act Two", "Script scene"], ["Act Three", "Script scene"], ["Tag", "Script scene"]], extra: [["Series bible", null], ["Main character", "Character"]], compile: { headings: "title", separator: "page", layout: "script" } },
	comic: { notes: [["Issue 1", "Comic script"]], extra: [["Series bible", null], ["Main character", "Character"]], compile: { headings: "none", separator: "page", layout: "book" } },
};

// Planning notes no template covers.
const NOTES = {
	Outline: "# Outline\n\n%% A line or two per chapter: what happens, and what changes. Drag the chapter cards on the storyboard to try another order. %%\n\n1. \n2. \n3. \n",
	Sources: "# Sources\n\n%% Everything you might cite, with enough to write the citation later: author, title, publisher or site, date, page or URL, and the quotation itself. %%\n\n- \n",
	"Beat sheet": "# Beat sheet\n\n- **Opening image:** \n- **Setup:** \n- **Inciting incident:** \n- **Break into two:** \n- **Midpoint:** \n- **All is lost:** \n- **Climax:** \n- **Final image:** \n",
	"Series bible": "# Series bible\n\n## Premise\n\n## Characters\n\n## World and rules\n\n## Tone\n\n## Story so far\n",
};

const PLAN_FOR = (kind, variant) => PLANS[variant && PLANS[variant] ? variant : kind];

// Sets property key in a note's frontmatter (adding one if it has none).
function withProperty(text, key, value) {
	const m = text.match(/^---\r?\n([\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
	if (!m) return `---\n${key}: ${value}\n---\n\n` + text;
	const body = m[1] || "";
	if (new RegExp(`^${key}\\s*:`, "m").test(body)) return text.replace(m[0], m[0].replace(new RegExp(`^${key}\\s*:.*$`, "m"), `${key}: ${value}`));
	return text.replace(m[0], `---\n${body}${key}: ${value}\n---\n`);
}

// The files for a new project: [{ path, text }], the binder last.
// folder: where it goes ("content/My Novel/"); title: the project's name;
// template(name, title): that template rendered for a note called title, or
// null; paths: the notebook's paths (for the binder's links).
export function projectFiles({ kind, variant, title, folder, template, paths = [] }) {
	const plan = PLAN_FOR(kind, variant);
	if (!plan) throw new Error("No such project: " + kind);
	const files = [];
	for (const [name, tmpl] of plan.notes) {
		const n = name || title;
		files.push({ path: folder + n + ".md", text: template(tmpl, n) ?? "" });
	}
	for (const [name, tmpl] of plan.extra) {
		const text = (tmpl ? template(tmpl, name) : null) ?? NOTES[name] ?? `# ${name}\n`;
		files.push({ path: folder + "Notes/" + name + ".md", text: withProperty(text, "compile", "false") });
	}
	const all = [...paths, ...files.map((f) => f.path)];
	const items = [
		...plan.notes.map(([name]) => ({ kind: "note", path: folder + (name || title) + ".md" })),
		{ kind: "folder", path: folder + "Notes/" },
	];
	const settings = { title: plan.noTitlePage ? "" : title, author: "", ...plan.compile };
	files.push({ path: binderPath(folder), text: writeCompileSettings(writeBinder("", items, all), settings) });
	return files;
}
