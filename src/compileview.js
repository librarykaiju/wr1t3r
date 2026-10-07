// The Compile dialog: settings on one side, a live preview of the book on the
// other, and a button per format. Settings are saved in the folder's binder
// (src/compile.js writeCompileSettings) when something is exported.
//
// host: {
//   folder, label,               the folder, and its name
//   parts(),                     reading order (src/scrivenings.js readingOrder)
//   text(path),                  a note's text
//   embed(name),                 the text of a note ![[embedded]] in another, or null
//   settings(),                  the saved settings (the binder's compile:)
//   saveSettings(s),             save them
//   image(name),                 a vault picture as a Blob, or null
//   saveToVault(name, text),     keep the markdown as a note
//   toast(text),
//   single,                      true when exporting one note: no binder
//                                settings, headings or separators, and no
//                                Save to vault
// }

import { compileMarkdown, compileSettings, HEADINGS, SEPARATORS, LAYOUTS } from "./compile.js";
import { isManuscript } from "./manuscript.js";
import { isScript } from "./script.js";

let open = null;

export function openCompile(host) {
	open?.close();
	// With no layout saved, notes marked cssclasses: script or manuscript pick it.
	const raw = host.settings() || {};
	const notesThat = (is) => host.parts().some((p) => p.kind === "note" && is(host.text(p.path)));
	const auto = raw.layout ? {} : { layout: notesThat(isScript) ? "script" : notesThat(isManuscript) ? "manuscript" : "book" };
	const settings = compileSettings({ ...raw, ...auto });
	const back = document.activeElement;
	const wrap = document.createElement("div");
	wrap.className = "palette compile";
	wrap.setAttribute("role", "dialog");
	wrap.setAttribute("aria-label", `${host.single ? "Export" : "Compile"} ${host.label}`);
	const box = document.createElement("div");
	box.className = "compile-box";

	const head = document.createElement("header");
	head.className = "compile-head";
	const h = document.createElement("h2");
	h.textContent = `${host.single ? "Export or print" : "Compile"} “${host.label}”`;
	const x = document.createElement("button");
	x.type = "button";
	x.className = "quiet";
	x.textContent = "×";
	x.setAttribute("aria-label", "Close");
	head.append(h, x);

	const form = document.createElement("form");
	form.className = "compile-form";
	const field = (label, input) => {
		const l = document.createElement("label");
		const span = document.createElement("span");
		span.textContent = label;
		l.append(span, input);
		form.append(l);
		return input;
	};
	const text = (value, placeholder) => Object.assign(document.createElement("input"), { type: "text", value, placeholder });
	const select = (options, value) => {
		const s = document.createElement("select");
		for (const [k, v] of Object.entries(options)) s.append(new Option(v, k, false, k === value));
		return s;
	};
	const title = field("Title", text(settings.title, "For a title page (optional)"));
	const author = field("Author", text(settings.author, "Optional"));
	const headings = select(HEADINGS, settings.headings);
	const separator = select(SEPARATORS, settings.separator);
	if (!host.single) { field("Headings", headings); field("Between notes", separator); }
	const layout = field("Layout", select(LAYOUTS, settings.layout));
	const stats = document.createElement("p");
	stats.className = "hint";
	form.append(stats);
	const actions = document.createElement("div");
	actions.className = "compile-actions";
	const button = (label, hint, run) => {
		const b = document.createElement("button");
		b.type = "button";
		b.textContent = label;
		b.title = hint;
		b.addEventListener("click", () => act(b, run));
		actions.append(b);
		return b;
	};
	form.append(actions);
	const note = document.createElement("p");
	note.className = "hint";
	note.textContent = host.single
		? "Properties, %% comments %% and block ids are left out."
		: "Notes with compile: false or status: cut are left out. Properties, %% comments %% and block ids never go in.";
	form.append(note);

	const preview = document.createElement("iframe");
	preview.className = "compile-preview";
	preview.title = "Preview";
	preview.setAttribute("sandbox", "");

	const grid = document.createElement("div");
	grid.className = "compile-grid";
	grid.append(form, preview);
	box.append(head, grid);
	wrap.append(box);
	document.body.append(wrap);

	const now = () => compileSettings({ title: title.value, author: author.value, headings: headings.value, separator: separator.value, layout: layout.value });
	const fileName = () => (now().title || host.label).replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Compiled";
	const md = (opts) => compileMarkdown(host.parts(), now(), host.text, { embed: host.embed, keepAll: !!host.single, ...opts });

	let exporter = null;
	const load = () => (exporter ??= import("./exporter.js"));
	let images = null; // loaded once, for the rendered formats
	const pictures = async (markdown) => {
		const ex = await load();
		images ??= await ex.prepareImages(markdown, host.image);
		return images;
	};

	let timer, seq = 0;
	async function refresh() {
		const n = ++seq;
		const plain = md({});
		const words = `${plain.words.toLocaleString()} word${plain.words === 1 ? "" : "s"}`;
		stats.textContent = host.single ? words : `${plain.notes} note${plain.notes === 1 ? "" : "s"} · ${words}`;
		try {
			const ex = await load();
			const r = md({ render: true });
			const html = ex.toHTML(r.markdown, { title: fileName(), images: await pictures(r.markdown), layout: now().layout });
			if (n === seq) preview.srcdoc = html;
		} catch (e) {
			if (n === seq) preview.srcdoc = `<p style="font:14px sans-serif;padding:1em">The preview needs a connection the first time (${String(e.message).replace(/[<>&]/g, "")}).</p>`;
		}
	}
	form.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(refresh, 250); });
	form.addEventListener("submit", (e) => e.preventDefault());

	async function act(b, run) {
		const was = b.textContent;
		b.disabled = true;
		b.textContent = "Working…";
		try {
			const s = now();
			const saved = compileSettings({ ...host.settings(), ...auto });
			if (JSON.stringify(s) !== JSON.stringify(saved)) await host.saveSettings(s);
			await run();
		} catch (e) {
			host.toast("Couldn't compile: " + e.message);
		} finally {
			b.disabled = false;
			b.textContent = was;
		}
	}

	button("Markdown", "Download a .md file", async () => download(new Blob([md({}).markdown], { type: "text/markdown" }), fileName() + ".md"));
	button("HTML", "Download a web page", async () => {
		const ex = await load();
		const r = md({ render: true });
		download(new Blob([ex.toHTML(r.markdown, { title: fileName(), images: await pictures(r.markdown), layout: now().layout })], { type: "text/html" }), fileName() + ".html");
	});
	button(host.single ? "Print / PDF" : "PDF", "Print, or save as PDF from the print dialog", async () => {
		const ex = await load();
		const r = md({ render: true });
		printHTML(ex.toHTML(r.markdown, { title: fileName(), images: await pictures(r.markdown), layout: now().layout }));
	});
	button("Word", "Download a .docx file", async () => {
		const ex = await load();
		const r = md({ render: true, titlePage: false });
		const s = now();
		const blob = await ex.toDocx(r.markdown, { title: s.title, author: s.author, images: await pictures(r.markdown), layout: s.layout });
		download(blob, fileName() + ".docx");
	});
	if (!host.single) button("Save to vault", "Keep the compiled markdown as a note in _compiled", async () => host.saveToVault(fileName(), md({}).markdown));

	function close() {
		clearTimeout(timer);
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

function download(blob, name) {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = name;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// The browser's print dialog for the page (where "Save as PDF" is).
function printHTML(html) {
	document.querySelector("iframe.print-frame")?.remove();
	const f = document.createElement("iframe");
	f.className = "print-frame";
	f.setAttribute("aria-hidden", "true");
	Object.assign(f.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
	f.addEventListener("load", () => {
		const w = f.contentWindow;
		// Pictures first, so they're on the page.
		const imgs = [...f.contentDocument.images].filter((i) => !i.complete);
		Promise.all(imgs.map((i) => new Promise((ok) => { i.onload = i.onerror = ok; }))).then(() => { w.focus(); w.print(); });
	}, { once: true });
	f.srcdoc = html;
	document.body.append(f);
}
