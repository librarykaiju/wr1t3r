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

// The getting-started note, written for the areas that are on (features: the
// map from featuresFor or the Settings note). worker: false for the Dropbox
// build, which has no Clip button, transcripts or voice memos. story: the
// sample manuscript is there to point at.
export function guideText(features, { worker = true, story = false } = {}) {
	const on = (id) => features[id] !== false;
	const lines = [
		"# Welcome to wr1t3r",
		"",
		"Everything here is a plain Markdown file in your own storage. You can open, copy or back them up with anything, and delete this note when you're done with it. Commands > Getting started brings it back, written for whatever is switched on then.",
		"",
		"## Getting around",
		"",
		"- **New note:** the New button in the sidebar.",
		"- **Right-click** a note or folder in the sidebar (or press and hold it on a phone or tablet) for everything you can do with it: new notes inside it, rename, move, pin to Home, archive or delete.",
		"- **Commands:** the ⌘ button, or Ctrl/Cmd+P, finds everything wr1t3r can do.",
		"- **Open a note fast:** Ctrl/Cmd+O.",
		"- **Home:** the house button shows your pinned tiles. Commands > Pin this note to Home adds one.",
		"- **Settings:** the gear button. Settings > Features turns whole parts of wr1t3r on or off.",
		"",
		"## Writing",
		"",
		"- Type `/` at the start of a line for headings, lists, tables, task lists and more.",
		"- Link notes with `[[double brackets]]`. The link follows the note if you rename it.",
		"- `#tags` anywhere in a note show up in the sidebar.",
		"- Properties (the block between `---` lines at the top) hold things like a title, tags or a status.",
		"- The printer button in the toolbar exports the note as Markdown, HTML, PDF or Word.",
	];
	if (on("longform")) lines.push(
		"",
		"## Long-form writing",
		"",
		"Keep a book or story in a folder, one note per scene or chapter. **Right-click the folder in the sidebar** (press and hold on a phone or tablet) to open it as:",
		"",
		"- **Corkboard:** a card for each note, showing its `synopsis` property. Drag the cards to change the order.",
		"- **Outliner:** the same notes as a table, with their synopsis, status and word count.",
		"- **Draft:** every note in the folder as one long document, to read and edit straight through.",
		"- **Compile…:** joins the folder into one file, as Markdown, HTML, PDF or Word, with a title page if you like.",
		"",
		"Once a folder is open, the buttons along its top switch between Corkboard, Outliner and Draft. A note with `status: cut` or `compile: false` is left out of Compile.",
	);
	if (on("longform") && story) lines.push("", "Try it on [[My Story/01 Opening|My Story]], a sample manuscript with three scenes.");
	if (on("boards")) lines.push(
		"",
		"## Boards",
		"",
		"A board shows notes as a grid, a gallery of cards or a kanban, sorted and filtered by their properties. Right-click a folder > **New board…** makes one for that folder, and Commands > Insert board puts one inside a note.",
	);
	if (on("daily")) lines.push(
		"",
		"## Your day",
		"",
		"The **Today** button opens today's note: a planner with a timeline for the day beside your Critical and To Do task lists. Tag a task `#crit` or `#todo` in any note and it shows up there; unticked tasks from earlier days carry over until they're done.",
	);
	if (on("health")) lines.push(
		"",
		"## Health and food",
		"",
		"The buttons at the top of the planner log food, water, meds and mood to the day's health note. Commands > Log food does the same from anywhere.",
	);
	if (on("calendar")) lines.push(
		"",
		"## Calendar",
		"",
		"The calendar button at the top right opens the agenda: today and the week ahead. On a computer, click an empty day in the month calendar to add an event.",
	);
	if (on("reminders")) lines.push(
		"",
		"## Reminders",
		"",
		"A task with a date and time, like `- [ ] Call Sam (@2026-10-07 14:00)`, reminds you then. " + (worker
			? "Turn them on for each phone or computer with Commands > Turn on reminders on this device, and they come even with wr1t3r closed."
			: "They come while wr1t3r is open in a tab. Commands > Turn on reminders on this device lets them show as notifications when the tab is in the background."),
	);
	if (on("media")) lines.push(
		"",
		"## Books, films and more",
		"",
		"Commands > New book log (or movie, TV series, music, game, podcast, comic) looks the title up and fills in the details and cover. Commands > Open stats charts what you've finished, and Commands > Import StoryGraph library brings in what you've already read.",
	);
	if (on("capture")) lines.push(
		"",
		"## Capture",
		"",
		(worker ? "The Clip button saves a web page as a note, and " : "") + "Commands > Capture to the Inbox jots a thought into your Inbox note without leaving what you're on.",
	);
	if (on("ocr")) lines.push(
		"",
		"## Pictures and PDFs",
		"",
		"Commands > Make pictures and PDFs searchable reads the text in them, so search finds a photo of a page or a scanned PDF.",
	);
	if (on("audio") && worker) lines.push(
		"",
		"## Recordings",
		"",
		"Commands > Record a voice memo, or Transcribe a video or audio file, writes what was said into a note.",
	);
	lines.push(
		"",
		"## Publishing",
		"",
		"Set `publish: true` on any note (or Commands > Publish this note), then Commands > Export as website makes a ready-to-upload site from those notes, in your theme, for Neocities or any other host.",
	);
	return lines.join("\n") + "\n";
}

const scene = (title, synopsis, status, body) => ["---", `synopsis: ${synopsis}`, `status: ${status}`, "---", "", `# ${title}`, "", body, ""].join("\n");

// The notes to add for the chosen uses, as [{ path, text }], under root
// ("" or "content/"); worker as for guideText. The Home note pins the ones worth a tile.
export function starterNotes(uses, root = "", { worker = true } = {}) {
	const out = [{ path: root + "Welcome.md", text: guideText(featuresFor(uses), { worker, story: has(uses, "writing") }) }];
	const pins = [{ link: "[[Welcome]]", color: 4 }];
	if (has(uses, "writing")) {
		out.push(
			{ path: root + "My Story/01 Opening.md", text: scene("Opening", "Where the story starts, and who we meet first.", "draft", "Write your first scene here. Each scene is its own note, so they're easy to move around on the corkboard.") },
			{ path: root + "My Story/02 Trouble.md", text: scene("Trouble", "Something goes wrong.", "idea", "The synopsis property above is what the corkboard card shows.") },
			{ path: root + "My Story/03 Turn.md", text: scene("Turn", "Nothing is the same after this.", "idea", "") },
		);
		pins.push({ link: "corkboard:" + root + "My Story", title: "My Story", color: 2 });
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
