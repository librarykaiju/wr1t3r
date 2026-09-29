// wr1t3r's page: file list, editor and the sync loop. Every keystroke is
// saved to this device first (IndexedDB); syncing with the vault happens in
// the background and whenever the connection comes back.

import { createEditor } from "./editor.js";
import { setupKeyboardBar } from "./kbbar.js";
import { DAILY_FOLDER, isoDate, renderTemplate, findTemplate } from "./daily.js";
import { promptFor } from "./prompts.js";
import { resolveNote, headingFor, blockFor } from "./links.js";
import { noteTags } from "./frontmatter.js";
import { vaultChanged } from "./vault.js";
import { setLivePreview } from "./livepreview.js";
import { parseQuery, matches, snippet } from "./search.js";
import { openPalette } from "./palette.js";
import { EDIT_ACTIONS, DEFAULT_KEYS, keyName, showKey, usableKey, bindings, rebind } from "./hotkeys.js";
import { templatesIn, insertTemplate } from "./templates.js";
import { COMMANDS } from "./slash.js";
import { runCommand } from "./kbbar.js";
import { inTable } from "./table.js";
import { renameEdits, applyChanges } from "./vaultlinks.js";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { local, meta, persist } from "./store.js";
import { resolveAttachment, attachmentURL } from "./attachments.js";
import { api, token, setToken, AuthError } from "./api.js";
import { sync } from "./sync.js";
import { isNotePath } from "./paths.js";
import { counts, countWords } from "./count.js";
import * as pomo from "./pomodoro.js";
import * as agenda from "./agenda.js";
import * as toc from "./toc.js";
import { timelineChanges, eventsOn } from "./timeline.js";
import { newNoteFrontmatter } from "./frontmatter.js";
import { quoteFor } from "./quotes.js";
import { readTheme, themeAttr } from "./theme.js";
import { rerunDataview } from "./dataview.js";
import { makeMediaNote } from "./media.js";

const $ = (id) => document.getElementById(id);
const notes = new Map(); // path -> note, mirrors IndexedDB
let editor;

// ---- storage: one write chain so saves land in order ----------------------

let writing = Promise.resolve();
// fn(current|null) -> new note | null (delete) | undefined (leave), applied in
// one IndexedDB transaction (see local.update).
function change(path, fn) {
	writing = writing
		.then(() => local.update(path, fn))
		.then(({ after }) => {
			if (after) notes.set(path, after); else notes.delete(path);
			return after;
		})
		.catch((e) => toast("Couldn't save on this device: " + e.message));
	return writing;
}

// ---- sync ------------------------------------------------------------------

let syncing = false, again = false, lastSynced = null, lastError = null, syncTimer;

function scheduleSync(ms = 2000) {
	clearTimeout(syncTimer);
	syncTimer = setTimeout(runSync, ms);
}

async function runSync() {
	if (syncing) { again = true; return; }
	if (!navigator.onLine) { lastError = "offline"; renderStatus(); return; }
	syncing = true;
	renderStatus();
	try {
		await writing;
		const r = await sync({ local, api, onNote });
		refreshAttachments();
		lastSynced = new Date();
		lastError = null;
		for (const c of r.conflicts) {
			toast(`${name(c.path)} was also changed elsewhere. Your version is saved as “${name(c.copy)}”.`, 8000);
		}
	} catch (e) {
		if (e instanceof AuthError) return signOut("That token no longer works.");
		lastError = e instanceof TypeError ? "offline" : e.message;
	} finally {
		syncing = false;
		renderStatus();
		renderTree();
		if (again) { again = false; scheduleSync(0); }
	}
}

function onNote(path, note) {
	if (note) notes.set(path, note); else notes.delete(path);
	if (editor.path !== path) return;
	if (!note || note.deleted) {
		toast(`${name(path)} was deleted elsewhere.`);
		closeTab(path);
	} else if (!note.dirty) { editor.replace(note); refreshCount(true); }
}

function pending() {
	let n = 0;
	for (const note of notes.values()) if (note.dirty) n++;
	return n;
}

function renderStatus() {
	const s = $("status");
	const n = pending();
	const waiting = n ? ` · ${n} to send` : "";
	s.classList.toggle("warn", !!lastError && lastError !== "offline");
	if (syncing) s.textContent = "Syncing…";
	else if (lastError === "offline") s.textContent = "Offline" + waiting;
	else if (lastError) { s.textContent = "Sync failed" + waiting; s.title = lastError + " (tap to retry)"; return; }
	else if (n) s.textContent = `${n} to send`;
	else if (lastSynced) s.textContent = "Synced " + lastSynced.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	else s.textContent = "";
	s.title = "Sync now";
}

// ---- file list ---------------------------------------------------------------

const OPEN_KEY = "wr1t3r-open-folders";
let openFolders = new Set(readJSON(OPEN_KEY, []));

function readJSON(key, fallback) {
	try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
	try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const name = (path) => path.split("/").pop().replace(/\.md$/i, "");

function visible() {
	return [...notes.values()].filter((n) => !n.deleted).sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));
}

function link(note, label) {
	const a = document.createElement("a");
	a.href = "#" + encodeURIComponent(note.path);
	a.textContent = label;
	a.title = note.path;
	a.classList.toggle("current", note.path === editor.path);
	a.classList.toggle("dirty", !!note.dirty);
	return a;
}

// The folder the notes live in ("content/"), or "". Notes elsewhere in the
// bucket (at the vault root, say) don't change it; they're listed beside it.
function commonFolder(list) {
	let base = list[0]?.path.includes("/") ? list[0].path.slice(0, list[0].path.indexOf("/") + 1) : "";
	if (base && list.every((n) => n.path.startsWith(base))) return base;
	return list.some((n) => n.path.startsWith("content/")) ? "content/" : "";
}

// Tells the editor other notes changed (backlinks, faded links to missing
// notes), after a pause so a burst of changes redraws once.
let vaultTimer;
function vaultTouched() {
	clearTimeout(vaultTimer);
	vaultTimer = setTimeout(() => editor?.view.dispatch({ effects: vaultChanged.of(null) }), 400);
	refTouched();
}

function renderTree() {
	vaultTouched();
	const tree = $("tree");
	const q = $("filter").value.trim();
	tree.replaceChildren();
	const list = visible();
	if (q) {
		// Words, "phrases", path:, file:, tag:/#tag and -word (src/search.js).
		const terms = parseQuery(q);
		const hits = list.filter((n) => matches(n.binary ? { path: n.path, text: "" } : n, terms, noteTags));
		const base = commonFolder(list);
		for (const n of hits.slice(0, 300)) {
			const a = link(n, (n.path.startsWith(base) ? n.path.slice(base.length) : n.path).replace(/\.md$/i, ""));
			const s = n.binary ? null : snippet(n.text, terms);
			if (s) {
				a.classList.add("hit");
				const line = document.createElement("span");
				line.className = "snippet";
				const mark = document.createElement("mark");
				mark.textContent = s.match;
				line.append(s.before, mark, s.after);
				a.append(line);
			}
			tree.append(a);
		}
		if (!hits.length) tree.append(Object.assign(document.createElement("div"), { className: "hint", textContent: "No matches." }));
		return;
	}
	if (!list.length) {
		tree.append(Object.assign(document.createElement("div"), { className: "hint", textContent: lastSynced ? "The vault is empty." : "Loading the vault…" }));
		return;
	}
	drawBookmarks(tree);
	drawTags(tree, list);
	// Folders first, then notes, like Obsidian.
	const root = { folders: new Map(), notes: [] };
	for (const n of list) {
		const parts = n.path.split("/");
		let node = root;
		for (const dir of parts.slice(0, -1)) {
			if (!node.folders.has(dir)) node.folders.set(dir, { folders: new Map(), notes: [] });
			node = node.folders.get(dir);
		}
		node.notes.push(n);
	}
	// The notes' folder ("content/") isn't shown; its contents are the top level,
	// followed by anything outside it.
	let top = root, base = "";
	const home = commonFolder(list);
	if (home) {
		top = root.folders.get(home.slice(0, -1));
		base = home;
		root.folders.delete(home.slice(0, -1));
	}
	const current = editor.path || "";
	let i = 0; // top-level folders take the theme's rainbow in turn
	const draw = (node, into, prefix, depth = 0) => {
		for (const [dir, child] of node.folders) {
			const full = prefix + dir + "/";
			const d = document.createElement("details");
			// Subfolders keep their parent's color.
			if (!depth) d.style.setProperty("--fc", `var(--f${(i++ % 7) + 1})`);
			d.open = openFolders.has(full) || current.startsWith(full);
			const s = document.createElement("summary");
			s.textContent = dir;
			const kids = document.createElement("div");
			kids.className = "kids";
			d.append(s, kids);
			d.addEventListener("toggle", () => {
				d.open ? openFolders.add(full) : openFolders.delete(full);
				writeJSON(OPEN_KEY, [...openFolders]);
				if (d.open && !kids.childElementCount) draw(child, kids, full, depth + 1);
			});
			if (d.open) draw(child, kids, full, depth + 1);
			into.append(d);
		}
		for (const n of node.notes) into.append(link(n, name(n.path)));
	};
	draw(top, tree, base);
	if (top !== root) draw(root, tree, "");
}

// Bookmarked notes, and every tag with its count, above the folders. Both
// fold, and stay folded or open on this device.
const BOOKMARKS_KEY = "wr1t3r-bookmarks";
let bookmarks = readJSON(BOOKMARKS_KEY, []);
const SECTIONS_KEY = "wr1t3r-side-sections";
const sections = readJSON(SECTIONS_KEY, { bookmarks: true, tags: false });

function sideSection(key, title, into) {
	const d = document.createElement("details");
	d.className = "side-section";
	d.open = !!sections[key];
	const sum = document.createElement("summary");
	sum.textContent = title;
	const kids = document.createElement("div");
	kids.className = "kids";
	d.append(sum, kids);
	d.addEventListener("toggle", () => { sections[key] = d.open; writeJSON(SECTIONS_KEY, sections); });
	into.append(d);
	return kids;
}

function drawBookmarks(tree) {
	const marked = bookmarks.filter(isOpenable);
	if (!marked.length) return;
	const kids = sideSection("bookmarks", `Bookmarks`, tree);
	for (const p of marked) kids.append(link(notes.get(p), name(p)));
}

function toggleBookmark(path = editor.path) {
	if (!path) return;
	bookmarks = bookmarks.includes(path) ? bookmarks.filter((p) => p !== path) : [...bookmarks, path];
	writeJSON(BOOKMARKS_KEY, bookmarks);
	renderBookmarkButton();
	renderTree();
}

function renderBookmarkButton() {
	const on = !!editor.path && bookmarks.includes(editor.path);
	const b = $("bookmark");
	b.textContent = on ? "★" : "☆";
	b.classList.toggle("on", on);
	b.setAttribute("aria-pressed", String(on));
	b.title = on ? "Remove bookmark" : "Bookmark this note";
}

// Tags per note, kept while the note's text is the same.
const tagCache = new Map();
function tagsOfNote(n) {
	const hit = tagCache.get(n.path);
	if (hit && hit.text === n.text) return hit.tags;
	const tags = n.binary ? [] : [...new Set(noteTags(n.text).map((t) => t.toLowerCase()))];
	tagCache.set(n.path, { text: n.text, tags });
	return tags;
}

function drawTags(tree, list) {
	const counts = new Map();
	for (const n of list) for (const t of tagsOfNote(n)) counts.set(t, (counts.get(t) || 0) + 1);
	if (!counts.size) return;
	const kids = sideSection("tags", `Tags`, tree);
	kids.classList.add("tag-list");
	for (const [t, c] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
		const a = document.createElement("a");
		a.href = "#";
		a.className = "tag-row";
		a.textContent = "#" + t;
		const n = document.createElement("span");
		n.className = "count";
		n.textContent = c;
		a.append(n);
		a.addEventListener("click", (e) => { e.preventDefault(); showTag(t); });
		kids.append(a);
	}
}

// ---- notes ---------------------------------------------------------------------

// The tab shows the note's name; while you're editing it, its full path.
function showPath() {
	const input = $("path"), p = editor.path;
	input.value = !p ? "" : document.activeElement === input ? p : name(p);
	input.size = Math.max(4, input.value.length + 1);
	$("tab").hidden = !p;
}

// ---- tabs ----------------------------------------------------------------------

// Open notes, in tab order, remembered on this device. Opening a note from the
// sidebar (or New, Today, a search) gives it a tab; following a link opens it
// in the current tab, as Obsidian does.
const TABS_KEY = "wr1t3r-tabs";
const MAX_TABS = 12;
let tabs = readJSON(TABS_KEY, []);
const saveTabs = () => writeJSON(TABS_KEY, tabs);
const isOpenable = (p) => { const n = notes.get(p); return !!n && !n.deleted; };

function addTab(path, replace) {
	if (tabs.includes(path)) return;
	const at = tabs.indexOf(editor.path);
	if (replace && at >= 0) tabs[at] = path;
	else tabs.splice(at >= 0 ? at + 1 : tabs.length, 0, path);
	while (tabs.length > MAX_TABS) tabs.splice(tabs.findIndex((p) => p !== path), 1);
	saveTabs();
}

function closeTab(path) {
	const at = tabs.indexOf(path);
	if (at >= 0) { tabs.splice(at, 1); saveTabs(); }
	if (path !== editor.path) return renderTabs();
	const next = tabs.slice(Math.max(0, at)).concat(tabs.slice(0, Math.max(0, at)).reverse()).find(isOpenable);
	openNote(next || null, { tab: false });
}

function renderTabs() {
	const strip = $("tabs"), current = $("tab");
	const shown = tabs.filter((p) => isOpenable(p) || p === editor.path);
	strip.replaceChildren();
	for (const p of shown) {
		if (p === editor.path) { strip.append(current); continue; }
		const t = document.createElement("div");
		t.className = "other" + (notes.get(p)?.dirty ? " dirty" : "");
		t.setAttribute("role", "tab");
		t.setAttribute("aria-selected", "false");
		t.title = p;
		const b = document.createElement("button");
		b.type = "button";
		b.className = "name quiet";
		b.textContent = name(p);
		b.addEventListener("click", () => openNote(p, { tab: false }));
		const x = document.createElement("button");
		x.type = "button";
		x.className = "x quiet";
		x.textContent = "×";
		x.setAttribute("aria-label", `Close ${name(p)}`);
		x.addEventListener("click", () => closeTab(p));
		t.addEventListener("auxclick", (e) => { if (e.button === 1) { e.preventDefault(); closeTab(p); } });
		t.append(b, x);
		strip.append(t);
	}
	if (!shown.includes(editor.path)) strip.append(current);
	const pick = $("tabPick");
	$("tabPickWrap").hidden = shown.length < 2;
	$("tabCount").textContent = shown.length;
	pick.replaceChildren(...shown.map((p) => Object.assign(document.createElement("option"), { value: p, textContent: name(p), selected: p === editor.path })));
	requestAnimationFrame(() => current.scrollIntoView?.({ block: "nearest", inline: "nearest" }));
	renderRefPick();
}

// opts.replace: show it in the current tab (links); opts.tab: false to leave the tabs as they are.
// Recently opened notes, newest first, for the quick switcher.
const RECENT_KEY = "wr1t3r-recent";
let recent = readJSON(RECENT_KEY, []);

function openNote(path, { replace = false, tab = true } = {}) {
	const note = path ? notes.get(path) : null;
	if (tab && note && !note.deleted) addTab(path, replace);
	if (note && !note.deleted) { recent = [path, ...recent.filter((p) => p !== path)].slice(0, 50); writeJSON(RECENT_KEY, recent); }
	editor.open(note && !note.deleted ? note : null);
	const has = !!editor.path;
	document.querySelector("main").classList.toggle("has-note", has);
	showPath();
	$("path").disabled = !has || note.binary;
	$("delete").disabled = !has;
	renderTitle();
	if (has && location.hash !== "#" + encodeURIComponent(path)) history.replaceState(null, "", "#" + encodeURIComponent(path));
	if (!has && location.hash) history.replaceState(null, "", location.pathname);
	$("app").classList.remove("menu-open");
	renderTree();
	renderTabs();
	renderBookmarkButton();
	refreshCount(true);
}

// ---- quick switcher, command palette, templates ----------------------------------

const folderOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")).replace(/^content(\/|$)/, "") : "");

// Ctrl/Cmd+O: jump to a note by name, recent ones first; Enter on a name
// that isn't a note offers to make it.
function quickSwitcher() {
	const all = visible().filter((n) => !n.binary).map((n) => n.path);
	const set = new Set(all);
	const order = [...recent.filter((p) => set.has(p) && p !== editor.path), ...all.filter((p) => !recent.includes(p))];
	openPalette({
		placeholder: "Open a note…",
		items: order.map((p) => ({ label: name(p), detail: folderOf(p), keywords: folderOf(p), run: () => openNote(p) })),
		empty: (q) => ({ label: `Create “${q}”`, detail: "new note", run: () => newNote(currentFolder() + normalise(q)) }),
	});
}

// Rendering a template for a note called title.
function renderFor(tmplPath, title) {
	return renderTemplate(notes.get(tmplPath)?.text || "", { title, date: new Date() }).text;
}

function templateItems(run) {
	return templatesIn(visible().map((n) => n.path)).map((t) => ({ label: t.name, detail: "template", run: () => run(t) }));
}

// A new note from any template, named first (in the current note's folder).
function newFromTemplate() {
	const items = templateItems((t) => newNote(currentFolder() + "Untitled.md", (path) => renderFor(t.path, name(path))));
	if (!items.length) return toast("There's no _templates folder in the vault.");
	openPalette({ placeholder: "New note from template…", items });
}

// The template at the cursor; its properties join the note's without changing any.
function insertFromTemplate() {
	const view = editor.view;
	if (!editor.path || view.state.readOnly) return toast("Open a note first.");
	const items = templateItems((t) => {
		const text = view.state.sliceDoc();
		const changes = insertTemplate(text, renderFor(t.path, name(editor.path)), view.state.selection.main.head);
		const body = changes[changes.length - 1];
		view.dispatch({ changes, selection: body ? { anchor: view.state.changes(changes).mapPos(body.from, 1) } : undefined, scrollIntoView: true, userEvent: "input.template" });
		view.focus();
	});
	if (!items.length) return toast("There's no _templates folder in the vault.");
	openPalette({ placeholder: "Insert template…", items });
}

// Hotkeys: Obsidian's defaults plus this device's changes (src/hotkeys.js).
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const HOTKEYS_KEY = "wr1t3r-hotkeys";
let keyChanges = readJSON(HOTKEYS_KEY, {});
let keys = bindings(keyChanges);
let capturing = false; // while a new hotkey is being pressed

function searchNotes() {
	$("app").classList.add("menu-open");
	$("filter").focus();
	$("filter").select();
}

function toggleLivePreview() {
	const live = readRaw("wr1t3rMode") !== "live";
	storeRaw("wr1t3rMode", live ? "live" : null);
	applyMode(live ? "live" : "source");
}

// Every command, for the palette and the hotkeys. editor: runs on the open
// note's editor (and only while it has the cursor, from a hotkey).
function allCommands() {
	const view = editor.view;
	const app = [
		["Open a note", quickSwitcher, "quick switcher go to find"],
		["Run a command", commandPalette, "palette"],
		["New note", () => newNote(), "create"],
		["New note from template", newFromTemplate, "templater"],
		["Insert template", insertFromTemplate, "templater", true],
		["Open today's daily note", openDaily, "today journal daily"],
		["Add calendar events to the timeline", pullTimeline, "pull today's events daily agenda schedule"],
		["Search notes", searchNotes, "find sidebar"],
		["Bookmark this note", () => toggleBookmark(), "star pin unbookmark", true],
		["Rename this note", () => { $("path").focus(); }, "move", true],
		["Delete this note", () => removeNote(editor.path), "remove", true],
		["Close this tab", () => closeTab(editor.path), "close", true],
		["Show reference pane", () => showRef(!ref.on), "split side", true],
		["Contents", () => openToc(!tocOpen()), "outline headings toc", true],
		["Toggle Live Preview", toggleLivePreview, "markdown symbols hide"],
		["Settings", () => openSettings($("settings").hidden), "preferences theme"],
		["Change hotkeys", editHotkeys, "keyboard shortcuts keys bindings"],
		["Upload files", () => $("upload-input").click(), "import docx pdf"],
		["Clip a web page", () => clipPage(prompt("Web page to clip:") || ""), "save article"],
		...mediaKinds.filter((k) => k.ready && MEDIA_COMMANDS[k.kind]).map((k) => [`Create ${MEDIA_COMMANDS[k.kind]} note`, () => newMediaNote(k), "media log " + k.label.toLowerCase()]),
		["Sync now", () => runSync(), "save"],
		["Start or pause the focus timer", () => toggleTimer(), "pomodoro"],
		["Find in note", () => { view.focus(); openSearchPanel(view); }, "search replace", true],
	].map(([label, run, keywords, needsNote]) => ({ label, run, keywords, needsNote: !!needsNote }));
	const edits = [
		...COMMANDS.map((c) => ({ label: c.label, keywords: c.keywords, table: !!c.table, run: EDIT_ACTIONS[c.label] || ((v) => runCommand(v, c)) })),
		{ label: "Indent", keywords: "tab nest", run: EDIT_ACTIONS.Indent },
		{ label: "Outdent", keywords: "unindent dedent", run: EDIT_ACTIONS.Outdent },
	].map((c) => ({ ...c, editor: true, needsNote: true }));
	return [...app, ...edits];
}

// Ctrl/Cmd+P: every command that can run now, with its hotkey.
function commandPalette() {
	const has = !!editor.path;
	const view = editor.view;
	const items = allCommands()
		.filter((c) => (!c.needsNote || has) && (!c.editor || !view.state.readOnly) && (!c.table || inTable(view.state)))
		.map((c) => ({
			label: c.label, keywords: c.keywords,
			detail: showKey(keys.byLabel[c.label], MAC) || (c.editor ? "insert" : undefined),
			run: c.editor ? () => { view.focus(); c.run(view); } : c.run,
		}));
	openPalette({ placeholder: "Run a command…", items });
}

// Runs the command whose hotkey was pressed. Editing commands only act on the
// open note's text while it has the cursor.
function onHotkey(e) {
	if (capturing || e.defaultPrevented || e.isComposing) return;
	const name = keyName(e, MAC);
	if (!usableKey(name)) return;
	const label = keys.byKey.get(name);
	const c = label && allCommands().find((x) => x.label === label);
	if (!c) return;
	const view = editor.view;
	if (c.needsNote && !editor.path) return;
	if (c.editor && (document.activeElement !== view.contentDOM || (c.table && !inTable(view.state)))) return;
	e.preventDefault();
	e.stopPropagation();
	c.editor ? c.run(view) : c.run();
}

// Settings > Hotkeys: pick a command, then press its new keys.
function editHotkeys() {
	openSettings(false);
	const items = allCommands().map((c) => ({
		label: c.label, keywords: c.keywords,
		detail: showKey(keys.byLabel[c.label], MAC) || "—",
		run: () => captureHotkey(c.label),
	}));
	openPalette({ placeholder: "Change a hotkey…", items });
}

function saveHotkeys(changes) {
	keyChanges = changes;
	keys = bindings(changes);
	writeJSON(HOTKEYS_KEY, changes);
}

function captureHotkey(label) {
	const back = document.activeElement;
	const wrap = document.createElement("div");
	wrap.className = "palette";
	wrap.setAttribute("role", "dialog");
	wrap.setAttribute("aria-label", `New hotkey for ${label}`);
	const box = document.createElement("div");
	box.className = "palette-box hotkey-box";
	const title = document.createElement("p");
	title.className = "hotkey-title";
	title.textContent = `Press the new keys for “${label}”`;
	const now = document.createElement("p");
	now.className = "hotkey-now";
	const current = keys.byLabel[label];
	now.textContent = current ? `Now: ${showKey(current, MAC)}` : "No hotkey yet";
	const row = document.createElement("div");
	row.className = "hotkey-actions";
	const button = (text, fn) => {
		const b = document.createElement("button");
		b.type = "button";
		b.textContent = text;
		b.addEventListener("click", fn);
		row.append(b);
		return b;
	};
	const done = (changes, note) => {
		window.removeEventListener("keydown", onKey, true);
		capturing = false;
		wrap.remove();
		if (changes) saveHotkeys(changes);
		if (note) toast(note);
		back?.focus?.();
		editHotkeys();
	};
	const set = (key) => {
		const had = key && keys.byKey.get(key);
		const lost = had && had !== label ? ` It was on “${had}”, which now has none.` : "";
		const changes = rebind(keyChanges, label, key);
		const shown = bindings(changes).byLabel[label];
		done(changes, shown ? `“${label}” is now ${showKey(shown, MAC)}.${lost}` : `“${label}” has no hotkey now.`);
	};
	if (current) button("Remove", () => set(""));
	if ((DEFAULT_KEYS[label] || "") !== (current || "")) button(DEFAULT_KEYS[label] ? `Reset to ${showKey(DEFAULT_KEYS[label], MAC)}` : "Reset", () => set(null));
	button("Cancel", () => done(null));
	const onKey = (e) => {
		if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); return done(null); }
		if (e.key === "Tab" || e.key === "Enter" || e.key === " ") return; // move between and press the buttons
		const name = keyName(e, MAC);
		if (!name) return;
		e.preventDefault();
		e.stopPropagation();
		if (!usableKey(name)) {
			now.textContent = `${showKey(name, MAC)} would get in the way of typing. Hold ${MAC ? "⌘, ⌃ or ⌥" : "Ctrl or Alt"} too.`;
			return;
		}
		set(name);
	};
	box.append(title, now, row);
	wrap.append(box);
	wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) { e.preventDefault(); done(null); } });
	document.body.append(wrap);
	capturing = true;
	window.addEventListener("keydown", onKey, true);
	row.lastElementChild.focus();
}

// ---- reference pane ------------------------------------------------------------

// Another note, read-only, beside the one being edited (wide screens). Links in
// it open in the pane; Edit swaps it into the editor.
const REF_KEY = "wr1t3r-ref";
let reader = null;
let ref = readJSON(REF_KEY, { on: false, path: null });
const saveRef = () => writeJSON(REF_KEY, ref);

function showRef(on, path = ref.path) {
	if (on && (!path || !isOpenable(path))) path = [...tabs].reverse().find((p) => p !== editor.path && isOpenable(p)) || editor.path;
	ref = { on: !!on && !!path, path: path || ref.path };
	saveRef();
	$("ref").hidden = !ref.on;
	$("refBtn").setAttribute("aria-expanded", String(ref.on));
	if (ref.on) {
		reader ??= editor.reader($("refView"), followRefLink);
		reader.show(notes.get(ref.path));
	}
	renderRefPick();
}

function renderRefPick() {
	if (!ref.on) return;
	const pick = $("refPick");
	const list = [...new Set([ref.path, ...tabs])].filter(isOpenable);
	pick.replaceChildren(...list.map((p) => Object.assign(document.createElement("option"), { value: p, textContent: name(p), selected: p === ref.path })));
}

function followRefLink(link) {
	if (link.url || link.tag) return followLink(link);
	const path = resolveNote(link, ref.path, visible().map((n) => n.path));
	if (!path) return toast(`There's no note at “${link.note}”.`);
	if (path !== ref.path) showRef(true, path);
	const { state } = reader.view;
	const at = link.heading.startsWith("^") ? blockFor(state, link.heading) : headingFor(toc.headings(state), link.heading)?.from;
	if (at != null) reader.view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "start", yMargin: 24 }) });
}

// The pane keeps up with edits and syncs (after a pause).
let refTimer;
function refTouched() {
	if (!ref.on || !reader) return;
	clearTimeout(refTimer);
	refTimer = setTimeout(() => {
		if (!isOpenable(ref.path)) return showRef(false);
		reader.show(notes.get(ref.path));
		reader.refresh();
	}, 400);
}

// The empty screen's quote of the day. Checked again whenever wr1t3r comes back
// into view, so a tab left open overnight shows the new day's quote.
// Today's writing prompt; a tap starts a note titled with it, the arrow shows another.
let promptStep = 0;
function renderPrompt() {
	$("writingPrompt").textContent = promptFor(new Date(), promptStep);
}

// A prompt as a note name: without the characters Obsidian won't allow in one.
function promptFileName(text) {
	const n = text.replace(/[*"\\/<>:|?#^\[\]]/g, "").replace(/\s+/g, " ").trim();
	return (n.length > 80 ? n.slice(0, 80).replace(/\s+\S*$/, "") : n) || "Untitled";
}

// A journal entry for a prompt: in journal/, with the prompt as its title and
// the rest of the frontmatter from _templates/Journal.md, filled in the way
// Templater would. Without that template, the usual new-note properties.
const JOURNAL_TEMPLATE = "_templates/journal.md";
function newPromptNote(question) {
	const paths = visible().map((n) => n.path);
	const tmpl = findTemplate(paths, JOURNAL_TEMPLATE);
	const folder = (tmpl ? tmpl.root : commonFolder(visible())) + "journal/";
	const title = question.replaceAll('"', "'");
	newNote(folder + promptFileName(question) + ".md", () => {
		const date = new Date();
		if (!tmpl) return newNoteFrontmatter(title, date.toLocaleDateString("en-CA"));
		return renderTemplate(notes.get(tmpl.path).text, { title, date }).text;
	});
}

function renderQuote() {
	const q = quoteFor();
	$("quoteText").textContent = q.text.replaceAll(" / ", "\n");
	const by = $("quoteBy");
	const cite = document.createElement("cite");
	cite.textContent = q.work;
	by.replaceChildren("— " + q.author + ", ", cite);
	renderPrompt();
}

function renderTitle() {
	const base = editor.path ? name(editor.path) + " · wr1t3r" : "wr1t3r";
	document.title = timer.running ? `${pomo.format(pomo.remaining(timer, Date.now()))} · ${base}` : base;
}

function onEdit(path, text) {
	const note = notes.get(path);
	if (!note || note.binary) return;
	const wasDirty = note.dirty;
	typed = true;
	notes.set(path, { ...note, text, dirty: true });
	change(path, (cur) => (cur ? { ...cur, text, dirty: true, deleted: false } : { path, text, base: null, dirty: true, deleted: false }));
	if (!wasDirty) { renderStatus(); renderTree(); }
	if (path === ref.path) refTouched();
	scheduleSync();
}

function currentFolder() {
	const p = editor.path;
	return p && p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "";
}

function taken(path) {
	const lower = path.toLowerCase();
	for (const n of notes.values()) if (!n.deleted && n.path.toLowerCase() === lower) return true;
	return false;
}

function normalise(input) {
	let p = input.trim().replace(/^\/+/, "");
	if (!/\.md$/i.test(p)) p += ".md";
	return p;
}

async function newNote(suggestion = currentFolder() + "Untitled.md", makeText = null) {
	const input = prompt("New note (folders with /):", suggestion);
	if (input == null) return;
	const path = normalise(input);
	if (!isNotePath(path)) return toast("That isn't a usable note name.");
	if (taken(path)) return openNote([...notes.keys()].find((p) => p.toLowerCase() === path.toLowerCase() && !notes.get(p).deleted));
	// A tombstone of a deleted note with this name keeps its base, so the new
	// note replaces it in the vault.
	// Notes that could be published start with the Note template's properties,
	// including today's date; "_" folders never publish, so they start empty.
	const text = makeText ? makeText(path) : /(^|\/)_/.test(path) ? "" : newNoteFrontmatter(name(path), new Date().toLocaleDateString("en-CA"));
	await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
	openNote(path);
	// Focus goes back to the New button once the name prompt closes; take it
	// back so typing lands in the note (a space would press New again).
	requestAnimationFrame(() => editor.view.focus());
	scheduleSync();
}

// Today's note in _daily, from _templates/Daily.md (and its companion notes,
// like "<date> Health"), or the existing one. Made the way Obsidian would, so
// both apps produce the same file.
async function openDaily() {
	const paths = visible().map((n) => n.path);
	const tmpl = findTemplate(paths);
	if (!tmpl) return toast("There's no _templates/Daily.md in the vault.");
	const date = new Date();
	const title = isoDate(date);
	const folder = tmpl.root + DAILY_FOLDER;
	const path = folder + title + ".md";
	const existing = paths.find((p) => p.toLowerCase() === path.toLowerCase());
	if (existing) return openNote(existing);
	let { text, companion } = renderTemplate(notes.get(tmpl.path).text, { title, date });
	const events = await timelineEvents(date);
	const filled = events && timelineChanges(text, events);
	if (filled) text = applyChanges(text, filled.changes);
	for (const c of companion) {
		const cPath = folder + c.name + ".md";
		const t = findTemplate(paths, c.template.replace(/\.md$/i, "") + ".md");
		if (taken(cPath) || !t) continue;
		const ct = renderTemplate(notes.get(t.path).text, { title: c.name, date }).text;
		await change(cPath, (cur) => ({ path: cPath, text: ct, base: cur?.base ?? null, dirty: true, deleted: false }));
	}
	await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
	openNote(path);
	scheduleSync();
}

// The Timeline's calendar (Settings > Daily note timeline): off until one is
// picked, per device like the other settings.
const DAILY_CAL_KEY = "wr1t3r-daily-calendar";

// `date`'s events from that calendar, or null when none is picked or they
// can't be loaded (the note is still made; a toast says why).
async function timelineEvents(date) {
	const id = readRaw(DAILY_CAL_KEY);
	if (!id) return null;
	const from = agenda.startOfDay(date);
	try {
		return eventsOn((await api.events(from, agenda.addDays(from, 1), [id])).events, from);
	} catch (e) {
		if (e instanceof AuthError) signOut("That token no longer works.");
		else toast("Couldn't load calendar events" + (e instanceof TypeError ? " while offline." : ": " + e.message));
		return null;
	}
}

// The open daily note's day (its name is YYYY-MM-DD), or null.
function noteDay(path) {
	const m = path && name(path).match(/^(\d{4})-(\d{2})-(\d{2})$/);
	return m ? new Date(+m[1], m[2] - 1, +m[3]) : null;
}

// Fill the open daily note's Timeline (or today's, made if needed) from the
// picked calendar. Events already there aren't added again.
async function pullTimeline() {
	if (!readRaw(DAILY_CAL_KEY)) {
		openSettings(true);
		return toast("Pick a calendar under Daily note timeline first.");
	}
	if (!noteDay(editor.path)) await openDaily();
	const path = editor.path, date = noteDay(path);
	if (!date) return;
	const events = await timelineEvents(date);
	if (!events || editor.path !== path) return;
	const view = editor.view;
	const r = timelineChanges(view.state.sliceDoc(), events);
	if (!r) return toast("This note has no Timeline heading.");
	if (r.changes.length) view.dispatch({ changes: r.changes, userEvent: "input.timeline" });
	if (r.added) toast(`Added ${r.added} event${r.added === 1 ? "" : "s"} to the timeline, in time order.`);
	else if (r.changes.length) toast("No new events. Sorted the timeline by time.");
	else toast(events.length ? "The timeline already has every event." : "No events on the calendar that day.");
}

function fillCalendarSetting() {
	const sel = $("dailyCal"), id = readRaw(DAILY_CAL_KEY) || "";
	const list = calState === "setup" ? [] : cal?.calendars || [];
	sel.replaceChildren(new Option("Off", ""));
	for (const c of [...list].sort((a, b) => b.primary - a.primary)) sel.append(new Option(agenda.calendarLabel(c), c.id));
	// Picked before the calendar list loaded on this device: keep it.
	if (id && !list.some((c) => c.id === id)) sel.append(new Option("Picked calendar", id));
	sel.value = id;
	sel.disabled = calState === "setup";
}

// A clicked link: web links open in a new tab, links to notes open the note
// (Back returns), and a [[link]] to a note that doesn't exist yet offers to
// create it next to this note, as Obsidian does.
function followLink(link) {
	if (link.url) return void window.open(link.url, "_blank", "noopener");
	if (link.tag) return showTag(link.tag);
	const path = resolveNote(link, editor.path, visible().map((n) => n.path));
	if (path) {
		if (path !== editor.path) {
			history.pushState(null, "", "#" + encodeURIComponent(path));
			openNote(path, { replace: true });
		}
		const { state } = editor.view;
		const at = link.heading.startsWith("^") ? blockFor(state, link.heading) : headingFor(toc.headings(state), link.heading)?.from;
		if (at != null) {
			editor.view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "start", yMargin: 24 }) });
			editor.view.focus();
		} else if (link.heading) toast(`No ${link.heading.startsWith("^") ? "block" : "heading"} “${link.heading}” in ${name(path)}.`);
		return;
	}
	if (link.wiki) return newNote(currentFolder() + normalise(link.note));
	toast(`There's no note at “${link.note}”.`);
}

// A clicked tag: list the notes that have it, in the sidebar (opened on a phone).
function showTag(tag) {
	$("filter").value = "#" + tag;
	renderTree();
	$("app").classList.add("menu-open");
}

async function removeNote(path) {
	const note = notes.get(path);
	if (!note || !confirm(`Delete “${name(path)}”? It's removed from the vault on every device.`)) return;
	await change(path, (cur) => (cur?.base ? { ...cur, deleted: true, dirty: true } : null));
	editor.forget(path);
	closeTab(path);
	renderStatus();
	scheduleSync(0);
}

async function renameNote(from, input) {
	const to = normalise(input);
	if (to === from) return;
	if (!isNotePath(to)) { $("path").value = from; return toast("That isn't a usable note name."); }
	if (taken(to) && to.toLowerCase() !== from.toLowerCase()) { $("path").value = from; return toast("A note with that name already exists."); }
	const paths = visible().map((n) => n.path);
	// Links to the note in other notes (and in itself) are rewritten to the new name.
	const edits = [];
	for (const p of paths) {
		const t = p === from ? editor.text() : notes.get(p)?.text;
		if (!t || notes.get(p)?.binary || (!t.includes("[[") && !t.includes("]("))) continue;
		const ch = renameEdits(t, p, from, to, paths);
		if (ch.length) edits.push({ path: p, text: applyChanges(t, ch), count: ch.length });
	}
	const others = edits.filter((e) => e.path !== from);
	const n = others.reduce((a, e) => a + e.count, 0);
	const update = others.length && confirm(`Update ${n} link${n === 1 ? "" : "s"} to this note in ${others.length} other note${others.length === 1 ? "" : "s"}?`);
	const text = edits.find((e) => e.path === from)?.text ?? editor.text();
	if (update) {
		for (const e of others) {
			await change(e.path, (cur) => (cur ? { ...cur, text: e.text, dirty: true } : cur));
			editor.forget(e.path);
		}
	}
	// A rename is a new note plus a delete of the old one; the vault has no moves.
	await change(to, (cur) => ({ path: to, text, base: cur?.base ?? null, dirty: true, deleted: false }));
	await change(from, (cur) => (cur?.base ? { ...cur, deleted: true, dirty: true } : null));
	editor.forget(from);
	tabs = tabs.map((p) => (p === from ? to : p));
	saveTabs();
	if (ref.path === from) ref.path = to;
	openNote(to);
	scheduleSync(0);
}

// ---- uploads -------------------------------------------------------------------

// Uploads and clippings become notes here. content/_* folders stay out of the site build.
const UPLOAD_FOLDER = "content/_uploads/";
const CLIP_FOLDER = "content/_clippings/";

// Saves a new note under folder, numbering the name if it's taken.
async function addNote(folder, noteName, text) {
	const base = folder + noteName;
	let path = base + ".md";
	for (let n = 2; taken(path); n++) path = `${base} ${n}.md`;
	await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
	return path;
}

function showAdded(folder, path) {
	// The folder and every folder above it, so the new note shows in the sidebar.
	for (let i = folder.indexOf("/"); i >= 0; i = folder.indexOf("/", i + 1)) openFolders.add(folder.slice(0, i + 1));
	writeJSON(OPEN_KEY, [...openFolders]);
	openNote(path);
	renderStatus();
	scheduleSync(0);
}

async function upload(files) {
	if (!files.length) return;
	toast(`Converting ${files.length} file${files.length === 1 ? "" : "s"}…`, 60000);
	let convert;
	try {
		convert = await import("./convert.js");
	} catch {
		return toast("The converter isn't on this device yet. Try again once you're online.");
	}
	const done = [], failed = [];
	for (const file of files) {
		try {
			const { markdown, notes } = await convert.toMarkdown(file);
			const path = await addNote(UPLOAD_FOLDER, convert.noteName(file.name), convert.withFrontmatter(markdown, file.name));
			done.push({ path, notes });
		} catch (e) {
			failed.push(`${file.name}: ${e.message}`);
		}
	}
	const parts = [];
	if (done.length) parts.push(`Added ${done.length} note${done.length === 1 ? "" : "s"} to _uploads.`);
	for (const d of done) if (d.notes.length) parts.push(`${name(d.path)}: ${d.notes.join(", ")}.`);
	if (failed.length) parts.push(`Couldn't convert ${failed.join("; ")}.`);
	toast(parts.join(" "), failed.length ? 10000 : 6000);
	if (done.length) showAdded(UPLOAD_FOLDER, done[done.length - 1].path);
}

async function clipPage(url) {
	url = (url || "").trim();
	if (!url) return;
	if (!/^https?:\/\//i.test(url)) url = "https://" + url;
	if (!navigator.onLine) return toast("Clipping needs a connection.");
	toast("Clipping…", 60000);
	try {
		const [{ clip }, { noteName }] = await Promise.all([import("./clip.js"), import("./convert-text.js")]);
		const c = await clip(url);
		const path = await addNote(CLIP_FOLDER, noteName(c.title), c.text);
		toast(`Clipped “${name(path)}” to _clippings.`);
		showAdded(CLIP_FOLDER, path);
	} catch (e) {
		if (e instanceof AuthError) return signOut("That token no longer works.");
		toast("Couldn't clip that: " + e.message, 8000);
	}
}

// Media notes (src/media.js, worker/media.js): the kinds this Worker can look
// up, remembered so the commands are there offline too.
const MEDIA_KEY = "wr1t3r-media-kinds";
let mediaKinds = readJSON(MEDIA_KEY, []);
async function loadMediaKinds() {
	try {
		mediaKinds = await api.mediaKinds();
		writeJSON(MEDIA_KEY, mediaKinds);
	} catch {}
}

const MEDIA_COMMANDS = { movie: "movie/TV", book: "book", music: "music", game: "game", comic: "comic", podcast: "podcast" };

async function newMediaNote(k) {
	if (!navigator.onLine) return toast("Media lookups need a connection.");
	try {
		const made = await makeMediaNote(k, api, (text) => (text ? toast(text, 60000) : ($("toast").hidden = true)));
		if (!made) return;
		const path = await addNote(made.folder, made.name, made.text);
		toast(`Made “${name(path)}”.`);
		showAdded(made.folder, path);
	} catch (e) {
		if (e instanceof AuthError) return signOut("That token no longer works.");
		toast("Couldn't make that note: " + e.message, 8000);
	}
}

// The bookmarklet (see the Aa panel) opens wr1t3r at #clip=<page address>.
function clipFromHash() {
	const m = location.hash.match(/^#clip=(.+)$/);
	if (!m) return false;
	history.replaceState(null, "", location.pathname);
	clipPage(decodeURIComponent(m[1]));
	return true;
}

// ---- small things ----------------------------------------------------------------

let toastTimer;
function toast(text, ms = 4000) {
	const t = $("toast");
	t.textContent = text;
	t.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (t.hidden = true), ms);
}

async function signOut(message) {
	if (pending() && !confirm(`${pending()} change(s) haven't reached the vault yet and will be lost. Sign out anyway?`)) return;
	setToken("");
	await local.clear();
	if (message) sessionStorage.setItem("wr1t3r-msg", message);
	location.replace(location.pathname);
}

// ---- display settings (same choices and storage keys style as Reader) -----------

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
let fontSize = clamp(Number(readRaw("wr1t3rFontSize")) || 19, 14, 30);

function readRaw(key) {
	try { return localStorage.getItem(key); } catch { return null; }
}
function storeRaw(key, value) {
	try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch {}
}

function applyTheme() {
	const root = document.documentElement;
	const { family, mode } = readTheme(readRaw("wr1t3rThemeFamily"), readRaw("wr1t3rTheme"));
	const attr = themeAttr(family, mode, matchMedia("(prefers-color-scheme: dark)").matches);
	if (attr) root.setAttribute("data-theme", attr); else root.removeAttribute("data-theme");
	rerunDataview();
	document.querySelectorAll("#themeFamilies button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.family === family)));
	document.querySelectorAll("#themes button").forEach((b) => {
		b.setAttribute("aria-pressed", String(family !== "sepia" && b.dataset.theme === mode));
		b.disabled = family === "sepia"; // Sepia is light only
	});
	const meta = document.querySelector("meta[name=theme-color]");
	if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg").trim();
}

function applySize(px) {
	fontSize = clamp(px, 14, 30);
	document.documentElement.style.setProperty("--editor-size", fontSize + "px");
	$("sizeVal").textContent = fontSize;
	editor?.view.requestMeasure();
}

// Live Preview hides markdown symbols off the cursor line (off unless chosen).
function applyMode(mode) {
	const live = mode === "live";
	setLivePreview(editor?.view, live);
	document.querySelectorAll("#modes button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.mode === "live") === live)));
}

function openSettings(on) {
	if (on && !$("agenda").hidden) openAgenda(false);
	$("settings").hidden = !on;
	$("settingsBtn").setAttribute("aria-expanded", String(on));
	if (on) { fillCalendarSetting(); if (!cal?.calendars && calState !== "setup") loadAgenda(); }
}

function setupSettings() {
	applyTheme();
	applySize(fontSize);
	// Auto follows the system, so the theme and browser bar color follow it too.
	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme());
	$("themeFamilies").addEventListener("click", (e) => {
		const b = e.target.closest("button");
		if (!b) return;
		const { mode } = readTheme(readRaw("wr1t3rThemeFamily"), readRaw("wr1t3rTheme"));
		storeRaw("wr1t3rThemeFamily", b.dataset.family === "default" ? null : b.dataset.family);
		storeRaw("wr1t3rTheme", mode === "auto" ? null : mode); // drops an old "sepia"
		applyTheme();
	});
	$("settingsBtn").addEventListener("click", (e) => { e.stopPropagation(); openSettings($("settings").hidden); });
	$("themes").addEventListener("click", (e) => {
		const b = e.target.closest("button");
		if (!b) return;
		storeRaw("wr1t3rTheme", b.dataset.theme === "auto" ? null : b.dataset.theme);
		applyTheme();
	});
	applyMode(readRaw("wr1t3rMode"));
	$("modes").addEventListener("click", (e) => {
		const b = e.target.closest("button");
		if (!b) return;
		storeRaw("wr1t3rMode", b.dataset.mode === "live" ? "live" : null);
		applyMode(b.dataset.mode);
	});
	$("dailyCal").addEventListener("change", (e) => storeRaw(DAILY_CAL_KEY, e.target.value || null));
	$("smaller").addEventListener("click", () => { applySize(fontSize - 1); storeRaw("wr1t3rFontSize", fontSize); });
	$("larger").addEventListener("click", () => { applySize(fontSize + 1); storeRaw("wr1t3rFontSize", fontSize); });
	document.addEventListener("click", (e) => {
		if (!$("settings").hidden && !e.target.closest("#settings, #settingsBtn")) openSettings(false);
	});
	document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("settings").hidden) openSettings(false); });
}

// ---- word count ----------------------------------------------------------------------

let countMode = readRaw("wr1t3rCount") === "chars" ? "chars" : "words";
let countTimer, typed = false, lastWords = null; // lastWords: {path, words}, for the words-written tally
const fmt = (n) => n.toLocaleString();

// Counting a long note on every keystroke would lag, so it waits for a pause.
// fresh: a different note or a synced version was loaded, so any change in
// the count isn't writing.
function refreshCount(fresh = false) {
	clearTimeout(countTimer);
	if (fresh) { typed = false; lastWords = null; }
	countTimer = setTimeout(renderCount, fresh ? 0 : 250);
}

function renderCount() {
	const b = $("count");
	if (!editor.path) { b.textContent = ""; lastWords = null; return; }
	const all = counts(editor.text());
	if (typed && lastWords?.path === editor.path && timer.running && timer.phase === "work") {
		written += all.words - lastWords.words;
		saveTimer();
	}
	typed = false;
	lastWords = { path: editor.path, words: all.words };
	renderToc();
	const sel = editor.selected();
	const unit = countMode === "chars" ? "character" : "word";
	const total = countMode === "chars" ? all.chars : all.words;
	const part = sel ? (countMode === "chars" ? [...sel.replace(/\r?\n/g, "")].length : countWords(sel)) : null;
	b.textContent = part == null
		? `${fmt(total)} ${unit}${total === 1 ? "" : "s"}`
		: `${fmt(part)} of ${fmt(total)} ${unit}s`;
}

// ---- table of contents ----------------------------------------------------------------

const TOC_KEY = "wr1t3rToc";
const wide = matchMedia("(min-width: 1180px)");
let tocItems = [], tocCollapsed = new Set(), tocScrollQueued = false;

function tocOpen() { return !$("toc").hidden; }

function openToc(on) {
	$("toc").hidden = !on;
	$("tocBtn").setAttribute("aria-expanded", String(on));
	$("app").classList.toggle("toc-docked", on && wide.matches);
	// Remembered only on wide screens, where it stays docked beside the note.
	if (wide.matches) storeRaw(TOC_KEY, on ? "1" : null);
	if (on) { openSettings(false); openAgenda(false); renderToc(); }
}

function renderToc() {
	$("toc").classList.toggle("docked", wide.matches);
	if (!tocOpen() || !editor.path) return;
	tocItems = toc.outline(toc.headings(editor.view.state));
	const list = $("tocList");
	list.textContent = "";
	$("tocEmpty").hidden = tocItems.length > 0;
	tocItems.forEach((h, i) => {
		if (toc.hidden(tocItems, i, tocCollapsed)) return;
		const li = document.createElement("li");
		li.className = "lvl" + h.depth;
		li.dataset.i = i;
		li.style.paddingLeft = h.depth * 14 + "px";
		const fold = document.createElement("button");
		fold.type = "button";
		fold.className = "fold";
		if (h.hasKids) {
			const shut = tocCollapsed.has(toc.key(h));
			fold.textContent = "▾";
			fold.classList.toggle("shut", shut);
			fold.setAttribute("aria-label", (shut ? "Show" : "Hide") + " the parts under " + h.text);
			fold.setAttribute("aria-expanded", String(!shut));
			fold.addEventListener("click", () => {
				shut ? tocCollapsed.delete(toc.key(h)) : tocCollapsed.add(toc.key(h));
				renderToc();
			});
		} else fold.tabIndex = -1;
		const go = document.createElement("button");
		go.type = "button";
		go.className = "go";
		go.textContent = h.text;
		go.addEventListener("click", () => jumpTo(h.from));
		li.append(fold, go);
		list.append(li);
	});
	markActive();
}

function jumpTo(pos) {
	const { view } = editor;
	view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 16 }) });
	view.focus();
	if (!wide.matches) openToc(false);
}

// The heading you're reading: the last one above the top of the screen (or
// the cursor's, if you're typing). Plus how far down the note you are.
function markActive(fromScroll = false) {
	if (!tocOpen() || !editor.path) return;
	const { view } = editor;
	const sd = view.scrollDOM;
	const top = view.lineBlockAtHeight(sd.getBoundingClientRect().top - view.documentTop + 8).from;
	const pos = view.hasFocus && !fromScroll ? view.state.selection.main.head : top;
	const active = toc.activeIndex(tocItems, pos);
	let shown = active;
	while (shown > -1 && toc.hidden(tocItems, shown, tocCollapsed)) shown = tocItems[shown].parent;
	for (const li of $("tocList").children) li.classList.toggle("active", Number(li.dataset.i) === shown);
	$("tocList").querySelector("li.active")?.scrollIntoView({ block: "nearest" });
	const max = sd.scrollHeight - sd.clientHeight;
	$("tocProgress").textContent = max > 0 ? Math.round((sd.scrollTop / max) * 100) + "%" : "";
}

function setupToc() {
	$("tocBtn").addEventListener("click", (e) => { e.stopPropagation(); openToc(!tocOpen()); });
	$("tocClose").addEventListener("click", () => openToc(false));
	$("tocTop").addEventListener("click", () => jumpTo(0));
	editor.view.scrollDOM.addEventListener("scroll", () => {
		if (tocScrollQueued || !tocOpen()) return;
		tocScrollQueued = true;
		requestAnimationFrame(() => { tocScrollQueued = false; markActive(true); });
	}, { passive: true });
	document.addEventListener("click", (e) => {
		if (tocOpen() && !wide.matches && e.target.isConnected && !e.target.closest("#toc, #tocBtn")) openToc(false);
	});
	document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tocOpen() && !wide.matches) openToc(false); });
	wide.addEventListener("change", () => { openToc(wide.matches && readRaw(TOC_KEY) === "1"); });
	if (wide.matches && readRaw(TOC_KEY) === "1") openToc(true);
}

// ---- pomodoro timer --------------------------------------------------------------------

const TIMER_KEY = "wr1t3rPomodoro";
let lengths = {
	work: clamp(Number(readRaw("wr1t3rFocusMin")) || 25, pomo.WORK_RANGE[0], pomo.WORK_RANGE[1]),
	brk: clamp(Number(readRaw("wr1t3rBreakMin")) || 5, pomo.BREAK_RANGE[0], pomo.BREAK_RANGE[1]),
};
const savedTimer = readJSON(TIMER_KEY, null);
let timer = pomo.restore(savedTimer, lengths);
let written = Number(savedTimer?.written) || 0; // words written in this focus block
let ticker, audio;

function saveTimer() {
	writeJSON(TIMER_KEY, { ...timer, written });
}

function renderTimer() {
	const b = $("pomo");
	const left = pomo.format(pomo.remaining(timer, Date.now()));
	const label = timer.phase === "work" ? "focus" : "break";
	b.textContent = `${timer.running ? "❚❚" : "▶\uFE0E"} ${left} ${label}`;
	b.setAttribute("aria-label", `${timer.running ? "Pause" : "Start"} ${label} timer, ${left} left`);
	b.classList.toggle("running", timer.running);
	const fresh = !timer.running && timer.left === pomo.minutes(lengths, timer.phase);
	$("pomoReset").hidden = fresh && timer.phase === "work";
	renderTitle();
}

function tickTimer() {
	const { state, ended } = pomo.tick(timer, lengths, Date.now());
	if (ended) {
		timer = state;
		timerDone(ended);
		written = 0;
		saveTimer();
		clearInterval(ticker);
	}
	renderTimer();
}

function runTicker() {
	clearInterval(ticker);
	if (timer.running) ticker = setInterval(tickTimer, 1000);
}

function toggleTimer() {
	unlockSound();
	askToNotify();
	if (timer.running) timer = pomo.pause(timer, Date.now());
	else {
		if (timer.phase === "work" && timer.left === pomo.minutes(lengths, "work")) written = 0;
		timer = pomo.start(timer, Date.now());
	}
	saveTimer();
	runTicker();
	renderTimer();
}

function resetTimer() {
	timer = pomo.idle(lengths);
	written = 0;
	saveTimer();
	runTicker();
	renderTimer();
}

function timerDone(phase) {
	const words = phase === "work" && written > 0 ? ` You wrote ${fmt(written)} word${written === 1 ? "" : "s"}.` : "";
	const text = phase === "work"
		? `Focus block done.${words} Tap ▶\uFE0E for a ${lengths.brk}-minute break.`
		: "Break's over. Tap ▶\uFE0E to start the next focus block.";
	alertUser(phase === "work" ? "Focus block done" : "Break's over", text);
	$("pomo").classList.add("done");
	setTimeout(() => $("pomo").classList.remove("done"), 15000);
}

// Toast, chime and buzz; and a system notification when wr1t3r isn't in front.
function alertUser(title, text) {
	toast(text, 15000);
	chime();
	navigator.vibrate?.([200, 100, 200]);
	if (document.visibilityState !== "visible" && window.Notification?.permission === "granted") {
		try { new Notification(title, { body: text, icon: "/icon-180.png" }); } catch {}
	}
}

// Browsers only allow sound after a tap, so the first tap readies it.
function unlockSound() {
	try {
		audio ??= new (window.AudioContext || window.webkitAudioContext)();
		if (audio.state === "suspended") audio.resume();
	} catch {}
}

function chime() {
	if (!audio) return;
	try {
		const t = audio.currentTime;
		[0, 0.35, 0.7].forEach((d, i) => {
			const osc = audio.createOscillator(), gain = audio.createGain();
			osc.frequency.value = i === 2 ? 880 : 660;
			gain.gain.setValueAtTime(0.0001, t + d);
			gain.gain.exponentialRampToValueAtTime(0.25, t + d + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.3);
			osc.connect(gain).connect(audio.destination);
			osc.start(t + d);
			osc.stop(t + d + 0.32);
		});
	} catch {}
}

// Ask once, on the first Start, so an alert can show while another tab or
// app is in front. On iPhone this only exists when wr1t3r is on the Home Screen.
function askToNotify() {
	if (window.Notification?.permission === "default" && !readRaw("wr1t3rAskedNotify")) {
		storeRaw("wr1t3rAskedNotify", "1");
		Notification.requestPermission().catch(() => {});
	}
}

function setLength(kind, step) {
	const [lo, hi, by] = kind === "work" ? pomo.WORK_RANGE : pomo.BREAK_RANGE;
	const before = lengths;
	lengths = { ...lengths, [kind]: clamp(lengths[kind] + step * by, lo, hi) };
	storeRaw(kind === "work" ? "wr1t3rFocusMin" : "wr1t3rBreakMin", lengths[kind]);
	timer = pomo.resize(timer, before, lengths);
	saveTimer();
	renderLengths();
	renderTimer();
}

function renderLengths() {
	$("workVal").textContent = lengths.work + " min";
	$("breakVal").textContent = lengths.brk + " min";
}

function setupFocusTools() {
	$("count").addEventListener("click", () => {
		countMode = countMode === "words" ? "chars" : "words";
		storeRaw("wr1t3rCount", countMode === "chars" ? "chars" : null);
		renderCount();
	});
	$("pomo").addEventListener("click", toggleTimer);
	$("pomoReset").addEventListener("click", resetTimer);
	$("workLess").addEventListener("click", () => setLength("work", -1));
	$("workMore").addEventListener("click", () => setLength("work", 1));
	$("breakLess").addEventListener("click", () => setLength("brk", -1));
	$("breakMore").addEventListener("click", () => setLength("brk", 1));
	// Timers stop while the phone is locked; catch up as soon as it's back.
	document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && tickTimer());
	renderLengths();
	tickTimer();
	runTicker();
}

// ---- agenda (Google Calendar) ------------------------------------------------------------

const AGENDA_KEY = "wr1t3rAgenda", ALERTED_KEY = "wr1t3rAlertedAt", FILTER_KEY = "wr1t3rCalShow";
let cal = readJSON(AGENDA_KEY, null); // {at, events} -- the last agenda, for offline
let calState = "ok"; // ok | setup | error | offline
let calError = "", calLoading = false, openEvent = null;

// Which calendars the agenda shows: your own pick (the chips in the panel),
// or until you make one, the calendars ticked in Google Calendar.
function shownIds() {
	const picked = readJSON(FILTER_KEY, null);
	if (Array.isArray(picked)) return new Set(picked);
	return new Set((cal?.calendars || []).filter((c) => c.shown).map((c) => c.id));
}

function visibleEvents() {
	const ids = shownIds();
	return (cal?.events || []).filter((e) => ids.has(e.calendar));
}

function toggleCalendar(id) {
	const ids = shownIds();
	ids.has(id) ? ids.delete(id) : ids.add(id);
	writeJSON(FILTER_KEY, [...ids]);
	renderAgenda();
	loadMonth();
	loadPick();
	if (ids.has(id) && !cal?.fetched?.includes(id)) loadAgenda(true);
}

// The month calendar above the agenda, on desktop. It loads the six weeks it
// shows; picking a day moves the agenda list to start there (loaded on its
// own, since the header's next event and reminders stay on today).
const desk = matchMedia("(min-width: 900px)");
let monthShown = agenda.startOfMonth(new Date());
let monthData = null; // { key, events }
let agendaFrom = null; // the day the list starts on; null for today
let pickData = null; // { key, events } for the list when it doesn't start today

const idsKey = () => [...shownIds()].sort().join(",");

async function rangeEvents(from, days) {
	const picked = readJSON(FILTER_KEY, null);
	const r = await api.events(from, agenda.addDays(from, days), Array.isArray(picked) ? picked : null);
	return r.events;
}

async function loadMonth() {
	if (!desk.matches || $("agenda").hidden || calState === "setup" || !navigator.onLine) return;
	const key = agenda.dayKey(monthShown) + "|" + idsKey();
	if (monthData?.key === key && Date.now() - monthData.at < 5 * 60000) return;
	try {
		const events = await rangeEvents(agenda.gridStart(monthShown), agenda.GRID_DAYS);
		if (key === agenda.dayKey(monthShown) + "|" + idsKey()) { monthData = { key, events, at: Date.now() }; renderMonth(); }
	} catch {}
}

async function loadPick() {
	if (!agendaFrom) return;
	const key = agenda.dayKey(agendaFrom) + "|" + idsKey();
	if (pickData?.key === key) return;
	try {
		const events = await rangeEvents(agendaFrom, agenda.DAYS);
		if (agendaFrom && key === agenda.dayKey(agendaFrom) + "|" + idsKey()) { pickData = { key, events }; renderAgenda(); }
	} catch {}
}

function monthEvents() {
	const ids = shownIds();
	return (monthData?.events || []).filter((e) => ids.has(e.calendar));
}

function renderMonth() {
	const box = $("calMonth");
	box.hidden = !desk.matches || calState === "setup" || $("agenda").hidden;
	if (box.hidden) return;
	$("monthTitle").textContent = monthShown.toLocaleDateString([], { month: "long", year: "numeric" });
	const grid = $("monthGrid");
	grid.textContent = "";
	const today = agenda.dayKey(new Date());
	const picked = agenda.dayKey(agendaFrom || new Date());
	const days = agenda.monthGrid(monthShown);
	const byKey = new Map(agenda.byDay(monthData ? monthEvents() : [], days[0], agenda.GRID_DAYS).map((d) => [d.key, d.events]));
	for (let i = 0; i < 7; i++) {
		const w = document.createElement("span");
		w.className = "wd";
		w.textContent = days[i].toLocaleDateString([], { weekday: "narrow" });
		grid.append(w);
	}
	for (const date of days) {
		const key = agenda.dayKey(date);
		const events = byKey.get(key) || [];
		const b = document.createElement("button");
		b.type = "button";
		b.className = "md";
		b.classList.toggle("out", date.getMonth() !== monthShown.getMonth());
		b.classList.toggle("today", key === today);
		b.classList.toggle("picked", key === picked);
		b.setAttribute("aria-label", date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) + (monthData ? `, ${events.length || "no"} event${events.length === 1 ? "" : "s"}` : ""));
		const n = document.createElement("span");
		n.textContent = date.getDate();
		const dots = document.createElement("span");
		dots.className = "dots";
		for (const e of events.slice(0, 3)) {
			const d = document.createElement("i");
			if (/^#[0-9a-f]{3,8}$/i.test(e.color)) d.style.background = e.color;
			dots.append(d);
		}
		b.append(n, dots);
		b.addEventListener("click", () => pickDay(date, monthData ? events.length === 0 : false));
		grid.append(b);
	}
}

// A day picked on the month calendar: the list starts there, and an empty day
// opens the new-event form for it.
function pickDay(date, empty) {
	const today = agenda.startOfDay(new Date());
	agendaFrom = date.getTime() === today.getTime() ? null : date;
	if (date.getMonth() !== monthShown.getMonth()) { monthShown = agenda.startOfMonth(date); loadMonth(); }
	renderAgenda();
	loadPick();
	$("agendaList").scrollIntoView?.({ block: "nearest" });
	if (empty) showAddEvent(true, date);
}

function showMonth(n) {
	monthShown = n === 0 ? agenda.startOfMonth(new Date()) : agenda.addMonths(monthShown, n);
	if (n === 0) agendaFrom = null;
	renderAgenda();
	loadMonth();
}

async function loadAgenda(force = false) {
	if (calLoading && !force) return;
	if (!navigator.onLine) { calState = "offline"; renderAgenda(); return; }
	calLoading = true;
	const from = agenda.startOfDay(new Date());
	try {
		const picked = readJSON(FILTER_KEY, null);
		const r = await api.events(from, agenda.addDays(from, agenda.DAYS), Array.isArray(picked) ? picked : null);
		const fetched = Array.isArray(picked) ? picked : r.calendars.filter((c) => c.shown).map((c) => c.id);
		cal = { at: Date.now(), events: r.events, calendars: r.calendars, fetched };
		writeJSON(AGENDA_KEY, cal);
		calState = "ok";
		if (force || !monthData || Date.now() - monthData.at > 5 * 60000) { monthData = monthData && { ...monthData, at: 0 }; pickData = null; loadMonth(); loadPick(); }
	} catch (e) {
		if (e instanceof AuthError) return signOut("That token no longer works.");
		calState = e.body?.setup ? "setup" : e instanceof TypeError ? "offline" : "error";
		calError = e.message;
	} finally {
		calLoading = false;
		renderAgenda();
	}
}

function renderAgenda() {
	if (!$("settings").hidden && document.activeElement !== $("dailyCal")) fillCalendarSetting();
	const now = new Date();
	const events = visibleEvents();
	const next = agenda.nextEvent(events, now);
	$("calNext").textContent = next && agenda.startOfDay(new Date(next.start)).getTime() === agenda.startOfDay(now).getTime()
		? `${new Date(next.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ${next.title}` : "";
	$("addEventBtn").hidden = calState === "setup";
	const note = $("agendaNote");
	if (calState === "setup") note.textContent = "Google Calendar isn't connected yet. The README's “Google Calendar” section has the steps.";
	else if (calState === "offline") note.textContent = cal ? `Offline. Showing the agenda from ${new Date(cal.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : "Offline.";
	else if (calState === "error") note.textContent = "Couldn't load the agenda: " + calError;
	else note.textContent = "";
	if ($("agenda").hidden) return;

	renderFilters();
	renderMonth();
	const list = $("agendaList");
	list.textContent = "";
	if (calState === "setup") return;
	if (cal?.calendars?.length && !shownIds().size) {
		const p = document.createElement("p");
		p.className = "hint";
		p.textContent = "No calendars picked. Tap one above to show it.";
		list.append(p);
		return;
	}
	let shown = events, from = now;
	if (agendaFrom) {
		from = agendaFrom;
		const key = agenda.dayKey(agendaFrom) + "|" + idsKey();
		if (pickData?.key !== key) {
			const p = document.createElement("p");
			p.className = "hint";
			p.textContent = navigator.onLine ? "Loading…" : "Offline. Only the coming week is kept for offline use.";
			list.append(p);
			return;
		}
		const ids = shownIds();
		shown = pickData.events.filter((e) => ids.has(e.calendar));
	}
	for (const day of agenda.byDay(shown, from)) {
		const sec = document.createElement("section");
		sec.className = "day";
		const h = document.createElement("h3");
		h.textContent = agenda.dayLabel(day.date, now);
		sec.append(h);
		if (!day.events.length) {
			const p = document.createElement("p");
			p.className = "none";
			p.textContent = "Nothing scheduled";
			sec.append(p);
		}
		for (const e of day.events) sec.append(eventRow(e, now));
		list.append(sec);
	}
}

function renderFilters() {
	const box = $("calFilters");
	box.textContent = "";
	const list = calState === "setup" ? [] : cal?.calendars || [];
	if (list.length < 2) return;
	const ids = shownIds();
	for (const c of [...list].sort((a, b) => b.primary - a.primary)) {
		const b = document.createElement("button");
		b.type = "button";
		b.setAttribute("aria-pressed", String(ids.has(c.id)));
		const dot = document.createElement("span");
		dot.className = "dot";
		if (/^#[0-9a-f]{3,8}$/i.test(c.color)) dot.style.background = c.color;
		const name = document.createElement("span");
		name.textContent = agenda.calendarLabel(c);
		b.append(dot, name);
		b.addEventListener("click", () => toggleCalendar(c.id));
		box.append(b);
	}
}

function eventRow(e, now) {
	const key = e.calendar + "/" + e.id;
	const row = document.createElement("div");
	row.className = "ev";
	row.classList.toggle("past", !e.allDay && new Date(e.end) < now);
	row.classList.toggle("open", openEvent === key);
	const b = document.createElement("button");
	b.type = "button";
	b.setAttribute("aria-expanded", String(openEvent === key));
	if (/^#[0-9a-f]{3,8}$/i.test(e.color)) row.style.setProperty("--c", e.color);
	const when = document.createElement("span");
	when.className = "when";
	when.textContent = agenda.timeLabel(e) + (e.location ? " · " + e.location : "");
	const title = document.createElement("span");
	title.className = "title";
	title.textContent = e.title;
	b.append(when, title);
	b.addEventListener("click", () => { openEvent = openEvent === key ? null : key; renderAgenda(); });
	row.append(b);
	if (openEvent === key) {
		const acts = document.createElement("div");
		acts.className = "acts";
		const ins = document.createElement("button");
		ins.type = "button";
		ins.textContent = "Insert in note";
		ins.disabled = !editor.path || notes.get(editor.path)?.binary;
		ins.addEventListener("click", () => { editor.insert(agenda.noteLine(e)); openAgenda(false); });
		acts.append(ins);
		if (/^https:\/\/(www\.)?google\.com\//.test(e.link)) {
			const a = document.createElement("a");
			a.href = e.link;
			a.target = "_blank";
			a.rel = "noopener";
			a.textContent = "Open in Google";
			acts.append(a);
		}
		row.append(acts);
	}
	return row;
}

// On a wide screen the agenda can be pinned: it docks beside the note (above
// the contents when those are docked too) and stays open while you write.
const AGENDA_PIN_KEY = "wr1t3r-agenda-pinned";
function agendaPinned() { return wide.matches && readRaw(AGENDA_PIN_KEY) === "1"; }

function pinAgenda(on) {
	storeRaw(AGENDA_PIN_KEY, on ? "1" : null);
	layoutAgenda();
	if (on) openAgenda(true);
}

function layoutAgenda() {
	const docked = agendaPinned() && !$("agenda").hidden;
	$("agenda").classList.toggle("docked", docked);
	$("app").classList.toggle("agenda-docked", docked);
	const pin = $("agendaPin");
	pin.setAttribute("aria-pressed", String(agendaPinned()));
	pin.title = agendaPinned() ? "Unpin the agenda" : "Pin the agenda beside the note";
}

function openAgenda(on, force = false) {
	if (!on && agendaPinned() && !force) return; // pinned: stays open
	$("agenda").hidden = !on;
	layoutAgenda();
	$("calBtn").setAttribute("aria-expanded", String(on));
	if (on) {
		openSettings(false);
		if (!wide.matches) $("toc").hidden = true;
		unlockSound();
		askToNotify();
		renderAgenda();
		loadMonth();
		if (!cal || Date.now() - cal.at > 60000) loadAgenda();
	} else {
		openEvent = null;
		showAddEvent(false);
	}
}

function showAddEvent(on, day = null) {
	$("addEvent").hidden = !on;
	$("evError").textContent = "";
	if (!on) return;
	const now = new Date();
	const start = new Date(Math.ceil(now.getTime() / 1800000) * 1800000); // next half hour
	const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	$("addEvent").reset();
	fillCalendars();
	$("evDate").value = agenda.dayKey(day || start);
	$("evStart").value = hm(start);
	$("evEnd").value = hm(new Date(start.getTime() + 3600000));
	allDayFields();
	$("evTitle").focus();
}

// Calendars you can add to, main one first; the last one used is picked.
function fillCalendars() {
	const list = (cal?.calendars || []).filter((c) => c.writable).sort((a, b) => b.primary - a.primary);
	const sel = $("evCalendar");
	sel.textContent = "";
	for (const c of list) sel.append(new Option(c.primary && agenda.calendarLabel(c) !== "Main" ? `${agenda.calendarLabel(c)} (main)` : agenda.calendarLabel(c), c.id));
	const last = readRaw("wr1t3rEventCal");
	if (list.some((c) => c.id === last)) sel.value = last;
	$("evCalendarRow").hidden = list.length < 2;
	pickColor("");
}

// Swatches: the calendar's own color (the default), then Google's event colors.
let eventColor = "";
function pickColor(id) {
	eventColor = id;
	const box = $("evColors");
	const calColor = cal?.calendars?.find((c) => c.id === ($("evCalendar").value || cal.calendars.find((x) => x.primary)?.id))?.color;
	box.textContent = "";
	const swatch = (value, color, label) => {
		const b = document.createElement("button");
		b.type = "button";
		b.setAttribute("role", "radio");
		b.setAttribute("aria-checked", String(value === id));
		b.setAttribute("aria-label", label);
		b.title = label;
		if (/^#[0-9a-f]{3,8}$/i.test(color || "")) b.style.setProperty("--sw", color);
		b.addEventListener("click", () => pickColor(value));
		return b;
	};
	const def = swatch("", calColor, "Calendar color");
	def.classList.add("cal");
	box.append(def);
	for (const [value, [label, color]] of Object.entries(agenda.EVENT_COLORS)) box.append(swatch(value, color, label));
}

function allDayFields() {
	const all = $("evAllDay").checked;
	$("evTimes").hidden = all;
	$("evStart").required = $("evEnd").required = !all;
	$("evEndDate").hidden = !all;
	if (all && !$("evEndDate").value) $("evEndDate").value = $("evDate").value;
}

async function addEvent(e) {
	e.preventDefault();
	if (!navigator.onLine) { $("evError").textContent = "Adding events needs a connection."; return; }
	const all = $("evAllDay").checked;
	if (all && $("evEndDate").value && $("evEndDate").value < $("evDate").value) { $("evError").textContent = "The last day is before the first."; return; }
	const submit = $("addEvent").querySelector("[type=submit]");
	submit.disabled = true;
	try {
		const body = agenda.formEvent({
			title: $("evTitle").value, allDay: all, date: $("evDate").value, endDate: $("evEndDate").value,
			startTime: $("evStart").value, endTime: $("evEnd").value, reminder: $("evReminder").value, location: $("evLocation").value,
			colorId: eventColor,
		}, Intl.DateTimeFormat().resolvedOptions().timeZone);
		const calendarId = $("evCalendar").value;
		if (calendarId) { body.calendarId = calendarId; storeRaw("wr1t3rEventCal", calendarId); }
		await api.addEvent(body);
		showAddEvent(false);
		const where = cal?.calendars?.find((c) => c.id === calendarId);
		toast(`Added “${body.title}” to ${where && !where.primary ? agenda.calendarLabel(where) : "Google Calendar"}.`);
		cal = cal && { ...cal, at: 0 };
		monthData = null; pickData = null;
		await loadAgenda();
	} catch (err) {
		if (err instanceof AuthError) return signOut("That token no longer works.");
		$("evError").textContent = "Couldn't add it: " + err.message;
	} finally {
		submit.disabled = false;
	}
}

// Reminders from Google Calendar, while wr1t3r is open. Google's own app
// still handles them when it isn't.
function checkAlerts() {
	const events = cal ? visibleEvents() : null;
	const now = Date.now();
	const since = Number(readRaw(ALERTED_KEY)) || now;
	storeRaw(ALERTED_KEY, now);
	if (!events) return;
	for (const due of agenda.dueAlerts(events, since, now)) alertUser(due.event.title, agenda.alertText(due));
}

function setupAgenda() {
	$("calBtn").addEventListener("click", (e) => {
		e.stopPropagation();
		if (agendaPinned() && !$("agenda").hidden) { pinAgenda(false); openAgenda(false); return; }
		openAgenda($("agenda").hidden);
	});
	$("agendaPin").addEventListener("click", () => pinAgenda(!agendaPinned()));
	$("monthPrev").addEventListener("click", () => showMonth(-1));
	$("monthNext").addEventListener("click", () => showMonth(1));
	$("monthToday").addEventListener("click", () => showMonth(0));
	desk.addEventListener("change", () => { renderAgenda(); loadMonth(); });
	wide.addEventListener("change", () => { if (agendaPinned()) openAgenda(true); else layoutAgenda(); });
	if (agendaPinned()) openAgenda(true);
	$("addEventBtn").addEventListener("click", () => showAddEvent($("addEvent").hidden));
	$("evCancel").addEventListener("click", () => showAddEvent(false));
	$("evAllDay").addEventListener("change", allDayFields);
	$("evCalendar").addEventListener("change", () => pickColor(eventColor));
	$("evDate").addEventListener("change", () => { if ($("evEndDate").value < $("evDate").value) $("evEndDate").value = $("evDate").value; });
	$("addEvent").addEventListener("submit", addEvent);
	document.addEventListener("click", (e) => {
		// The list redraws on each tap, so a tapped row may already be gone.
		if (!$("agenda").hidden && e.target.isConnected && !e.target.closest("#agenda, #calBtn")) openAgenda(false);
	});
	document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("agenda").hidden) openAgenda(false); });
	document.addEventListener("pointerdown", unlockSound, { once: true });
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		checkAlerts();
		if (!cal || Date.now() - cal.at > 5 * 60000) loadAgenda();
	});
	window.addEventListener("online", () => loadAgenda());
	setInterval(checkAlerts, 20000);
	setInterval(() => document.visibilityState === "visible" && loadAgenda(), 10 * 60000);
	setInterval(renderAgenda, 60000); // "past" styling and the next-event label
	renderAgenda();
	checkAlerts();
	loadAgenda();
}

// ---- start -------------------------------------------------------------------------

function showLogin(message = "") {
	applyTheme();
	$("login").hidden = false;
	$("login-error").textContent = message;
	$("token").focus();
	$("login").onsubmit = async (e) => {
		e.preventDefault();
		setToken($("token").value.trim());
		try {
			await api.check();
			$("login").hidden = true;
			start();
		} catch (err) {
			setToken("");
			$("login-error").textContent = err instanceof AuthError ? "That token didn't work." : "Couldn't reach wr1t3r: " + err.message;
		}
	};
}

let refreshKeyboardBar = null;

// Vault attachments (images, PDFs, audio, video): the list, kept for offline
// use; the files themselves are fetched when shown (src/attachments.js).
let attachments = [];
let attachmentsLoaded = false;
async function loadAttachments() {
	try { attachments = (await meta.get("attachments")) || []; } catch {}
	if (attachments.length) { attachmentsLoaded = true; vaultTouched(); }
}
async function refreshAttachments() {
	try {
		const list = await api.attachments();
		const changed = JSON.stringify(list) !== JSON.stringify(attachments);
		attachments = list;
		attachmentsLoaded = true;
		if (changed) { meta.set("attachments", list).catch(() => {}); vaultTouched(); }
	} catch {}
}

// What dataviewjs blocks (src/dataview.js) may read: notes on this device, and
// public web pages through the Worker, as the clipper fetches them.
const dataviewVault = {
	paths: () => visible().filter((n) => !n.binary).map((n) => n.path),
	text: (path) => { const n = notes.get(path); return n && !n.deleted && !n.binary ? n.text : null; },
	attachments: () => attachments,
	attachmentsLoaded: () => attachmentsLoaded,
	resolveAttachment: (name, from) => resolveAttachment(name, from, attachments.map((f) => f.path)),
	attachmentURL(path) {
		const file = attachments.find((f) => f.path === path);
		return file ? attachmentURL(file, (p) => api.attachment(p)) : Promise.reject(new Error("No such attachment"));
	},
	async fetch(url) {
		const res = await fetch("/api/fetch?url=" + encodeURIComponent(url), { headers: { Authorization: "Bearer " + token() }, cache: "no-store" });
		if (res.ok) return { status: 200, text: await res.text() };
		const err = (await res.json().catch(() => ({}))).error || "";
		return { status: Number((err.match(/answered (\d{3})/) || [])[1]) || res.status, text: err };
	},
};

async function start() {
	$("app").hidden = false;
	editor = createEditor($("editor"), { onChange: onEdit, onUpdate: () => { refreshCount(); refreshKeyboardBar?.(); }, onLink: followLink, vault: dataviewVault });
	setupSettings();
	setupFocusTools();
	setupAgenda();
	setupToc();
	refreshKeyboardBar = setupKeyboardBar($("app"), () => editor.view);
	renderQuote();
	$("writingPrompt").addEventListener("click", () => newPromptNote($("writingPrompt").textContent));
	$("promptNext").addEventListener("click", () => { promptStep++; renderPrompt(); });
	document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && renderQuote());
	for (const n of await local.all()) notes.set(n.path, n);
	loadAttachments();
	loadMediaKinds();
	persist();

	$("filter").addEventListener("input", renderTree);
	$("new").addEventListener("click", () => newNote());
	$("today").addEventListener("click", () => openDaily());
	// Keep this in step with ACCEPT in src/convert.js. It's set here, not
	// imported, because Safari only opens the picker straight from the tap.
	$("upload-input").accept = ".md,.markdown,.txt,.html,.htm,.docx,.pdf";
	$("upload").addEventListener("click", () => $("upload-input").click());
	$("clip").addEventListener("click", () => clipPage(prompt("Web page to clip:") || ""));
	$("bookmarklet").href = `javascript:location.href=${JSON.stringify(location.origin + "/#clip=")}+encodeURIComponent(location.href)`;
	$("upload-input").addEventListener("change", (e) => {
		const files = [...e.target.files];
		e.target.value = "";
		upload(files);
	});
	// Fetch the converters in the background so uploads work offline later.
	(window.requestIdleCallback || setTimeout)(() => navigator.onLine && import("./convert.js").then((m) => m.warm()).catch(() => {}));
	$("status").addEventListener("click", () => runSync());
	$("delete").addEventListener("click", () => editor.path && removeNote(editor.path));
	$("signout").addEventListener("click", () => signOut());
	$("menu").addEventListener("click", () => $("app").classList.toggle("menu-open"));
	$("scrim").addEventListener("click", () => $("app").classList.remove("menu-open"));
	$("path").addEventListener("keydown", (e) => {
		if (e.key === "Enter") { e.preventDefault(); renameNote(editor.path, $("path").value); $("path").blur(); }
		if (e.key === "Escape") { $("path").value = editor.path; $("path").blur(); }
		if (e.key !== "Enter" && e.key !== "Escape") requestAnimationFrame(() => { $("path").size = Math.max(4, $("path").value.length + 1); });
	});
	$("path").addEventListener("blur", showPath);
	$("path").addEventListener("focus", () => { showPath(); $("path").select(); });
	$("closeNote").addEventListener("click", () => editor.path ? closeTab(editor.path) : openNote(null));
	$("tabPick").addEventListener("change", () => openNote($("tabPick").value, { tab: false }));
	$("refBtn").addEventListener("click", () => showRef(!ref.on));
	$("refClose").addEventListener("click", () => showRef(false));
	$("refPick").addEventListener("change", () => showRef(true, $("refPick").value));
	$("refOpen").addEventListener("click", () => {
		const was = editor.path, p = ref.path;
		if (!p || p === was) return;
		openNote(p);
		if (was) showRef(true, was); // swap: the note you were editing moves to the pane
	});
	$("tree").addEventListener("click", (e) => {
		const a = e.target.closest("a");
		if (!a) return;
		e.preventDefault();
		openNote(decodeURIComponent(a.hash.slice(1)));
	});
	window.addEventListener("hashchange", () => {
		if (clipFromHash()) return;
		const p = decodeURIComponent(location.hash.slice(1));
		if (p && p !== editor.path) openNote(p);
	});
	window.addEventListener("online", () => runSync());
	window.addEventListener("offline", () => { lastError = "offline"; renderStatus(); });
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") runSync();
	});
	document.addEventListener("keydown", onHotkey, true); // ahead of the editor's own keys
	$("hotkeysBtn").addEventListener("click", editHotkeys);
	$("bookmark").addEventListener("click", () => toggleBookmark());
	$("palette").addEventListener("click", () => commandPalette());
	setInterval(() => document.visibilityState === "visible" && runSync(), 60000);

	if (!clipFromHash()) openNote(decodeURIComponent(location.hash.slice(1)) || tabs.find(isOpenable) || null);
	if (ref.on) showRef(true);
	renderStatus();
	runSync();
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
	navigator.serviceWorker.register("/sw.js").catch(() => {});
}

if (token()) start();
else {
	const msg = sessionStorage.getItem("wr1t3r-msg") || "";
	sessionStorage.removeItem("wr1t3r-msg");
	showLogin(msg);
}
