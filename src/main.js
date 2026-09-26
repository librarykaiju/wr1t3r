// wr1t3r's page: file list, editor and the sync loop. Every keystroke is
// saved to this device first (IndexedDB); syncing with the vault happens in
// the background and whenever the connection comes back.

import { createEditor } from "./editor.js";
import { local, persist } from "./store.js";
import { api, token, setToken, AuthError } from "./api.js";
import { sync } from "./sync.js";
import { isNotePath } from "./paths.js";

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
	} else if (!note.dirty) editor.replace(note);
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
	document.title = has ? name(editor.path) + " · wr1t3r" : "wr1t3r";
	if (has && location.hash !== "#" + encodeURIComponent(path)) history.replaceState(null, "", "#" + encodeURIComponent(path));
	if (!has && location.hash) history.replaceState(null, "", location.pathname);
	$("app").classList.remove("menu-open");
	renderTree();
}

function onEdit(path, text) {
	const note = notes.get(path);
	if (!note || note.binary) return;
	const wasDirty = note.dirty;
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

async function newNote() {
	const suggestion = currentFolder() + "Untitled.md";
	const input = prompt("New note (folders with /):", suggestion);
	if (input == null) return;
	const path = normalise(input);
	if (!isNotePath(path)) return toast("That isn't a usable note name.");
	if (taken(path)) return openNote([...notes.keys()].find((p) => p.toLowerCase() === path.toLowerCase() && !notes.get(p).deleted));
	// A tombstone of a deleted note with this name keeps its base, so the new
	// note replaces it in the vault.
	await change(path, (cur) => ({ path, text: "", base: cur?.base ?? null, dirty: true, deleted: false }));
	openNote(path);
	scheduleSync();
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

// Uploaded files become notes here. content/_* folders stay out of the site build.
const UPLOAD_FOLDER = "content/_uploads/";

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
			const base = UPLOAD_FOLDER + convert.noteName(file.name);
			let path = base + ".md";
			for (let n = 2; taken(path); n++) path = `${base} ${n}.md`;
			const text = convert.withFrontmatter(markdown, file.name);
			await change(path, (cur) => ({ path, text, base: cur?.base ?? null, dirty: true, deleted: false }));
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
	if (done.length) {
		openFolders.add("content/").add(UPLOAD_FOLDER);
		writeJSON(OPEN_KEY, [...openFolders]);
		openNote(done[done.length - 1].path);
		renderStatus();
		scheduleSync(0);
	}
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
	editor = createEditor($("editor"), { onChange: onEdit });
	setupSettings();
	for (const n of await local.all()) notes.set(n.path, n);
	persist();

	$("filter").addEventListener("input", renderTree);
	$("new").addEventListener("click", newNote);
	// Keep this in step with ACCEPT in src/convert.js. It's set here, not
	// imported, because Safari only opens the picker straight from the tap.
	$("upload-input").accept = ".md,.markdown,.txt,.html,.htm,.docx,.pdf";
	$("upload").addEventListener("click", () => $("upload-input").click());
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

	openNote(decodeURIComponent(location.hash.slice(1)) || null);
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
