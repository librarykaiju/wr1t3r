// The Version history panel: the open note's earlier copies (src/history.js),
// newest first. Picking one shows what changed between it and the note now,
// and Restore puts it back.

import { lineDiff } from "./history.js";

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const words = (t) => (t.match(/\S+/g) || []).length;
const when = (at) => new Date(at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

let open = null;

// host: { path, name, current() -> text, copies() -> Promise<[{ at, text }]>, restore(text) -> Promise }
export async function openHistory(host) {
	open?.close();
	const back = document.activeElement;
	const wrap = el("div", "palette compile history");
	wrap.setAttribute("role", "dialog");
	wrap.setAttribute("aria-label", "Version history");
	const box = el("div", "compile-box history-box");
	const head = el("header", "compile-head");
	const x = el("button", "quiet", "×");
	x.type = "button";
	x.setAttribute("aria-label", "Close");
	head.append(el("h2", null, `Version history: ${host.name}`), x);
	const list = el("ol", "history-list");
	const side = el("div", "history-side");
	const bar = el("div", "history-bar");
	const diff = el("div", "history-diff");
	side.append(bar, diff);
	const body = el("div", "history-body");
	body.append(list, side);
	box.append(head, body);
	wrap.append(box);
	document.body.append(wrap);

	const close = () => {
		wrap.remove();
		document.removeEventListener("keydown", onKey, true);
		open = null;
		back?.focus?.();
	};
	const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
	document.addEventListener("keydown", onKey, true);
	x.addEventListener("click", close);
	wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
	open = { close };

	const all = await host.copies();
	if (!wrap.isConnected) return;
	if (!all.length) {
		list.remove();
		diff.append(el("p", "history-empty", "No earlier versions on this device yet. A copy is kept when the note changes, at most every 10 minutes, so editing here or syncing a change starts its history."));
		return;
	}

	function show(copy, item) {
		list.querySelectorAll(".on").forEach((n) => n.classList.remove("on"));
		item.classList.add("on");
		const now = host.current();
		const restore = el("button", "props-btn props-primary", "Restore this version");
		restore.type = "button";
		restore.disabled = copy.text === now;
		restore.addEventListener("click", async () => { await host.restore(copy.text); close(); });
		bar.replaceChildren(el("span", "history-when", copy.text === now ? "Same as the note now" : `${when(copy.at)} compared with now`), restore);
		diff.replaceChildren();
		const lines = lineDiff(copy.text, now);
		let skipped = 0;
		const flush = () => { if (skipped) diff.append(el("div", "history-skip", `${skipped} unchanged line${skipped === 1 ? "" : "s"}`)); skipped = 0; };
		lines.forEach((l, i) => {
			// Unchanged lines show only next to a change.
			const near = l.op !== "same" || lines.slice(Math.max(0, i - 2), i + 3).some((m) => m.op !== "same");
			if (!near) { skipped++; return; }
			flush();
			const row = el("div", "history-line " + l.op, l.text || " ");
			row.prepend(el("span", "history-mark", l.op === "add" ? "+" : l.op === "del" ? "−" : " "));
			diff.append(row);
		});
		flush();
	}

	const now = words(host.current());
	all.forEach((copy, i) => {
		const item = el("li");
		const b = el("button", "history-item");
		b.type = "button";
		const delta = words(copy.text) - now;
		b.append(el("span", "history-when", when(copy.at)), el("span", "history-words", `${words(copy.text).toLocaleString()} words${delta ? ` (${delta > 0 ? "+" : "−"}${Math.abs(delta).toLocaleString()} vs now)` : ""}`));
		b.addEventListener("click", () => show(copy, item));
		item.append(b);
		list.append(item);
		if (i === 0) show(copy, item);
	});
}
