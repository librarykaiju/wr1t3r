// A picker over a list, opened from the keyboard: the quick switcher
// (Ctrl/Cmd+O, notes by name), the command palette (Ctrl/Cmd+P) and the
// template list use it. Type to filter (letters in order, not necessarily
// together), arrows to move, Enter to pick, Escape to close.

// How well query matches text: null when it doesn't, else a score where
// higher is better (runs of letters together, a start-of-word hit and a
// short text all help).
export function fuzzy(query, text) {
	const q = query.toLowerCase().replace(/\s+/g, "");
	if (!q) return 0;
	const t = text.toLowerCase();
	const at = t.indexOf(q);
	if (at >= 0) return 1000 - at * 2 - t.length + (at === 0 || /[\s/_-]/.test(t[at - 1]) ? 200 : 0);
	let score = 0, pos = -1, run = 0;
	for (const ch of q) {
		const next = t.indexOf(ch, pos + 1);
		if (next < 0) return null;
		run = next === pos + 1 ? run + 1 : 0;
		score += 10 + run * 15 + (next === 0 || /[\s/_-]/.test(t[next - 1]) ? 20 : 0) - Math.min(next - pos - 1, 10);
		pos = next;
	}
	return score - t.length / 4;
}

// items: [{ label, detail?, keywords?, run() }]; empty(query) may return an
// extra item for when nothing matches (like "Create note"). Resolves when closed.
export function openPalette({ placeholder, items, empty, limit = 60 }) {
	document.querySelector(".palette")?.remove();
	const wrap = document.createElement("div");
	wrap.className = "palette";
	wrap.setAttribute("role", "dialog");
	wrap.setAttribute("aria-label", placeholder);
	const box = document.createElement("div");
	box.className = "palette-box";
	const input = document.createElement("input");
	input.type = "text";
	input.placeholder = placeholder;
	input.setAttribute("aria-label", placeholder);
	input.setAttribute("autocomplete", "off");
	input.spellcheck = false;
	const list = document.createElement("ul");
	list.setAttribute("role", "listbox");
	box.append(input, list);
	wrap.append(box);
	document.body.append(wrap);
	const back = document.activeElement;

	let shown = [], sel = 0;
	const draw = () => {
		const q = input.value.trim();
		shown = q
			? items.map((it, i) => ({ it, i, s: fuzzy(q, it.label + (it.keywords ? " " + it.keywords : "")) })).filter((x) => x.s != null).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.it)
			: items.slice();
		shown = shown.slice(0, limit);
		const extra = q && empty ? empty(q) : null;
		if (extra && !shown.some((it) => it.label.toLowerCase() === q.toLowerCase())) shown.push(extra);
		sel = Math.min(sel, Math.max(0, shown.length - 1));
		list.replaceChildren(...shown.map((it, i) => {
			const li = document.createElement("li");
			li.setAttribute("role", "option");
			li.setAttribute("aria-selected", String(i === sel));
			const l = document.createElement("span");
			l.className = "label";
			l.textContent = it.label;
			li.append(l);
			if (it.detail) {
				const d = document.createElement("span");
				d.className = "detail";
				d.textContent = it.detail;
				li.append(d);
			}
			li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(i); });
			return li;
		}));
		if (!shown.length) list.append(Object.assign(document.createElement("li"), { className: "none", textContent: "Nothing matches." }));
		list.children[sel]?.scrollIntoView?.({ block: "nearest" });
	};
	const close = (refocus = true) => {
		wrap.remove();
		if (refocus) back?.focus?.();
	};
	const pick = (i) => {
		const it = shown[i];
		if (!it) return;
		close(false);
		it.run();
	};
	input.addEventListener("input", () => { sel = 0; draw(); });
	input.addEventListener("keydown", (e) => {
		if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); draw(); }
		else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
		else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
		else if (e.key === "Escape") { e.preventDefault(); close(); }
	});
	wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) { e.preventDefault(); close(); } });
	draw();
	input.focus();
}
