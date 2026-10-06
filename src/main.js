// wr1t3r's page: file list, editor and the sync loop. Every keystroke is
// saved to this device first (IndexedDB); syncing with the vault happens in
// the background and whenever the connection comes back.

import { createEditor } from "./editor.js";
import { setupKeyboardBar } from "./kbbar.js";
import { DAILY_FOLDER, isoDate, renderTemplate, findTemplate } from "./daily.js";
import { promptFor } from "./prompts.js";
import { resolveNote, headingFor, blockFor } from "./links.js";
import { noteTags, tagHue } from "./frontmatter.js";
import { vaultChanged } from "./vault.js";
import { setLivePreview } from "./livepreview.js";
import { parseQuery, matches, snippet, isArchived, asksForArchive, archiveText } from "./search.js";
import { openPalette } from "./palette.js";
import { starterBase } from "./baseconfig.js";
import { EDIT_ACTIONS, DEFAULT_KEYS, keyName, showKey, usableKey, bindings, rebind, macAlias } from "./hotkeys.js";
import { templatesIn, insertTemplate, isTemplatePath, templatesFolder } from "./templates.js";
import { COMMANDS, setSlashExtras } from "./slash.js";
import { runCommand } from "./kbbar.js";
import { inTable } from "./table.js";
import { renameEdits, applyChanges } from "./vaultlinks.js";
import { movePlan, moveLinkEdits } from "./moves.js";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { local, meta, persist } from "./store.js";
import { resolveAttachment, attachmentURL, attachmentBlob } from "./attachments.js";
import { api, token, setToken, AuthError } from "./api.js";
import { openStorage, registerStorage, storageKind, setStorageKind } from "./storage.js";
import { dropboxStorage, dropboxAppKey, dropboxSignedIn, forgetDropbox, beginDropboxSignIn, finishDropboxSignIn, isDropboxReturn } from "./dropbox.js";
import { FEATURE_AREAS, FOLDER_SETTINGS, readSettings, writeSettings, settingsPath, commandArea, cleanFolder } from "./features.js";
import { sync, conflictPath } from "./sync.js";
import { runPass, folderSupported } from "./localvaultview.js";
import { transcribeFile } from "./transcribeview.js";
import { contentHash } from "./localvault.js";
import { isNotePath, isAttachmentPath, isBoardPath, BOARD_EXT } from "./paths.js";
import { counts, countWords, stats, noteGoal } from "./count.js";
import * as pomo from "./pomodoro.js";
import * as agenda from "./agenda.js";
import * as toc from "./toc.js";
import { timelineChanges, eventsOn } from "./timeline.js";
import { newNoteFrontmatter, withTitleHeading } from "./frontmatter.js";
import { readTypes, writeTypes, listKeys, propertyUsage } from "./properties.js";
import { quoteFor } from "./quotes.js";
import { readTheme, themeAttr } from "./theme.js";
import { rerunDataview } from "./dataview.js";
import { makeMediaNote } from "./media.js";
import { homePath, readPins, writePins, pinKind, pinPath, pinTitle, pinColor, linkFor, folderLink, viewLink, pinOpens, retargetPins, isAppFile, isSection, tileOrdinals } from "./home.js";
import { binderPath, isBinder, binderOrder, writeBinder, renameFolderEntry, cardInfo, readBinder } from "./binder.js";
import { reorder } from "./drag.js";
import { drawBoard, drawOutline, folderWords, stopViews } from "./folderview.js";
import { mountScrivenings, readingOrder } from "./scrivenings.js";
import { cleanNote, writeCompileSettings } from "./compile.js";
import { openCompile as openCompileDialog } from "./compileview.js";
import { setProperty } from "./bases.js";
import { prettyOf, draggedPosition } from "./pretty.js";
import { Text } from "@codemirror/state";
import { drawHome, onMenu } from "./homeview.js";
import { setCardsHost } from "./cardsblock.js";
import { setPlannerHost, importEvents } from "./plannerview.js";
import { openPropertyCleanup } from "./propcleanview.js";
import { NEW_NOTE_KINDS, kindForTemplate, kindFolder, noteFileName, freeNotePath } from "./newnotes.js";
import { healthPathFor, MEALS, WATER, MOOD, removeEvent, editPlannerBlock } from "./planner.js";
import { openFoodPanel } from "./plannerview.js";
import { TASK_TAGS, itemTags, listName, tagFor } from "./tasklists.js";
import { attachmentKind } from "./attachments.js";
import { ocrOn, setOcrOn, unread, readFiles } from "./ocr.js";
import { setFocusMode } from "./focus.js";
import { lookUp } from "./lookup.js";
import { setupGrammar, setGrammar, checkNote, grammarOn, grammarAtCursor } from "./grammar.js";
import { setSpellcheck, setSmartPunctuation } from "./writing.js";
import { setDoneDates, sortChecklists } from "./tasks.js";
import { menu as dropMenu } from "./basesui.js";
import { SIZES, MARGINS, readSetup, setPageSetup } from "./pagelayout.js";
import { setPageView, isPageView } from "./pageview.js";
import { setTracking, isTracking, setFinalView, isFinalView, acceptChange, rejectChange, resolveEvery, gotoChange, addComment, countChanges } from "./trackview.js";
import { setPictureHost } from "./paste.js";
import { pictureFolder, pictureName, freePath, pictureLink } from "./pictures.js";
import { setupToolbar } from "./toolbar.js";
import * as versions from "./history.js";
import { INBOX, captureEntry, appendCapture, stamp } from "./capture.js";
import { recordVoice } from "./recorder.js";
import { remindersIn } from "./reminders.js";
import { openHistory } from "./historyview.js";

const $ = (id) => document.getElementById(id);
// path -> note, mirrors IndexedDB. version changes when a note arrives, goes,
// or is marked deleted or binary, not on every keystroke's save, so visible()
// can keep its sorted list between those.
class NoteMap extends Map {
	version = 0;
	set(path, note) {
		const cur = super.get(path);
		if (!cur || !cur.deleted !== !note?.deleted || !cur.binary !== !note?.binary) this.version++;
		return super.set(path, note);
	}
	delete(path) {
		if (super.has(path)) this.version++;
		return super.delete(path);
	}
	clear() {
		this.version++;
		super.clear();
	}
}
const notes = new NoteMap();
// Where the notebook lives (src/storage.js); the Worker unless this device picked another.
if (dropboxAppKey()) registerStorage("dropbox", () => dropboxStorage());
const onDropbox = storageKind() === "dropbox";
const remote = openStorage();
const SIGNED_OUT = onDropbox ? "Dropbox ended wr1t3r's sign-in. Sign in again." : "That token no longer works.";
let editor;

// ---- storage: one write chain so saves land in order ----------------------

let writing = Promise.resolve();
// fn(current|null) -> new note | null (delete) | undefined (leave), applied in
// one IndexedDB transaction (see local.update).
function change(path, fn) {
	writing = writing
		.then(() => local.update(path, fn))
		.then(({ before, after }) => {
			if (after) notes.set(path, after); else notes.delete(path);
			if (before?.text != null && after?.text !== before.text) versions.keep(path, before.text);
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
	if (syncing || localFolder?.running) { again = true; return; } // one at a time with the local folder's passes
	if (!navigator.onLine) { lastError = "offline"; renderStatus(); return; }
	syncing = true;
	renderStatus();
	try {
		await writing;
		const r = await sync({ local, api: remote, onNote });
		refreshAttachments();
		lastSynced = new Date();
		applyFeatures();
		uploadReminders();
		lastError = null;
		if (sortPending && sortPending === editor.path && settingOn("sort")) sortOpenNote();
		sortPending = null;
		for (const c of r.conflicts) {
			toast(`${name(c.path)} was also changed elsewhere. Your version is saved as “${name(c.copy)}”.`, 8000);
		}
	} catch (e) {
		if (e instanceof AuthError) return signOut(SIGNED_OUT);
		lastError = e instanceof TypeError ? "offline" : e.message;
	} finally {
		syncing = false;
		renderStatus();
		renderTree();
		if (again) { again = false; scheduleSync(0); }
		scheduleLocalPass(500);
	}
}

// ---- the local folder (src/localvault.js, src/localvaultview.js) ------------
// A folder on this computer that wr1t3r keeps in step with its own copy, both
// ways (Chrome and Edge only). The folder's handle and the per-file records
// live in IndexedDB; a pass runs after each sync, when the tab comes back,
// every 30 seconds, and a few seconds after typing stops.

let localFolder = null; // { handle, name, records: { notes, files }, state: "ready" | "needs-permission", lastPass, lastError, running }
let localTimer = null, localAgain = false;

function scheduleLocalPass(ms = 0) {
	if (!localFolder) return;
	clearTimeout(localTimer);
	localTimer = setTimeout(localPass, ms);
}

async function loadLocalFolder() {
	try {
		const saved = await meta.get("localFolder");
		if (!saved?.handle) return;
		const recs = saved.records || {};
		localFolder = { handle: saved.handle, name: saved.handle.name, records: { notes: new Map(recs.notes || []), files: new Map(recs.files || []) }, state: "needs-permission" };
		if ((await saved.handle.queryPermission({ mode: "readwrite" })) === "granted") localFolder.state = "ready";
	} catch {}
	renderLocalFolder();
	scheduleLocalPass(1500);
}

function saveLocalFolder() {
	if (!localFolder) return meta.set("localFolder", null).catch(() => {});
	return meta.set("localFolder", { handle: localFolder.handle, records: { notes: [...localFolder.records.notes], files: [...localFolder.records.files] } }).catch(() => {});
}

async function pickLocalFolder() {
	let handle;
	try { handle = await window.showDirectoryPicker({ id: "wr1t3r-vault", mode: "readwrite" }); } catch { return; }
	// The same folder as before keeps its records; another starts fresh.
	const same = localFolder && (await localFolder.handle.isSameEntry(handle).catch(() => false));
	localFolder = { handle, name: handle.name, records: same ? localFolder.records : { notes: new Map(), files: new Map() }, state: "ready" };
	await saveLocalFolder();
	renderLocalFolder();
	localPass();
}

async function reconnectLocalFolder() {
	if (!localFolder) return;
	if ((await localFolder.handle.requestPermission({ mode: "readwrite" }).catch(() => "denied")) === "granted") localFolder.state = "ready";
	renderLocalFolder();
	localPass();
}

async function stopLocalFolder() {
	if (!localFolder || !confirm(`Stop keeping “${localFolder.name}” in step with wr1t3r? The files stay where they are.`)) return;
	localFolder = null;
	await saveLocalFolder();
	renderLocalFolder();
}

async function localPass() {
	if (!localFolder || localFolder.state !== "ready") return;
	if (localFolder.running) { localAgain = true; return; }
	if (syncing) return; // runSync starts one when it's done
	if ((await localFolder.handle.queryPermission({ mode: "readwrite" }).catch(() => "denied")) !== "granted") { localFolder.state = "needs-permission"; renderLocalFolder(); return; }
	localFolder.running = true;
	renderLocalFolder();
	const f = localFolder;
	try {
		await writing;
		// Each note as the pass saw it: one changed since (typed in, or synced
		// in) keeps that change, and the folder's version comes in as a copy.
		const current = (path) => { const n = notes.get(path); return !n || n.deleted ? null : n.binary ? { bytes: n.bytes } : { text: path === editor.path ? editor.text() : n.text }; };
		const seen = new Map();
		const r = await runPass({
			root: f.handle, records: f.records,
			notes: () => {
				const out = new Map();
				for (const n of notes.values()) if (!n.deleted) { const c = current(n.path); out.set(n.path, c); seen.set(n.path, contentHash(c)); }
				return out;
			},
			async putNote(path, n) {
				const now = current(path);
				if ((now ? contentHash(now) : undefined) !== seen.get(path)) {
					const copy = conflictPath(path, (p) => taken(p));
					toast(`${name(path)} changed here while the folder's copy was coming in. The folder's version is saved as “${name(copy)}”.`, 8000);
					path = copy;
				}
				await change(path, (cur) => ({ path, ...(n.bytes ? { bytes: n.bytes, binary: true } : { text: n.text }), base: cur?.base ?? null, dirty: true, deleted: false }));
				if (editor.path === path) editor.replace(notes.get(path)); else editor.forget(path);
			},
			async deleteNote(path) {
				await change(path, (cur) => (cur?.base ? { ...cur, deleted: true, dirty: true } : null));
				editor.forget(path);
				if (editor.path === path) closeTab(path);
			},
			conflictPath: (path) => conflictPath(path, (p) => taken(p)),
			attachments: () => (attachmentsLoaded ? attachments : null),
			fetchAttachment: (file) => attachmentBlob(file, (p) => remote.attachment(p)),
			async uploadPicture(path, blob) {
				if (!navigator.onLine) throw new Error("offline");
				const added = await remote.uploadAttachment(path, blob);
				if (!added) return null; // the vault has one by that name; it comes down next pass
				attachments = [...attachments.filter((x) => x.path !== path), added];
				meta.set("attachments", attachments).catch(() => {});
				vaultTouched();
				return added.version;
			},
			confirmFirst: async (s) => confirm(`“${f.name}” already has notes in it. Keeping it in step with wr1t3r will:\n\n`
				+ `• leave ${s.same} that match as they are\n`
				+ `• add ${s.folderOnly} that are only in the folder to the vault (and every device)\n`
				+ `• write ${s.vaultOnly} from the vault into the folder\n`
				+ `• keep both versions of ${s.differ} that differ (the folder's comes in as a “(conflict …)” copy)\n\nGo ahead?`),
			confirmDeletes: async (paths) => confirm(`${paths.length === 1 ? `“${name(paths[0])}” was` : `${paths.length} notes were`} deleted from “${f.name}”:\n\n${paths.slice(0, 12).map((p) => "• " + p).join("\n")}${paths.length > 12 ? `\n…and ${paths.length - 12} more` : ""}\n\nDelete ${paths.length === 1 ? "it" : "them"} from the vault too (on every device)? Cancel puts ${paths.length === 1 ? "it" : "them"} back in the folder.`),
			isNote: isNotePath,
			isFile: isAttachmentPath,
		});
		if (localFolder !== f) return; // stopped meanwhile
		if (r.declined) { localFolder = null; await saveLocalFolder(); renderLocalFolder(); toast(`Not using “${f.name}”. Pick an empty folder, or one you're happy to merge.`); return; }
		f.lastPass = new Date();
		f.lastError = r.errors.length ? `${r.errors.length} file${r.errors.length === 1 ? "" : "s"} couldn't be copied (will try again)` : null;
		await saveLocalFolder();
		if (r.changed) { renderTree(); renderStatus(); scheduleSync(); }
	} catch (e) {
		f.lastError = e?.message || String(e);
	} finally {
		f.running = false;
		renderLocalFolder();
		if (localAgain) { localAgain = false; scheduleLocalPass(0); }
		if (again) { again = false; scheduleSync(0); }
	}
}

function renderLocalFolder() {
	const status = $("folderStatus");
	if (!status) return;
	const show = (id, on) => { $(id).hidden = !on; };
	if (!folderSupported()) {
		status.textContent = "Needs Chrome or Edge on a computer.";
		["folderPick", "folderReconnect", "folderStop"].forEach((id) => show(id, false));
		return;
	}
	show("folderPick", true);
	$("folderPick").textContent = localFolder ? "Choose another folder…" : "Choose a folder…";
	show("folderReconnect", !!localFolder && localFolder.state === "needs-permission");
	show("folderStop", !!localFolder);
	if (!localFolder) status.textContent = "Off. Pick a folder to keep the vault there as plain files, both ways.";
	else if (localFolder.state === "needs-permission") status.textContent = `“${localFolder.name}”: the browser needs your OK again to use it.`;
	else status.textContent = `In step with “${localFolder.name}”` + (localFolder.running ? " · checking…" : localFolder.lastPass ? ` · checked ${localFolder.lastPass.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "") + (localFolder.lastError ? ` · ${localFolder.lastError}` : "");
}

function setupLocalFolder() {
	$("folderPick").addEventListener("click", pickLocalFolder);
	$("folderReconnect").addEventListener("click", reconnectLocalFolder);
	$("folderStop").addEventListener("click", stopLocalFolder);
	document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleLocalPass(300); });
	window.addEventListener("focus", () => scheduleLocalPass(300));
	setInterval(() => document.visibilityState === "visible" && scheduleLocalPass(0), 30000);
	renderLocalFolder();
	if (folderSupported()) loadLocalFolder();
}

function onNote(path, note) {
	const prev = notes.get(path);
	if (prev?.text != null && note?.text !== prev.text) versions.keep(path, prev.text);
	if (note) notes.set(path, note); else notes.delete(path);
	if (editor.path !== path) return;
	if (!note || note.deleted) {
		toast(`${name(path)} was deleted elsewhere.`);
		closeTab(path);
	} else if (!note.dirty) { editor.replace(note); refreshCount(true); sortPending = path; applyTracking(); }
}

// Checklists sort (done tasks to the bottom, src/tasks.js) when a note opens
// or a sync brings in a new version of it, if Aa > Sort checklists is on. The
// sort waits for a finished sync, so the note is the vault's latest and it
// never races an edit on its way from Obsidian; it's written only when the
// order changes, and undoes like any edit.
let sortPending = null;
const sortable = (path) => !!path && /\.md$/i.test(path) && !/(^|\/)_(templates|clippings|uploads)\//i.test(path) && !isAppFile(path);
function sortOpenNote({ quiet = true } = {}) {
	const view = editor.view;
	if (!sortable(editor.path) || view.state.readOnly) return quiet || toast("This note's checklists aren't sorted.");
	const before = view.state.doc.toString(), after = sortChecklists(before);
	if (after) view.dispatch({ changes: diffChange(before, after), userEvent: "input.sort" });
	if (!quiet) toast(after ? "Done tasks moved to the bottom." : "The checklists are already in order.", 2500);
}
function sortOnOpen(path) {
	if (!settingOn("sort") || !sortable(path)) return;
	if (!syncing && !lastError && lastSynced && Date.now() - lastSynced < 60000) sortOpenNote();
	else { sortPending = path; scheduleSync(0); }
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

// One collator: localeCompare with options builds a new one on every call,
// which made sorting a big vault slow enough to lag typing.
const byPath = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
let order = { version: -1, paths: [] };

function visible() {
	if (order.version !== notes.version) {
		const paths = [...notes.values()].filter((n) => !n.deleted).map((n) => n.path).sort(byPath.compare);
		order = { version: notes.version, paths };
	}
	return order.paths.map((p) => notes.get(p));
}

// The same array until the vault changes, so src/links.js can index it once.
function cachedPaths(key, pick) {
	const hit = pathLists.get(key);
	if (hit && hit.version === notes.version) return hit.paths;
	const paths = visible().filter(pick).map((n) => n.path);
	pathLists.set(key, { version: notes.version, paths });
	return paths;
}
const pathLists = new Map();

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
let vaultTimer, vaultStamp = 0;
function vaultTouched() {
	vaultStamp++;
	clearTimeout(vaultTimer);
	vaultTimer = setTimeout(() => {
		editor?.view.dispatch({ effects: vaultChanged.of(null) });
		// Home's boards and lists show other notes too.
		homeBoards?.ed.view.dispatch({ effects: vaultChanged.of(null) });
	}, 400);
	refTouched();
	folderTouched();
}

// Whether a note is archived (src/search.js), worked out again only when its text changes.
const archivedCache = new Map();
function archivedNote(n) {
	if (n.binary || !n.text) return false;
	const hit = archivedCache.get(n.path);
	if (hit && hit.text === n.text) return hit.on;
	const on = isArchived(n.text);
	archivedCache.set(n.path, { text: n.text, on });
	return on;
}

// Archives the open note, or brings it back.
function toggleArchive() {
	const note = notes.get(editor.path);
	if (!note || note.binary) return;
	archivePaths([editor.path], !archivedNote({ ...note, text: editor.view.state.doc.toString() }));
}

// Archiving sets status: Archived (unarchiving clears it), so the notes
// leave the notes list; search still finds them.
function archivePaths(paths, on) {
	for (const p of paths) dataviewVault.write(p, (text) => archiveText(text, on, setProperty));
	const what = paths.length === 1 ? "" : ` ${paths.length} notes`;
	toast(on ? `Archived${what}: out of the notes list, but search still finds ${paths.length === 1 ? "it" : "them"} (search "archive" for all of them)` : `Back in the notes list:${what || " 1 note"}`, 3500);
}
const notesIn = (folder) => visible().filter((n) => !n.binary && n.path.startsWith(folder) && n.path.endsWith(".md")).map((n) => n.path);
function archiveFolder(folder) {
	const paths = notesIn(folder), live = paths.filter((p) => !archivedNote(notes.get(p)));
	if (!paths.length) return;
	if (!live.length) return archivePaths(paths, false);
	if (live.length > 1 && !confirm(`Archive the ${live.length} notes in “${itemLabel(folder)}”? Each gets status: Archived and leaves the notes list.`)) return;
	archivePaths(live, true);
}

function renderTree() {
	vaultTouched();
	renderFolderNav();
	renderHome();
	renderHomeSettings();
	renderTemplateSettings();
	const tree = $("tree");
	const q = $("filter").value.trim();
	tree.replaceChildren();
	// wr1t3r's own files (the Home note) are edited from Aa > Home instead, and
	// templates from Aa > Templates.
	const list = visible().filter((n) => !isAppFile(n.path) && !isTemplatePath(n.path));
	if (q) {
		// Words, "phrases", path:, file:, tag:/#tag and -word (src/search.js).
		// Archived notes are found too; "archive" alone lists them all first.
		const terms = parseQuery(q);
		let hits = list.filter((n) => matches(n.binary ? { path: n.path, text: "" } : n, terms, noteTags));
		if (asksForArchive(terms)) {
			const archived = list.filter(archivedNote);
			hits = [...archived, ...hits.filter((n) => !archivedNote(n))];
		}
		const base = commonFolder(list);
		for (const n of hits.slice(0, 300)) {
			const a = link(n, (n.path.startsWith(base) ? n.path.slice(base.length) : n.path).replace(/\.md$/i, ""));
			if (archivedNote(n)) {
				a.classList.add("archived");
				a.prepend(Object.assign(document.createElement("span"), { className: "archived-badge", textContent: "archived" }));
			}
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
		// Pictures and PDFs whose text was read (src/ocr.js).
		const fileHits = readFiles(attachments, ocrIndex).filter((f) => matches(f, terms, () => []));
		for (const f of fileHits.slice(0, 100)) {
			const a = document.createElement("a");
			a.href = "#";
			a.className = "file-hit";
			a.title = f.path;
			a.append(Object.assign(document.createElement("span"), { className: "archived-badge", textContent: attachmentKind(f.path) === "pdf" ? "pdf" : "picture" }), f.path.split("/").pop());
			a.addEventListener("click", (e) => { e.preventDefault(); openAttachment(f.path); });
			const s = snippet(f.text, terms);
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
		if (!hits.length && !fileHits.length) tree.append(Object.assign(document.createElement("div"), { className: "hint", textContent: "No matches." }));
		return;
	}
	if (!list.length) {
		tree.append(Object.assign(document.createElement("div"), { className: "hint", textContent: lastSynced ? "The vault is empty." : "Loading the vault…" }));
		return;
	}
	// Folders first, then notes, like Obsidian. Archived notes aren't listed.
	const root = { folders: new Map(), notes: [] };
	for (const n of list) {
		if (archivedNote(n)) continue;
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
		top = root.folders.get(home.slice(0, -1)) || { folders: new Map(), notes: [] };
		base = home;
		root.folders.delete(home.slice(0, -1));
	}
	// Top-level folders take the theme's rainbow in turn; subfolders, their
	// notes and bookmarks of them keep that color.
	const folderColor = new Map([...top.folders.keys(), ...(top === root ? [] : root.folders.keys())].map((dir, k) => [dir, `var(--f${(k % 7) + 1})`]));
	drawBookmarks(tree, (p) => (p.startsWith(base) && p.slice(base.length).includes("/") ? folderColor.get(p.slice(base.length).split("/")[0]) : null));
	drawTags(tree, list);
	const paths = list.map((n) => n.path);
	const drawFolder = (into, dir, child, prefix, depth) => {
		const full = prefix + dir + "/";
		const d = document.createElement("details");
		// Subfolders keep their parent's color.
		if (!depth) d.style.setProperty("--fc", folderColor.get(dir) || "var(--mark)");
		// Open or shut as you left it; syncing and switching notes never open one.
		d.open = openFolders.has(full);
		const s = document.createElement("summary");
		s.textContent = dir;
		itemRow(s, full);
		dropTarget(s, full, d);
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
	};
	const draw = (node, into, prefix, depth = 0) => {
		// A folder with a _Binder.md lists its notes and folders in that order
		// (the binder itself isn't listed); others show folders, then notes.
		const binder = node.notes.find((n) => isBinder(n.path) && n.path === binderPath(prefix));
		if (binder && !binder.binary) {
			const byPath = new Map(node.notes.map((n) => [n.path, n]));
			for (const it of binderOrder(prefix, paths, binder.text)) {
				if (it.kind === "folder") {
					const dir = it.path.slice(prefix.length, -1);
					if (node.folders.has(dir)) drawFolder(into, dir, node.folders.get(dir), prefix, depth);
				} else if (byPath.has(it.path)) into.append(itemRow(link(byPath.get(it.path), name(it.path)), it.path));
			}
			for (const n of node.notes) if (!/\.md$/i.test(n.path)) into.append(itemRow(link(n, name(n.path)), n.path)); // boards
			return;
		}
		for (const [dir, child] of node.folders) drawFolder(into, dir, child, prefix, depth);
		for (const n of node.notes) into.append(itemRow(link(n, name(n.path)), n.path));
	};
	dropTarget(tree, base);
	draw(top, tree, base);
	if (top !== root) draw(root, tree, "");
}

// ---- moving and deleting from the sidebar -------------------------------------
//
// Notes and folders drag onto a folder (or the empty space below the list, for
// the top level). Right-click, or a long press on a phone, opens a menu with
// Rename, Move to… and Delete.

const DRAG_TYPE = "application/x-wr1t3r-item";
let dragging = null; // the note path or folder path ("…/") being dragged

function itemRow(el, item) {
	el.draggable = true;
	el.dataset.item = item;
	el.addEventListener("dragstart", (e) => {
		dragging = item;
		e.dataTransfer.setData(DRAG_TYPE, item);
		e.dataTransfer.setData("text/plain", item);
		e.dataTransfer.effectAllowed = "move";
		e.stopPropagation();
	});
	el.addEventListener("dragend", () => { dragging = null; clearDrop(); });
	onMenu(el, (x, y) => itemMenu(item, x, y));
	return el;
}

// The outline can sit on #tree itself (a drop at the top level), and the row
// that was dragged may be redrawn before its dragend fires, so this clears
// every outline, and runs after any drag on the page ends.
function clearDrop() {
	document.querySelectorAll("#tree.drop, #tree .drop").forEach((x) => x.classList.remove("drop"));
}
document.addEventListener("dragend", () => { dragging = null; clearDrop(); });
document.addEventListener("drop", () => clearDrop());

// el takes drops into folder; a closed folder (details) opens while hovered.
function dropTarget(el, folder, details = null) {
	let openTimer;
	el.addEventListener("dragover", (e) => {
		if (!dragging || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
		e.preventDefault();
		e.stopPropagation();
		e.dataTransfer.dropEffect = "move";
		if (!el.classList.contains("drop")) {
			clearDrop();
			el.classList.add("drop");
			clearTimeout(openTimer);
			if (details && !details.open) openTimer = setTimeout(() => { details.open = true; }, 700);
		}
	});
	el.addEventListener("dragleave", (e) => {
		if (el.contains(e.relatedTarget)) return;
		el.classList.remove("drop");
		clearTimeout(openTimer);
	});
	el.addEventListener("drop", (e) => {
		const item = e.dataTransfer.getData(DRAG_TYPE);
		if (!item) return;
		e.preventDefault();
		e.stopPropagation();
		clearTimeout(openTimer);
		clearDrop();
		dragging = null;
		moveItem(item, folder);
	});
}

const folderLabel = (f) => f.replace(/^content\//, "").replace(/\/$/, "") || "the top level";
const itemLabel = (item) => (item.endsWith("/") ? item.slice(0, -1).split("/").pop() : name(item));

function itemMenu(item, x, y) {
	const isFolder = item.endsWith("/");
	showMenu([
		...(isFolder ? [
			["New note here…", () => newNote(item + "Untitled.md")],
			...(featureOn("longform") ? [
				["Corkboard", () => openFolderView(item, "corkboard")],
				["Outliner", () => openFolderView(item, "outliner")],
				["Scrivenings", () => openFolderView(item, "scrivenings")],
				["Compile…", () => openCompile(item)],
			] : []),
			...(featureOn("boards") ? [["New board…", () => newBase(item)]] : []),
		] : []),
		pinEntry(item),
		isFolder
			? [notesIn(item).length && notesIn(item).every((p) => archivedNote(notes.get(p))) ? "Unarchive folder" : "Archive folder", () => archiveFolder(item)]
			: [notes.get(item) && archivedNote(notes.get(item)) ? "Unarchive" : "Archive", () => archivePaths([item], !archivedNote(notes.get(item) || {}))],
		["Rename…", () => renameItem(item)],
		["Move to…", () => moveItemTo(item)],
		[isFolder ? "Delete folder" : "Delete", () => deleteItem(item), "danger"],
	], x, y);
}

// A small menu at (x, y). entries: [label, run, class] rows, or a DOM element
// (given close, to call when it's done).
function showMenu(entries, x, y) {
	document.querySelector(".item-menu")?.remove();
	const menu = document.createElement("div");
	menu.className = "item-menu";
	menu.setAttribute("role", "menu");
	for (const entry of entries) {
		if (typeof entry === "function") { menu.append(entry(() => close())); continue; }
		const [label, run, cls] = entry;
		const b = document.createElement("button");
		b.type = "button";
		b.setAttribute("role", "menuitem");
		b.textContent = label;
		if (cls) b.className = cls;
		b.addEventListener("click", () => { close(); run(); });
		menu.append(b);
	}
	document.body.append(menu);
	const r = menu.getBoundingClientRect();
	menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
	menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
	const away = (e) => { if (!menu.contains(e.target)) close(); };
	const esc = (e) => { if (e.key === "Escape") close(); };
	function close() {
		menu.remove();
		document.removeEventListener("pointerdown", away, true);
		document.removeEventListener("keydown", esc, true);
	}
	// Wait for the press that opened the menu to finish.
	setTimeout(() => {
		document.addEventListener("pointerdown", away, true);
		document.addEventListener("keydown", esc, true);
	});
	menu.querySelector("button")?.focus();
}

const parentFolder = (item) => {
	const q = item.endsWith("/") ? item.slice(0, -1) : item;
	return q.includes("/") ? q.slice(0, q.lastIndexOf("/") + 1) : "";
};

function renameItem(item) {
	const input = prompt(item.endsWith("/") ? "Rename folder:" : "Rename note:", itemLabel(item));
	if (input == null || input.trim() === itemLabel(item)) return;
	moveItem(item, parentFolder(item), input.trim().replace(/\.md$/i, ""));
}

// "Move to…": pick a folder from the vault's folders.
function moveItemTo(item) {
	const list = visible();
	const home = commonFolder(list);
	const folders = new Set([home]);
	for (const n of list) {
		const parts = n.path.split("/").slice(0, -1);
		for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/") + "/");
	}
	const here = parentFolder(item);
	const items = [...folders]
		.filter((f) => f.startsWith(home) && f !== here && !(item.endsWith("/") && f.startsWith(item)))
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
		.map((f) => ({ label: folderLabel(f), run: () => moveItem(item, f) }));
	openPalette({
		placeholder: `Move “${itemLabel(item)}” to…`,
		items,
		empty: (q) => ({ label: `New folder “${q}”`, detail: "create", run: () => moveItem(item, home + q.trim().replace(/^\/+|\/+$/g, "") + "/") }),
	});
}

// Moves a note or folder into folder (renaming it to newName on the way), and
// points links to it at its new place. A move is a new note plus a delete of
// the old one, as a rename is.
async function moveItem(item, folder, newName = null) {
	const list = visible();
	const paths = list.map((n) => n.path);
	const { pairs, error } = movePlan(paths, item, folder, newName);
	if (error) return toast(error);
	if (!pairs.length) return;
	if (pairs.some((p) => !isNotePath(p.to))) return toast("That isn't a usable name.");
	const was = editor.path;
	const map = await relocate(pairs, paths, null);
	const destFolder = item.endsWith("/") ? pairs[0].to.slice(0, pairs[0].to.length - (pairs[0].from.length - item.length)) : null;
	await followPins(map, paths, destFolder && item, destFolder);
	// A renamed folder keeps its place in its parent's binder.
	if (destFolder && newName != null) {
		const bp = binderPath(parentFolder(item));
		if (dataviewVault.text(bp) != null) await dataviewVault.write(bp, (t) => renameFolderEntry(t, itemLabel(item), newName));
	}
	if (destFolder) followFolderTabs(item, destFolder);
	if (item.endsWith("/")) {
		const dest = destFolder;
		openFolders = new Set([...openFolders].map((f) => (f.startsWith(item) ? dest + f.slice(item.length) : f)));
	}
	for (let i = folder.indexOf("/"); i >= 0; i = folder.indexOf("/", i + 1)) openFolders.add(folder.slice(0, i + 1));
	writeJSON(OPEN_KEY, [...openFolders]);
	if (was && map.has(was)) openNote(map.get(was), { tab: false });
	else renderTabs();
	renderTree();
	renderStatus();
	scheduleSync(0);
	toast(newName != null
		? `Renamed to “${newName}”.`
		: `Moved ${pairs.length === 1 && !item.endsWith("/") ? `“${name(item)}”` : `“${itemLabel(item)}” (${pairs.length} note${pairs.length === 1 ? "" : "s"})`} to ${folderLabel(folder)}.`);
	return map;
}

// Deletes a note, or every note in a folder, after asking.
async function deleteItem(item) {
	if (!item.endsWith("/")) return removeNote(item);
	const inside = visible().filter((n) => n.path.startsWith(item)).map((n) => n.path);
	if (!inside.length) return;
	if (!confirm(`Delete the folder “${itemLabel(item)}” and the ${inside.length} note${inside.length === 1 ? "" : "s"} in it? They're removed from the vault on every device.`)) return;
	for (const p of inside) {
		await change(p, (cur) => (cur?.base ? { ...cur, deleted: true, dirty: true } : null));
		editor.forget(p);
	}
	bookmarks = bookmarks.filter((p) => !p.startsWith(item));
	writeJSON(BOOKMARKS_KEY, bookmarks);
	const open = (editor.path && editor.path.startsWith(item)) || (folderTab && shownFolder().startsWith(item));
	tabs = tabs.filter((p) => !p.startsWith(item) && !(isFolderTab(p) && p.slice(FOLDER_TAB.length).startsWith(item)));
	saveTabs();
	if (open) openNote(tabs.find(tabOpen) || null, { tab: false });
	else renderTabs();
	renderTree();
	renderStatus();
	scheduleSync(0);
	toast(`Deleted “${itemLabel(item)}” (${inside.length} note${inside.length === 1 ? "" : "s"}).`);
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

function drawBookmarks(tree, colorOf) {
	const marked = bookmarks.filter(isOpenable);
	if (!marked.length) return;
	const kids = sideSection("bookmarks", `Bookmarks`, tree);
	for (const p of marked) {
		const a = link(notes.get(p), name(p));
		const c = colorOf(p);
		if (c) a.style.setProperty("--fc", c); // its folder's color, as in the list below
		onMenu(a, (x, y) => showMenu([pinEntry(p), ["Remove bookmark", () => toggleBookmark(p)]], x, y));
		kids.append(a);
	}
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

// ---- Home ------------------------------------------------------------------------
//
// With no note open, Home shows the quote, today's prompt, and a grid of pinned
// tiles. The pins live in the vault (src/home.js), so every device has them.

const homeFile = () => { const list = visible(); return homePath(list.map((n) => n.path), commonFolder(list)); };

function homeText() {
	const path = homeFile(), n = notes.get(path);
	if (!n || n.deleted || n.binary) return null;
	return path === editor?.path ? editor.text() : n.text;
}

const pins = () => readPins(homeText() || "");

// ---- Notebook settings: which areas are on, and wr1t3r's own folders --------
//
// In _wr1t3r/Settings.md beside the Home note (src/features.js), so every
// device has the same ones. With no Settings note, everything is on.

const settingsFile = () => { const h = homeFile(); return settingsPath(visible().map((n) => n.path), h.slice(0, h.lastIndexOf("/") + 1)); };
let settingsCache = { text: null, value: readSettings("") };
function appSettings() {
	const path = settingsFile(), n = notes.get(path);
	const text = !n || n.deleted || n.binary ? "" : path === editor?.path ? editor.text() : n.text;
	if (text !== settingsCache.text) settingsCache = { text, value: readSettings(text) };
	return settingsCache.value;
}
const featureOn = (id) => !id || appSettings().features[id] !== false;
// One of wr1t3r's own folders (or the Inbox note), under the notes' folder.
const ownFolder = (id) => commonFolder(visible()) + appSettings().folders[id];

async function saveSettings(next) {
	const path = settingsFile();
	if (dataviewVault.text(path) != null) await dataviewVault.write(path, (t) => writeSettings(t, next));
	else {
		if (!visible().length) return toast("The vault hasn't loaded yet.");
		const text = writeSettings("", next);
		await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
		renderStatus();
		scheduleSync();
	}
	applyFeatures();
}

// Hides what belongs to areas that are off: body.no-<area> (style.css) and
// anything marked data-feature="<area>".
let featuresShown = "";
function applyFeatures() {
	const s = appSettings();
	const key = JSON.stringify(s);
	if (key === featuresShown) return;
	featuresShown = key;
	const calendarWasOff = document.body.classList.contains("no-calendar");
	for (const a of FEATURE_AREAS) document.body.classList.toggle("no-" + a.id, !s.features[a.id]);
	renderFeatureSettings(); // also what Search settings looks through
	if (s.features.calendar && calendarWasOff) loadAgenda();
}

// Settings > Features: a switch per area, and the folders.
function renderFeatureSettings() {
	const pane = document.querySelector('.set-pane[data-tab="features"]');
	const s = appSettings();
	pane.textContent = "";
	const h2 = (t) => { const h = document.createElement("h2"); h.textContent = t; return h; };
	const hint = (t) => { const p = document.createElement("p"); p.className = "hint"; p.textContent = t; return p; };
	for (const a of FEATURE_AREAS) {
		const seg = document.createElement("div");
		seg.className = "seg";
		seg.title = a.detail;
		for (const [on, label] of [[true, "On"], [false, "Off"]]) {
			const b = document.createElement("button");
			b.type = "button";
			b.textContent = label;
			b.setAttribute("aria-pressed", String(s.features[a.id] === on));
			b.addEventListener("click", () => { if (s.features[a.id] !== on) saveSettings({ ...s, features: { ...s.features, [a.id]: on } }).then(renderFeatureSettings); });
			seg.append(b);
		}
		pane.append(h2(a.label), seg, hint(a.detail + "."));
	}
	pane.append(h2("Folders"), hint("wr1t3r's own folders, inside the notes' folder. Notes already there stay where they are."));
	for (const f of FOLDER_SETTINGS) {
		const input = document.createElement("input");
		input.type = "text";
		input.value = s.folders[f.id];
		input.placeholder = f.dflt;
		input.setAttribute("aria-label", f.label);
		input.title = f.detail;
		const save = () => {
			const v = cleanFolder(f.id, input.value);
			input.value = v;
			if (v !== appSettings().folders[f.id]) saveSettings({ ...appSettings(), folders: { ...appSettings().folders, [f.id]: v } });
		};
		input.addEventListener("change", save);
		input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
		const row = document.createElement("div");
		row.className = "set-folder";
		const lab = document.createElement("label");
		lab.textContent = f.label;
		lab.append(input);
		row.append(lab);
		pane.append(row);
	}
	pane.append(hint("These sync to every device through _wr1t3r/Settings.md, which stays out of the notes list."));
}

// Saves the pins to the Home note (made the first time), like any edit.
async function savePins(list) {
	const path = homeFile();
	if (homeText() != null) await dataviewVault.write(path, (t) => writePins(t, list));
	else {
		if (!visible().length) return toast("The vault hasn't loaded yet.");
		const text = writePins("", list);
		await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
		renderStatus();
		renderTree();
		scheduleSync();
	}
	renderHome(true);
	renderHomeSettings();
}

const pinTarget = (item) => (item.endsWith("/") ? { folder: item } : { path: item });
function pinIndex(item, list = pins()) {
	const paths = visible().map((n) => n.path);
	return list.findIndex((p) => pinOpens(p, pinTarget(item), paths, homeFile()));
}

// "Pin to Home" or "Unpin from Home", for a note or folder ("…/") menu.
function pinEntry(item) {
	return pinIndex(item) >= 0 ? ["Unpin from Home", () => unpinItem(item)] : ["Pin to Home", () => pinItem(item)];
}

const pinItemHome = (item) => pinItem(item);
function pinItem(item) {
	if (!item) return;
	const list = pins();
	if (pinIndex(item, list) >= 0) return toast(`“${itemLabel(item)}” is already on Home.`);
	const link = item.endsWith("/") ? folderLink(item) : linkFor(item, visible().map((n) => n.path));
	addPin({ link }, itemLabel(item));
}

const addPinHome = (pin, label) => addPin(pin, label);
function addPin(pin, label) {
	savePins([...pins(), pin]);
	toast(`Pinned “${label}” to Home.`);
}

function unpinItem(item) {
	const list = pins(), i = pinIndex(item, list);
	if (i < 0) return;
	savePins(list.filter((_, j) => j !== i));
	toast(`Unpinned “${itemLabel(item)}”.`);
}

// After notes or a folder moved: pins point at their new places.
async function followPins(moved, oldPaths, folderFrom = null, folderTo = null) {
	const list = pins();
	if (!list.length) return;
	const next = retargetPins(list, moved, oldPaths, visible().map((n) => n.path), homeFile(), folderFrom, folderTo);
	if (next) await savePins(next);
}

function goHome() {
	if (activeTab()) openNote(null, { tab: false });
	else renderHome(true);
	$("app").classList.remove("menu-open");
}

// A tile's picture: a web address as is, a vault image through the attachment
// cache (so it shows offline), or null while the list of files hasn't come.
function tileImage(ref, from) {
	if (ref.url) return ref.url;
	const path = dataviewVault.resolveAttachment(ref.name, from);
	if (!path || attachmentKind(path) !== "image") return null;
	return dataviewVault.attachmentURL(path);
}

// The Home note's banner: banner: and banner_position: in _wr1t3r/Home.md,
// drawn across the top of Home the way a note draws its own.
function homeBanner() {
	const text = homeText();
	return text == null ? null : prettyOf(Text.of(text.split("\n"))).banner;
}

// Home's banner: banner: and banner_position: in _wr1t3r/Home.md, set from
// Home itself: "Add a banner" (none yet), or Change, Reposition and Remove
// over the picture. patch: { banner, banner_position } (null removes one).
async function setHomeBanner(patch) {
	if (homeText() == null) await savePins(pins());
	await dataviewVault.write(homeFile(), (t) => {
		for (const [k, v] of Object.entries(patch)) {
			if (v == null) {
				const fm = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---)/.exec(t);
				if (fm) t = fm[1] + fm[2].split(/\r?\n/).filter((l) => !new RegExp(`^${k}\\s*:`).test(l)).join("\n") + t.slice(fm[1].length + fm[2].length);
			} else t = setProperty(t, k, v);
		}
		return t;
	});
	homeKey = null;
	renderHome(true);
}

function pickHomeBanner(current) {
	const images = attachments.filter((f) => attachmentKind(f.path) === "image").map((f) => f.path);
	const nameOf = (p) => p.split("/").pop();
	openPalette({
		placeholder: images.length ? "Home banner: pick a vault image or paste a web address…" : "Home banner…",
		items: [
			{ label: "Web image…", detail: "paste an https address", run: () => {
				const u = (prompt("Image address (https://…):", /^https:/.test(current || "") ? current : "") || "").trim();
				if (!u) return;
				if (!/^https:\/\/\S+$/i.test(u)) return toast("That needs to be an https:// address.");
				setHomeBanner({ banner: u, banner_position: null });
			} },
			...(current ? [{ label: "No banner", detail: "remove it", run: () => setHomeBanner({ banner: null, banner_position: null }) }] : []),
			...images.map((p) => ({
				label: nameOf(p), detail: p.slice(0, -nameOf(p).length - 1).replace(/^content\//, ""), keywords: p,
				run: () => setHomeBanner({ banner: `[[${images.filter((q) => nameOf(q).toLowerCase() === nameOf(p).toLowerCase()).length > 1 ? p : nameOf(p)}]]`, banner_position: null }),
			})),
		],
	});
}

// Dragging the picture up or down picks the part that shows; Save writes it.
function repositionHomeBanner(box, img, start) {
	if (box.classList.contains("moving")) return;
	let pos = start, drag = null;
	box.classList.add("moving");
	const bar = document.createElement("div");
	bar.className = "home-banner-bar moving-bar";
	const hint = Object.assign(document.createElement("span"), { textContent: "Drag the picture up or down" });
	const cancel = Object.assign(document.createElement("button"), { type: "button", textContent: "Cancel" });
	const save = Object.assign(document.createElement("button"), { type: "button", textContent: "Save" });
	bar.append(hint, cancel, save);
	box.append(bar);
	const show = (p) => { img.style.objectPosition = `center ${p}%`; };
	const overflow = () => (img.naturalWidth ? img.naturalHeight * (img.clientWidth / img.naturalWidth) - img.clientHeight : 0);
	const down = (e) => { if (e.button !== 0 || e.target.closest(".home-banner-bar")) return; e.preventDefault(); drag = { y: e.clientY, from: pos, overflow: overflow() }; box.setPointerCapture?.(e.pointerId); };
	const move = (e) => { if (!drag) return; pos = draggedPosition(drag.from, e.clientY - drag.y, drag.overflow); show(pos); };
	const up = () => { drag = null; };
	const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); finish(false); } };
	function finish(keep) {
		box.removeEventListener("pointerdown", down);
		box.removeEventListener("pointermove", move);
		box.removeEventListener("pointerup", up);
		box.removeEventListener("pointercancel", up);
		document.removeEventListener("keydown", esc, true);
		bar.remove();
		box.classList.remove("moving");
		if (keep && Math.round(pos) !== Math.round(start)) setHomeBanner({ banner_position: Math.round(pos) });
		else show(start);
	}
	box.addEventListener("pointerdown", down);
	box.addEventListener("pointermove", move);
	box.addEventListener("pointerup", up);
	box.addEventListener("pointercancel", up);
	document.addEventListener("keydown", esc, true);
	cancel.addEventListener("click", () => finish(false));
	save.addEventListener("click", () => finish(true));
}

function drawHomeBanner(banner, file) {
	const box = $("homeBanner");
	const src = banner && tileImage(banner.ref, file);
	box.replaceChildren();
	box.classList.toggle("empty", !src);
	box.hidden = false;
	if (!src) {
		const add = Object.assign(document.createElement("button"), { type: "button", className: "home-banner-add", textContent: "+ Add a banner" });
		add.addEventListener("click", () => pickHomeBanner(null));
		box.append(add);
		return;
	}
	const bar = document.createElement("div");
	bar.className = "home-banner-bar";
	const btn = (text, run) => { const b = Object.assign(document.createElement("button"), { type: "button", textContent: text }); b.addEventListener("click", run); bar.append(b); };
	const img = document.createElement("img");
	img.alt = "";
	img.decoding = "async";
	img.draggable = false;
	img.referrerPolicy = "no-referrer";
	img.style.objectPosition = `center ${banner.position}%`;
	img.addEventListener("error", () => { box.hidden = true; });
	Promise.resolve(src).then((u) => { img.src = u; }, () => { box.hidden = true; });
	btn("Change", () => pickHomeBanner(banner.ref));
	btn("Reposition", () => repositionHomeBanner(box, img, banner.position));
	btn("Remove", () => setHomeBanner({ banner: null, banner_position: null }));
	box.append(img, bar);
}

let homeKey = null;
function renderHome(force = false) {
	if (!editor || editor.path) return;
	renderHomeBoards();
	const list = pins(), paths = visible().map((n) => n.path), file = homeFile();
	// Redraw only when something a tile shows changed (a sync redraws the
	// sidebar often; the pictures would flicker).
	const banner = homeBanner();
	const key = JSON.stringify([list, banner, paths.length, attachments.length, list.map((p) => { const q = pinPath(p, paths, file); return q && notes.get(q)?.text?.slice(0, 1500); })]);
	if (!force && key === homeKey) return;
	homeKey = key;
	drawHomeBanner(banner, file);
	drawHome($("homeGrid"), {
		pins: list, homeFile: file, paths,
		text: (p) => { const n = notes.get(p); return n && !n.binary ? n.text : null; },
		image: tileImage,
		open: openPin,
		menu: tileMenu,
		add: addTile,
		reorder: (from, to) => {
			const next = pins();
			const [moved] = next.splice(from, 1);
			next.splice(to, 0, moved);
			savePins(next);
		},
	});
}

// Boards under Home's tiles: the ```board blocks in _wr1t3r/Home Boards.md
// (beside Home.md, out of the notes list), shown in a live editor the way
// Scrivenings shows a note, so the boards work in full. "Add a board" picks
// the folder it shows and adds one; the note is made the first time.
let homeBoards = null; // { path, ed }
const homeBoardsPath = () => homeFile().replace(/[^/]*$/, "Home Boards.md");

function renderHomeBoards() {
	const box = $("homeBoards");
	if (!box) return;
	const path = homeBoardsPath(), n = notes.get(path);
	const note = n && !n.deleted && !n.binary && /```(board|base|wr1t3r-tasks)\b/i.test(n.text) ? n : null;
	if (homeBoards && (!note || homeBoards.path !== path)) { homeBoards.ed.destroy(); homeBoards = null; box.replaceChildren(); }
	if (!box.firstChild) {
		const head = document.createElement("div");
		head.className = "home-boards-head";
		const addList = Object.assign(document.createElement("button"), { type: "button", className: "home-boards-add", textContent: "+ Add a list" });
		addList.addEventListener("click", () => pickList((tag) => appendHomeBlock("```wr1t3r-tasks\nlist: " + tag + "\n```\n")));
		const add = Object.assign(document.createElement("button"), { type: "button", className: "home-boards-add", textContent: "+ Add a board" });
		add.addEventListener("click", addHomeBoard);
		head.append(Object.assign(document.createElement("h2"), { textContent: "Boards & lists" }), addList, add);
		const body = document.createElement("div");
		body.className = "home-boards-body scriv-body";
		box.append(head, body);
	}
	box.classList.toggle("empty", !note);
	if (!note) return;
	if (!homeBoards) {
		homeBoards = { path, ed: editor.section(box.querySelector(".home-boards-body"), note, { edits: (text) => onEdit(path, text), focus: () => {}, edge: () => false }) };
	} else if (!note.dirty && note.text !== homeBoards.ed.text()) homeBoards.ed.replace(note);
}

// A block added at the end of Home's boards note (made the first time).
async function appendHomeBlock(block) {
	const path = homeBoardsPath();
	await change(path, (cur) => {
		const text = cur && !cur.deleted ? cur.text.replace(/\s*$/, "\n\n") + block : block;
		return { ...(cur || { path, base: null }), path, text, dirty: true, deleted: false };
	});
	renderHomeBoards();
	requestAnimationFrame(() => $("homeBoards")?.lastElementChild?.lastElementChild?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
	scheduleSync();
}

// Picks a list for a new list card: the vault's lists (the tags its checkbox
// items use, the task lists first), or a new one by name. then(tag).
function pickList(then) {
	const texts = {};
	for (const n of visible()) if (!n.binary && !archivedNote(n)) texts[n.path] = n.text;
	const used = itemTags(texts);
	const tags = [...TASK_TAGS, ...used.map((x) => x.tag).filter((t) => !TASK_TAGS.includes(t))].slice(0, 30);
	const count = (t) => used.find((x) => x.tag === t)?.count || 0;
	openPalette({
		placeholder: "Which list? Pick one, or type a new list's name…",
		items: tags.map((t) => ({ label: listName(t), detail: `#${t} · ${count(t)} item${count(t) === 1 ? "" : "s"}`, keywords: t, run: () => then(t) })),
		empty: (q) => ({ label: `New list “${q.trim()}”`, detail: `#${tagFor(q)}`, run: () => { const t = tagFor(q); if (t) then(t); } }),
	});
}

// "Insert list" (/list): a list card at the cursor.
function insertList() {
	const view = editor.view;
	if (!view || !editor.path || view.state.readOnly) return;
	pickList((tag) => {
		const { state } = view, head = state.selection.main.head, line = state.doc.lineAt(head);
		const at = line.text.trim() ? line.to : line.from;
		const text = `${line.text.trim() ? "\n\n" : ""}\`\`\`wr1t3r-tasks\nlist: ${tag}\n\`\`\`\n`;
		view.dispatch({ changes: { from: at, to: at, insert: text }, selection: { anchor: at + text.length }, scrollIntoView: true });
		view.focus();
	});
}

function addHomeBoard() {
	const list = visible(), home = commonFolder(list);
	const folders = new Set();
	for (const n of list) {
		const parts = n.path.split("/").slice(0, -1);
		for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/") + "/");
	}
	const all = [...folders].filter((f) => f.startsWith(home) && f !== home && !isAppFile(f))
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
	const make = (folder) => {
		const f = folder.replace(/\/+$/, "");
		const texts = list.filter((n) => n.path.startsWith(folder) && /\.md$/i.test(n.path) && !n.binary).slice(0, 200).map((n) => n.text);
		const title = folder ? itemLabel(folder) : "Every note";
		appendHomeBlock("```board\n" + `wr1t3r:\n  title: ${JSON.stringify(title)}\n` + starterBase(f, texts).replace(/\n$/, "") + "\n```\n");
	};
	openPalette({
		placeholder: "Which notes should the board show?",
		items: [
			...all.map((f) => ({ label: folderLabel(f), detail: "folder", run: () => make(f) })),
			{ label: "Every note", detail: "vault", keywords: "all whole", run: () => make("") },
		],
	});
}

// Aa > Home: the pins as a list, each with its tile menu, plus adding a tile
// and opening the Home note itself (it isn't in the notes list).
function renderHomeSettings() {
	const box = $("homePins");
	if (!box || $("settings").hidden) return;
	const list = pins(), paths = visible().map((n) => n.path), file = homeFile();
	box.replaceChildren();
	const ordinal = tileOrdinals(list);
	list.forEach((pin, i) => {
		if (isSection(pin)) {
			const row = document.createElement("button");
			row.type = "button";
			row.className = "home-pin home-pin-section";
			row.title = "Rename, move or remove this section";
			row.textContent = String(pin.section);
			row.addEventListener("click", (e) => { e.stopPropagation(); const r = row.getBoundingClientRect(); tileMenu(i, r.left + 12, r.bottom + 2); });
			onMenu(row, (x, y) => tileMenu(i, x, y));
			box.append(row);
			return;
		}
		const k = pinKind(pin.link);
		const path = k.kind === "note" ? pinPath(pin, paths, file) : null;
		const row = document.createElement("button");
		row.type = "button";
		row.className = "home-pin";
		row.style.setProperty("--tc", pinColor(pin, ordinal[i]));
		row.title = "Change, move or unpin this tile";
		const what = { note: isBoardPath(path || k.target || "") ? "board" : "note", folder: "corkboard", view: k.view === "outliner" ? "outline" : k.view === "scrivenings" ? "one document" : k.view, command: "command", url: "web page" }[k.kind];
		const nm = document.createElement("span");
		nm.textContent = pinTitle(pin, path);
		const kind = document.createElement("small");
		kind.textContent = what;
		row.append(nm, kind);
		row.addEventListener("click", (e) => { e.stopPropagation(); const r = row.getBoundingClientRect(); tileMenu(i, r.left + 12, r.bottom + 2); });
		onMenu(row, (x, y) => tileMenu(i, x, y));
		box.append(row);
	});
	if (!list.length) box.append(Object.assign(document.createElement("p"), { className: "hint", textContent: "Nothing pinned yet." }));
}

// Aa > Templates: the vault's templates (out of the notes list), each opening
// a menu to open, rename or delete it.
function renderTemplateSettings() {
	const box = $("templateList");
	if (!box || $("settings").hidden) return;
	box.replaceChildren();
	for (const t of vaultTemplates()) {
		const row = document.createElement("button");
		row.type = "button";
		row.className = "home-pin template-row";
		row.title = "Open, rename or delete this template";
		const nm = document.createElement("span");
		nm.textContent = t.name;
		row.append(nm);
		const menu = (x, y) => showMenu([
			["Open", () => { openSettings(false); openNote(t.path); }],
			["Rename…", () => renameItem(t.path)],
			["Delete", () => removeNote(t.path), "danger"],
		], x, y);
		row.addEventListener("click", (e) => { e.stopPropagation(); const r = row.getBoundingClientRect(); menu(r.left + 12, r.bottom + 2); });
		onMenu(row, menu);
		box.append(row);
	}
	if (!box.childElementCount) box.append(Object.assign(document.createElement("p"), { className: "hint", textContent: "No templates yet." }));
}

// A new, empty template in the folder the others are in.
function newTemplate() {
	const list = visible();
	openSettings(false);
	newNote(templatesFolder(list.map((n) => n.path), commonFolder(list)) + "Untitled.md");
}

async function editHomeNote() {
	if (homeText() == null) await savePins(pins());
	openSettings(false);
	openNote(homeFile());
}

function openPin(pin, path) {
	const k = pinKind(pin.link);
	if (k.kind === "url") return void window.open(k.url, "_blank", "noopener");
	if (k.kind === "note") return path ? openNote(path) : toast(`There's no note at “${k.target}” any more.`);
	// A pinned folder opens as a corkboard; an outliner: or scrivenings: pin as that.
	if (k.kind === "folder" || k.kind === "view") return openFolderView(k.folder, k.kind === "view" ? k.view : "corkboard");
	const c = allCommands().find((x) => x.label.toLowerCase() === k.command.toLowerCase());
	if (!c) return toast(`There's no command called “${k.command}”.`);
	if (c.needsNote) return toast(`“${c.label}” needs a note open.`);
	c.run();
}

// A folder tile: the folder, opened and in view, in the notes list.
function revealFolder(folder) {
	if (!visible().some((n) => n.path.toLowerCase().startsWith(folder.toLowerCase()))) return toast(`There's no folder “${folderLabel(folder)}” any more.`);
	$("filter").value = "";
	for (let i = folder.indexOf("/"); i >= 0; i = folder.indexOf("/", i + 1)) openFolders.add(folder.slice(0, i + 1));
	writeJSON(OPEN_KEY, [...openFolders]);
	renderTree();
	showSidebar();
	const row = [...$("tree").querySelectorAll("summary")].find((s) => s.dataset.item?.toLowerCase() === folder.toLowerCase());
	if (row) {
		row.scrollIntoView({ block: "center" });
		row.classList.add("flash");
		setTimeout(() => row.classList.remove("flash"), 1200);
	}
}

// Asks for a section's name; null when cancelled or left empty.
function askSection(now = "") {
	const t = prompt("Section name:", now);
	return t == null || !t.trim() ? null : t.trim();
}

// Where tiles live: Home's pins, or a note's cards block (src/cardsblock.js).
const homeStore = { list: () => pins(), save: (list) => savePins(list), home: true };

function tileMenu(i, x, y, store = homeStore) {
	const list = store.list(), pin = list[i];
	if (!pin) return;
	const savePins = store.save; // this list's, not always Home's
	const set = (patch) => savePins(list.map((p, j) => (j === i ? clean({ ...p, ...patch }) : p)));
	const move = (to) => { const next = [...list]; next.splice(i, 1); next.splice(to, 0, pin); savePins(next); };
	const startSection = () => { const t = askSection(); if (t) savePins([...list.slice(0, i), { section: t }, ...list.slice(i)]); };
	if (isSection(pin)) {
		return showMenu([
			["Rename…", () => { const t = askSection(String(pin.section)); if (t) set({ section: t }); }],
			...(i > 0 ? [["Move earlier", () => move(i - 1)]] : []),
			...(i < list.length - 1 ? [["Move later", () => move(i + 1)]] : []),
			["Remove section (keeps its tiles)", () => savePins(list.filter((_, j) => j !== i)), "danger"],
		], x, y);
	}
	const k = pinKind(pin.link);
	const views = k.kind === "folder" || k.kind === "view"
		? [["corkboard", "Open as corkboard"], ["outliner", "Open as outline"], ["scrivenings", "Open as one document"]]
			.filter(([v]) => v !== (k.kind === "view" ? k.view : "corkboard"))
			.map(([v, label]) => [label, () => set({ link: v === "corkboard" ? folderLink(k.folder) : viewLink(v, k.folder) })])
		: [];
	showMenu([
		...views,
		...(views.length ? [["Show in the notes list", () => revealFolder(k.folder)]] : []),
		["Color…", () => colorMenu(pin, set, x, y)],
		["Cover…", () => pickCover(pin, set)],
		["Rename…", () => {
			const t = prompt("Tile name (empty for the usual one):", pin.title ?? "");
			if (t != null) set({ title: t.trim() || null });
		}],
		...(i > 0 ? [["Move earlier", () => move(i - 1)]] : []),
		...(i < list.length - 1 ? [["Move later", () => move(i + 1)]] : []),
		["Start a section here…", startSection],
		[store.home ? "Unpin" : "Remove card", () => savePins(list.filter((_, j) => j !== i)), "danger"],
	], x, y);
}

// Cards blocks in notes use Home's tiles, menus and picker.
setCardsHost({
	paths: () => visible().map((n) => n.path),
	text: (p) => { const n = notes.get(p); return n && !n.binary ? n.text : null; },
	image: (ref, from) => tileImage(ref, from),
	open: (pin, path) => openPin(pin, path),
	menu: (store, i, x, y) => tileMenu(i, x, y, store),
	add: (store) => addTile(store),
});

// Planner blocks: the day's health note (made the way Today makes it, from
// _templates/Daily Health.md, when it isn't there yet) and calendar events.
setPlannerHost({
	async healthNote(dailyPath) {
		const path = healthPathFor(dailyPath);
		const have = visible().find((n) => n.path.toLowerCase() === path.toLowerCase());
		if (have) return have.path;
		const title = name(path), date = noteDay(dailyPath) || new Date();
		const t = findTemplate(visible().map((n) => n.path), "_templates/Daily Health.md");
		const text = t ? renderTemplate(notes.get(t.path).text, { title, date }).text
			: `---\ntitle: Daily Health\ndate: "${isoDate(date)}"\n---\n\n## Nutrition Log\n${MEALS.map((m) => `### ${m}\n- \n`).join("")}\n## ${WATER.parent}\n### ${WATER.heading}\n- \n\n## ${MOOD.heading}\n- \n`;
		await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
		renderTree();
		scheduleSync();
		return path;
	},
	async events(date) {
		if (!readRaw(DAILY_CAL_KEY)) {
			openSettings(true, "tasks");
			toast("Pick a calendar under Timeline calendar first.");
			return null;
		}
		return timelineEvents(date);
	},
	image: (ref, from) => tileImage(ref, from),
	open: (path) => openNote(path),
	toast: (text) => toast(text),
	usda: (q) => api.usdaSearch(q),
});

// Drops keys set to nothing, so they come out of the file.
const clean = (p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && v !== ""));

// The theme's seven rainbow colors, and Auto (the tile's place in the grid).
function colorMenu(pin, set, x, y) {
	showMenu([(close) => {
		const row = document.createElement("div");
		row.className = "swatches";
		row.setAttribute("role", "group");
		row.setAttribute("aria-label", "Tile color");
		const now = Number(pin.color);
		for (const n of [0, 1, 2, 3, 4, 5, 6, 7]) {
			const b = document.createElement("button");
			b.type = "button";
			b.className = "swatch" + (n ? "" : " auto");
			if (n) b.style.setProperty("--sw", `var(--f${n})`);
			b.setAttribute("aria-label", n ? `Color ${n}` : "Auto");
			b.title = n ? `Color ${n}` : "Auto (next in the rainbow)";
			b.setAttribute("aria-pressed", String(n ? now === n : !(now >= 1 && now <= 7)));
			b.addEventListener("click", () => { close(); set({ color: n || null }); });
			row.append(b);
		}
		return row;
	}], x, y);
}

// Cover: the note's own, none, a web image, or any image in the vault.
function pickCover(pin, set) {
	const k = pinKind(pin.link);
	const images = attachments.filter((f) => attachmentKind(f.path) === "image").map((f) => f.path);
	const nameOf = (p) => p.split("/").pop();
	const items = [
		...(k.kind === "note" ? [{ label: "Use the note's cover", detail: "cover or banner property", run: () => set({ cover: null }) }] : []),
		{ label: "No picture", detail: "color only", run: () => set({ cover: "none" }) },
		{ label: "Web image…", detail: "paste an https address", run: () => {
			const u = (prompt("Image address (https://…):", /^https:/.test(pin.cover || "") ? pin.cover : "") || "").trim();
			if (!u) return;
			if (!/^https:\/\/\S+$/i.test(u)) return toast("That needs to be an https:// address.");
			set({ cover: u });
		} },
		...images.map((p) => ({
			label: nameOf(p), detail: p.slice(0, -nameOf(p).length - 1).replace(/^content\//, ""), keywords: p,
			run: () => set({ cover: `[[${images.filter((q) => nameOf(q).toLowerCase() === nameOf(p).toLowerCase()).length > 1 ? p : nameOf(p)}]]` }),
		})),
	];
	openPalette({ placeholder: images.length ? "Tile picture: pick a vault image or an option…" : "Tile picture…", items });
}

// The + tile: pin a note, a folder, a command, or a web page (to Home, or to
// a note's cards block).
function addTile(store = homeStore) {
	if (typeof store?.list !== "function") store = homeStore;
	const list = visible(), paths = list.map((n) => n.path), home = commonFolder(list), file = store.home ? homeFile() : editor.path;
	const have = store.list();
	const addPin = (pin, label) => {
		if (store.home) return addPinHome(pin, label);
		store.save([...store.list(), pin]);
		toast(`Added “${label}”.`);
	};
	const pinItem = (item) => (store.home ? pinItemHome(item) : addPin({ link: item.endsWith("/") ? folderLink(item) : linkFor(item, paths) }, itemLabel(item)));
	const pinned = (item) => have.some((p) => pinOpens(p, pinTarget(item), paths, file));
	const notesIn = list.filter((n) => !n.binary && !isAppFile(n.path)).map((n) => n.path);
	const order = [...recent.filter((p) => notesIn.includes(p)), ...notesIn.filter((p) => !recent.includes(p))];
	const folders = new Set();
	for (const p of paths) {
		const parts = p.split("/").slice(0, -1);
		for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/") + "/");
	}
	const webLink = (u) => {
		u = u.trim();
		if (!/^https?:\/\//i.test(u)) u = "https://" + u;
		try { new URL(u); } catch { return toast("That isn't a web address."); }
		const title = prompt("Tile name:", new URL(u).hostname.replace(/^www\./, ""));
		if (title == null) return;
		addPin(clean({ link: u, title: title.trim() || null }), title.trim() || u);
	};
	const items = [
		{ label: "Web page…", detail: "link", keywords: "url https website", run: () => { const u = prompt("Web page address:"); if (u) webLink(u); } },
		{ label: "Section header…", detail: "a label over the tiles after it", keywords: "section header heading group label divider", run: () => { const t = askSection(); if (t) { store.save([...store.list(), { section: t }]); toast(`Added the section “${t}”; tiles added after it go under it.`); } } },
		...order.filter((p) => !pinned(p)).map((p) => ({ label: name(p), detail: folderOf(p) || "note", keywords: folderOf(p), run: () => pinItem(p) })),
		...[...folders].filter((f) => f !== home && f.startsWith(home) && !pinned(f) && !isAppFile(f)).sort()
			.map((f) => ({ label: folderLabel(f), detail: "folder", keywords: "folder", run: () => pinItem(f) })),
		...allCommands().filter((c) => !c.needsNote && !c.editor)
			.map((c) => ({ label: c.label, detail: "command", keywords: "command " + (c.keywords || ""), run: () => addPin({ link: "command:" + c.label }, c.label) })),
	];
	openPalette({
		placeholder: store.home ? "Pin to Home: a note, folder, command or web page…" : "Add a card: a note, folder, command or web page…",
		items,
		empty: (q) => (/^(https?:\/\/|www\.)\S+$|^\S+\.[a-z]{2,}(\/\S*)?$/i.test(q.trim()) ? { label: `Web page “${q.trim()}”`, detail: "link", run: () => webLink(q) } : null),
	});
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
		a.style.setProperty("--fc", `var(--f${tagHue(t) + 1})`); // the tag's pill color
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
// A tab is a note's path, or "folder:<folder>/" for a folder's corkboard,
// outliner or scrivenings.
const FOLDER_TAB = "folder:";
const isFolderTab = (p) => typeof p === "string" && p.startsWith(FOLDER_TAB);
const folderExists = (f) => { const lf = f.toLowerCase(); return visible().some((n) => n.path.toLowerCase().startsWith(lf)); };
const tabOpen = (p) => (isFolderTab(p) ? folderExists(p.slice(FOLDER_TAB.length)) : isOpenable(p));
const tabName = (p) => (isFolderTab(p) ? p.slice(FOLDER_TAB.length).replace(/\/+$/, "").split("/").pop() || "Folder" : name(p));
let folderTab = null; // the folder tab showing, or null
const activeTab = () => editor.path || folderTab;

function addTab(path, replace) {
	if (tabs.includes(path)) return;
	const at = tabs.indexOf(activeTab());
	if (replace && at >= 0) tabs[at] = path;
	else tabs.splice(at >= 0 ? at + 1 : tabs.length, 0, path);
	while (tabs.length > MAX_TABS) tabs.splice(tabs.findIndex((p) => p !== path), 1);
	saveTabs();
}

function closeTab(path) {
	const at = tabs.indexOf(path);
	if (at >= 0) { tabs.splice(at, 1); saveTabs(); }
	if (path !== activeTab()) return renderTabs();
	const next = tabs.slice(Math.max(0, at)).concat(tabs.slice(0, Math.max(0, at)).reverse()).find(tabOpen);
	openNote(next || null, { tab: false });
}

function renderTabs() {
	const strip = $("tabs"), current = $("tab");
	const shown = tabs.filter((p) => tabOpen(p) || p === activeTab());
	strip.replaceChildren();
	for (const p of shown) {
		if (p === editor.path) { strip.append(current); continue; }
		const t = document.createElement("div");
		const here = p === folderTab;
		t.className = "other" + (notes.get(p)?.dirty ? " dirty" : "") + (isFolderTab(p) ? " folder-tab" : "") + (here ? " current" : "");
		t.setAttribute("role", "tab");
		t.setAttribute("aria-selected", String(here));
		t.title = isFolderTab(p) ? folderLabel(p.slice(FOLDER_TAB.length)) : p;
		const b = document.createElement("button");
		b.type = "button";
		b.className = "name quiet";
		b.textContent = tabName(p);
		b.addEventListener("click", () => openNote(p, { tab: false }));
		const x = document.createElement("button");
		x.type = "button";
		x.className = "x quiet";
		x.textContent = "×";
		x.setAttribute("aria-label", `Close ${tabName(p)}`);
		x.addEventListener("click", () => closeTab(p));
		t.addEventListener("auxclick", (e) => { if (e.button === 1) { e.preventDefault(); closeTab(p); } });
		t.append(b, x);
		strip.append(t);
	}
	if (!shown.includes(editor.path)) strip.append(current);
	const pick = $("tabPick");
	$("tabPickWrap").hidden = shown.length < 2;
	$("tabCount").textContent = shown.length;
	pick.replaceChildren(...shown.map((p) => Object.assign(document.createElement("option"), { value: p, textContent: tabName(p), selected: p === activeTab() })));
	requestAnimationFrame(() => (folderTab ? strip.querySelector(".current") : current)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }));
	renderRefPick();
}

// The vault's property types ({ name: type }, chosen from a property's menu in
// the properties box), in _wr1t3r/Property Types.md beside the Home note so
// they sync like any note.
const typesFile = () => homeFile().replace(/[^/]*$/, "Property Types.md");
// Properties the rest of the vault keeps as lists count as lists too, unless
// a type was chosen for them (listKeys in src/properties.js).
let typesCache = { text: undefined, types: {} };
let listCache = { at: -1, types: {} };
function propertyTypes() {
	const text = notes.get(typesFile())?.deleted ? null : notes.get(typesFile())?.text ?? null;
	if (text !== typesCache.text) typesCache = { text, types: readTypes(text) };
	if (listCache.at !== vaultStamp) listCache = { at: vaultStamp, types: listKeys([...notes.values()].filter((n) => !n.deleted && !n.binary).map((n) => n.text)) };
	return { ...listCache.types, ...typesCache.types };
}
// Every property name and value in the vault with how many notes use it,
// for the properties box's suggestions (propertyUsage in src/properties.js).
let usageCache = { at: -1, usage: null };
function propertyUsageNow() {
	if (usageCache.at !== vaultStamp) usageCache = { at: vaultStamp, usage: propertyUsage([...notes.values()].filter((n) => !n.deleted && !n.binary).map((n) => n.text)) };
	return usageCache.usage;
}
async function setPropertyType(key, type) {
	if (propertyTypes()[key] === type) return;
	const path = typesFile();
	await change(path, (cur) => {
		const text = cur && !cur.deleted ? cur.text : null;
		return { ...(cur || { path, base: null }), path, text: writeTypes(text, { ...readTypes(text), [key]: type }), dirty: true, deleted: false };
	});
	scheduleSync();
}

// opts.replace: show it in the current tab (links); opts.tab: false to leave the tabs as they are.
// Recently opened notes, newest first, for the quick switcher.
const RECENT_KEY = "wr1t3r-recent";
let recent = readJSON(RECENT_KEY, []);

function openNote(path, { replace = false, tab = true } = {}) {
	if (isFolderTab(path)) return openFolderView(path.slice(FOLDER_TAB.length), null, { tab });
	if (folderTab) closeFolderView();
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
	renderFolderNav();
	refreshCount(true);
	renderHome();
	applyTracking();
	applyPageView();
	if (has) sortOnOpen(path);
}

// ---- page layout -----------------------------------------------------------
// Page view and Page setup (src/pageview.js, src/pagelayout.js), per device.
// Printing and exports use the same page.
let pageSetupNow = readSetup(readJSON("wr1t3rPage", null));
setPageSetup(pageSetupNow);
const pageViewOn = () => readRaw("wr1t3rPageView") === "on";
// Page layout is a setting (Settings > Writing, off to start): off, notes
// show as usual and the toolbar has no page button; Page setup still sets
// the page printing and exports use.
function applyPageView() {
	const view = editor?.view, on = pageViewOn();
	if (view && (isPageView(view) !== on || on)) setPageView(view, on, { ...pageSetupNow, title: editor.path ? editor.path.split("/").pop().replace(/\.md$/i, "") : "" });
	$("app").classList.toggle("no-pages", !on);
	toolbarUi?.refreshPage(on);
	if ($("pageSeg")) {
		markSeg("pageSeg", on);
		$("pageSize").value = pageSetupNow.size;
		$("pageOrient").value = pageSetupNow.orient;
		$("pageMargin").value = pageSetupNow.margin;
		if (document.activeElement !== $("pageHeader")) $("pageHeader").value = pageSetupNow.header;
		if (document.activeElement !== $("pageFooter")) $("pageFooter").value = pageSetupNow.footer;
	}
}
function togglePageView(on = !pageViewOn()) {
	storeRaw("wr1t3rPageView", on ? "on" : null);
	applyPageView();
	toast(on ? "Page layout on: notes show on pages. Paper and margins are in the toolbar's page menu and Settings > Writing." : "Page layout off.", 3000);
}
function changePageSetup(patch) {
	pageSetupNow = readSetup({ ...pageSetupNow, ...patch });
	writeJSON("wr1t3rPage", pageSetupNow);
	setPageSetup(pageSetupNow);
	applyPageView();
}
function setupPageSettings() {
	for (const [k, v] of Object.entries(SIZES)) $("pageSize").append(new Option(v.label, k));
	for (const [k, v] of Object.entries(MARGINS)) $("pageMargin").append(new Option("Margins: " + v.label, k));
	$("pageSeg").addEventListener("click", (e) => {
		const b = e.target.closest("button");
		if (b) togglePageView(b.dataset.on === "true");
	});
	$("pageSize").addEventListener("change", (e) => changePageSetup({ size: e.target.value }));
	$("pageOrient").addEventListener("change", (e) => changePageSetup({ orient: e.target.value }));
	$("pageMargin").addEventListener("change", (e) => changePageSetup({ margin: e.target.value }));
	let typing;
	for (const [id, key] of [["pageHeader", "header"], ["pageFooter", "footer"]]) {
		$(id).addEventListener("input", (e) => { clearTimeout(typing); typing = setTimeout(() => changePageSetup({ [key]: e.target.value }), 300); });
		$(id).addEventListener("change", (e) => { clearTimeout(typing); changePageSetup({ [key]: e.target.value }); });
	}
	applyPageView();
}
// The toolbar's Page layout menu.
function pageMenu(view, btn) {
	const r = btn.getBoundingClientRect();
	const tick = (on) => (on ? "✓ " : "\u2003");
	dropMenu([
		[tick(pageViewOn()) + "Page layout", () => togglePageView()],
		null,
		...Object.entries(SIZES).map(([k, v]) => [tick(pageSetupNow.size === k) + v.label, () => changePageSetup({ size: k })]),
		null,
		[tick(pageSetupNow.orient === "portrait") + "Portrait", () => changePageSetup({ orient: "portrait" })],
		[tick(pageSetupNow.orient === "landscape") + "Landscape", () => changePageSetup({ orient: "landscape" })],
		null,
		...Object.entries(MARGINS).map(([k, v]) => [tick(pageSetupNow.margin === k) + "Margins: " + v.label, () => changePageSetup({ margin: k })]),
		null,
		["\u2003Header and footer…", () => { openSettings(true, "writing"); $("pageHeader").focus(); }],
	], r.left, r.bottom + 4);
}

// ---- track changes ---------------------------------------------------------
// Which notes are tracking their changes (src/trackview.js), per device.
const TRACK_KEY = "wr1t3r-tracking";
let trackedNotes = new Set(readJSON(TRACK_KEY, []));
function applyTracking() {
	const on = !!editor?.path && trackedNotes.has(editor.path);
	if (editor?.view && isTracking(editor.view) !== on) setTracking(editor.view, on);
	toolbarUi?.refreshReview(on);
}
function toggleTracking(on = !trackedNotes.has(editor.path)) {
	if (!editor.path) return;
	on ? trackedNotes.add(editor.path) : trackedNotes.delete(editor.path);
	writeJSON(TRACK_KEY, [...trackedNotes]);
	applyTracking();
	toast(on ? "Tracking changes: new text is underlined, deleted text struck through." : "Stopped tracking changes. The changes already marked stay until you accept or reject them.", 3500);
}
function reviewAll(accept) {
	const view = activeView();
	const n = resolveEvery(view, accept);
	toast(n ? `${accept ? "Accepted" : "Rejected"} ${n} change${n === 1 ? "" : "s"}.` : "No changes to review.", 2500);
}
// The toolbar's Review menu.
function reviewMenu(view, btn) {
	const r = btn.getBoundingClientRect();
	const n = countChanges(view);
	dropMenu([
		[(isTracking(view) ? "✓ " : "\u2003") + "Track changes", () => toggleTracking()],
		[(isFinalView(view) ? "✓ " : "\u2003") + "Show as final (hide changes)", () => setFinalView(view, !isFinalView(view))],
		null,
		["Next change", () => gotoChange(view, 1) || toast("No changes in this note.")],
		["Previous change", () => gotoChange(view, -1) || toast("No changes in this note.")],
		["Accept change at cursor", () => acceptChange(view) || toast("Put the cursor in a change first.")],
		["Reject change at cursor", () => rejectChange(view) || toast("Put the cursor in a change first.")],
		null,
		["New comment", () => addComment(view)],
		null,
		[`Accept all changes${n ? ` (${n})` : ""}`, () => reviewAll(true)],
		[`Reject all changes${n ? ` (${n})` : ""}`, () => reviewAll(false), "danger"],
	], r.left, r.bottom + 4);
}

// ---- a folder as a manuscript: corkboard, outliner, scrivenings -----------------
//
// A folder's tab shows it one of three ways (remembered per folder on this
// device). Its order is the folder's _Binder.md (src/binder.js); dragging a
// card or a row rewrites that list, and nothing else.

const VIEWS = ["corkboard", "outliner", "scrivenings"];
const VIEWS_KEY = "wr1t3r-folder-views";
let folderViews = readJSON(VIEWS_KEY, {});
let scriv = null; // Scrivenings, while it shows
let focusedSection = null; // { view, path }: the Scrivenings section last typed in

const viewOf = (folder) => (VIEWS.includes(folderViews[folder]) ? folderViews[folder] : "corkboard");
const shownFolder = () => (folderTab ? folderTab.slice(FOLDER_TAB.length) : null);
// A folder's notes and subfolders in order, for the corkboard, outliner,
// Scrivenings and Compile. Archived notes aren't shown (only a search that
// asks for them finds them); fullOrderOf keeps them, for saving the order.
const fullOrderOf = (folder) => binderOrder(folder, visible().map((n) => n.path), dataviewVault.text(binderPath(folder)));
const orderOf = (folder) => binderOrder(folder, visible().filter((n) => !archivedNote(n)).map((n) => n.path), dataviewVault.text(binderPath(folder)));

// The notes either side of the open one in its folder, in the folder's order
// (the sidebar's and the corkboard's), for the ‹ › buttons.
function folderSiblings(path) {
	if (!path || !/\.md$/i.test(path)) return null;
	const folder = path.slice(0, path.lastIndexOf("/") + 1);
	const list = orderOf(folder).filter((it) => it.kind === "note").map((it) => it.path);
	const at = list.indexOf(path);
	return at < 0 || list.length < 2 ? null : { prev: list[at - 1], next: list[at + 1], at, count: list.length };
}

function renderFolderNav() {
	const s = folderSiblings(editor?.path);
	$("folderNav").hidden = !s;
	if (!s) return;
	for (const [id, to, word, n, edge] of [["prevNote", s.prev, "Previous", s.at, "first"], ["nextNote", s.next, "Next", s.at + 2, "last"]]) {
		const b = $(id);
		b.disabled = !to;
		b.querySelector("span").textContent = to ? name(to) : "";
		b.title = to ? `${word}: ${name(to)} (${n} of ${s.count})` : `This is the ${edge} note in the folder`;
		b.setAttribute("aria-label", b.title);
	}
}

// Opens the note before (-1) or after (1) this one, in this tab.
function stepFolder(dir) {
	const s = folderSiblings(editor.path);
	const to = s && (dir < 0 ? s.prev : s.next);
	if (to) openNote(to, { replace: true });
}

// The editor commands act on: a Scrivenings section while one has been typed
// in, else the editor.
function activeView() {
	const s = focusedSection;
	return folderTab && s?.view.dom.isConnected ? s.view : editor.view;
}

// The folder as it's spelled in the vault ("content/novel/" -> "content/Novel/").
function realFolder(folder) {
	const lf = folder.toLowerCase();
	const hit = visible().find((n) => n.path.toLowerCase().startsWith(lf));
	return hit ? hit.path.slice(0, folder.length) : folder;
}

function openFolderView(folder, view = null, { tab = true, replace = false } = {}) {
	if (!folder.endsWith("/")) folder += "/";
	if (!folderExists(folder)) return toast(`There's no folder “${folderLabel(folder)}” any more.`);
	folder = realFolder(folder);
	if (view) { folderViews[folder] = view; writeJSON(VIEWS_KEY, folderViews); }
	const key = FOLDER_TAB + folder;
	if (tab) addTab(key, replace);
	if (folderTab !== key) closeFolderView();
	editor.open(null);
	folderTab = key;
	const main = document.querySelector("main");
	main.classList.remove("has-note");
	main.classList.add("has-folder");
	$("folderView").hidden = false;
	showPath();
	$("path").disabled = true;
	$("delete").disabled = true;
	renderTitle();
	if (location.hash !== "#" + encodeURIComponent(key)) history.replaceState(null, "", "#" + encodeURIComponent(key));
	$("app").classList.remove("menu-open");
	renderFolderView(true);
	renderTree();
	renderTabs();
	renderBookmarkButton();
	refreshCount(true);
}

function closeFolderView() {
	if (!folderTab) return;
	scriv?.destroy();
	scriv = null;
	stopViews();
	focusedSection = null;
	folderTab = null;
	$("fvBody").replaceChildren();
	$("folderView").hidden = true;
	document.querySelector("main").classList.remove("has-folder");
}

// After a folder moved or was renamed: its tabs and settings go with it.
function followFolderTabs(from, to) {
	const move = (f) => (f.startsWith(from) ? to + f.slice(from.length) : f);
	tabs = tabs.map((t) => (isFolderTab(t) ? FOLDER_TAB + move(t.slice(FOLDER_TAB.length)) : t));
	saveTabs();
	folderViews = Object.fromEntries(Object.entries(folderViews).map(([f, v]) => [move(f), v]));
	writeJSON(VIEWS_KEY, folderViews);
	if (folderTab && shownFolder().startsWith(from)) {
		folderTab = FOLDER_TAB + move(shownFolder());
		history.replaceState(null, "", "#" + encodeURIComponent(folderTab));
		renderFolderView(true);
	}
}

// Redraws after a sync or an edit elsewhere (after a pause), unless a card is
// being edited or dragged; Scrivenings only takes in changed text.
let folderTimer;
function folderTouched() {
	if (!folderTab) return;
	clearTimeout(folderTimer);
	folderTimer = setTimeout(() => renderFolderView(false), 300);
}

function renderFolderView(force) {
	if (!folderTab) return;
	const folder = shownFolder();
	if (!folderExists(folder)) return closeTab(folderTab);
	const view = viewOf(folder);
	const body = $("fvBody");
	const host = folderHost(folder);
	renderFolderBar(folder, view, host);
	if (view === "scrivenings") {
		const same = scriv && scriv.folder === folder;
		if (same && !force) {
			const key = scrivKey(folder);
			if (key === scriv.key || scriv.hasFocus()) return scriv.sync();
		}
		const top = same ? body.scrollTop : 0;
		scriv?.destroy();
		stopViews();
		scriv = mountScrivenings(body, scrivHost(folder));
		scriv.folder = folder;
		body.scrollTop = top;
		return;
	}
	if (scriv) { scriv.destroy(); scriv = null; focusedSection = null; }
	if (!force && (document.documentElement.classList.contains("sorting") || body.contains(document.activeElement) && document.activeElement.matches("input, textarea"))) return folderTouched();
	const top = body.dataset.shown === folder + view ? body.scrollTop : 0;
	(view === "outliner" ? drawOutline : drawBoard)(body, host);
	body.dataset.shown = folder + view;
	body.scrollTop = top;
}

const scrivKey = (folder) => {
	const walk = (f) => orderOf(f).flatMap((it) => (it.kind === "folder" ? [it.path, ...walk(it.path)] : [it.path]));
	return walk(folder).join("\n");
};

function renderFolderBar(folder, view, host) {
	const crumbs = $("fvCrumbs");
	crumbs.replaceChildren();
	const root = commonFolder(visible());
	const parts = folder.slice(root.length).split("/").filter(Boolean);
	parts.forEach((part, i) => {
		const f = root + parts.slice(0, i + 1).join("/") + "/";
		if (i) crumbs.append(Object.assign(document.createElement("span"), { className: "sep", textContent: "/" }));
		const b = document.createElement("button");
		b.type = "button";
		b.className = "quiet" + (i === parts.length - 1 ? " here" : "");
		b.textContent = part;
		if (i < parts.length - 1) b.addEventListener("click", () => openFolderView(f, null, { replace: true }));
		else b.addEventListener("click", () => revealFolder(folder));
		b.title = i < parts.length - 1 ? `Show ${part}` : "Show in the notes list";
		crumbs.append(b);
	});
	for (const b of $("fvModes").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.view === view));
	const n = folderWords(folder, host);
	$("fvWords").textContent = `${fmt(n)} word${n === 1 ? "" : "s"}`;
}

function folderHost(folder) {
	return {
		folder,
		order: orderOf,
		text: (p) => dataviewVault.text(p),
		cover: cardCover,
		open: (p) => openNote(p),
		openFolder: (f) => openFolderView(f, null, { replace: true }),
		menu: cardMenu,
		reorder: saveOrder,
		moveInto,
		setProp,
		add: addCard,
	};
}

function scrivHost(folder) {
	return {
		folder,
		order: orderOf,
		note: (p) => { const n = notes.get(p); return n && !n.deleted ? n : null; },
		editor,
		edit: (p, text) => onEdit(p, text),
		open: (p) => openNote(p),
		openFolder: (f) => openFolderView(f, null, { replace: true }),
		focused: (view, path) => { focusedSection = { view, path }; },
	};
}

// A card's picture: the note's cover property (not its banner).
function cardCover(path, text) {
	if (!text || !text.startsWith("---")) return null;
	const { cover } = prettyOf(Text.of(text.split(/\r?\n/)));
	return cover ? tileImage(cover.ref, path) : null;
}

// Saves a folder's order in its _Binder.md (made the first time).
async function saveOrder(folder, items) {
	const path = binderPath(folder), paths = visible().map((n) => n.path);
	// Archived notes keep their places: each goes back in after the item it followed.
	const full = fullOrderOf(folder), shown = new Set(items.map((it) => it.path));
	for (let i = 0; i < full.length; i++) {
		if (shown.has(full[i].path)) continue;
		const after = full.slice(0, i).reverse().find((it) => shown.has(it.path));
		const at = after ? items.findIndex((it) => it.path === after.path) + 1 : 0;
		items = [...items.slice(0, at), full[i], ...items.slice(at)];
		shown.add(full[i].path);
	}
	if (dataviewVault.text(path) != null) await dataviewVault.write(path, (t) => writeBinder(t, items, paths));
	else {
		const text = writeBinder("", items, paths);
		await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
		renderStatus();
		scheduleSync();
	}
	renderTree();
	renderFolderView(true);
}

// A card or row dropped into another folder: moved there, at that place in its order.
async function moveInto(item, folder, at) {
	const map = await moveItem(item, folder);
	if (!map) return renderFolderView(true);
	const moved = item.endsWith("/") ? folder + itemLabel(item) + "/" : map.get(item);
	const order = orderOf(folder);
	const i = order.findIndex((it) => it.path === moved);
	if (i < 0) return renderFolderView(true);
	await saveOrder(folder, reorder(order, i, Math.max(0, Math.min(at, order.length - 1))));
}

async function setProp(path, key, value) {
	await dataviewVault.write(path, (t) => setProperty(t, key, value));
	renderFolderView(true);
}

// A new note in folder, at a place in its order. It stays on the board, so
// several can be jotted down in a row.
async function addCard(folder, at) {
	const input = prompt("New note:", "Untitled");
	if (input == null || !input.trim()) return;
	const nm = input.trim().replace(/\.md$/i, "");
	const path = folder + nm + ".md";
	if (!isNotePath(path) || nm.includes("/")) return toast("That isn't a usable note name.");
	if (taken(path)) return toast(`There's already a note called “${nm}” here.`);
	const text = /(^|\/)_/.test(path) ? "" : newNoteFrontmatter(nm, new Date().toLocaleDateString("en-CA"));
	await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
	scheduleSync();
	const order = orderOf(folder);
	const i = order.findIndex((it) => it.path === path);
	await saveOrder(folder, reorder(order, i, Math.min(at, order.length - 1)));
	toast(`Added “${nm}”.`);
}

function cardMenu(item, x, y, index, what) {
	if (what === "label") return labelMenu(item, x, y);
	const folder = shownFolder();
	if (!folder) return;
	const isFolder = item.endsWith("/");
	const order = orderOf(folder);
	const i = order.findIndex((it) => it.path === item);
	const move = (to) => saveOrder(folder, reorder(order, i, to));
	const info = isFolder ? null : cardInfo(item, dataviewVault.text(item) || "");
	showMenu([
		["Open", () => (isFolder ? openFolderView(item, null, { replace: true }) : openNote(item))],
		...(isFolder ? [] : [
			["Open in Scrivenings", () => { openFolderView(folder, "scrivenings", { tab: false }); scriv?.show(item); }],
			["Label color…", () => labelMenu(item, x, y)],
			["Status…", () => {
				const v = prompt("Status (empty to clear):", info.status);
				if (v != null) setProp(item, "status", v.trim() || null);
			}],
		]),
		...(i > 0 ? [["Move to the top", () => move(0)], ["Move earlier", () => move(i - 1)]] : []),
		...(i >= 0 && i < order.length - 1 ? [["Move later", () => move(i + 1)], ["Move to the bottom", () => move(order.length - 1)]] : []),
		["Rename…", () => renameItem(item)],
		["Move to…", () => moveItemTo(item)],
		[isFolder ? "Delete folder" : "Delete", () => deleteItem(item), "danger"],
	], x, y);
}

// The label color: one of the theme's seven, in the note's `label` property.
function labelMenu(item, x, y) {
	const now = cardInfo(item, dataviewVault.text(item) || "").label;
	colorMenu({ color: now }, ({ color }) => setProp(item, "label", color ?? null), x, y);
}

function folderMore() {
	const folder = shownFolder();
	if (!folder) return;
	const view = viewOf(folder);
	const r = $("fvMore").getBoundingClientRect();
	const paths = visible().map((n) => n.path);
	const pinned = pins().some((p) => pinOpens(p, { folder, view }, paths, homeFile()));
	const bp = binderPath(folder);
	showMenu([
		["New note here", () => addCard(folder, orderOf(folder).length)],
		pinned
			? ["Unpin from Home", () => savePins(pins().filter((p) => !pinOpens(p, { folder, view }, paths, homeFile())))]
			: ["Pin to Home", () => addPin({ link: viewLink(view, folder) }, `${itemLabel(folder)} (${view})`)],
		[dataviewVault.text(bp) != null ? "Open the binder note" : "Save this order as a binder note", async () => {
			if (dataviewVault.text(bp) == null) await saveOrder(folder, orderOf(folder));
			openNote(bp);
		}],
		["Show in the notes list", () => revealFolder(folder)],
	], r.left, r.bottom + 4);
}

// A folder to show or compile: the open note's folder first.
function pickFolder(what) {
	if (what === "compile" && folderTab) return openCompile(shownFolder());
	const list = visible(), home = commonFolder(list);
	const folders = new Set();
	for (const n of list) {
		const parts = n.path.split("/").slice(0, -1);
		for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/") + "/");
	}
	const here = shownFolder() || currentFolder();
	const all = [...folders].filter((f) => f.startsWith(home) && f !== home)
		.sort((a, b) => (b === here) - (a === here) || a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
	openPalette({
		placeholder: what === "compile" ? "Compile which folder?" : `Show which folder as ${what === "corkboard" ? "a corkboard" : what === "outliner" ? "an outline" : "one document"}?`,
		items: all.map((f) => ({ label: folderLabel(f), detail: "folder", run: () => (what === "compile" ? openCompile(f) : openFolderView(f, what)) })),
	});
}

// Compile: the folder's notes in order, as one file (src/compileview.js).
function openCompile(folder) {
	if (!folder.endsWith("/")) folder += "/";
	if (!folderExists(folder)) return toast(`There's no folder “${folderLabel(folder)}”.`);
	folder = realFolder(folder);
	const bp = binderPath(folder);
	const paths = () => visible().map((n) => n.path);
	openCompileDialog({
		folder,
		label: itemLabel(folder),
		parts: () => readingOrder(folder, orderOf),
		text: (p) => dataviewVault.text(p),
		embed: (name) => {
			const p = resolveNote({ note: name, heading: "", wiki: true }, bp, paths());
			const t = p && dataviewVault.text(p);
			return t == null ? null : cleanNote(t);
		},
		settings: () => readBinder(dataviewVault.text(bp) || "").compile,
		async saveSettings(s) {
			if (dataviewVault.text(bp) == null) await saveOrder(folder, orderOf(folder));
			await dataviewVault.write(bp, (t) => writeCompileSettings(t, s));
		},
		async image(name) {
			const path = dataviewVault.resolveAttachment(name, bp);
			const file = path && attachmentKind(path) === "image" && attachments.find((f) => f.path === path);
			return file ? attachmentBlob(file, (p) => remote.attachment(p)) : null;
		},
		async saveToVault(nm, text) {
			const path = ownFolder("compiled") + nm + ".md";
			if (!isNotePath(path)) return toast("That title can't be a note name.");
			if (dataviewVault.text(path) != null) {
				if (!confirm(`Replace “${nm}” in ${folderLabel(ownFolder("compiled"))} with this version?`)) return;
				await dataviewVault.write(path, () => text);
			} else {
				await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
				renderStatus();
				renderTree();
				scheduleSync();
			}
			toast(`Saved “${nm}” in ${folderLabel(ownFolder("compiled"))}.`);
		},
		toast,
	});
}

function setupFolderView() {
	$("fvModes").addEventListener("click", (e) => {
		const b = e.target.closest("button[data-view]");
		const folder = shownFolder();
		if (!b || !folder) return;
		folderViews[folder] = b.dataset.view;
		writeJSON(VIEWS_KEY, folderViews);
		renderFolderView(true);
	});
	$("fvCompile").addEventListener("click", () => shownFolder() && openCompile(shownFolder()));
	$("fvMore").addEventListener("click", (e) => { e.stopPropagation(); folderMore(); });
}

// ---- quick switcher, command palette, templates ----------------------------------

const folderOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")).replace(/^content(\/|$)/, "") : "");

// Ctrl/Cmd+O: jump to a note by name, recent ones first; Enter on a name
// that isn't a note offers to make it.
function quickSwitcher() {
	const all = visible().filter((n) => !n.binary && !isAppFile(n.path)).map((n) => n.path);
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

const vaultTemplates = () => templatesIn(visible().map((n) => n.path));

function templateItems(run) {
	return vaultTemplates().map((t) => ({ label: t.name, detail: "template", run: () => run(t) }));
}

// A new note from any template, named first: in its kind's folder for the
// templates src/newnotes.js knows (Journal, the logs...), else the current note's.
function newFromTemplate() {
	const items = templateItems((t) => {
		const kind = kindForTemplate(t.path);
		if (kind) return newKindNote(kind, { blank: true }); // a template was picked: no lookup
		newNote(currentFolder() + "Untitled.md", (path) => renderFor(t.path, name(path)));
	});
	if (!items.length) return toast("There's no _templates folder in the vault.");
	openPalette({ placeholder: "New note from template…", items });
}

// The template at the cursor; its properties join the note's without changing any.
function insertTemplateAt(t) {
	const view = editor.view;
	if (!editor.path || view.state.readOnly) return toast("Open a note first.");
	const text = view.state.sliceDoc();
	const changes = insertTemplate(text, renderFor(t.path, name(editor.path)), view.state.selection.main.head);
	const body = changes[changes.length - 1];
	view.dispatch({ changes, selection: body ? { anchor: view.state.changes(changes).mapPos(body.from, 1) } : undefined, scrollIntoView: true, userEvent: "input.template" });
	view.focus();
}

function insertFromTemplate() {
	if (!editor.path || editor.view.state.readOnly) return toast("Open a note first.");
	const items = templateItems(insertTemplateAt);
	if (!items.length) return toast("There's no _templates folder in the vault.");
	openPalette({ placeholder: "Insert template…", items });
}

// Each template in the slash menu too: /name inserts it at the cursor.
setSlashExtras(() => [
	{ label: "Transcript", detail: "of a video or audio file", keywords: "transcribe speech speakers video audio", run: () => transcribeIntoNote() },
	{ label: "Voice memo", detail: "record and transcribe here", keywords: "voice memo record microphone dictate audio speech", run: () => voiceMemo() },
	{ label: "Log food", detail: "to the day's health note", keywords: "food eat meal nutrition calories usda", run: () => logFood() },
	{ label: "Board", detail: "grid, gallery, list or kanban of notes", keywords: "base view table database properties filter", run: () => insertBoard() },
	{ label: "List", detail: "a checklist card: tasks, shopping, wishlist…", keywords: "checklist shopping wishlist tasks todo crit", run: () => insertList() },
	...vaultTemplates().map((t) => ({
		label: t.name, detail: "template", keywords: "template " + t.name.toLowerCase(),
		run: () => insertTemplateAt(t),
	})),
]);

// Hotkeys: Obsidian's defaults plus this device's changes (src/hotkeys.js).
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const HOTKEYS_KEY = "wr1t3r-hotkeys";
let keyChanges = readJSON(HOTKEYS_KEY, {});
let keys = bindings(keyChanges);
let capturing = false; // while a new hotkey is being pressed

function searchNotes() {
	showSidebar();
	$("filter").focus();
	$("filter").select();
}

function toggleLivePreview() {
	const live = readRaw("wr1t3rMode") !== "live";
	storeRaw("wr1t3rMode", live ? "live" : null);
	applyMode(live ? "live" : "source");
}

// A transcript of a video or audio file, put in the open note at the cursor
// (src/transcribeview.js).
function transcribeIntoNote() {
	const path = editor.path;
	if (!path || editor.view.state.readOnly) return;
	// In the page while it's open: Safari ignores a click on a detached input.
	const input = Object.assign(document.createElement("input"), { type: "file", accept: "video/*,audio/*", hidden: true });
	document.body.append(input);
	window.addEventListener("focus", () => setTimeout(() => { if (!input.files?.length) input.remove(); }, 1000), { once: true });
	input.addEventListener("change", async () => {
		const file = input.files?.[0];
		input.remove();
		if (!file) return;
		const at = editor.view.state.selection.main.head;
		let md, note = null;
		try {
			md = await transcribeFile(file, api, (t) => { if (note) note.set(t); else note = toast(t, 10 * 60000); });
		} catch (e) {
			note?.close();
			toast(`Couldn't transcribe “${file.name}”: ${e.message}`, 8000);
			return;
		}
		note?.close();
		await insertTranscript(path, at, md, `the transcript of “${file.name}”`);
	});
	input.click();
}

// Puts a transcript in the note at `at`, or at its end if another note was
// opened meanwhile.
async function insertTranscript(path, at, md, what) {
	if (editor.path !== path) {
		await change(path, (cur) => (cur && !cur.deleted ? { ...cur, text: cur.text.replace(/\s*$/, "\n\n") + md, dirty: true } : cur));
		toast(`Added ${what} to the end of ${name(path)}.`, 6000);
		scheduleSync();
		return;
	}
	const view = editor.view, doc = view.state.doc, pos = Math.min(at, doc.length);
	const line = doc.lineAt(pos);
	const before = line.text.trim() ? "\n\n" : pos > 0 && doc.lineAt(Math.max(0, line.from - 1)).text.trim() ? "\n" : "";
	const where = line.text.trim() ? line.to : pos;
	view.dispatch({ changes: { from: where, insert: before + md }, selection: { anchor: where + before.length + md.length }, scrollIntoView: true });
	toast(`Added ${what}.`, 4000);
}

// ---- task reminders (src/reminders.js, worker/push.js) --------------------
// After each sync the page sends every upcoming reminder to the Worker, which
// pushes each one, when it's due, to every device that turned reminders on.
// Only a changed list is sent.
let remindersOff = false; // the Worker hasn't been given its keys yet
async function uploadReminders() {
	if (remindersOff || !navigator.onLine) return;
	const now = Date.now(), list = [];
	for (const n of notes.values()) {
		if (!n || n.deleted || n.binary || !/\.md$/i.test(n.path) || /(^|\/)_templates\//i.test(n.path)) continue;
		const text = n.path === editor.path ? editor.view.state.doc.toString() : n.text;
		for (const r of remindersIn(n.path, text || "")) if (r.at > now - 6 * 3600000) list.push(r);
	}
	list.sort((a, b) => a.at - b.at);
	const body = JSON.stringify(list.slice(0, 1000));
	if (body === readRaw("wr1t3rRemindersSent")) return;
	try {
		await api.putReminders(list.slice(0, 1000));
		storeRaw("wr1t3rRemindersSent", body);
	} catch (e) {
		if (e.status === 501) remindersOff = true;
	}
}

const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
const sameKey = (buf, b64) => !!buf && keyBytes(b64).every((v, i) => new Uint8Array(buf)[i] === v);

// Whether this device has a push subscription, which is what "on" means here.
async function remindersHere() {
	try {
		return !!(await (await navigator.serviceWorker?.getRegistration())?.pushManager?.getSubscription());
	} catch {
		return false;
	}
}
const markReminders = async () => markSeg("remSeg", await remindersHere());

async function turnOnReminders() {
	if (!("serviceWorker" in navigator) || !window.PushManager || !window.Notification) {
		return toast(MAC && /iPhone|iPad/.test(navigator.userAgent) ? "On iPhone, reminders work in wr1t3r on the Home Screen: Share, Add to Home Screen, then open it from there and try again." : "This browser can't show reminders.", 12000);
	}
	try {
		if ((await Notification.requestPermission()) !== "granted") return toast("Notifications are blocked for wr1t3r. Allow them in the browser's settings for this site, then try again.", 10000);
		const key = await api.pushKey();
		const reg = await navigator.serviceWorker.ready;
		let sub = await reg.pushManager.getSubscription();
		if (sub && !sameKey(sub.options?.applicationServerKey, key)) { await sub.unsubscribe(); sub = null; }
		sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
		await api.pushSubscribe(sub.toJSON(), navigator.userAgentData?.platform || navigator.platform || "");
		remindersOff = false;
		storeRaw("wr1t3rRemindersSent", null);
		await uploadReminders();
		await api.pushTest();
		toast("Reminders are on for this device. A test notification is on its way.", 6000);
	} catch (e) {
		if (e.status === 501) remindersOff = true;
		toast("Couldn't turn on reminders: " + e.message, 12000);
	}
	markReminders();
}

async function turnOffReminders() {
	try {
		const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager?.getSubscription();
		if (!sub) return toast("Reminders weren't on for this device.");
		await api.pushUnsubscribe(sub.endpoint).catch(() => {});
		await sub.unsubscribe();
		toast("Reminders are off for this device.");
	} catch (e) {
		toast("Couldn't turn off reminders: " + e.message, 8000);
	}
	markReminders();
}

// "Record a voice memo": records, transcribes, and puts the transcript in the
// open note at the cursor, or in the Inbox when no note is open.
async function voiceMemo() {
	const path = editor.path && !editor.view.state.readOnly ? editor.path : null;
	const at = path ? editor.view.state.selection.main.head : 0;
	const when = stamp();
	let file;
	try { file = await recordVoice("Voice memo " + when.replace(":", ".")); }
	catch (e) { return toast("Couldn't record: " + (e.name === "NotAllowedError" ? "wr1t3r isn't allowed to use the microphone." : e.message), 8000); }
	if (!file) return;
	let md, note = null;
	try {
		md = await transcribeFile(file, api, (t) => { if (note) note.set(t); else note = toast(t, 10 * 60000); }, { heading: `## Voice memo ${when}` });
	} catch (e) {
		note?.close();
		return toast(`Couldn't transcribe the voice memo: ${e.message}`, 8000);
	}
	note?.close();
	if (path) return insertTranscript(path, at, md, "the voice memo");
	await captureToInbox({ text: md.replace(/^## /, "") });
}

// Quick capture: the Worker adds it to the Inbox (so it can't clash with a
// copy of the Inbox this device hasn't synced yet); offline it's added here
// and syncs later.
async function captureToInbox(item) {
	if (!captureEntry(item, "x")) return toast("Nothing to capture.");
	const inbox = ownFolder("inbox");
	// The Worker writes to its own CAPTURE_NOTE, so only when that's where the Inbox is.
	if (navigator.onLine && inbox === INBOX && !onDropbox) {
		try {
			await api.capture(item);
			toast("Sent to the Inbox.", 3000);
			scheduleSync(0);
			return;
		} catch (e) {
			if (e instanceof AuthError) return signOut(SIGNED_OUT);
		}
	}
	const entry = captureEntry(item, stamp());
	await change(inbox, (cur) => ({ base: null, ...cur, path: inbox, text: appendCapture(cur && !cur.deleted ? cur.text : null, entry), dirty: true, deleted: false }));
	renderTree();
	toast("Added to the Inbox.", 3000);
	scheduleSync();
}

function captureCommand() {
	const text = prompt("Capture to the Inbox:");
	if (text?.trim()) captureToInbox({ text });
}

// The phone's share sheet (manifest share_target) opens wr1t3r with
// ?share-title=&share-text=&share-url=.
// Read as the page loads, before opening a note can rewrite the address.
const shared = new URLSearchParams(location.search);
function captureFromShare() {
	if (![...shared.keys()].some((k) => k.startsWith("share-"))) return;
	if (location.search) history.replaceState(null, "", location.pathname + location.hash);
	captureToInbox({ title: shared.get("share-title") || "", text: shared.get("share-text") || "", url: shared.get("share-url") || "" });
}

// "Log food": the planner's Food panel from anywhere, for the open daily or
// health note's day, else today. It writes to that day's health note (made
// from the template if need be), as the planner's button does.
function logFood() {
	const view = editor.view;
	if (!view) return;
	const open = editor.path ? editor.path.replace(/ Health\.md$/i, ".md") : null;
	const paths = visible().map((n) => n.path);
	let daily = open && noteDay(open) ? open : null;
	if (!daily) {
		const tmpl = findTemplate(paths) || findTemplate(paths, "_templates/Daily Health.md");
		const root = tmpl ? tmpl.root : paths.some((p) => p.startsWith("content/")) ? "content/" : "";
		daily = root + DAILY_FOLDER + isoDate(new Date()) + ".md";
	}
	const have = paths.find((p) => p.toLowerCase() === daily.toLowerCase());
	if (have) daily = have;
	const r = view.scrollDOM.getBoundingClientRect();
	const anchor = { getBoundingClientRect: () => ({ left: Math.max(8, r.left + r.width / 2 - 180), bottom: r.top + 8 }) };
	openFoodPanel(view, daily, have ? notes.get(have)?.text : "", anchor);
}

// "Insert board": a ```board block at the cursor, starting as a Grid of the
// note's folder with the properties its notes use most (src/baseconfig.js).
function insertBoard() {
	const view = editor.view, path = editor.path;
	if (!view || !path || view.state.readOnly) return;
	const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
	const texts = visible().filter((n) => n.path.startsWith(folder + "/") && !n.binary).slice(0, 200).map((n) => n.text);
	const body = starterBase(folder, texts).replace(/\n$/, "");
	const { state } = view, head = state.selection.main.head, line = state.doc.lineAt(head);
	const at = line.text.trim() ? line.to : line.from;
	const before = line.text.trim() ? "\n\n" : "";
	const text = `${before}\`\`\`board\n${body}\n\`\`\`\n`;
	// The cursor goes after the block, so it draws as a board straight away.
	view.dispatch({ changes: { from: at, to: at, insert: text }, selection: { anchor: at + text.length }, scrollIntoView: true });
	view.focus();
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
		...NEW_NOTE_KINDS.map((k) => [k.label, () => newKindNote(k), `create template ${k.template.toLowerCase()} ${k.keywords}`]),
		["New board file", () => newBase(), "create database table grid gallery kanban view bases base"],
		["Rename .base files to .board", convertBoards, "convert boards bases obsidian extension"],
		["Clean up properties", cleanUpProperties, "yaml frontmatter properties empty rename merge delete tidy vault"],
		["Insert template", insertFromTemplate, "templater", true],
		["Open today's daily note", () => openDaily(), "today journal daily"],
		["Log food", logFood, "eat meal nutrition calories health usda planner"],
		["Insert board", insertBoard, "grid gallery kanban list table view properties filter database base", true],
		["Insert list", insertList, "checklist shopping wishlist tasks todo crit list card", true],
		["Add calendar events to the timeline", pullTimeline, "pull today's events daily agenda schedule"],
		["Search notes", searchNotes, "find sidebar"],
		["Bookmark this note", () => toggleBookmark(), "star pin unbookmark", true],
		[editor.path && archivedNote({ path: editor.path, text: view.state.doc.toString() }) ? "Unarchive this note" : "Archive this note", toggleArchive, "archive hide remove from list restore unarchive", true],
		["Go home", goHome, "home start pinned tiles grid"],
		["Previous note in this folder", () => stepFolder(-1), "back prev page sibling chapter", true],
		["Next note in this folder", () => stepFolder(1), "forward page sibling chapter", true],
		["Pin this note to Home", () => pinItem(editor.path), "pin home tile", true],
		["Add a tile to Home", addTile, "pin home tile folder command link"],
		["Rename this note", () => { $("path").focus(); }, "move", true],
		["Delete this note", () => removeNote(editor.path), "remove", true],
		["Close this tab", () => closeTab(editor.path), "close", true],
		["Show reference pane", () => showRef(!ref.on), "split side", true],
		["Contents", () => showToc(!tocOpen()), "outline headings toc", true],
		["Toggle left sidebar", () => showLeft(leftShut()), "notes list panel collapse hide show"],
		["Toggle right sidebar", () => showRight(rightShut()), "calendar agenda contents panel collapse hide show"],
		["Toggle focus mode", () => toggleFocus(), "distraction free typewriter zen dim writing mode"],
		["Toggle page layout", () => togglePageView(), "page view print layout pages paper margins word processor"],
		["Track changes", () => toggleTracking(), "track changes revisions review suggest edits criticmarkup", true],
		["Accept all changes", () => reviewAll(true), "track changes review revisions", true],
		["Reject all changes", () => reviewAll(false), "track changes review revisions", true],
		["Next change", () => gotoChange(activeView(), 1), "track changes review", true],
		["New comment", () => addComment(activeView()), "track changes review comment note annotation", true],
		["Look up word", () => lookUpWord(activeView()), "dictionary define definition thesaurus synonym meaning", true],
		["Toggle Live Preview", toggleLivePreview, "markdown symbols hide"],
		["Toggle readable line length", toggleLineLength, "width wide full center column"],
		["Toggle spellcheck", () => toggleSetting("spell"), "spelling spell check dictionary"],
		["Toggle grammar check", () => toggleSetting("grammar"), "grammar style languagetool proofread"],
		["Check grammar in this note", () => checkGrammar(activeView()), "grammar style languagetool proofread", true],
		["Show grammar problem at cursor", () => { if (!grammarAtCursor(activeView())) toast("No grammar underline at the cursor.", 2500); }, "grammar fix suggestion", true],
		["Toggle smart punctuation", () => toggleSetting("smart"), "curly quotes em dash ellipsis autocorrect typography"],
		["Toggle formatting toolbar", () => toggleSetting("toolbar"), "buttons bold italic format bar"],
		["Sort checklists", () => sortOpenNote({ quiet: false }), "tasks done checked bottom order todo", true],
		["Make pictures and PDFs searchable", searchablePictures, "ocr scan text image photo pdf search read"],
		...(ocrOn() ? [["Stop reading new pictures and PDFs", () => { setOcrOn(false); toast("New pictures and PDFs won't be read. Ones already read stay searchable."); }, "ocr off"]] : []),
		["Version history", showHistory, "versions snapshots restore undo earlier backup recover diff compare", true],
		["Export or print this note", () => exportNote(editor.path), "print pdf word docx html download save", true],
		["Settings", () => openSettings($("settings").hidden), "preferences theme"],
		...[...document.querySelectorAll("#setTabs [data-tab]")].map((b) => ["Settings: " + b.textContent, () => openSettings(true, b.dataset.tab), "preferences options"]),
		["Change hotkeys", editHotkeys, "keyboard shortcuts keys bindings"],
		["Open corkboard", () => pickFolder("corkboard"), "scrivener index cards folder board order"],
		["Open outliner", () => pickFolder("outliner"), "scrivener outline table folder order"],
		["Open scrivenings", () => pickFolder("scrivenings"), "scrivener one document whole folder read"],
		["Compile a folder", () => pickFolder("compile"), "scrivener export pdf word docx html markdown book manuscript print"],
		["Upload files", () => $("upload-input").click(), "import docx pdf"],
		["Transcribe a video or audio file", transcribeIntoNote, "transcript speech text speakers video audio mp4 mov podcast interview", true],
		["Turn on reminders on this device", turnOnReminders, "notifications push alerts remind alarm phone"],
		["Turn off reminders on this device", turnOffReminders, "notifications push alerts remind stop mute"],
		["Capture to the Inbox", captureCommand, "quick capture inbox jot idea note share"],
		["Record a voice memo", voiceMemo, "voice memo record microphone dictate audio speech transcribe"],
		["Clip a web page", () => clipPage(prompt("Web page to clip:") || ""), "save article"],
		// Lookups with no blank kind of their own (comics).
		...mediaKinds.filter((k) => k.ready && MEDIA_COMMANDS[k.kind] && !NEW_NOTE_KINDS.some((n) => n.media === k.kind)).map((k) => [`New ${MEDIA_COMMANDS[k.kind]} log`, () => newMediaNote(k), "create media lookup " + k.label.toLowerCase()]),
		["Sync now", () => runSync(), "save"],
		["Start or pause the focus timer", () => toggleTimer(), "pomodoro"],
		["Find in note", () => { view.focus(); openSearchPanel(view); }, "search replace", true],
		// One per template, so each can have its own hotkey.
		...vaultTemplates().map((t) => [`Insert template: ${t.name}`, () => insertTemplateAt(t), "templater " + t.name.toLowerCase(), true]),
	].filter(([label]) => featureOn(commandArea(label))).map(([label, run, keywords, needsNote]) => ({ label, run, keywords, needsNote: !!needsNote }));
	const edits = [
		...COMMANDS.map((c) => ({ label: c.label, keywords: c.keywords, table: !!c.table, run: EDIT_ACTIONS[c.label] || ((v) => runCommand(v, c)) })),
		{ label: "Indent", keywords: "tab nest", run: EDIT_ACTIONS.Indent },
		{ label: "Outdent", keywords: "unindent dedent", run: EDIT_ACTIONS.Outdent },
		{ label: "Delete line", keywords: "remove cut line erase", run: EDIT_ACTIONS["Delete line"] },
	].map((c) => ({ ...c, editor: true, needsNote: true }));
	return [...app, ...edits];
}

// Ctrl/Cmd+P: every command that can run now, with its hotkey.
function commandPalette() {
	const view = activeView();
	const has = !!editor.path, section = view !== editor.view;
	const items = allCommands()
		.filter((c) => (!c.needsNote || has || (section && c.editor)) && (!c.editor || !view.state.readOnly) && (!c.table || inTable(view.state)))
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
	const label = keys.byKey.get(name) || (MAC && keys.byKey.get(macAlias(name)));
	const c = label && allCommands().find((x) => x.label === label);
	if (!c) return;
	const view = activeView();
	if (c.needsNote && !editor.path && !(c.editor && view !== editor.view)) return;
	// A note just opened from the list has the cursor but not the focus: an
	// editing key still goes to it rather than doing nothing.
	const idle = !document.activeElement || document.activeElement === document.body;
	if (c.editor && idle && editor.path && !view.state.readOnly) view.focus();
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
	if (!$("settings").hidden) renderHotkeyTab();
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
		// Back to where the change started: the Hotkeys tab or the palette list.
		if ($("settings").hidden) editHotkeys();
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
	// A pane opened afresh sits on the right; Edit swaps sides (editInPlace).
	ref = { on: !!on && !!path, path: path || ref.path, left: !!on && !!ref.on && !!ref.left };
	saveRef();
	layoutRef();
	$("ref").hidden = !ref.on;
	$("refBtn").setAttribute("aria-expanded", String(ref.on));
	if (ref.on) {
		reader ??= editor.reader($("refView"), followRefLink);
		reader.show(notes.get(ref.path));
	}
	renderRefPick();
}

// Edit: the pane's note becomes editable where it is. The editor and the pane
// trade sides (and sizes), so each note stays put on the screen, scrolled
// where it was; the note you were editing shows in the pane.
function editInPlace() {
	const was = editor.path, p = ref.path;
	if (!p || p === was) return;
	const topOf = (v) => v.lineBlockAtHeight(Math.max(0, v.scrollDOM.scrollTop)).from;
	const refTop = reader ? topOf(reader.view) : 0, edTop = was ? topOf(editor.view) : 0;
	ref.left = !ref.left;
	openNote(p);
	if (was) showRef(true, was);
	else layoutRef();
	const at = (v, pos) => v.dispatch({ effects: EditorView.scrollIntoView(Math.min(pos, v.state.doc.length), { y: "start" }) });
	at(editor.view, refTop);
	if (was && reader) requestAnimationFrame(() => at(reader.view, edTop));
	editor.view.focus();
}

function layoutRef() {
	$("panes").classList.toggle("ref-left", ref.on && !!ref.left);
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
	const base = editor.path ? name(editor.path) + " · wr1t3r" : folderTab ? tabName(folderTab) + " · wr1t3r" : "wr1t3r";
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
	scheduleLocalPass(3000);
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

// Moves notes (pairs of { from, to }) and points links to them at their new
// places: folder binders always, other notes' links when ask is true, or
// when the person says so if ask is null. -> the from -> to Map.
async function relocate(pairs, paths, ask) {
	const textOf = (p) => (p === editor.path ? editor.text() : notes.get(p)?.binary ? null : notes.get(p)?.text);
	const edits = moveLinkEdits(pairs, paths, textOf);
	const moved = new Set(pairs.map((p) => p.to));
	// Folder binders (their order) always follow; other notes' links are asked about.
	const binders = edits.filter((e) => !moved.has(e.path) && isBinder(e.path));
	const others = edits.filter((e) => !moved.has(e.path) && !isBinder(e.path));
	const n = others.reduce((a, e) => a + e.count, 0);
	const update = others.length && (ask ?? confirm(`Update ${n} link${n === 1 ? "" : "s"} in ${others.length} other note${others.length === 1 ? "" : "s"} to point at the new place?`));
	for (const e of binders) {
		await change(e.path, (cur) => (cur ? { ...cur, text: e.text, dirty: true } : cur));
		editor.forget(e.path);
	}
	if (update) {
		for (const e of others) {
			await change(e.path, (cur) => (cur ? { ...cur, text: e.text, dirty: true } : cur));
			editor.forget(e.path);
		}
	}
	const own = new Map(edits.filter((e) => moved.has(e.path)).map((e) => [e.path, e.text]));
	for (const { from, to } of pairs) {
		const note = notes.get(from);
		const body = note.binary ? { bytes: note.bytes, binary: true } : { text: own.get(to) ?? textOf(from) };
		await change(to, (cur) => ({ path: to, ...body, base: cur?.base ?? null, dirty: true, deleted: false }));
		await change(from, (cur) => (cur?.base ? { ...cur, deleted: true, dirty: true } : null));
		await versions.move(from, to);
		editor.forget(from);
	}
	const map = new Map(pairs.map((p) => [p.from, p.to]));
	const moveTo = (p) => map.get(p) ?? p;
	tabs = tabs.map(moveTo);
	saveTabs();
	bookmarks = bookmarks.map(moveTo);
	writeJSON(BOOKMARKS_KEY, bookmarks);
	if (ref.path && map.has(ref.path)) { ref.path = map.get(ref.path); saveRef(); }
	return map;
}

// Renames every .base board (Obsidian's name for them) to .board, after
// asking, and points links, embeds and Home pins at the new names.
async function convertBoards() {
	const paths = visible().map((n) => n.path);
	const pairs = paths.filter((p) => /\.base$/i.test(p)).map((from) => ({ from, to: from.replace(/\.base$/i, BOARD_EXT) }));
	if (!pairs.length) return toast("There are no .base files to rename.");
	const taken = new Set(paths.map((p) => p.toLowerCase()));
	const clash = pairs.find((p) => taken.has(p.to.toLowerCase()));
	if (clash) return toast(`There's already a board at “${clash.to}”.`);
	if (!confirm(`Rename ${pairs.length} .base file${pairs.length === 1 ? "" : "s"} to ${BOARD_EXT}? Links and Home pins to them follow.`)) return;
	const was = editor.path;
	const map = await relocate(pairs, paths, true);
	await followPins(map, paths);
	if (was && map.has(was)) openNote(map.get(was), { tab: false });
	else renderTabs();
	renderTree();
	renderStatus();
	scheduleSync(0);
	toast(`Renamed ${pairs.length} board${pairs.length === 1 ? "" : "s"} to ${BOARD_EXT}.`);
}

function normalise(input) {
	let p = input.trim().replace(/^\/+/, "");
	if (!/\.(md|board|base)$/i.test(p)) p += ".md";
	return p;
}

// A new board starts as Obsidian starts a base: a table of every note.
const NEW_BASE = "views:\n  - type: table\n    name: Table\n";

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
	const text = makeText ? makeText(path) : isBoardPath(path) ? NEW_BASE : /(^|\/)_/.test(path) ? "" : withTitleHeading(newNoteFrontmatter(name(path), new Date().toLocaleDateString("en-CA")), name(path));
	await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
	openNote(path);
	// Focus goes back to the New button once the name prompt closes; take it
	// back so typing lands in the note (a space would press New again).
	requestAnimationFrame(() => editor.view.focus());
	scheduleSync();
}

// The Properties cleanup panel (src/propcleanview.js): every note with
// properties but templates and wr1t3r's own files. Its batch writes skip the
// per-note redraw; done() redraws and syncs once.
function cleanUpProperties() {
	openPropertyCleanup({
		notes: () => Object.fromEntries(visible()
			.filter((n) => !n.binary && /\.md$/i.test(n.path) && !/(^|\/)_templates\//i.test(n.path) && !isAppFile(n.path))
			.map((n) => [n.path, n.path === editor.path ? editor.view.state.doc.toString() : n.text])),
		async write(path, fn) {
			const note = notes.get(path);
			if (!note || note.deleted || note.binary) return;
			if (path === editor.path) {
				const before = editor.view.state.doc.toString(), after = fn(before);
				if (after !== before) editor.view.dispatch({ changes: diffChange(before, after), userEvent: "input.properties" });
				return;
			}
			const after = fn(note.text);
			if (after === note.text) return;
			await change(path, (cur) => (cur ? { ...cur, text: after, dirty: true } : cur));
			editor.forget(path);
		},
		done() { renderStatus(); renderTree(); scheduleSync(); },
		open: (path) => openNote(path),
		toast: (text) => toast(text),
	});
}

// A note of one kind (src/newnotes.js): asks for its title, fills in the kind's
// template the way Templater would, and saves it in the kind's folder (numbered
// if the name's taken). The sidebar's folders are left as they are.
// A log kind with a lookup searches first; "Start blank" there (or no
// lookup, or no connection) makes it from the template.
async function newKindNote(kind, { blank = false } = {}) {
	const lookup = !blank && kind.media && navigator.onLine && mediaKinds.find((k) => k.kind === kind.media && k.ready);
	if (lookup) return newMediaNote(lookup, kind);
	const paths = visible().map((n) => n.path);
	const tmpl = findTemplate(paths, `_templates/${kind.template}.md`);
	if (!tmpl) return toast(`There's no _templates/${kind.template}.md in the vault.`);
	const title = prompt(`${kind.label.replace(/^New /, "")}: title`)?.trim();
	if (!title) return;
	const folder = kindFolder(kind, tmpl.root, mediaKinds);
	const path = freeNotePath(folder, noteFileName(title), paths);
	const text = withTitleHeading(renderTemplate(notes.get(tmpl.path).text, { title: title.replaceAll('"', "'"), date: new Date() }).text, title);
	await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
	openNote(path);
	requestAnimationFrame(() => editor.view.focus());
	scheduleSync();
}

// "New base": pick the folder it shows (the palette's first row is every
// note), then its name; it's saved in that folder as "<Folder>.board" unless
// renamed, and opens in its Grid.
function newBase(folder = null) {
	if (folder != null) return nameBase(folder);
	const list = visible(), home = commonFolder(list);
	const folders = new Set();
	for (const n of list) {
		const parts = n.path.split("/").slice(0, -1);
		for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/") + "/");
	}
	const here = currentFolder();
	const all = [...folders].filter((f) => f.startsWith(home) && f !== home)
		.sort((a, b) => (b === here) - (a === here) || a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
	openPalette({
		placeholder: "Which notes should the board show?",
		items: [
			{ label: "Every note", detail: "vault", keywords: "all whole", run: () => nameBase("") },
			...all.map((f) => ({ label: folderLabel(f), detail: "folder", run: () => nameBase(f) })),
		],
	});
}

async function nameBase(folder) {
	const home = folder || commonFolder(visible());
	const input = prompt("New board (folders with /):", home + (folder ? itemLabel(folder) : "Untitled") + BOARD_EXT);
	if (input == null) return;
	let path = input.trim().replace(/^\/+/, "");
	if (!isBoardPath(path)) path += BOARD_EXT;
	if (!isNotePath(path)) return toast("That isn't a usable name.");
	if (taken(path)) return openNote([...notes.keys()].find((p) => p.toLowerCase() === path.toLowerCase() && !notes.get(p).deleted));
	const text = starterBase(folder, visible().filter((n) => n.path.startsWith(folder) && /\.md$/i.test(n.path) && !n.binary).map((n) => n.text));
	await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
	openNote(path);
	scheduleSync();
}

// Today's note in _daily, from _templates/Daily.md (and its companion notes,
// like "<date> Health"), or the existing one. Made the way Obsidian would, so
// both apps produce the same file.
async function openDaily({ quiet = true } = {}) {
	const paths = visible().map((n) => n.path);
	const tmpl = findTemplate(paths);
	if (!tmpl) return toast("There's no _templates/Daily.md in the vault.");
	const date = new Date();
	const title = isoDate(date);
	const folder = tmpl.root + DAILY_FOLDER;
	const path = folder + title + ".md";
	const existing = paths.find((p) => p.toLowerCase() === path.toLowerCase());
	if (existing) {
		// Made earlier, here or by Obsidian: still bring in new events.
		openNote(existing);
		return fillTimeline(existing, { quiet });
	}
	const { text, companion } = renderTemplate(notes.get(tmpl.path).text, { title, date });
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
	await fillTimeline(path, { quiet });
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
		if (e instanceof AuthError) signOut(SIGNED_OUT);
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
		openSettings(true, "tasks");
		return toast("Pick a calendar under Timeline calendar first.");
	}
	if (noteDay(editor.path)) await fillTimeline(editor.path, { quiet: false });
	else await openDaily({ quiet: false });
}

// Put the picked calendar's events into the open daily note's Timeline.
// quiet (the Today button): says nothing when there's nothing to add.
async function fillTimeline(path, { quiet }) {
	const date = noteDay(path);
	if (!date || !readRaw(DAILY_CAL_KEY)) return;
	const events = await timelineEvents(date);
	if (!events || editor.path !== path) return;
	const view = editor.view;
	const where = calendarName(readRaw(DAILY_CAL_KEY));
	// A planner page keeps its Timeline in the planner block.
	const planned = importEvents(view, events);
	if (planned) {
		if (planned.added) toast(`Added ${planned.added} event${planned.added === 1 ? "" : "s"} from ${where} to the timeline.`);
		else if (!quiet) toast(events.length ? "The timeline already has every event." : `No events on ${where} ${isoDate(date) === isoDate() ? "today" : "on " + isoDate(date)}.`);
		return;
	}
	const r = timelineChanges(view.state.sliceDoc(), events);
	if (!r) return toast("This note has no Timeline heading, so no events were added.");
	if (r.changes.length) view.dispatch({ changes: r.changes, userEvent: "input.timeline" });
	if (r.added) toast(`Added ${r.added} event${r.added === 1 ? "" : "s"} from ${where} to the timeline.`);
	else if (!events.length) toast(`No events on ${where} ${isoDate(date) === isoDate() ? "today" : "on " + isoDate(date)}.`);
	else if (quiet) return;
	else if (r.changes.length) toast("No new events. Sorted the timeline by time.");
	else toast("The timeline already has every event.");
}

function calendarName(id) {
	const c = cal?.calendars?.find((x) => x.id === id);
	return c ? agenda.calendarLabel(c) : "the calendar";
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
	showSidebar();
}

async function removeNote(path) {
	const note = notes.get(path);
	if (!note || !confirm(`Delete “${name(path)}”? It's removed from the vault on every device.`)) return;
	await change(path, (cur) => (cur?.base ? { ...cur, deleted: true, dirty: true } : null));
	editor.forget(path);
	closeTab(path);
	renderTree();
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
	const binders = edits.filter((e) => e.path !== from && isBinder(e.path));
	const others = edits.filter((e) => e.path !== from && !isBinder(e.path));
	const n = others.reduce((a, e) => a + e.count, 0);
	const update = others.length && confirm(`Update ${n} link${n === 1 ? "" : "s"} to this note in ${others.length} other note${others.length === 1 ? "" : "s"}?`);
	const text = edits.find((e) => e.path === from)?.text ?? editor.text();
	for (const e of binders) {
		await change(e.path, (cur) => (cur ? { ...cur, text: e.text, dirty: true } : cur));
		editor.forget(e.path);
	}
	if (update) {
		for (const e of others) {
			await change(e.path, (cur) => (cur ? { ...cur, text: e.text, dirty: true } : cur));
			editor.forget(e.path);
		}
	}
	// A rename is a new note plus a delete of the old one; the vault has no moves.
	await change(to, (cur) => ({ path: to, text, base: cur?.base ?? null, dirty: true, deleted: false }));
	await change(from, (cur) => (cur?.base ? { ...cur, deleted: true, dirty: true } : null));
	await versions.move(from, to);
	editor.forget(from);
	tabs = tabs.map((p) => (p === from ? to : p));
	saveTabs();
	if (ref.path === from) ref.path = to;
	await followPins(new Map([[from, to]]), paths);
	openNote(to);
	scheduleSync(0);
}

// ---- uploads -------------------------------------------------------------------

// Uploads and clippings become notes here. content/_* folders stay out of the site build.

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
			const path = await addNote(ownFolder("uploads"), convert.noteName(file.name), convert.withFrontmatter(markdown, file.name));
			done.push({ path, notes });
		} catch (e) {
			failed.push(`${file.name}: ${e.message}`);
		}
	}
	const parts = [];
	if (done.length) parts.push(`Added ${done.length} note${done.length === 1 ? "" : "s"} to ${folderLabel(ownFolder("uploads"))}.`);
	for (const d of done) if (d.notes.length) parts.push(`${name(d.path)}: ${d.notes.join(", ")}.`);
	if (failed.length) parts.push(`Couldn't convert ${failed.join("; ")}.`);
	toast(parts.join(" "), failed.length ? 10000 : 6000);
	if (done.length) showAdded(ownFolder("uploads"), done[done.length - 1].path);
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
		const path = await addNote(ownFolder("clippings"), noteName(c.title), c.text);
		toast(`Clipped “${name(path)}” to ${folderLabel(ownFolder("clippings"))}.`);
		showAdded(ownFolder("clippings"), path);
	} catch (e) {
		if (e instanceof AuthError) return signOut(SIGNED_OUT);
		toast("Couldn't clip that: " + e.message, 8000);
	}
}

// Media notes (src/media.js, worker/media.js): the kinds this Worker can look
// up, remembered so the commands are there offline too.
const MEDIA_KEY = "wr1t3r-media-kinds";
let mediaKinds = readJSON(MEDIA_KEY, []);
// Media lookups through the Worker, or with no Worker the same code in the
// page (src/mediahere.js).
const mediaSource = () => (onDropbox ? import("./mediahere.js").then((m) => m.mediaHere) : Promise.resolve(api));
async function loadMediaKinds() {
	try {
		mediaKinds = await (await mediaSource()).mediaKinds();
		writeJSON(MEDIA_KEY, mediaKinds);
	} catch {}
}

const MEDIA_COMMANDS = { movie: "movie/TV", book: "book", music: "music", game: "game", comic: "comic", podcast: "podcast" };

// kind: the new-note kind this was started from, so "Start blank" can make
// that kind's note from its template instead.
async function newMediaNote(k, kind = null) {
	if (!navigator.onLine) return toast("Media lookups need a connection.");
	try {
		let progress = null;
		const made = await makeMediaNote(k, await mediaSource(), (text) => {
			if (text) progress ? progress.set(text) : (progress = toast(text, 60000));
			else { progress?.close(); progress = null; }
		}, { blank: kind ? `Start a blank ${kind.label.replace(/^New /, "")}` : null });
		if (!made) return;
		if (made.blank) return newKindNote(kind, { blank: true });
		const path = await addNote(made.folder, made.name, withTitleHeading(made.text, made.name));
		toast(`Made “${name(path)}”.`);
		showAdded(made.folder, path);
	} catch (e) {
		if (e instanceof AuthError) return signOut(SIGNED_OUT);
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

// Notices (messages, calendar reminders, the focus timer) stack in one corner,
// above the last sync time, newest at the bottom; each goes after ms or with
// its ×. The same text again just stays up longer. Returns { set, close }.
const MAX_NOTICES = 4;
function toast(text, ms = 4000, title = "") {
	const list = $("noticeList");
	let el = [...list.children].find((n) => n.dataset.text === title + "\n" + text);
	if (!el) {
		el = document.createElement("div");
		el.className = "notice";
		const body = document.createElement("div");
		body.className = "notice-text";
		const x = document.createElement("button");
		x.type = "button";
		x.className = "notice-x";
		x.setAttribute("aria-label", "Dismiss");
		x.textContent = "×";
		x.addEventListener("click", () => close());
		el.append(body, x);
		list.append(el);
		while (list.children.length > MAX_NOTICES) list.firstElementChild.remove();
	}
	const set = (t) => {
		el.dataset.text = title + "\n" + t;
		const body = el.querySelector(".notice-text");
		body.textContent = "";
		if (title) body.append(Object.assign(document.createElement("strong"), { textContent: title }), document.createElement("br"));
		body.append(t);
	};
	const close = () => { clearTimeout(el.timer); el.remove(); };
	set(text);
	clearTimeout(el.timer);
	el.timer = setTimeout(close, ms);
	return { set, close };
}

async function signOut(message) {
	if (pending() && !confirm(`${pending()} change(s) haven't reached the vault yet and will be lost. Sign out anyway?`)) return;
	setToken("");
	forgetDropbox();
	setStorageKind("worker");
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
	$("themeFamilies").value = family;
	document.querySelectorAll("#themes button").forEach((b) => {
		// Sepia is light only, SynthWave '84 dark only.
		const oneMode = family === "sepia" || family === "synthwave";
		b.setAttribute("aria-pressed", String(!oneMode && b.dataset.theme === mode));
		b.disabled = oneMode;
	});
	const meta = document.querySelector("meta[name=theme-color]");
	if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg").trim();
}

// The editor's font (Settings > Appearance), per device.
const FONTS = {
	serif: "var(--serif)",
	sans: "var(--sans)",
	mono: "var(--mono)",
	georgia: "Georgia, serif",
	palatino: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
	garamond: 'Garamond, "EB Garamond", "Adobe Garamond Pro", serif',
	humanist: 'Optima, Candara, "Avenir Next", "Noto Sans", sans-serif',
	typewriter: '"Courier Prime", "American Typewriter", "Courier New", Courier, monospace',
};
const FONT_NAMES = { serif: "Serif", sans: "Sans", mono: "Mono", georgia: "Georgia", palatino: "Palatino", garamond: "Garamond", humanist: "Humanist sans", typewriter: "Typewriter" };
let fontName = "serif", toolbarUi = null;
function applyFont(name) {
	const key = FONTS[name] ? name : "serif";
	fontName = key;
	document.documentElement.style.setProperty("--editor-font", FONTS[key]);
	$("fontPick").value = key;
	toolbarUi?.refreshType();
	editor?.view.requestMeasure();
}

function applySize(px) {
	fontSize = clamp(px, 14, 30);
	document.documentElement.style.setProperty("--editor-size", fontSize + "px");
	$("sizeVal").textContent = fontSize;
	toolbarUi?.refreshType();
	editor?.view.requestMeasure();
}

// The font and size, from the toolbar or Settings, kept per device.
function setFont(name) { applyFont(name); storeRaw("wr1t3rFont", fontName === "serif" ? null : fontName); }
function setSize(px) { applySize(px); storeRaw("wr1t3rFontSize", fontSize); }

// Live Preview hides markdown symbols off the cursor line (off unless chosen).
function applyMode(mode) {
	const live = mode === "live";
	setLivePreview(editor?.view, live);
	document.querySelectorAll("#modes button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.mode === "live") === live)));
}

// Readable line length (on unless turned off): lines stop at 720px and the note
// is centered on the screen. Off, lines run the full width of the note column.
function applyLineLength(full) {
	$("app").classList.toggle("full-lines", full);
	document.querySelectorAll("#lineLength button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.lines === "full") === full)));
	editor?.view.requestMeasure();
}
// Focus mode (src/focus.js): side columns, toolbar and header fold away, the
// typing line stays centred and other paragraphs dim. Per device.
function toggleFocus(on = !$("app").classList.contains("focus-mode")) {
	$("app").classList.toggle("focus-mode", on);
	$("focusExit").hidden = !on;
	storeRaw("wr1t3rFocus", on ? "on" : null);
	setFocusMode(editor?.view, on);
	editor?.view.requestMeasure();
	if (on) editor?.view.focus();
}

function checkGrammar(view) {
	if (!view) return;
	if (!grammarOn()) { storeSetting("grammar", true); applySetting("grammar", true); }
	toast(checkNote(view) ? "Checking grammar… underlines appear paragraph by paragraph." : "Nothing to check in this note.", 3000);
}

let grammarWarned = false;
function grammarTrouble(e) {
	if (grammarWarned) return;
	grammarWarned = true;
	toast(navigator.onLine ? "Grammar check: " + e.message : "Grammar check needs a connection.", 4000);
	setTimeout(() => (grammarWarned = false), 60000);
}

function lookUpWord(view) {
	if (!view) return;
	lookUp(view, (w) => api.define(w), (t) => toast(t, 3000));
}

function toggleLineLength() {
	const full = !$("app").classList.contains("full-lines");
	storeRaw("wr1t3rLines", full ? "full" : null);
	applyLineLength(full);
}

// On/off typing settings, per device (on unless turned off, or off unless
// turned on when marked offByDefault): spellcheck, smart punctuation, the
// formatting toolbar, grammar check...
const ON_OFF = {
	spell: { key: "wr1t3rSpell", apply: (on) => setSpellcheck(activeView(), on) },
	smart: { key: "wr1t3rSmart", apply: (on) => setSmartPunctuation(on) },
	toolbar: { key: "wr1t3rToolbar", apply: (on) => $("app").classList.toggle("no-toolbar", !on) },
	done: { key: "wr1t3rDoneDates", apply: (on) => setDoneDates(on) },
	sort: { key: "wr1t3rSortChecklists", apply: () => {} },
	grammar: { key: "wr1t3rGrammar", offByDefault: true, apply: (on) => setGrammar(activeView(), on) },
};
const settingOn = (name) => (ON_OFF[name].offByDefault ? readRaw(ON_OFF[name].key) === "on" : readRaw(ON_OFF[name].key) !== "off");
const storeSetting = (name, on) => storeRaw(ON_OFF[name].key, ON_OFF[name].offByDefault ? (on ? "on" : null) : (on ? null : "off"));
function applySetting(name, on) {
	ON_OFF[name].apply(on);
	document.querySelectorAll(`[data-setting="${name}"] button`).forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.on === "true") === on)));
}
function toggleSetting(name) {
	const on = !settingOn(name);
	storeSetting(name, on);
	applySetting(name, on);
	toast(`${{ spell: "Spellcheck", smart: "Smart punctuation", toolbar: "Formatting toolbar", done: "Task done dates", sort: "Sorting checklists when a note opens", grammar: "Grammar check" }[name]} ${on ? "on" : "off"}`, 2000);
}

// The settings window: tabs down the side (a list to pick from on phones),
// one pane of settings at a time, and a search box that shows matching rows
// from every pane. The last tab is remembered per device.
const SET_TAB_KEY = "wr1t3rSettingsTab";
const narrowSettings = matchMedia("(max-width: 699px)");
let settingsBack = null;

function openSettings(on, tab) {
	if (on && !$("agenda").hidden) openAgenda(false);
	const was = !$("settings").hidden;
	$("settings").hidden = !on;
	$("settingsBtn").setAttribute("aria-expanded", String(on));
	if (!on) {
		if (was) { $("setSearch").value = ""; searchSettings(""); settingsBack?.focus?.(); }
		return;
	}
	if (!was) settingsBack = document.activeElement;
	fillCalendarSetting();
	if (!cal?.calendars && calState !== "setup") loadAgenda();
	showSettingsTab(tab || readRaw(SET_TAB_KEY) || "look", !tab && narrowSettings.matches);
	// Phones skip this so the keyboard doesn't cover the list.
	if (!narrowSettings.matches) (tab ? $("setTabs").querySelector(`[aria-selected="true"]`) : $("setSearch")).focus({ preventScroll: true });
}

// Shows one pane; onPhoneList keeps the phone layout on the tab list.
function showSettingsTab(tab, onPhoneList = false) {
	const pane = document.querySelector(`.set-pane[data-tab="${tab}"]`) || document.querySelector(".set-pane");
	tab = pane.dataset.tab;
	storeRaw(SET_TAB_KEY, tab === "look" ? null : tab);
	document.querySelectorAll(".set-pane").forEach((p) => (p.hidden = p !== pane));
	document.querySelectorAll("#setTabs [data-tab]").forEach((b) => {
		b.setAttribute("aria-selected", String(b.dataset.tab === tab));
		b.tabIndex = b.dataset.tab === tab ? 0 : -1;
	});
	$("setTitle").textContent = pane.dataset.title;
	$("settings").classList.toggle("pane-open", !onPhoneList);
	if (tab === "home") renderHomeSettings();
	if (tab === "templates") renderTemplateSettings();
	if (tab === "features") renderFeatureSettings();
	if (tab === "hotkeys") renderHotkeyTab();
	if (tab === "sync") {
		$("setSynced").textContent = $("status").title || $("status").textContent || "Not yet this session";
		$("setStorage").textContent = onDropbox ? "Notes are kept in your Dropbox, in Apps › wr1t3r." : "";
	}
	if (tab === "writing") $("setDayGoal").value = Number(readRaw("wr1t3rDayGoal")) || "";
	if (tab === "focus") markSeg("focusSeg", $("app").classList.contains("focus-mode"));
	if (tab === "sync") markSeg("ocrSeg", ocrOn());
	if (tab === "tasks") markReminders();
	$("settings").querySelector(".set-main").scrollTop = 0;
}

const markSeg = (id, on) => $(id).querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.on === "true") === on)));

// Search: every pane shows, with only the rows (a heading and what follows
// it) whose words match.
function settingRows(pane) {
	const rows = [];
	for (const el of pane.children) {
		if (el.tagName === "H2" || !rows.length) rows.push([]);
		rows[rows.length - 1].push(el);
	}
	return rows;
}
function searchSettings(q) {
	q = q.trim().toLowerCase();
	const box = $("settings");
	box.classList.toggle("searching", !!q);
	let any = false;
	for (const pane of document.querySelectorAll(".set-pane")) {
		let shown = 0;
		if (pane.dataset.tab === "hotkeys") {
			// The commands whose names match, ready to change.
			$("hotkeyFilter").value = q;
			renderHotkeyTab();
			shown = q ? $("hotkeyList").childElementCount : 1;
			pane.classList.toggle("set-hit", !!q && shown > 0);
			if (q) pane.hidden = !shown;
			if (q && shown) any = true;
			continue;
		}
		for (const row of settingRows(pane)) {
			const words = (pane.dataset.title + " " + row.map((el) => el.textContent + " " + (el.title || "") + " " + (el.getAttribute("aria-label") || "")).join(" ")).toLowerCase();
			const hit = !q || q.split(/\s+/).every((w) => words.includes(w));
			row.forEach((el) => el.classList.toggle("set-miss", !hit));
			if (hit) shown++;
		}
		pane.classList.toggle("set-hit", !!q && shown > 0);
		if (q) pane.hidden = !shown;
		if (q && shown) any = true;
	}
	if (q) { box.classList.add("pane-open"); $("setTitle").textContent = any ? "Search" : "Nothing matches"; }
	else showSettingsTab(readRaw(SET_TAB_KEY) || "look", narrowSettings.matches && !box.classList.contains("pane-open"));
}

function renderHotkeyTab() {
	const list = $("hotkeyList");
	const q = $("hotkeyFilter").value.trim().toLowerCase();
	list.replaceChildren();
	for (const c of allCommands()) {
		if (q && !(c.label + " " + (c.keywords || "")).toLowerCase().includes(q)) continue;
		const b = document.createElement("button");
		b.type = "button";
		b.className = "hotkey-row";
		const name = document.createElement("span");
		name.textContent = c.label;
		const key = document.createElement("kbd");
		key.textContent = showKey(keys.byLabel[c.label], MAC) || "—";
		b.append(name, key);
		b.addEventListener("click", () => captureHotkey(c.label));
		list.append(b);
	}
}

function setupSettings() {
	applyTheme();
	applySize(fontSize);
	applyFont(readRaw("wr1t3rFont"));
	// Auto follows the system, so the theme and browser bar color follow it too.
	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme());
	$("themeFamilies").addEventListener("change", (e) => {
		const family = e.target.value;
		const { mode } = readTheme(readRaw("wr1t3rThemeFamily"), readRaw("wr1t3rTheme"));
		storeRaw("wr1t3rThemeFamily", family === "default" ? null : family);
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
	applyLineLength(readRaw("wr1t3rLines") === "full");
	$("lineLength").addEventListener("click", (e) => {
		const b = e.target.closest("button");
		if (!b) return;
		storeRaw("wr1t3rLines", b.dataset.lines === "full" ? "full" : null);
		applyLineLength(b.dataset.lines === "full");
	});
	// Which Aa sections are unfolded, per device (Appearance until changed).
	$("setTabs").addEventListener("click", (e) => {
		const b = e.target.closest("[data-tab]");
		if (!b) return;
		$("setSearch").value = "";
		$("settings").classList.remove("searching");
		searchSettings("");
		showSettingsTab(b.dataset.tab);
	});
	$("setTabs").addEventListener("keydown", (e) => {
		const tabs = [...$("setTabs").querySelectorAll("[data-tab]")];
		const i = tabs.indexOf(document.activeElement);
		const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
		if (i < 0 || to == null) return;
		e.preventDefault();
		const t = tabs[(to + tabs.length) % tabs.length];
		t.focus();
		showSettingsTab(t.dataset.tab);
	});
	$("setSearch").addEventListener("input", (e) => searchSettings(e.target.value));
	$("setBack").addEventListener("click", () => { $("setSearch").value = ""; searchSettings(""); $("settings").classList.remove("pane-open"); });
	$("setClose").addEventListener("click", () => openSettings(false));
	$("setCloseNav").addEventListener("click", () => openSettings(false));
	$("hotkeyFilter").addEventListener("input", renderHotkeyTab);
	$("setDayGoal").addEventListener("change", (e) => { const n = Math.max(0, Math.round(Number(e.target.value) || 0)); storeRaw("wr1t3rDayGoal", n ? String(n) : null); drawStats(); });
	$("focusSeg").addEventListener("click", (e) => {
		const b = e.target.closest("button");
		if (!b) return;
		const on = b.dataset.on === "true";
		if (on) openSettings(false);
		toggleFocus(on);
		markSeg("focusSeg", on);
	});
	$("ocrSeg").addEventListener("click", (e) => {
		const b = e.target.closest("button");
		if (!b) return;
		if (b.dataset.on === "true") searchablePictures();
		else { setOcrOn(false); toast("New pictures and PDFs won't be read. Ones already read stay searchable."); }
		markSeg("ocrSeg", ocrOn());
	});
	$("remSeg").addEventListener("click", (e) => {
		const b = e.target.closest("button");
		if (!b || b.getAttribute("aria-pressed") === "true") return;
		if (b.dataset.on === "true") turnOnReminders();
		else turnOffReminders();
	});
	$("setSignOut").addEventListener("click", () => signOut());
	for (const name of Object.keys(ON_OFF)) {
		applySetting(name, settingOn(name));
		document.querySelector(`[data-setting="${name}"]`)?.addEventListener("click", (e) => {
			const b = e.target.closest("button");
			if (!b) return;
			storeSetting(name, b.dataset.on === "true");
			applySetting(name, b.dataset.on === "true");
		});
	}
	$("homeAdd").addEventListener("click", (e) => { e.stopPropagation(); addTile(); });
	$("templateAdd").addEventListener("click", (e) => { e.stopPropagation(); newTemplate(); });
	$("homeEdit").addEventListener("click", editHomeNote);
	$("dailyCal").addEventListener("change", (e) => storeRaw(DAILY_CAL_KEY, e.target.value || null));
	$("smaller").addEventListener("click", () => setSize(fontSize - 1));
	$("fontPick").addEventListener("change", (e) => setFont(e.target.value));
	$("larger").addEventListener("click", () => setSize(fontSize + 1));
	document.addEventListener("click", (e) => {
		// A menu item removes itself before this runs; menus and the palette
		// opened from Aa > Home keep the panel open.
		if (!$("settings").hidden && e.target.isConnected && (e.target === $("settings") || !e.target.closest("#settings, #settingsBtn, .item-menu, .palette, .toast"))) openSettings(false);
	});
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Escape" || $("settings").hidden || document.querySelector(".palette, .item-menu")) return;
		if ($("setSearch").value) { $("setSearch").value = ""; searchSettings(""); }
		else openSettings(false);
	});
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
	if (typed && lastWords?.path === editor.path) {
		if (timer.running && timer.phase === "work") {
			written += all.words - lastWords.words;
			saveTimer();
		}
		addToday(all.words - lastWords.words);
	}
	typed = false;
	lastWords = { path: editor.path, words: all.words };
	renderToc();
	const sel = editor.selected();
	const unit = countMode === "chars" ? "character" : "word";
	const total = countMode === "chars" ? all.chars : all.words;
	const part = sel ? (countMode === "chars" ? [...sel.replace(/\r?\n/g, "")].length : countWords(sel)) : null;
	const goal = noteGoal(editor.text());
	b.textContent = part != null
		? `${fmt(part)} of ${fmt(total)} ${unit}s`
		: goal && countMode === "words"
			? `${fmt(total)} / ${fmt(goal)} words`
			: `${fmt(total)} ${unit}${total === 1 ? "" : "s"}`;
	b.classList.toggle("has-goal", !!goal);
	b.style.setProperty("--goal-p", goal ? Math.min(100, Math.round((all.words / goal) * 100)) + "%" : "0%");
	if (!$("statsPanel").hidden) drawStats();
}

// Words written today on this device (added minus deleted while typing), and
// the day's goal: the "session" in Writing goals.
function today() {
	const day = new Date().toDateString();
	let t = null;
	try { t = JSON.parse(readRaw("wr1t3rToday") || "null"); } catch {}
	return t?.day === day ? t : { day, words: 0 };
}
function addToday(n) {
	if (!n) return;
	const t = today();
	const goal = Number(readRaw("wr1t3rDayGoal")) || 0;
	const before = t.words;
	t.words += n;
	storeRaw("wr1t3rToday", JSON.stringify(t));
	if (goal && before < goal && t.words >= goal) toast(`Today's goal reached: ${fmt(t.words)} words.`, 6000);
}

// The word count's panel: document stats and the two goals.
function drawStats() {
	const box = $("statsPanel");
	const s = stats(editor.text());
	const goal = noteGoal(editor.text());
	const t = today();
	const dayGoal = Number(readRaw("wr1t3rDayGoal")) || 0;
	const row = (k, v) => `<div class="st-row"><span>${k}</span><b>${v}</b></div>`;
	const bar = (n, of) => of ? `<div class="st-bar"><i style="width:${Math.min(100, Math.round((n / of) * 100))}%"></i></div>` : "";
	box.innerHTML = `<h2>This note</h2>`
		+ row("Words", fmt(s.words)) + row("Characters", fmt(s.chars)) + row("Sentences", fmt(s.sentences))
		+ row("Words per sentence", s.perSentence) + row("Paragraphs", fmt(s.paragraphs)) + row("Reading time", s.minutes ? `${s.minutes} min` : "–")
		+ `<h2>Goals</h2>`
		+ `<label class="st-goal">Words for this note <input id="goalNote" type="number" min="0" step="100" placeholder="none" value="${goal || ""}"></label>` + bar(s.words, goal)
		+ `<label class="st-goal">Words today <input id="goalDay" type="number" min="0" step="100" placeholder="none" value="${dayGoal || ""}"></label>`
		+ `<div class="st-row"><span>Written today</span><b>${fmt(Math.max(0, t.words))}${dayGoal ? " of " + fmt(dayGoal) : ""}</b></div>` + bar(Math.max(0, t.words), dayGoal)
		+ `<button id="countSwitch" type="button" class="quiet st-switch">Show ${countMode === "chars" ? "words" : "characters"} in the bar</button>`;
	const keep = (id, fn) => {
		const i = $(id);
		const save = () => { const n = Math.max(0, Math.round(Number(i.value) || 0)); fn(n || null); };
		i.addEventListener("change", save);
		i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); i.blur(); } });
	};
	keep("goalNote", (n) => {
		if (!editor.path || n === noteGoal(editor.text())) return;
		dataviewVault.write(editor.path, (text) => setProperty(text, "goal", n));
	});
	keep("goalDay", (n) => { storeRaw("wr1t3rDayGoal", n ? String(n) : null); drawStats(); });
	$("countSwitch").addEventListener("click", () => {
		countMode = countMode === "words" ? "chars" : "words";
		storeRaw("wr1t3rCount", countMode === "chars" ? "chars" : null);
		renderCount();
	});
}
function showStats(on) {
	const box = $("statsPanel");
	box.hidden = !on;
	$("count").setAttribute("aria-expanded", String(on));
	if (!on) return;
	const r = $("count").getBoundingClientRect();
	box.style.bottom = Math.round(innerHeight - r.top + 6) + "px";
	box.style.right = Math.max(8, Math.round(innerWidth - r.right)) + "px";
	drawStats();
}

// ---- table of contents ----------------------------------------------------------------

const TOC_KEY = "wr1t3rToc";
const wide = matchMedia("(min-width: 1180px)");
let tocItems = [], tocCollapsed = new Set(), tocScrollQueued = false;

function tocOpen() { return !$("toc").hidden; }

function openToc(on) {
	$("toc").hidden = !on;
	$("tocBtn").setAttribute("aria-expanded", String(on));
	// Remembered only on wide screens, where it stays in the right column.
	if (wide.matches) storeRaw(TOC_KEY, on ? "1" : null);
	if (on) { openSettings(false); openAgenda(false); renderToc(); }
}

// Opening Contents by hand in the right column folds the agenda above it, so
// the outline has the room.
function showToc(on) {
	openToc(on);
	if (on && wide.matches && !agendaFolded()) foldAgenda(true);
}

function renderToc() {
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
	$("tocBtn").addEventListener("click", (e) => {
		e.stopPropagation();
		if (wide.matches && rightShut()) { showRight(true); showToc(true); } else showToc(!tocOpen());
	});
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
		// Starting a focus block goes into focus mode; Esc leaves it and the timer keeps going.
		if (timer.phase === "work" && editor?.path && !$("app").classList.contains("focus-mode")) toggleFocus(true);
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
	toast(text, 15000, title);
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
	$("count").addEventListener("click", () => showStats($("statsPanel").hidden));
	document.addEventListener("pointerdown", (e) => { if (!$("statsPanel").hidden && !e.target.closest("#statsPanel, #count")) showStats(false); });
	document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("statsPanel").hidden) showStats(false); });
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
	if (wide.matches && agendaFolded()) foldAgenda(false);
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
	if ((calLoading && !force) || !featureOn("calendar")) return;
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
		if (e instanceof AuthError) return signOut(SIGNED_OUT);
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
		if (cal?.calendars?.find((c) => c.id === e.calendar)?.writable) {
			const del = document.createElement("button");
			del.type = "button";
			del.className = "danger";
			del.textContent = "Delete";
			del.addEventListener("click", () => deleteEvent(e, del));
			acts.append(del);
		}
		row.append(acts);
	}
	return row;
}

// Deletes an event from Google Calendar (one occurrence of a repeating one),
// and its line from that day's planner Timeline when it was brought in there.
async function deleteEvent(e, button) {
	if (!navigator.onLine) return toast("Deleting an event needs a connection.");
	const when = agenda.timeLabel(e);
	if (!confirm(`Delete “${e.title}” (${when}) from Google Calendar?` + (/_\d{8}(T\d{6}Z)?$/.test(e.id) ? "\n\nIt repeats: only this occurrence is deleted." : ""))) return;
	button.disabled = true;
	try {
		await api.deleteEvent(e.calendar, e.id);
	} catch (err) {
		button.disabled = false;
		if (err instanceof AuthError) return signOut(SIGNED_OUT);
		return toast("Couldn't delete it: " + err.message, 8000);
	}
	const gone = (list) => list.filter((x) => !(x.calendar === e.calendar && x.id === e.id));
	if (cal?.events) { cal = { ...cal, events: gone(cal.events) }; writeJSON(AGENDA_KEY, cal); }
	if (pickData) pickData = { ...pickData, events: gone(pickData.events) };
	if (monthData) monthData = { ...monthData, events: gone(monthData.events) };
	openEvent = null;
	renderAgenda();
	// The day's Timeline, if the event was imported into it.
	const day = e.allDay ? e.start : agenda.dayKey(new Date(e.start));
	const daily = visible().find((n) => !n.binary && new RegExp(`(^|/)${day}\\.md$`).test(n.path) && /```wr1t3r-planner/.test(n.text));
	let fromTimeline = false;
	if (daily) {
		await dataviewVault.write(daily.path, (t) => {
			const next = editPlannerBlock(t, (c) => { const r = removeEvent(c.timeline, e); fromTimeline = r.removed > 0; return { ...c, timeline: r.timeline }; });
			return fromTimeline && next != null ? next : t;
		});
	}
	toast(`Deleted “${e.title}”` + (fromTimeline ? ` and took it off ${day}'s Timeline.` : "."));
}

// ---- three columns ------------------------------------------------------------------
// On a wide screen the page is notes list | note | calendar, agenda and
// contents. Either side column folds away (remembered per device), and so does
// the agenda list under the month calendar. Narrower screens keep the sidebar
// and the pop-over agenda and contents; phones keep the sliding menu.
const LEFT_KEY = "wr1t3r-left-shut", RIGHT_KEY = "wr1t3r-right-shut", AGENDA_FOLD_KEY = "wr1t3r-agenda-folded";
const leftShut = () => readRaw(LEFT_KEY) === "1";
const rightShut = () => readRaw(RIGHT_KEY) === "1";
const agendaFolded = () => readRaw(AGENDA_FOLD_KEY) === "1";

function showLeft(on) { storeRaw(LEFT_KEY, on ? null : "1"); layoutColumns(); }
function showRight(on) { storeRaw(RIGHT_KEY, on ? null : "1"); layoutColumns(); }
function foldAgenda(on) {
	storeRaw(AGENDA_FOLD_KEY, on ? "1" : null);
	layoutColumns();
	if (!on) renderAgenda();
}

// The notes list, wherever it lives: the phone menu, or the left column.
function showSidebar() {
	$("app").classList.add("menu-open");
	if (leftShut()) showLeft(true);
}

function layoutColumns() {
	const app = $("app"), col = $("rightcol"), cols = wide.matches;
	if (cols && $("agenda").parentElement !== col) $("rightFoot").before($("agenda"), $("toc"));
	if (!cols && $("agenda").parentElement === col) $("notices").before($("toc"), $("agenda"));
	app.classList.toggle("cols", cols);
	app.classList.toggle("left-shut", leftShut());
	app.classList.toggle("right-shut", cols && rightShut());
	app.classList.toggle("agenda-folded", cols && agendaFolded());
	// The sync time and Contents sit in the right column's footer while it
	// shows, else back in the note's bar and the notices corner.
	if (cols && !rightShut()) {
		if ($("status").parentElement !== $("rightFoot")) $("rightFoot").append($("tocBtn"), $("status"));
	} else if ($("status").parentElement === $("rightFoot")) {
		$("count").before($("tocBtn"));
		$("noticeList").after($("status"));
	}
	const label = (btn, on, what) => {
		btn.setAttribute("aria-pressed", String(on));
		btn.setAttribute("aria-label", (on ? "Hide " : "Show ") + what);
		btn.title = (on ? "Hide " : "Show ") + what;
	};
	label($("leftBtn"), !leftShut(), "the notes list");
	label($("rightBtn"), !rightShut(), "the calendar column");
	const fold = $("agendaFold");
	fold.setAttribute("aria-expanded", String(!agendaFolded()));
	fold.setAttribute("aria-label", agendaFolded() ? "Show the agenda" : "Hide the agenda");
	fold.title = fold.getAttribute("aria-label");
	if (cols) openAgenda(true);
	else if (!$("agenda").hidden) openAgenda(false);
}

function setupColumns() {
	$("leftBtn").addEventListener("click", () => showLeft(leftShut()));
	$("rightBtn").addEventListener("click", () => showRight(rightShut()));
	$("agendaFold").addEventListener("click", () => foldAgenda(!agendaFolded()));
	wide.addEventListener("change", layoutColumns);
	layoutColumns();
}

function openAgenda(on) {
	if (!on && wide.matches) return; // in the right column it stays
	$("agenda").hidden = !on;
	$("calBtn").setAttribute("aria-expanded", String(on));
	if (on) {
		if (!wide.matches) { openSettings(false); $("toc").hidden = true; }
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
	if (wide.matches && agendaFolded()) foldAgenda(false);
	const now = new Date();
	const start = new Date(Math.ceil(now.getTime() / 1800000) * 1800000); // next half hour
	const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	$("addEvent").reset();
	fillCalendars();
	$("evDate").value = agenda.dayKey(day || start);
	$("evStart").value = hm(start);
	$("evEnd").value = hm(new Date(start.getTime() + 3600000));
	evPrevStart = $("evStart").value;
	allDayFields();
	$("evTitle").focus();
}

let evPrevStart = ""; // the start time the end was last set from

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
		if (err instanceof AuthError) return signOut(SIGNED_OUT);
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
		unlockSound();
		askToNotify();
		// In the right column: show the column and the agenda, or fold the agenda.
		if (wide.matches) {
			if (rightShut() || agendaFolded()) { storeRaw(RIGHT_KEY, null); foldAgenda(false); } else foldAgenda(true);
			return;
		}
		openAgenda($("agenda").hidden);
	});
	$("monthPrev").addEventListener("click", () => showMonth(-1));
	$("monthNext").addEventListener("click", () => showMonth(1));
	$("monthToday").addEventListener("click", () => showMonth(0));
	desk.addEventListener("change", () => { renderAgenda(); loadMonth(); });
	$("addEventBtn").addEventListener("click", () => showAddEvent($("addEvent").hidden));
	$("evCancel").addEventListener("click", () => showAddEvent(false));
	$("evAllDay").addEventListener("change", allDayFields);
	// Events are hour blocks: moving the start moves the end with it (keeping
	// a length you set); the end can still be changed on its own.
	$("evStart").addEventListener("change", () => {
		$("evEnd").value = agenda.endAfterStart($("evStart").value, evPrevStart, $("evEnd").value);
		evPrevStart = $("evStart").value;
	});
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
	$("dropboxLogin").hidden = !dropboxAppKey();
	$("dropboxStart").onclick = () => {
		setStorageKind("dropbox");
		beginDropboxSignIn({ redirectUri: location.origin + location.pathname }).catch((err) => {
			setStorageKind("worker");
			$("login-error").textContent = "Couldn't start Dropbox sign-in: " + err.message;
		});
	};
	$("login").onsubmit = async (e) => {
		e.preventDefault();
		setToken($("token").value.trim());
		try {
			await remote.check();
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
	try { ocrIndex = (await meta.get("ocr")) || {}; } catch {}
	if (attachments.length) { attachmentsLoaded = true; vaultTouched(); renderHome(); }
}
async function refreshAttachments() {
	try {
		const list = await remote.attachments();
		const changed = JSON.stringify(list) !== JSON.stringify(attachments);
		attachments = list;
		attachmentsLoaded = true;
		if (changed) { meta.set("attachments", list).catch(() => {}); vaultTouched(); renderHome(); }
	} catch {}
	if (ocrOn()) readPictures({ quiet: true, max: 10 });
}

// Searchable pictures and PDFs (src/ocr.js, worker/ocr.js): the Worker has
// Claude read each one once; search looks through the text.
let ocrIndex = {};
let ocrBusy = false;
async function readPictures({ quiet = false, max = Infinity } = {}) {
	if (ocrBusy || !navigator.onLine) return;
	ocrBusy = true;
	let note = null, done = 0, failed = 0;
	try {
		ocrIndex = { ...ocrIndex, ...(await api.ocrIndex()) };
		const todo = unread(attachments, ocrIndex).slice(0, max);
		if (!todo.length) { if (!quiet) toast("Every picture and PDF is searchable already."); return; }
		if (!quiet) note = toast(`Reading ${todo.length} pictures and PDFs…`, 600000);
		for (const f of todo) {
			try {
				const r = await api.ocr(f.path);
				ocrIndex = { ...ocrIndex, [r.path]: { version: r.version, text: r.text } };
				done++;
			} catch (e) {
				failed++;
				if (e.status === 501) { setOcrOn(false); toast(e.message, 8000); break; }
			}
			note?.set(`Reading pictures and PDFs: ${done + failed} of ${todo.length}`);
		}
		meta.set("ocr", ocrIndex).catch(() => {});
		if ($("filter").value.trim()) renderTree();
		note?.close();
		if (!quiet) toast(`Read ${done} ${done === 1 ? "file" : "files"}; search finds their text now.` + (failed ? ` ${failed} couldn't be read.` : ""), 6000);
	} catch (e) {
		note?.close();
		if (!quiet) toast("Couldn't read pictures: " + e.message, 6000);
	} finally {
		ocrBusy = false;
	}
}
function searchablePictures() {
	if (!navigator.onLine) return toast("Reading pictures needs a connection.");
	const n = unread(attachments, ocrIndex).length;
	if (n > 20 && !confirm(`Send ${n} pictures and PDFs to Claude to read their text? Each costs a little on your Anthropic account. New ones are read as they're added.`)) return;
	setOcrOn(true);
	readPictures();
}
async function openAttachment(path) {
	const w = window.open("", "_blank");
	try {
		const url = await dataviewVault.attachmentURL(path);
		if (w) w.location = url; else location.href = url;
	} catch (e) {
		w?.close();
		toast("Couldn't open it: " + e.message);
	}
}

// Pictures pasted or dropped into a note (src/paste.js): saved in the vault
// where Obsidian's settings say, and linked the way Obsidian would link them.
let obsidianApp = null;
async function uploadPicture(file, notePath) {
	if (!navigator.onLine) { toast("Adding a picture needs a connection."); throw new Error("offline"); }
	if (file.size > 20 * 1024 * 1024) { toast("Pictures can be up to 20 MB."); throw new Error("too big"); }
	obsidianApp ??= await api.obsidian().catch(() => ({}));
	const from = notePath || commonFolder(visible()) + "x.md";
	const folder = pictureFolder(obsidianApp.attachmentFolderPath, from);
	const taken = () => [...attachments.map((f) => f.path), ...notes.keys()];
	try {
		for (let tries = 0; tries < 3; tries++) {
			const path = freePath(folder + pictureName(file), taken());
			const added = await remote.uploadAttachment(path, file);
			if (!added) { attachments.push({ path, version: "", size: 0 }); continue; } // taken on the vault, not here yet
			attachments = [...attachments.filter((f) => f.path !== path), added];
			meta.set("attachments", attachments).catch(() => {});
			vaultTouched();
			return pictureLink(path, from, obsidianApp, attachments.map((f) => f.path));
		}
		throw new Error("no free name");
	} catch (e) {
		toast("Couldn't add the picture: " + e.message);
		throw e;
	}
}

// Export or print one note: the Compile dialog with just that note.
function exportNote(path) {
	const note = path && notes.get(path);
	if (!note || note.deleted || note.binary) return;
	let settings = {};
	openCompileDialog({
		single: true,
		folder: path,
		label: name(path),
		parts: () => [{ kind: "note", path, depth: 0 }],
		text: (p) => (p === path && editor.path === path ? editor.text() : dataviewVault.text(p)),
		embed: (nm) => {
			const p = resolveNote({ note: nm, heading: "", wiki: true }, path, visible().map((n) => n.path));
			const t = p && dataviewVault.text(p);
			return t == null ? null : cleanNote(t);
		},
		settings: () => ({ headings: "none", ...settings }),
		async saveSettings(s) { settings = s; },
		async image(nm) {
			const p = dataviewVault.resolveAttachment(nm, path);
			const file = p && attachmentKind(p) === "image" && attachments.find((f) => f.path === p);
			return file ? attachmentBlob(file, (q) => remote.attachment(q)) : null;
		},
		toast,
	});
}

// Version history of the open note (src/history.js, src/historyview.js).
// Restoring goes through the editor, so Undo brings the newer text back, and
// the text being replaced is kept as a copy first.
function showHistory() {
	const path = editor.path, view = editor.view;
	if (!path || notes.get(path)?.binary) return;
	openHistory({
		path,
		name: name(path),
		current: () => view.state.doc.toString(),
		copies: () => versions.copies(path),
		async restore(text) {
			if (editor.path !== path || view.state.readOnly) return toast("Open the note to restore it.");
			const before = view.state.doc.toString();
			await versions.keep(path, before, { force: true });
			if (text !== before) view.dispatch({ changes: diffChange(before, text), userEvent: "input.restore", scrollIntoView: true });
			toast("Restored. Undo brings back the newer text.", 4000);
		},
	});
}

// The smallest single change that turns a into b.
function diffChange(a, b) {
	let from = 0;
	while (from < a.length && from < b.length && a[from] === b[from]) from++;
	let ea = a.length, eb = b.length;
	while (ea > from && eb > from && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
	return { from, to: ea, insert: b.slice(from, eb) };
}

// What dataviewjs blocks (src/dataview.js) may read: notes on this device, and
// public web pages through the Worker, as the clipper fetches them.
const dataviewVault = {
	// Where new task list notes go (Settings > Features > Folders).
	listsFolder: () => ownFolder("lists"),
	paths: () => cachedPaths("notes", (n) => !n.binary && !isBoardPath(n.path)),
	files: () => cachedPaths("files", (n) => !n.binary),
	// A base changing a note's property: the open note through the editor (so
	// it can be undone there), others saved and synced like any edit.
	async write(path, fn) {
		const note = notes.get(path);
		if (!note || note.deleted || note.binary) return;
		if (path === editor.path) {
			const before = editor.view.state.doc.toString(), after = fn(before); // "\n" breaks, as CodeMirror counts them
			if (after !== before) editor.view.dispatch({ changes: diffChange(before, after), userEvent: "input.base" });
			return;
		}
		const after = fn(note.text);
		if (after === note.text) return;
		await change(path, (cur) => (cur ? { ...cur, text: after, dirty: true } : cur));
		editor.forget(path);
		renderStatus();
		renderTree();
		scheduleSync();
	},
	text: (path) => { const n = notes.get(path); return n && !n.deleted && !n.binary ? n.text : null; },
	// The vault's property types (src/properties.js), kept in _wr1t3r/Property Types.md.
	propertyTypes: () => propertyTypes(),
	propertyUsage: () => propertyUsageNow(),
	setPropertyType: (key, type) => setPropertyType(key, type),
	// A base's "+ New": the note's text as New note would start it.
	newNoteText: (path) => (/(^|\/)_/.test(path) ? "" : withTitleHeading(newNoteFrontmatter(name(path), new Date().toLocaleDateString("en-CA")), name(path))),
	// ...then saved (numbered if the name's taken) and opened.
	// open: false (a task list's new note) saves it without leaving the note you're in.
	async create(folder, noteName, makeText, { open = true } = {}) {
		let path = folder + noteName + ".md";
		for (let n = 2; taken(path); n++) path = `${folder}${noteName} ${n}.md`;
		const text = makeText(path);
		await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
		if (open) showAdded(folder, path);
		else { renderStatus(); renderTree(); scheduleSync(); }
		return path;
	},
	attachments: () => attachments,
	attachmentsLoaded: () => attachmentsLoaded,
	resolveAttachment: (name, from) => resolveAttachment(name, from, attachments.map((f) => f.path)),
	attachmentURL(path) {
		const file = attachments.find((f) => f.path === path);
		return file ? attachmentURL(file, (p) => remote.attachment(p)) : Promise.reject(new Error("No such attachment"));
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
	setupColumns();
	refreshKeyboardBar = setupKeyboardBar($("app"), activeView);
	setupGrammar((text) => api.grammar(text), grammarTrouble);
	toolbarUi = setupToolbar($("toolbar"), activeView, {
		print: () => exportNote(editor.path), lookUp: (view) => lookUpWord(view),
		type: { fonts: Object.keys(FONTS).map((k) => [k, FONT_NAMES[k], FONTS[k]]), font: () => fontName, setFont, size: () => fontSize, setSize },
		review: reviewMenu,
		page: pageMenu,
	});
	applyTracking();
	setupPageSettings();
	if (readRaw("wr1t3rFocus") === "on") toggleFocus(true);
	$("focusExit").addEventListener("click", () => toggleFocus(false));
	document.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && $("app").classList.contains("focus-mode") && ![...document.querySelectorAll(".pop:not([hidden]), .settings-win:not([hidden]) .set-box, .item-menu, .lookup-pop, .palette")].some((el) => el.offsetParent)) toggleFocus(false);
	});
	setPictureHost({ upload: uploadPicture });
	setupFolderView();
	setupLocalFolder();
	renderQuote();
	$("writingPrompt").addEventListener("click", () => newPromptNote($("writingPrompt").textContent));
	$("promptNext").addEventListener("click", () => { promptStep++; renderPrompt(); });
	document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && renderQuote());
	for (const n of await local.all()) notes.set(n.path, n);
	applyFeatures();
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
	$("closeNote").addEventListener("click", () => activeTab() ? closeTab(activeTab()) : openNote(null));
	$("tabPick").addEventListener("change", () => openNote($("tabPick").value, { tab: false }));
	$("refBtn").addEventListener("click", () => showRef(!ref.on));
	$("refClose").addEventListener("click", () => showRef(false));
	$("refPick").addEventListener("change", () => showRef(true, $("refPick").value));
	$("refOpen").addEventListener("click", editInPlace);
	$("tree").addEventListener("click", (e) => {
		const a = e.target.closest("a");
		if (!a) return;
		e.preventDefault();
		const path = decodeURIComponent(a.hash.slice(1));
		// A note found by opening folders: they fold back up behind it.
		// (Bookmarks and tags are sections, not folders.)
		if (a.closest("details:not(.side-section)")) {
			openFolders = new Set([...openFolders].filter((f) => !path.startsWith(f)));
			writeJSON(OPEN_KEY, [...openFolders]);
		}
		openNote(path);
	});
	window.addEventListener("hashchange", () => {
		if (clipFromHash()) return;
		const p = decodeURIComponent(location.hash.slice(1));
		if (p && p !== activeTab()) openNote(p);
	});
	window.addEventListener("online", () => runSync());
	window.addEventListener("offline", () => { lastError = "offline"; renderStatus(); });
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") runSync();
	});
	document.addEventListener("keydown", onHotkey, true); // ahead of the editor's own keys
	$("bookmark").addEventListener("click", () => toggleBookmark());
	$("homeBtn").addEventListener("click", goHome);
	$("prevNote").addEventListener("click", () => stepFolder(-1));
	$("nextNote").addEventListener("click", () => stepFolder(1));
	$("palette").addEventListener("click", () => commandPalette());
	setInterval(() => document.visibilityState === "visible" && runSync(), 60000);

	if (!clipFromHash()) openNote(decodeURIComponent(location.hash.slice(1)) || tabs.find(tabOpen) || null);
	if (ref.on) showRef(true);
	renderStatus();
	runSync();
	captureFromShare();
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
	navigator.serviceWorker.register("/sw.js").catch(() => {});
}

if (isDropboxReturn(location.href)) {
	finishDropboxSignIn({ url: location.href })
		.then(() => { history.replaceState(null, "", location.pathname); start(); })
		.catch((err) => {
			// Back to the token sign-in, on a fresh page so storage is the Worker again.
			setStorageKind("worker");
			sessionStorage.setItem("wr1t3r-msg", err.message);
			location.replace(location.pathname);
		});
} else if (onDropbox ? dropboxSignedIn() : token()) start();
else {
	const msg = sessionStorage.getItem("wr1t3r-msg") || "";
	sessionStorage.removeItem("wr1t3r-msg");
	showLogin(msg);
}
