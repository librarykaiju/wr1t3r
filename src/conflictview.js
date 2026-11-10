// The conflict copy dialog: what a "Note (conflict DATE).md" copy has that
// the note doesn't (and the other way round), and three ways to settle it.
// src/conflict.js does the merging.

import { lineDiff } from "./history.js";
import { mergeLines, diffCounts } from "./conflict.js";

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const lines = (n) => `${n} line${n === 1 ? "" : "s"}`;

let open = null;

// host: { name, original: name of the note it came from, day, originalText(), copyText(),
//         keepOriginal(), useCopy(), merge(text) } (each settle step returns a Promise)
export function openConflict(host) {
	open?.close();
	const back = document.activeElement;
	const wrap = el("div", "palette compile history conflict");
	wrap.setAttribute("role", "dialog");
	wrap.setAttribute("aria-label", "Conflict copy");
	const box = el("div", "compile-box history-box conflict-box");
	const head = el("header", "compile-head");
	const x = el("button", "quiet", "×");
	x.type = "button";
	x.setAttribute("aria-label", "Close");
	head.append(el("h2", null, `Settle the conflict: ${host.original}`), x);

	const a = host.originalText(), b = host.copyText();
	const { added, removed } = diffCounts(a, b);
	const why = el("p", "conflict-why",
		`“${host.original}” was changed in two places${host.day ? ` around ${host.day}` : ""} before they synced, so wr1t3r kept both. `
		+ (a === b ? "The two are now the same, so the copy can go." : `The copy has ${lines(added)} the note doesn't, and is missing ${lines(removed)} the note has.`));
	const key = el("p", "conflict-key");
	key.append(el("span", "history-line del", "Only in the note"), el("span", "history-line add", "Only in the copy"));

	const diff = el("div", "history-diff");
	const all = lineDiff(a, b);
	let skipped = 0;
	const flush = () => { if (skipped) diff.append(el("div", "history-skip", `${skipped} matching line${skipped === 1 ? "" : "s"}`)); skipped = 0; };
	all.forEach((l, i) => {
		const near = l.op !== "same" || all.slice(Math.max(0, i - 2), i + 3).some((m) => m.op !== "same");
		if (!near) { skipped++; return; }
		flush();
		const row = el("div", "history-line " + l.op, l.text || " ");
		row.prepend(el("span", "history-mark", l.op === "add" ? "+" : l.op === "del" ? "−" : " "));
		diff.append(row);
	});
	flush();

	const actions = el("div", "conflict-actions");
	const button = (label, title, cls, fn) => {
		const btn = el("button", cls, label);
		btn.type = "button";
		btn.title = title;
		btn.addEventListener("click", async () => { actions.querySelectorAll("button").forEach((n) => (n.disabled = true)); await fn(); close(); });
		actions.append(btn);
		return btn;
	};
	if (a === b) {
		button("Delete the copy", "The note already has everything in it", "props-btn props-primary", () => host.keepOriginal());
	} else {
		button("Keep lines from both", `Every line from either version goes into “${host.original}” (a task ticked on either side stays ticked), and the copy is deleted.`, "props-btn props-primary", () => host.merge(mergeLines(a, b)));
		button("Keep the note", `“${host.original}” stays as it is and the copy is deleted`, "props-btn", () => host.keepOriginal());
		button("Use the copy", `“${host.original}” takes the copy's text and the copy is deleted`, "props-btn", () => host.useCopy());
	}
	const later = el("button", "quiet", "Decide later");
	later.type = "button";
	later.addEventListener("click", () => close());
	actions.append(later);

	const side = el("div", "history-side");
	side.append(why, key, diff, actions);
	box.append(head, side);
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
	actions.querySelector("button")?.focus();
}
