// The medication chart: the medicine list as a table, a row per medicine and
// a column per time of day, like the sheets a clinic hands out. Two ways to
// see it: the day's log, filled in from the Meds panel's Take buttons (✓ given,
// with when and by whom; X due), and the blank sheet (an X at each medicine's
// times, nothing logged) to print and tick by hand. Opened from the Meds
// panel's Chart button; Print sends either to the browser's print dialog. The
// table is made by medChart in src/meds.js.

import { medChart } from "./meds.js";

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = (day, n) => { const [y, m, d] = day.split("-").map(Number); return isoOf(new Date(y, m - 1, d + n)); };
const dayTitle = (day) => new Date(day + "T12:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

// "08:00" -> "8am", "20:30" -> "8:30pm".
function clock(hhmm) {
	const [h, m] = hhmm.split(":").map(Number);
	return `${h % 12 || 12}${m ? ":" + pad(m) : ""}${h < 12 ? "am" : "pm"}`;
}

const PRINT_CSS = `
body { font: 11pt/1.35 system-ui, sans-serif; color: #000; margin: 0; }
h1 { font-size: 15pt; margin: 0 0 2pt; } .medchart-day { margin: 0 0 10pt; color: #444; }
table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #000; padding: 4pt 5pt; vertical-align: middle; }
th { font-size: 10pt; } td.medchart-cell { text-align: center; width: 1%; white-space: nowrap; }
.medchart-name small, .medchart-meta { display: block; color: #444; font-size: 9pt; }
tr.medchart-off { color: #777; } .medchart-pill { display: none; }
@page { size: landscape; margin: 12mm; }`;

// title: whose chart ("Mom's medicines"); day: the day it opens on;
// meds: the parsed list; takenOn(day): that day's log entries;
// pill(med): a small picture of the pill, or null.
export function openMedChart({ title, meds, day, takenOn = () => [], pill = () => null, blank = false }) {
	document.querySelector(".palette")?.remove();
	const wrap = el("div", "palette");
	wrap.setAttribute("role", "dialog");
	wrap.setAttribute("aria-label", title);
	const box = el("div", "palette-box medchart-box");
	wrap.append(box);
	const back = document.activeElement;
	const close = () => {
		wrap.remove();
		document.removeEventListener("keydown", esc, true);
		back?.focus?.();
	};
	const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
	document.addEventListener("keydown", esc, true);
	wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) { e.preventDefault(); close(); } });

	let shown = day;
	const draw = () => {
		box.replaceChildren();
		const head = el("div", "medchart-head");
		const nav = el("div", "medchart-nav");
		const btn = (text, label, fn, cls = "planner-link") => { const b = el("button", cls, text); b.type = "button"; if (label) b.setAttribute("aria-label", label); b.addEventListener("click", fn); return b; };
		const tab = (text, on, fn) => { const b = btn(text, null, fn, "planner-day"); b.setAttribute("aria-pressed", String(on)); return b; };
		nav.append(tab("Day log", !blank, () => { blank = false; draw(); }), tab("Blank sheet", blank, () => { blank = true; draw(); }));
		if (!blank) nav.append(btn("‹", "Day before", () => { shown = shift(shown, -1); draw(); }), btn("Today", null, () => { shown = isoOf(new Date()); draw(); }), btn("›", "Day after", () => { shown = shift(shown, 1); draw(); }));
		head.append(el("div", "ingredient-title", title), nav);
		box.append(head, el("p", "medchart-day", blank ? "Every medicine on the list, with an X at each time it's taken." : dayTitle(shown) + " · filled in as doses are logged with Take"));

		const { times, rows } = medChart(meds, shown, takenOn(shown));
		const anyPrn = rows.some((r) => r.med.asNeeded);
		const now = new Date(), today = isoOf(now), mins = now.getHours() * 60 + now.getMinutes();
		const table = el("table", "medchart");
		const hr = el("tr");
		for (const h of ["Name", "Purpose", "Schedule and comments", ...times.map(clock), ...(anyPrn ? ["As needed"] : [])]) hr.append(el("th", null, h));
		table.append(el("thead"), el("tbody"));
		table.tHead.append(hr);
		for (const r of rows) {
			const tr = el("tr", r.active || blank ? null : "medchart-off");
			const name = el("td", "medchart-name");
			const pic = pill(r.med);
			if (pic) name.append(pic);
			name.append(el("span", null, r.med.name));
			tr.append(name, el("td", null, r.med.purpose || ""), el("td", null, r.schedule));
			for (const t of times) {
				const c = r.cells[t];
				const td = el("td", "medchart-cell");
				if (blank) {
					if (c) { td.classList.add("medchart-due"); td.textContent = "X"; }
				} else if (c?.due && c.given) {
					td.classList.add("medchart-given");
					td.append(el("span", null, "✓"), el("span", "medchart-meta", [c.given.time && clock(c.given.time), c.given.by].filter(Boolean).join(" · ")));
				} else if (c?.due) {
					const late = shown < today || (shown === today && Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + 60 < mins);
					td.classList.add(late ? "medchart-late" : "medchart-due");
					td.textContent = "X";
					td.title = late ? "Not logged" : "Due";
				} else if (c) {
					td.textContent = "–";
					td.title = "Not on this day";
				}
				tr.append(td);
			}
			if (anyPrn) {
				const td = el("td", "medchart-cell");
				if (blank) td.textContent = r.med.asNeeded ? "As needed" : "";
				else if (r.med.asNeeded && r.active) {
					td.append(el("span", null, r.given.length ? `✓ ${r.given.length}` : "As needed"));
					if (r.given.length) td.append(el("span", "medchart-meta", r.given.map((g) => g.time ? clock(g.time) : "").filter(Boolean).join(", ")));
				}
				tr.append(td);
			}
			table.tBodies[0].append(tr);
		}
		const scroll = el("div", "medchart-scroll");
		scroll.append(table);
		box.append(scroll);
		if (!rows.length) box.append(el("p", "ingredient-hint", "Nothing on the list yet."));
		const foot = el("div", "ingredient-buttons");
		foot.append(btn("Close", null, close, ""), btn("Print", null, () => print(title, blank ? null : shown, table), "ingredient-add"));
		box.append(foot);
	};
	draw();
	document.body.append(wrap);
	box.querySelector(".ingredient-add")?.focus();
}

function print(title, day, table) {
	document.querySelector("iframe.print-frame")?.remove();
	const f = document.createElement("iframe");
	f.className = "print-frame";
	f.setAttribute("aria-hidden", "true");
	Object.assign(f.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
	const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
	f.addEventListener("load", () => { f.contentWindow.focus(); f.contentWindow.print(); }, { once: true });
	f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body><h1>${esc(title)}</h1>${day ? `<p class="medchart-day">${esc(dayTitle(day))}</p>` : ""}${table.outerHTML}</body></html>`;
	document.body.append(f);
}
