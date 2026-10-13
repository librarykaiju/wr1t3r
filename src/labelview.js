// A food from a photo of its package: its barcode or its Nutrition Facts
// label. The photo is read on this device and never leaves it. A barcode
// (src/barcode.js) is looked for first: a food already in the Nutrition
// Database under that barcode comes straight back; otherwise Open Food Facts
// is asked for it (src/openfoodfacts.js; only the digits are sent). With no
// barcode, or one Open Food Facts doesn't know, the label's text is read
// (src/localocr.js, Tesseract) and its numbers picked out (src/label.js).
// Either way a form shows them beside the photo to check and name before the
// food is saved. On a phone, the file picker offers the camera.

import { parseLabel, addsUp } from "./label.js";

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export const GROUPS = ["Produce", "Grain", "Protein", "Dairy", "Dairy Alternative", "Legume", "Fat/Oil", "Fat/Protein", "Sweetener", "Beverage", "Condiment", "Spice", "Snack", "Other"];

function choosePhoto() {
	return new Promise((resolve) => {
		const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*" });
		input.setAttribute("capture", "environment");
		input.addEventListener("change", () => resolve(input.files[0] || null), { once: true });
		input.addEventListener("cancel", () => resolve(null), { once: true });
		input.click();
	});
}

// known(barcode) -> the Nutrition Database's food with that barcode as an
// alias, or null.
// -> a food ({ name, serving, calories, fat, carbs, protein, fiber, group,
// aliases }) or null when cancelled.
export async function foodFromLabel({ known = () => null } = {}) {
	const photo = await choosePhoto();
	if (!photo) return null;
	const url = URL.createObjectURL(photo);
	const ui = dialog(url);
	try {
		let code = null;
		try {
			const { readBarcode } = await import("./barcode.js");
			code = await readBarcode(photo);
		} catch { /* no barcode reader here: read the label */ }
		if (code) {
			const mine = known(code);
			// Unless the dialog was closed while the photo was read.
			if (mine) return ui.close() ? mine : null;
			ui.status(`Barcode ${code}: looking it up in Open Food Facts…`);
			try {
				const { lookupBarcode } = await import("./openfoodfacts.js");
				const { food, found } = await lookupBarcode(code);
				if (food) return await ui.form(food, "Found by its barcode in Open Food Facts. Check the numbers against the package, then save.");
				ui.note(found ? `Open Food Facts knows barcode ${code} but has no nutrition for it.` : `Barcode ${code} isn't in Open Food Facts.`);
			} catch (e) {
				ui.note(`Couldn't look up barcode ${code} (${e?.message || e}).`);
			}
			ui.status("Reading the photo for a Nutrition Facts label…");
		}
		let found = {};
		try {
			const { readText } = await import("./localocr.js");
			found = parseLabel(await readText(photo, photo.type || "image/jpeg"));
		} catch (e) {
			ui.note(`Couldn't read the photo (${e?.message || e}). Type the numbers in instead.`);
		}
		// The barcode as an alias, so the next scan finds this food.
		if (code) found.aliases = [code];
		return await ui.form(found, code ? "Or take a photo of the Nutrition Facts label instead." : "");
	} finally {
		URL.revokeObjectURL(url);
	}
}

function dialog(photoUrl) {
	document.querySelector(".palette")?.remove();
	const wrap = el("div", "palette");
	wrap.setAttribute("role", "dialog");
	wrap.setAttribute("aria-label", "Food from a photo");
	const box = el("div", "palette-box label-box");
	wrap.append(box);
	const img = Object.assign(el("img", "label-photo"), { src: photoUrl, alt: "The photo" });
	const status = el("p", "label-status", "Reading the photo on this device…");
	const body = el("div", "label-body");
	box.append(el("div", "ingredient-title", "Food from a photo"), img, status, body);
	document.body.append(wrap);
	const back = document.activeElement;
	let finish = () => {}, closed = false;
	const close = (value) => { closed = true; wrap.remove(); document.removeEventListener("keydown", esc, true); back?.focus?.(); finish(value); };
	const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); close(null); } };
	document.addEventListener("keydown", esc, true);
	wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) { e.preventDefault(); close(null); } });
	let notes = [];
	return {
		note: (t) => { notes.push(t); },
		status: (t) => { status.textContent = [...notes, t].join(" "); },
		// -> whether it was still open.
		close: () => { if (closed) return false; close(null); return true; },
		form: (found, tip = "") => new Promise((resolve) => {
			// Closed while the photo was being read.
			if (closed) return resolve(null);
			finish = resolve;
			const got = ["calories", "fat", "carbs", "protein", "fiber"].filter((k) => found[k] != null).length;
			const named = !!found.name;
			status.textContent = [...notes, named ? tip : got ? `Found ${got} of 5 numbers. Check them against the photo, then name the food.` : `Couldn't make out the numbers. Type them in from the photo. ${tip}`.trim()].join(" ");
			const field = (key, label, type = "number", value = found[key] ?? "") => {
				const wrapF = el("label", "label-field");
				const input = Object.assign(el("input"), { type, value, name: key });
				if (type === "number") Object.assign(input, { min: "0", step: "any", inputMode: "decimal" });
				wrapF.append(el("span", null, label), input);
				return { wrapF, input };
			};
			const name = field("name", "Food", "text", found.name || "");
			name.input.placeholder = "What is it? (e.g. Granola, maple almond)";
			name.input.required = true;
			const serving = field("serving", "Serving size", "text", found.serving || "");
			const nums = [["calories", "Calories"], ["fat", "Fat (g)"], ["carbs", "Carbs (g)"], ["protein", "Protein (g)"], ["fiber", "Fiber (g)"]].map(([k, l]) => field(k, l));
			const groupWrap = el("label", "label-field");
			const group = el("select");
			for (const g of GROUPS) group.append(new Option(g, g));
			group.value = GROUPS.includes(found.group) ? found.group : "Other";
			groupWrap.append(el("span", null, "Food group"), group);
			const grid = el("div", "label-grid");
			grid.append(...nums.map((f) => f.wrapF), groupWrap);
			const warn = el("p", "label-warn");
			const check = () => {
				const v = Object.fromEntries(nums.map((f) => [f.input.name, f.input.value === "" ? null : Number(f.input.value)]));
				warn.textContent = addsUp(v) ? "" : "Calories don't match the fat, carbs and protein (4 per gram of carbs and protein, 9 per gram of fat). One of them is probably misread.";
			};
			for (const f of nums) f.input.addEventListener("input", check);
			check();
			const buttons = el("div", "ingredient-buttons");
			const save = el("button", "ingredient-add", "Save to Nutrition Database");
			const cancel = el("button", null, "Cancel");
			save.type = cancel.type = "button";
			save.addEventListener("click", () => {
				const n = name.input.value.trim().replace(/\|/g, "/");
				const cal = nums[0].input.value;
				if (!n) return name.input.focus();
				if (cal === "") return nums[0].input.focus();
				const v = (i) => { const x = Number(nums[i].input.value); return Number.isFinite(x) && x >= 0 ? x : 0; };
				close({ name: n, serving: serving.input.value.trim() || "1 serving", calories: v(0), fat: v(1), carbs: v(2), protein: v(3), fiber: v(4), group: group.value, aliases: found.aliases || [] });
			});
			cancel.addEventListener("click", () => close(null));
			buttons.append(cancel, save);
			body.append(name.wrapF, serving.wrapF, grid, warn, buttons);
			(named ? save : name.input).focus();
		}),
	};
}
