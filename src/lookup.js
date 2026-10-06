// Look up: the selected word (or the one at the cursor) in a dictionary and
// thesaurus, in a box under it. Clicking a synonym puts it in place of the
// word, keeping a capital first letter. The words come from src/define.js,
// through the Worker's /api/define or, with no Worker, straight from the page.

const cache = new Map();

// The word to look up: { from, to, word }, or null.
export function wordFor(state) {
	const sel = state.selection.main;
	if (!sel.empty) {
		const text = state.sliceDoc(sel.from, sel.to).trim();
		if (/^[\p{L}'’-]+(?: [\p{L}'’-]+)?$/u.test(text) && text.length <= 60) {
			const from = sel.from + state.sliceDoc(sel.from, sel.to).indexOf(text);
			return { from, to: from + text.length, word: text };
		}
		return null;
	}
	const r = state.wordAt(sel.head);
	if (!r) return null;
	const word = state.sliceDoc(r.from, r.to);
	return /\p{L}/u.test(word) ? { from: r.from, to: r.to, word } : null;
}

// "Happy" + "glad" -> "Glad"; all caps stays all caps.
export function matchCase(original, word) {
	if (original.length > 1 && original === original.toUpperCase()) return word.toUpperCase();
	if (original[0] && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) return word[0].toUpperCase() + word.slice(1);
	return word;
}

let box = null;
function close() {
	box?.remove();
	box = null;
	document.removeEventListener("pointerdown", away, true);
	document.removeEventListener("keydown", esc, true);
}
const away = (e) => { if (box && !box.contains(e.target)) close(); };
const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };

const make = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});

export async function lookUp(view, define, toast) {
	const target = wordFor(view.state);
	if (!target) return toast?.("Select a word, or put the cursor in one, to look it up.");
	close();
	box = make("div", "lookup-pop");
	box.setAttribute("role", "dialog");
	box.setAttribute("aria-label", "Look up " + target.word);
	const head = make("div", "lookup-head");
	head.append(make("b", null, target.word));
	box.append(head, make("div", "lookup-note", "Looking it up…"));
	document.body.append(box);
	const at = view.coordsAtPos(target.to) || view.coordsAtPos(target.from);
	const place = () => {
		if (!box || !at) return;
		const w = box.offsetWidth, h = box.offsetHeight;
		box.style.left = Math.max(8, Math.min(at.left - 20, innerWidth - w - 8)) + "px";
		box.style.top = (at.bottom + 6 + h > innerHeight ? Math.max(8, at.top - h - 6) : at.bottom + 6) + "px";
	};
	place();
	document.addEventListener("pointerdown", away, true);
	document.addEventListener("keydown", esc, true);
	const mine = box;
	let data = cache.get(target.word.toLowerCase());
	if (!data) {
		try {
			data = await define(target.word);
			cache.set(target.word.toLowerCase(), data);
		} catch (e) {
			if (box !== mine) return;
			box.querySelector(".lookup-note").textContent = navigator.onLine ? "Couldn't look it up: " + e.message : "Looking up words needs a connection.";
			return place();
		}
	}
	if (box !== mine) return;
	box.querySelector(".lookup-note").remove();
	if (data.phonetic) head.append(make("span", "lookup-phon", " " + data.phonetic));
	if (!data.meanings.length && !data.synonyms.length) box.append(make("div", "lookup-note", "No entry for this word."));
	for (const m of data.meanings) {
		box.append(make("div", "lookup-part", m.part));
		const ol = make("ol", "lookup-defs");
		for (const d of m.definitions) {
			const li = make("li", null, d.text);
			if (d.example) li.append(make("div", "lookup-ex", "“" + d.example + "”"));
			ol.append(li);
		}
		box.append(ol);
	}
	if (data.synonyms.length) {
		box.append(make("div", "lookup-part", "Synonyms"));
		const row = make("div", "lookup-syns");
		for (const s of data.synonyms) {
			const b = make("button", "lookup-syn", s);
			b.type = "button";
			b.title = `Use “${s}” instead`;
			b.addEventListener("click", () => {
				// The word may have moved if the note changed meanwhile.
				if (view.state.sliceDoc(target.from, target.to) === target.word) {
					const insert = matchCase(target.word, s);
					view.dispatch({ changes: { from: target.from, to: target.to, insert }, selection: { anchor: target.from + insert.length }, userEvent: "input" });
				}
				close();
				view.focus();
			});
			row.append(b);
		}
		box.append(row);
	}
	place();
}
