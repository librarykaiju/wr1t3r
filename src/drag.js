// Drag to reorder, with a mouse or a finger: the corkboard's cards, the
// outliner's rows, and any other list of things that can be put in order.
//
//   sortable(list, { item, group, layout, onDrop, into, onHold })
//
// list:   the element holding the items.
// item:   a selector for the items that move (direct or nested in list).
// group:  lists sharing a group name take drops from each other.
// layout: "grid" (before/after by left and right halves) or "list" (by top
//         and bottom halves).
// into(el): true for items that take things dropped on their middle (a
//         folder's card), reported as { into: el }.
// onDrop({ el, from, to, source, target, into }): from is el's index among
//         source's items; to is the index it should have among target's items
//         once it's taken out of source. Not called for a drop where it was.
// onHold(el, x, y): a long press that let go without moving (on touch this is
//         the menu; a mouse uses right-click).
//
// A mouse drags after moving a few pixels. A finger holds still for a moment
// first, so swiping still scrolls. Escape cancels. Returns { destroy }.

const lists = new Map(); // group -> Set of registered lists
const EDITING = "input, textarea, select, [contenteditable=''], [contenteditable=true], .no-drag";

export function sortable(list, opts) {
	const o = { item: "[data-sort]", group: null, layout: "grid", onDrop: () => {}, into: null, onHold: null, holdMs: 350, ...opts };
	const reg = { list, o };
	const group = o.group || reg;
	if (!lists.has(group)) lists.set(group, new Set());
	lists.get(group).add(reg);

	let press = null; // { el, x, y, id, type, timer, active, ghost, dx, dy, drop }

	const itemsOf = (l, lo) => [...l.querySelectorAll(lo.item)].filter((el) => owner(el) === l);
	// The registered list an item belongs to (the nearest one up the tree).
	function owner(el) {
		let best = null;
		for (const r of lists.get(group)) if (r.list.contains(el) && (!best || best.contains(r.list))) best = r.list;
		return best;
	}

	function down(e) {
		if (press || (e.pointerType === "mouse" && e.button !== 0)) return;
		const el = e.target.closest(o.item);
		// (Only boxes inside the item count: a list can sit in an editor, whose
		// whole content is contenteditable.)
		const editing = e.target.closest(EDITING);
		if (!el || owner(el) !== list || (editing && el.contains(editing))) return;
		press = { el, x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType, active: false, drop: null };
		if (e.pointerType !== "mouse") press.timer = setTimeout(() => begin(), o.holdMs);
		window.addEventListener("pointermove", move, true);
		window.addEventListener("pointerup", up, true);
		window.addEventListener("pointercancel", cancel, true);
		window.addEventListener("keydown", key, true);
		window.addEventListener("touchmove", blockScroll, { passive: false, capture: true });
	}

	function begin() {
		if (!press || press.active) return;
		const { el } = press;
		const r = el.getBoundingClientRect();
		press.active = true;
		press.dx = press.x - r.left;
		press.dy = press.y - r.top;
		const ghost = el.cloneNode(true);
		ghost.classList.add("sort-ghost");
		ghost.removeAttribute("id");
		Object.assign(ghost.style, { position: "fixed", left: "0", top: "0", width: r.width + "px", height: r.height + "px", margin: "0", pointerEvents: "none", zIndex: "80", transform: `translate(${r.left}px, ${r.top}px)` });
		document.body.append(ghost);
		press.ghost = ghost;
		el.classList.add("sort-dragging");
		document.documentElement.classList.add("sorting");
		if (press.type !== "mouse") navigator.vibrate?.(8);
		getSelection()?.removeAllRanges();
		place(press.x, press.y);
	}

	function blockScroll(e) { if (press?.active) e.preventDefault(); }

	function move(e) {
		if (!press || e.pointerId !== press.id) return;
		const far = Math.hypot(e.clientX - press.x, e.clientY - press.y);
		if (!press.active) {
			if (press.type === "mouse" && far > 6) begin();
			else if (press.type !== "mouse" && far > 10) return end(); // a swipe: let it scroll
			if (!press?.active) return;
		}
		e.preventDefault();
		press.ghost.style.transform = `translate(${e.clientX - press.dx}px, ${e.clientY - press.dy}px)`;
		place(e.clientX, e.clientY);
		scrollNear(e.clientX, e.clientY);
	}

	// Where a drop at (x, y) would land, marked on the page.
	function place(x, y) {
		clearMarks();
		const drop = dropAt(x, y);
		press.drop = drop;
		if (!drop) return;
		if (drop.into) drop.into.classList.add("sort-into");
		else if (drop.mark) drop.mark.classList.add(drop.after ? "sort-after" : "sort-before");
		else drop.target.classList.add("sort-over");
	}

	function dropAt(x, y) {
		let target = null, area = Infinity;
		for (const r of lists.get(group)) {
			if (press.el.contains(r.list)) continue; // not into itself
			const b = r.list.getBoundingClientRect();
			if (!b.width || x < b.left || x > b.right || y < b.top || y > b.bottom) continue;
			const size = b.width * b.height;
			if (size < area) { target = r; area = size; } // the innermost list
		}
		if (!target) return null;
		const items = itemsOf(target.list, target.o).filter((el) => el !== press.el && !press.el.contains(el));
		if (!items.length) return { target: target.list, index: 0 };
		const grid = target.o.layout === "grid";
		let best = null, dist = Infinity;
		for (const el of items) {
			const b = el.getBoundingClientRect();
			const dx = x < b.left ? b.left - x : x > b.right ? x - b.right : 0;
			const dy = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
			const d = Math.hypot(dx, grid ? dy * 2 : dy);
			if (d < dist) { dist = d; best = { el, b }; }
		}
		const { el, b } = best;
		if (dist === 0 && target.o.into?.(el)) {
			const inner = grid ? (x - b.left) / b.width : (y - b.top) / b.height;
			if (inner > 0.25 && inner < 0.75) return { target: target.list, into: el };
		}
		const after = grid ? (y > b.bottom || (y >= b.top && x > b.left + b.width / 2)) : y > b.top + b.height / 2;
		const index = items.indexOf(el) + (after ? 1 : 0);
		return { target: target.list, index, mark: el, after };
	}

	let scroller = null, scrollTimer = null;
	function scrollNear(x, y) {
		scroller ??= scrollParent(list);
		cancelAnimationFrame(scrollTimer);
		if (!scroller) return;
		const b = scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
		const edge = 56;
		const speed = y < b.top + edge ? -(b.top + edge - y) : y > b.bottom - edge ? y - (b.bottom - edge) : 0;
		if (!speed) return;
		const step = () => {
			if (!press?.active) return;
			scroller.scrollTop += Math.max(-24, Math.min(24, speed / 3));
			place(x, y);
			scrollTimer = requestAnimationFrame(step);
		};
		scrollTimer = requestAnimationFrame(step);
	}

	function up(e) {
		if (!press || e.pointerId !== press.id) return;
		const p = press;
		if (!p.active) {
			// Let go before the long press started: an ordinary tap.
			return end();
		}
		const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10;
		const drop = p.drop;
		end();
		// A click follows the pointerup; it shouldn't open the card.
		const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
		window.addEventListener("click", swallow, { capture: true, once: true });
		setTimeout(() => window.removeEventListener("click", swallow, true), 0);
		if (!moved && p.type !== "mouse") return o.onHold?.(p.el, p.x, p.y);
		if (!drop) return;
		const source = owner(p.el);
		const sourceReg = [...lists.get(group)].find((r) => r.list === source);
		const from = itemsOf(source, sourceReg.o).indexOf(p.el);
		if (drop.into) return o.onDrop({ el: p.el, from, to: null, source, target: drop.target, into: drop.into });
		if (drop.target === source && drop.index === from) return;
		o.onDrop({ el: p.el, from, to: drop.index, source, target: drop.target, into: null });
	}

	function cancel(e) { if (press && (!e.pointerId || e.pointerId === press.id)) end(); }
	function key(e) { if (e.key === "Escape" && press) { e.preventDefault(); e.stopPropagation(); end(); } }

	function end() {
		if (!press) return;
		clearTimeout(press.timer);
		cancelAnimationFrame(scrollTimer);
		press.ghost?.remove();
		press.el.classList.remove("sort-dragging");
		document.documentElement.classList.remove("sorting");
		clearMarks();
		press = null;
		scroller = null;
		window.removeEventListener("pointermove", move, true);
		window.removeEventListener("pointerup", up, true);
		window.removeEventListener("pointercancel", cancel, true);
		window.removeEventListener("keydown", key, true);
		window.removeEventListener("touchmove", blockScroll, { capture: true });
	}

	// A long press on iOS would pop the page's own menu over the drag.
	const noMenu = (e) => { if (press?.active) e.preventDefault(); };
	list.addEventListener("pointerdown", down);
	list.addEventListener("contextmenu", noMenu);
	return {
		destroy() {
			end();
			list.removeEventListener("pointerdown", down);
			list.removeEventListener("contextmenu", noMenu);
			lists.get(group)?.delete(reg);
			if (!lists.get(group)?.size) lists.delete(group);
		},
	};
}

function clearMarks() {
	document.querySelectorAll(".sort-before, .sort-after, .sort-into, .sort-over").forEach((el) => el.classList.remove("sort-before", "sort-after", "sort-into", "sort-over"));
}

function scrollParent(el) {
	for (let n = el; n && n !== document.body; n = n.parentElement) {
		const s = getComputedStyle(n);
		if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
	}
	return document.scrollingElement;
}

// The new order of a list after moving the item at from to to (the index it
// should have once taken out), as onDrop reports it.
export function reorder(list, from, to) {
	const next = list.slice();
	const [x] = next.splice(from, 1);
	next.splice(to, 0, x);
	return next;
}
