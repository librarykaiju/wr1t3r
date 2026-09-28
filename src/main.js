// wr1t3r's page: file list, editor and the sync loop. Every keystroke is
// saved to this device first (IndexedDB); syncing with the vault happens in
// the background and whenever the connection comes back.

import { createEditor } from "./editor.js";
import { resolveNote, headingFor } from "./links.js";
import { EditorView } from "@codemirror/view";
import { local, persist } from "./store.js";
import { api, token, setToken, AuthError } from "./api.js";
import { sync } from "./sync.js";
import { isNotePath } from "./paths.js";
import { counts, countWords } from "./count.js";
import * as pomo from "./pomodoro.js";
import * as agenda from "./agenda.js";
import * as toc from "./toc.js";
import { newNoteFrontmatter } from "./frontmatter.js";
import { quoteFor } from "./quotes.js";

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
		openNote(null);
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

function renderTree() {
	const tree = $("tree");
	const q = $("filter").value.trim().toLowerCase();
	tree.replaceChildren();
	const list = visible();
	if (q) {
		const hits = list.filter((n) => n.path.toLowerCase().includes(q) || (!n.binary && n.text.toLowerCase().includes(q)));
		for (const n of hits.slice(0, 300)) tree.append(link(n, n.path.replace(/\.md$/i, "")));
		if (!hits.length) tree.append(Object.assign(document.createElement("div"), { className: "hint", textContent: "No matches." }));
		return;
	}
	if (!list.length) {
		tree.append(Object.assign(document.createElement("div"), { className: "hint", textContent: lastSynced ? "The vault is empty." : "Loading the vault…" }));
		return;
	}
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
	const current = editor.path || "";
	(function draw(node, into, prefix) {
		for (const [dir, child] of node.folders) {
			const full = prefix + dir + "/";
			const d = document.createElement("details");
			d.open = openFolders.has(full) || current.startsWith(full);
			const s = document.createElement("summary");
			s.textContent = dir;
			const kids = document.createElement("div");
			kids.className = "kids";
			d.append(s, kids);
			d.addEventListener("toggle", () => {
				d.open ? openFolders.add(full) : openFolders.delete(full);
				writeJSON(OPEN_KEY, [...openFolders]);
				if (d.open && !kids.childElementCount) draw(child, kids, full);
			});
			if (d.open) draw(child, kids, full);
			into.append(d);
		}
		for (const n of node.notes) into.append(link(n, name(n.path)));
	})(root, tree, "");
}

// ---- notes ---------------------------------------------------------------------

function openNote(path) {
	const note = path ? notes.get(path) : null;
	editor.open(note && !note.deleted ? note : null);
	const has = !!editor.path;
	document.querySelector("main").classList.toggle("has-note", has);
	$("path").value = has ? editor.path : "";
	$("path").disabled = !has || note.binary;
	$("delete").disabled = !has;
	renderTitle();
	if (has && location.hash !== "#" + encodeURIComponent(path)) history.replaceState(null, "", "#" + encodeURIComponent(path));
	if (!has && location.hash) history.replaceState(null, "", location.pathname);
	$("app").classList.remove("menu-open");
	renderTree();
	refreshCount(true);
}

// The empty screen's quote of the day. Checked again whenever wr1t3r comes back
// into view, so a tab left open overnight shows the new day's quote.
function renderQuote() {
	const q = quoteFor();
	$("quoteText").textContent = q.text.replaceAll(" / ", "\n");
	const by = $("quoteBy");
	const cite = document.createElement("cite");
	cite.textContent = q.work;
	by.replaceChildren("— " + q.author + ", ", cite);
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

async function newNote(suggestion = currentFolder() + "Untitled.md") {
	const input = prompt("New note (folders with /):", suggestion);
	if (input == null) return;
	const path = normalise(input);
	if (!isNotePath(path)) return toast("That isn't a usable note name.");
	if (taken(path)) return openNote([...notes.keys()].find((p) => p.toLowerCase() === path.toLowerCase() && !notes.get(p).deleted));
	// A tombstone of a deleted note with this name keeps its base, so the new
	// note replaces it in the vault.
	// Notes that could be published start with the Note template's properties,
	// including today's date; "_" folders never publish, so they start empty.
	const text = /(^|\/)_/.test(path) ? "" : newNoteFrontmatter(name(path), new Date().toLocaleDateString("en-CA"));
	await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
	openNote(path);
	// Focus goes back to the New button once the name prompt closes; take it
	// back so typing lands in the note (a space would press New again).
	requestAnimationFrame(() => editor.view.focus());
	scheduleSync();
}

// A clicked link: web links open in a new tab, links to notes open the note
// (Back returns), and a [[link]] to a note that doesn't exist yet offers to
// create it next to this note, as Obsidian does.
function followLink(link) {
	if (link.url) return void window.open(link.url, "_blank", "noopener");
	const path = resolveNote(link, editor.path, visible().map((n) => n.path));
	if (path) {
		if (path !== editor.path) {
			history.pushState(null, "", "#" + encodeURIComponent(path));
			openNote(path);
		}
		const h = headingFor(toc.headings(editor.view.state), link.heading);
		if (h) {
			editor.view.dispatch({ selection: { anchor: h.from }, effects: EditorView.scrollIntoView(h.from, { y: "start", yMargin: 24 }) });
			editor.view.focus();
		} else if (link.heading && !link.heading.startsWith("^")) toast(`No heading “${link.heading}” in ${name(path)}.`);
		return;
	}
	if (link.wiki) return newNote(currentFolder() + normalise(link.note));
	toast(`There's no note at “${link.note}”.`);
}

async function removeNote(path) {
	const note = notes.get(path);
	if (!note || !confirm(`Delete “${name(path)}”? It's removed from the vault on every device.`)) return;
	await change(path, (cur) => (cur?.base ? { ...cur, deleted: true, dirty: true } : null));
	editor.forget(path);
	openNote(null);
	renderStatus();
	scheduleSync(0);
}

async function renameNote(from, input) {
	const to = normalise(input);
	if (to === from) return;
	if (!isNotePath(to)) { $("path").value = from; return toast("That isn't a usable note name."); }
	if (taken(to) && to.toLowerCase() !== from.toLowerCase()) { $("path").value = from; return toast("A note with that name already exists."); }
	const text = editor.text();
	// A rename is a new note plus a delete of the old one; the vault has no moves.
	await change(to, (cur) => ({ path: to, text, base: cur?.base ?? null, dirty: true, deleted: false }));
	await change(from, (cur) => (cur?.base ? { ...cur, deleted: true, dirty: true } : null));
	editor.forget(from);
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
	openFolders.add("content/").add(folder);
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

function applyTheme(t) {
	const root = document.documentElement;
	if (t === "light" || t === "dark" || t === "sepia") root.setAttribute("data-theme", t);
	else { root.removeAttribute("data-theme"); t = "auto"; }
	document.querySelectorAll("#themes button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === t)));
	const meta = document.querySelector("meta[name=theme-color]");
	if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg").trim();
}

function applySize(px) {
	fontSize = clamp(px, 14, 30);
	document.documentElement.style.setProperty("--editor-size", fontSize + "px");
	$("sizeVal").textContent = fontSize;
	editor?.view.requestMeasure();
}

function openSettings(on) {
	if (on && !$("agenda").hidden) openAgenda(false);
	$("settings").hidden = !on;
	$("settingsBtn").setAttribute("aria-expanded", String(on));
}

function setupSettings() {
	applyTheme(readRaw("wr1t3rTheme"));
	applySize(fontSize);
	// Auto follows the system, so the browser bar color has to follow it too.
	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(readRaw("wr1t3rTheme")));
	$("settingsBtn").addEventListener("click", (e) => { e.stopPropagation(); openSettings($("settings").hidden); });
	$("themes").addEventListener("click", (e) => {
		const b = e.target.closest("button");
		if (!b) return;
		storeRaw("wr1t3rTheme", b.dataset.theme === "auto" ? null : b.dataset.theme);
		applyTheme(b.dataset.theme);
	});
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
	if (ids.has(id) && !cal?.fetched?.includes(id)) loadAgenda(true);
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
	for (const day of agenda.byDay(events, now)) {
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
		name.textContent = c.name;
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

function openAgenda(on) {
	$("agenda").hidden = !on;
	$("calBtn").setAttribute("aria-expanded", String(on));
	if (on) {
		openSettings(false);
		if (!wide.matches) $("toc").hidden = true;
		unlockSound();
		askToNotify();
		renderAgenda();
		if (!cal || Date.now() - cal.at > 60000) loadAgenda();
	} else {
		openEvent = null;
		showAddEvent(false);
	}
}

function showAddEvent(on) {
	$("addEvent").hidden = !on;
	$("evError").textContent = "";
	if (!on) return;
	const now = new Date();
	const start = new Date(Math.ceil(now.getTime() / 1800000) * 1800000); // next half hour
	const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	$("addEvent").reset();
	fillCalendars();
	$("evDate").value = agenda.dayKey(start);
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
	for (const c of list) sel.append(new Option(c.primary ? `${c.name} (main)` : c.name, c.id));
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
		toast(`Added “${body.title}” to ${where && !where.primary ? where.name : "Google Calendar"}.`);
		cal = cal && { ...cal, at: 0 };
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
	$("calBtn").addEventListener("click", (e) => { e.stopPropagation(); openAgenda($("agenda").hidden); });
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
	applyTheme(readRaw("wr1t3rTheme"));
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

async function start() {
	$("app").hidden = false;
	editor = createEditor($("editor"), { onChange: onEdit, onUpdate: () => refreshCount(), onLink: followLink });
	setupSettings();
	setupFocusTools();
	setupAgenda();
	setupToc();
	renderQuote();
	document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && renderQuote());
	for (const n of await local.all()) notes.set(n.path, n);
	persist();

	$("filter").addEventListener("input", renderTree);
	$("new").addEventListener("click", () => newNote());
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
	});
	$("path").addEventListener("blur", () => { if (editor.path) $("path").value = editor.path; });
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
	document.addEventListener("keydown", (e) => {
		if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); runSync(); }
	});
	setInterval(() => document.visibilityState === "visible" && runSync(), 60000);

	if (!clipFromHash()) openNote(decodeURIComponent(location.hash.slice(1)) || null);
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
