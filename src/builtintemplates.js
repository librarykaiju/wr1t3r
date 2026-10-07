// Templates wr1t3r brings with it, for a notebook without its own
// _templates/ (a new one, say). A notebook's own template always wins; these
// only fill in when it has none, so Today and the New ... commands work from
// the first day. Same <% %> forms as a notebook's templates (src/daily.js).

const fm = (lines) => ["---", ...lines, "---", ""].join("\n");
const log = (type, extra = []) => fm([`title: "<% tp.file.title %>"`, `type: ${type}`, ...extra, "rating:", "status:", `date: <% tp.date.now("YYYY-MM-DD") %>`, "tags: []", "publish: false"]) + "\n## Notes\n\n";

const TEMPLATES = {
	daily: fm([`date: <% tp.date.now("YYYY-MM-DD") %>`]) + "\n```wr1t3r-planner\ntasks: [crit, todo]\ntimeline: []\n```\n\n## Notes\n\n",
	journal: fm([`title: "<% tp.file.title %>"`, `date: <% tp.date.now("YYYY-MM-DD") %>`, "tags: []"]) + "\n",
	note: fm([`title: "<% tp.file.title %>"`, `date: <% tp.date.now("YYYY-MM-DD") %>`, "tags: []"]) + "\n",
	microblog: fm([`date: <% tp.date.now("YYYY-MM-DD HH:mm") %>`, "tags: []"]) + "\n",
	"catalog entry": fm([`title: "<% tp.file.title %>"`, "url:", "tags: []"]) + "\n",
	"tools entry": fm([`title: "<% tp.file.title %>"`, "url:", "tags: []"]) + "\n",
	book: log("book", ["author:"]),
	movie: log("movie", ["director:", "year:"]),
	series: log("series", ["year:"]),
	music: log("music", ["artist:", "year:"]),
	game: log("game", ["platform:", "year:"]),
	podcast: log("podcast", ["host:"]),
	comic: log("comic", ["writer:", "artist:"]),
};

// The built-in text for a template path ("_templates/Daily.md"), or null.
export function builtinTemplate(name) {
	const key = String(name || "").toLowerCase().replace(/^.*_templates\//, "").replace(/\.md$/, "");
	return TEMPLATES[key] ?? null;
}
