// A card: the corkboard's index card, and the piece other card views (a
// gallery, a kanban board) build on. It shows a title, a few lines of text,
// an optional picture and small labels, in one of the theme's seven colors.
// Moving cards is src/drag.js's job; a card is marked data-sort for it.
//
// makeCard({
//   title, text,        what it says; dim: text is a stand-in (grayed)
//   color,              1-7 (the theme's rainbow) or null
//   badge, meta,        a small label by the title; a line at the bottom
//   cover,              an image address, or a Promise of one
//   stack,              drawn as a pile of cards (a folder)
//   placeholder,        shown in the text box while it's empty and editable
//   open(),             the title was clicked, or Enter pressed on the card
//   edit(text),         the text was changed (the text is editable when given)
//   menu(x, y),         right-click, or the ⋯ button
// })

export function makeCard(c) {
	const card = document.createElement("article");
	card.className = "card" + (c.stack ? " card-stack" : "");
	card.dataset.sort = "";
	card.tabIndex = 0;
	if (c.color) card.style.setProperty("--cc", `var(--f${c.color})`);
	else card.classList.add("no-color");

	if (c.cover) {
		const img = document.createElement("img");
		img.className = "card-cover";
		img.alt = "";
		img.decoding = "async";
		img.draggable = false;
		img.referrerPolicy = "no-referrer";
		img.addEventListener("error", () => img.remove());
		Promise.resolve(c.cover).then((u) => { if (u) img.src = u; else img.remove(); }, () => img.remove());
		card.append(img);
	}

	const head = document.createElement("div");
	head.className = "card-head";
	const title = document.createElement("button");
	title.type = "button";
	title.className = "card-title";
	title.textContent = c.title;
	title.title = "Open";
	title.addEventListener("click", (e) => { e.stopPropagation(); c.open?.(); });
	head.append(title);
	if (c.badge) {
		const b = document.createElement("span");
		b.className = "card-badge";
		b.textContent = c.badge;
		head.append(b);
	}
	if (c.menu) {
		const more = document.createElement("button");
		more.type = "button";
		more.className = "card-more";
		more.textContent = "⋯";
		more.setAttribute("aria-label", `More for ${c.title}`);
		more.addEventListener("click", (e) => {
			e.stopPropagation();
			const r = more.getBoundingClientRect();
			c.menu(r.left, r.bottom + 4);
		});
		head.append(more);
		card.addEventListener("contextmenu", (e) => { if (e.target.closest("textarea")) return; e.preventDefault(); c.menu(e.clientX, e.clientY); });
	}

	const text = document.createElement("p");
	text.className = "card-text" + (c.dim ? " dim" : "");
	text.textContent = c.text || (c.edit ? c.placeholder || "" : "");
	if (!c.text && c.edit) text.classList.add("dim");
	card.append(head, text);

	if (c.edit) {
		text.classList.add("editable");
		text.title = "Click to edit";
		text.addEventListener("click", (e) => { e.stopPropagation(); editText(card, text, c); });
	}

	if (c.meta) {
		const foot = document.createElement("div");
		foot.className = "card-meta";
		foot.textContent = c.meta;
		card.append(foot);
	}

	card.addEventListener("keydown", (e) => {
		if (e.target !== card) return;
		if (e.key === "Enter") { e.preventDefault(); c.open?.(); }
		if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && c.menu) {
			e.preventDefault();
			const r = card.getBoundingClientRect();
			c.menu(r.left + 12, r.top + 12);
		}
	});
	return card;
}

// The card's text as a box to type in: Enter or leaving saves, Escape doesn't,
// Shift+Enter is a new line.
function editText(card, p, c) {
	if (card.querySelector("textarea")) return;
	const box = document.createElement("textarea");
	box.className = "card-edit";
	box.value = c.dim ? "" : c.text || "";
	box.placeholder = c.placeholder || "";
	box.rows = 4;
	p.replaceWith(box);
	card.classList.add("editing");
	box.focus();
	box.setSelectionRange(box.value.length, box.value.length);
	let done = false;
	const finish = (save) => {
		if (done) return;
		done = true;
		card.classList.remove("editing");
		box.replaceWith(p);
		const v = box.value.replace(/\s+/g, " ").trim();
		if (save && v !== (c.dim ? "" : (c.text || "").trim())) {
			p.textContent = v || c.placeholder || "";
			p.classList.toggle("dim", !v);
			c.edit(v);
		}
	};
	box.addEventListener("keydown", (e) => {
		e.stopPropagation();
		if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(true); card.focus(); }
		if (e.key === "Escape") { e.preventDefault(); finish(false); card.focus(); }
	});
	box.addEventListener("blur", () => finish(true));
}

// Keyboard reordering: Alt+Arrow keys on a focused card call move(delta).
export function arrowMoves(el, move, layout = "grid") {
	el.addEventListener("keydown", (e) => {
		if (!e.altKey || e.target.closest("textarea, input")) return;
		const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[e.key];
		if (!d || (layout === "list" && (e.key === "ArrowLeft" || e.key === "ArrowRight"))) return;
		e.preventDefault();
		move(d);
	});
}
