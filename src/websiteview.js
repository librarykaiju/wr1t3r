// The Export as website dialog: the site's title, support buttons and what
// files it may carry on one side, a preview of any page on the other, and a
// button that downloads the site as a .zip (src/website.js plans it). The
// settings are kept on this device. After a download it says how to put the
// site online, and lists pages the last download had that this one doesn't,
// since re-uploading a folder doesn't delete what's already on the host.
// Or it publishes the site to a GitHub repo (src/githubpublish.js); the token
// stays on this device, and only if the person asks.
//
// host: {
//   notes()        [{ path, text }] for every note
//   attachments()  every vault file's path
//   blob(path)     a vault file as a Blob
//   theme()        the notebook's { family, mode } (src/theme.js readTheme)
//   font()         the editor font, as CSS
//   toast(text)
// }

import appCss from "./style.css?raw";
import { buildSite, themeCss, SITE_FILES } from "./website.js";
import { FAMILIES, themeVariants } from "./theme.js";
import { publishToGitHub } from "./githubpublish.js";

const FAMILY_NAMES = { default: "Default", sepia: "Sepia", dracula: "Dracula", rosepine: "Rosé Pine", tokyonight: "Tokyo Night", catppuccin: "Catppuccin", kanagawa: "Kanagawa", synthwave: "SynthWave '84" };

const KEY = "wr1t3r-website";
let open = null;

const readSaved = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
const TOKEN = "wr1t3r-github-token";
const readToken = () => { try { return localStorage.getItem(TOKEN) || ""; } catch { return ""; } };
const keepToken = (t) => { try { t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN); } catch {} };

export function openWebsite(host) {
	open?.close();
	const saved = { footer: true, media: false, ...readSaved() };
	const back = document.activeElement;
	const wrap = document.createElement("div");
	wrap.className = "palette compile website";
	wrap.setAttribute("role", "dialog");
	wrap.setAttribute("aria-label", "Export as website");
	const box = document.createElement("div");
	box.className = "compile-box";
	const head = document.createElement("header");
	head.className = "compile-head";
	const h = document.createElement("h2");
	h.textContent = "Export as website";
	const x = Object.assign(document.createElement("button"), { type: "button", className: "quiet", textContent: "×" });
	x.setAttribute("aria-label", "Close");
	head.append(h, x);

	const form = document.createElement("form");
	form.className = "compile-form";
	const field = (label, input, hint) => {
		const l = document.createElement("label");
		l.append(Object.assign(document.createElement("span"), { textContent: label }), input);
		if (hint) l.title = hint;
		form.append(l);
		return input;
	};
	const text = (value, placeholder) => Object.assign(document.createElement("input"), { type: "text", value: value || "", placeholder });
	const check = (label, on) => {
		const l = document.createElement("label");
		l.className = "check";
		const c = Object.assign(document.createElement("input"), { type: "checkbox", checked: !!on });
		l.append(c, document.createTextNode(" " + label));
		form.append(l);
		return c;
	};
	const sub = (words) => form.append(Object.assign(document.createElement("h3"), { textContent: words }));

	const count = Object.assign(document.createElement("p"), { className: "hint" });
	form.append(count);
	const title = field("Site title", text(saved.title, "My notebook"));
	const logo = document.createElement("select");
	logo.append(new Option("No logo", ""));
	for (const p of host.attachments().filter((p) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(p)).sort()) logo.append(new Option(p.split("/").pop(), p, false, p === saved.logo));
	field("Logo (a picture in the notebook)", logo);
	const logoOnly = check("Show only the logo, not the title beside it", saved.logoOnly);
	const now = host.theme();
	const family = document.createElement("select");
	for (const f of FAMILIES) family.append(new Option(FAMILY_NAMES[f] + (f === now.family ? " (the notebook's)" : ""), f, false, f === (saved.family || now.family)));
	field("Theme", family);
	const mode = document.createElement("select");
	for (const [v, label] of [["auto", "Auto: light or dark, as each visitor's device is set"], ["light", "Light"], ["dark", "Dark"]]) mode.append(new Option(label, v, false, v === (saved.mode || now.mode)));
	field("Light or dark", mode);
	const layout = document.createElement("select");
	layout.append(new Option("Top menu: a link per folder across the top", "top", false, saved.layout !== "notebook"), new Option("Notebook: folders down the left, as in the app", "notebook", false, saved.layout === "notebook"));
	field("Layout", layout);
	const share = check("Share buttons under each post", saved.share !== false);
	const properties = check("Each note's properties in a box under its title", saved.properties !== false);
	sub("Right sidebar");
	const sidebar = check("Show the right sidebar (on phones it goes under the text)", saved.sidebar !== false);
	const calendar = check("A calendar of posts, with a page per month (for notes with a date)", saved.calendar);
	sub("Support buttons");
	const kofi = field("Ko-fi", text(saved.kofi, "Your Ko-fi name or page"));
	const patreon = field("Patreon", text(saved.patreon, "Your Patreon name or page"));
	const label = field("Your own link: words", text(saved.label, "Support my work"));
	const url = field("Your own link: address", text(saved.url, "https://…"));
	const note = field("A line above the buttons", text(saved.note, "Optional"));
	const social = document.createElement("textarea");
	Object.assign(social, { rows: 3, value: saved.social || "", placeholder: "https://bsky.app/profile/you\n@you@mastodon.social\nyou@example.com" });
	field("Find me on: one link or email address per line", social);
	sub("Files");
	const media = check("Include audio and video (a free Neocities site won't take them)", saved.media);
	const footer = check("Say “Made with wr1t3r” at the bottom", saved.footer);
	sub("Publish to GitHub (optional)");
	const ghHelp = document.createElement("p");
	ghHelp.className = "hint";
	const tokenLink = Object.assign(document.createElement("a"), { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener", textContent: "Make a token on GitHub" });
	ghHelp.append("Puts the site in a GitHub repo and turns on GitHub Pages, so it's online at you.github.io. Make an empty repo first. ", tokenLink, " for just that repo, with Contents and Pages set to Read and write. Want Cloudflare? Connect a Cloudflare Pages project to the same repo and it updates every time you publish here. ", helpLink("github", "Step-by-step help"), ".");
	form.append(ghHelp);
	const ghRepo = field("Repo", text(saved.ghRepo, "you/my-site"));
	const ghBranch = field("Branch", text(saved.ghBranch, "main"));
	const ghToken = field("Token", Object.assign(text(readToken(), "github_pat_…"), { type: "password", autocomplete: "off" }));
	const ghKeep = check("Remember the token on this device", !!readToken());
	const actions = document.createElement("div");
	actions.className = "compile-actions";
	const go = Object.assign(document.createElement("button"), { type: "button", textContent: "Download website (.zip)" });
	const ghGo = Object.assign(document.createElement("button"), { type: "button", textContent: "Publish to GitHub" });
	actions.append(go, ghGo);
	form.append(actions);
	const after = Object.assign(document.createElement("div"), { className: "website-after hint" });
	form.append(after);
	form.append(Object.assign(document.createElement("p"), { className: "hint", textContent: "Notes with publish: true go on the site. Links to other notes stay links only when those notes are published too; %% comments %% never go in." }));
	form.append(Object.assign(document.createElement("p"), { className: "hint", textContent: "Shared a post on Bluesky? Add a bluesky property with the Bluesky post's address, and the page shows its likes and replies." }));

	const side = document.createElement("div");
	side.className = "website-side";
	const pick = document.createElement("select");
	pick.setAttribute("aria-label", "Preview page");
	const preview = Object.assign(document.createElement("iframe"), { className: "compile-preview", title: "Preview" });
	preview.setAttribute("sandbox", "");
	side.append(pick, preview);

	const grid = document.createElement("div");
	grid.className = "compile-grid";
	grid.append(form, side);
	box.append(head, grid);
	wrap.append(box);
	document.body.append(wrap);

	const settings = () => ({ ghRepo: ghRepo.value.trim(), ghBranch: ghBranch.value.trim(), title: title.value.trim(), kofi: kofi.value.trim(), patreon: patreon.value.trim(), label: label.value.trim(), url: url.value.trim(), note: note.value.trim(), media: media.checked, footer: footer.checked, calendar: calendar.checked, logo: logo.value, logoOnly: logoOnly.checked, layout: layout.value, sidebar: sidebar.checked, social: social.value.trim(), share: share.checked, properties: properties.checked, family: family.value, mode: mode.value });
	// SynthWave '84's neon headings come along too.
	const GLOW = "\nh1, h2, h3 { text-shadow: 0 0 2px #001716, 0 0 6px #f92aad99, 0 0 14px #f92aad55; }\n";
	const css = () => themeCss(appCss, { ...themeVariants(family.value, mode.value), font: host.font() }) + (family.value === "synthwave" ? GLOW : "");
	const build = () => {
		const s = settings();
		return buildSite(host.notes(), host.attachments(), { title: s.title, css: css(), footer: s.footer, media: s.media, calendar: s.calendar, logo: s.logo, logoOnly: s.logoOnly, layout: s.layout, sidebar: s.sidebar, social: s.social, share: s.share, properties: s.properties, support: { kofi: s.kofi, patreon: s.patreon, label: s.label, url: s.url, note: s.note } });
	};

	let site = null, timer;
	function refresh() {
		site = build();
		const n = site.pages.length;
		count.textContent = n ? `${n} published note${n === 1 ? "" : "s"}${site.skipped.length ? ` · ${site.skipped.length} audio or video file${site.skipped.length === 1 ? "" : "s"} left out` : ""}` : "No notes are published yet. Set a note's publish property to true to put it on the site.";
		const was = pick.value || SITE_FILES.index;
		pick.replaceChildren(new Option("Front page", SITE_FILES.index), ...site.pages.filter((p) => p.file !== SITE_FILES.index).map((p) => new Option(p.title, p.file)));
		pick.value = [...pick.options].some((o) => o.value === was) ? was : SITE_FILES.index;
		show();
	}
	const blobs = new Map(); // vault path -> data: URL, for the preview's pictures (a sandboxed frame can't read blob: URLs)
	async function show() {
		// The page with its stylesheet inlined and its pictures from this device.
		const file = pick.value, dir = file.split("/").slice(0, -1);
		let page = (site.files.get(file) || "").replace(/<link rel="stylesheet" href="[^"]*">/, () => `<style>${site.files.get(SITE_FILES.style)}</style>`);
		const srcs = [...new Set([...page.matchAll(/src="([^"]+)"/g)].map((m) => m[1]))];
		for (const src of srcs) {
			const parts = [...dir];
			for (const seg of src.split("/").map(decodeURIComponent)) seg === ".." ? parts.pop() : parts.push(seg);
			const v = site.files.get(parts.join("/"));
			if (!v?.attachment) continue;
			if (!blobs.has(v.attachment)) blobs.set(v.attachment, Promise.resolve().then(() => host.blob(v.attachment)).then(dataURL).catch(() => ""));
			const url = await blobs.get(v.attachment);
			if (url) page = page.split(`src="${src}"`).join(`src="${url}"`);
		}
		if (pick.value === file) preview.srcdoc = page;
	}
	pick.addEventListener("change", show);
	form.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 250); });
	form.addEventListener("submit", (e) => e.preventDefault());

	go.addEventListener("click", async () => {
		const was = go.textContent;
		go.disabled = true;
		go.textContent = "Working…";
		try {
			site = build();
			if (!site.pages.length) return host.toast("Publish a note first: set its publish property to true.");
			const { default: JSZip } = await import("jszip");
			const zip = new JSZip();
			const missing = [];
			for (const [path, v] of site.files) {
				if (typeof v === "string") zip.file(path, v);
				else {
					try { zip.file(path, await host.blob(v.attachment)); } catch { missing.push(v.attachment); }
				}
			}
			const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
			download(blob, (site.title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "website") + ".zip");
			const s = settings();
			const pagesNow = [...site.files.keys()].filter((p) => p.endsWith(".html"));
			const gone = (saved.last || []).filter((p) => !pagesNow.includes(p));
			Object.assign(saved, s, { last: pagesNow });
			save(saved);
			told(gone, missing);
		} catch (e) {
			host.toast("Couldn't export the website: " + e.message);
		} finally {
			go.disabled = false;
			go.textContent = was;
		}
	});

	ghGo.addEventListener("click", async () => {
		const was = ghGo.textContent;
		ghGo.disabled = go.disabled = true;
		try {
			site = build();
			if (!site.pages.length) return host.toast("Publish a note first: set its publish property to true.");
			const s = settings();
			keepToken(ghKeep.checked ? ghToken.value.trim() : "");
			const lasts = saved.ghLast || {};
			const key = s.ghRepo.toLowerCase();
			const r = await publishToGitHub({ token: ghToken.value, repo: s.ghRepo, branch: s.ghBranch, files: site.files, read: host.blob, last: lasts[key] || [], progress: (t) => (ghGo.textContent = t) });
			Object.assign(saved, s, { ghLast: { ...lasts, [key]: r.paths } });
			save(saved);
			const a = Object.assign(document.createElement("a"), { href: r.url, target: "_blank", rel: "noopener", textContent: r.url });
			const first = p("");
			first.append(r.changed || r.deleted ? `Published to GitHub (${r.changed} file${r.changed === 1 ? "" : "s"} changed${r.deleted ? `, ${r.deleted} removed` : ""}). Your site: ` : "Nothing had changed since the last publish. Your site: ", a, r.changed || r.deleted ? ". GitHub takes a minute or two to update it." : "");
			after.replaceChildren(first, ...(r.pagesNote ? [p(r.pagesNote)] : []), ...(r.missing.length ? [p("These files couldn't be read on this device, so they weren't sent:"), list(r.missing)] : []));
		} catch (e) {
			after.replaceChildren(p("Couldn't publish to GitHub: " + e.message));
		} finally {
			ghGo.disabled = go.disabled = false;
			ghGo.textContent = was;
		}
	});

	const p = (words) => Object.assign(document.createElement("p"), { textContent: words });
	const list = (items) => { const ul = document.createElement("ul"); for (const i of items) ul.append(Object.assign(document.createElement("li"), { textContent: i })); return ul; };
	function told(gone, missing) {
		const first = p("Downloaded. To put it online with Neocities: unzip it, open your site's dashboard on neocities.org, and drag the files and folders in. It works the same with Netlify Drop or Cloudflare Pages, or anywhere that takes a folder of web pages. ");
		first.append(helpLink("neocities", "Step-by-step help"), ".");
		after.replaceChildren(
			first,
			...(gone.length ? [p("These pages were on the site last time and aren't now. Delete them from your host so they're not still online:"), list(gone)] : []),
			...(missing.length ? [p("These files couldn't be read on this device, so they're not in the zip:"), list(missing)] : []),
		);
	}

	function close() {
		clearTimeout(timer);
		Object.assign(saved, settings());
		save(saved);
		wrap.remove();
		document.removeEventListener("keydown", esc, true);
		open = null;
		back?.focus?.();
	}
	const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
	x.addEventListener("click", close);
	wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
	document.addEventListener("keydown", esc, true);
	open = { close };
	title.focus();
	refresh();
}

// The guides on the product site (site/public/help.html).
const helpLink = (part, words) => Object.assign(document.createElement("a"), { href: `https://wr1t3r.app/help.html#${part}`, target: "_blank", rel: "noopener", textContent: words });

const dataURL = (blob) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(blob); });

function download(blob, name) {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = name;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
