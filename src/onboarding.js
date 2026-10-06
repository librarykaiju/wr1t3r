// The first run: when a notebook has nothing in it, wr1t3r asks what it's for,
// turns on the areas that fit (src/features.js), and can add a few starter
// notes and a Home screen to show the way around. A notebook with anything
// in it never sees this.

import { FEATURE_AREAS } from "./features.js";
import { HOME_BODY } from "./home.js";

// What someone might want wr1t3r for, and the areas each one needs. Every
// area is in at least one, so picking them all leaves everything on.
export const USES = [
	{ id: "writing", label: "Writing", detail: "Stories, books, essays: chapters on a corkboard, compiled into one file", areas: ["longform", "boards"] },
	{ id: "planner", label: "Journal and day planner", detail: "A note for each day, tasks, reminders and a calendar", areas: ["daily", "calendar", "reminders"] },
	{ id: "health", label: "Health and food", detail: "Log meals, recipes and nutrition from the day planner", areas: ["health", "daily"] },
	{ id: "media", label: "Books, films and other media", detail: "Notes for what you read, watch, play and listen to", areas: ["media", "boards"] },
	{ id: "research", label: "Research and clipping", detail: "Clip web pages, capture ideas, search the text in pictures and recordings", areas: ["capture", "ocr", "audio"] },
];

export const DEFAULT_USES = ["writing"];

// The features map for the chosen uses: an area is on when any chosen use
// needs it. No uses at all means everything on, as before.
export function featuresFor(uses) {
	const chosen = USES.filter((u) => uses.includes(u.id));
	if (!chosen.length) return Object.fromEntries(FEATURE_AREAS.map((a) => [a.id, true]));
	const on = new Set(chosen.flatMap((u) => u.areas));
	return Object.fromEntries(FEATURE_AREAS.map((a) => [a.id, on.has(a.id)]));
}

const has = (uses, id) => uses.includes(id);

function welcomeText(uses) {
	const lines = [
		"# Welcome to wr1t3r",
		"",
		"Everything here is a plain Markdown file in your own storage. You can open, copy or back them up with anything, and delete this note when you're done with it.",
		"",
		"## Getting around",
		"",
		"- **New note:** the New button in the sidebar.",
		"- **Commands:** the ⌘ button, or Ctrl/Cmd+P, finds everything wr1t3r can do.",
		"- **Open a note fast:** Ctrl/Cmd+O.",
		"- **Home:** the house button shows your pinned tiles. Commands > Pin this note to Home adds one.",
		"- **Settings:** the Aa button. Settings > Features turns whole parts of wr1t3r on or off.",
		"",
		"## Writing",
		"",
		"- Type `/` at the start of a line for headings, lists, tables, task lists and more.",
		"- Link notes with `[[double brackets]]`. The link follows the note if you rename it.",
		"- `#tags` anywhere in a note show up in the sidebar.",
		"- Properties (the block between `---` lines at the top) hold things like a title, tags or a status.",
	];
	if (has(uses, "writing")) lines.push(
		"",
		"## Long-form",
		"",
		"The [[Draft/01 Opening|Draft]] folder is a sample manuscript, one note per scene. Open it as a corkboard (Commands > Open corkboard) to move scenes around, as an outline, or as scrivenings to read them as one. Commands > Compile a folder joins them into one file.",
	);
	if (has(uses, "planner") || has(uses, "health")) lines.push(
		"",
		"## Your day",
		"",
		"The Today button opens today's note with the day planner. Tasks like `- [ ] Call Sam (@2026-10-07 14:00)` get a reminder at that time.",
	);
	if (has(uses, "media")) lines.push(
		"",
		"## Media",
		"",
		"Commands > New book log (or movie, TV series, music, game, podcast, comic) looks the title up and fills in the details and cover.",
	);
	if (has(uses, "research")) lines.push(
		"",
		"## Capture",
		"",
		"The Clip button saves a web page as a note, and Commands > Capture to the Inbox jots a thought into your Inbox note without leaving what you're on.",
	);
	return lines.join("\n") + "\n";
}

const scene = (title, synopsis, status, body) => ["---", `synopsis: ${synopsis}`, `status: ${status}`, "---", "", `# ${title}`, "", body, ""].join("\n");

// The notes to add for the chosen uses, as [{ path, text }], under root
// ("" or "content/"). The Home note pins the ones worth a tile.
export function starterNotes(uses, root = "") {
	const out = [{ path: root + "Welcome.md", text: welcomeText(uses) }];
	const pins = [{ link: "[[Welcome]]", color: 4 }];
	if (has(uses, "writing")) {
		out.push(
			{ path: root + "Draft/01 Opening.md", text: scene("Opening", "Where the story starts, and who we meet first.", "draft", "Write your first scene here. Each scene is its own note, so they're easy to move around on the corkboard.") },
			{ path: root + "Draft/02 Trouble.md", text: scene("Trouble", "Something goes wrong.", "idea", "The synopsis property above is what the corkboard card shows.") },
			{ path: root + "Draft/03 Turn.md", text: scene("Turn", "Nothing is the same after this.", "idea", "") },
		);
		pins.push({ link: "corkboard:" + root + "Draft", title: "Draft", color: 2 });
	}
	if (has(uses, "planner") || has(uses, "health")) pins.push({ link: "command:Open today's daily note", title: "Today", color: 5 });
	if (has(uses, "research")) pins.push({ link: "[[Inbox]]", color: 6 });
	if (has(uses, "research")) out.push({ path: root + "Inbox.md", text: "# Inbox\n\nCaptures and shared links land here.\n" });
	const yaml = ["---", "pins:", ...pins.flatMap((p) => Object.entries(p).map(([k, v], i) => `${i ? "   " : "  -"} ${k}: ${typeof v === "number" ? v : JSON.stringify(v)}`)), "---", ""];
	out.push({ path: root + "_wr1t3r/Home.md", text: yaml.join("\n") + HOME_BODY });
	return out;
}

// iPhone and iPad Safari drop a site's stored data after about a week without
// a visit, unless it's added to the Home Screen. True when that tip applies.
export function needsHomeScreen(ua, standalone, touchPoints = 0) {
	const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1); // iPadOS says it's a Mac
	return ios && !standalone;
}
