// A page's icon and description around its title, for Home (icon:, title:
// and description: in _wr1t3r/Home.md's properties) and the daily planner
// (icon: and description: in its wr1t3r-planner block). The icon sits above
// the title, over the bottom of the banner when there is one, and the
// description under it.
//
// icon: is an emoji or a few letters ("❤️"), or a picture: "[[heart.png]]",
// a vault path or an https address, as a banner takes.

import { imageRef } from "./pretty.js";

// The text of a property, trimmed, or null when it's empty or a template's
// {{placeholder}}.
export function pageText(value) {
	const v = value == null ? "" : String(Array.isArray(value) ? value.join(", ") : value).trim();
	return v && !v.includes("{{") ? v : null;
}

// What an icon: value is: { image: ref } for a picture, { text } for an
// emoji or letters (the first 4 characters, as a person sees them), or null.
export function readIcon(value) {
	const v = pageText(value);
	if (!v) return null;
	const ref = imageRef(v);
	if (ref) return { image: ref };
	const chars = [...(typeof Intl !== "undefined" && Intl.Segmenter ? [...new Intl.Segmenter().segment(v)].map((s) => s.segment) : v)];
	return { text: chars.slice(0, 4).join("") };
}

// The icon element, or null. image(ref) resolves a picture's src (a URL or
// a promise of one); a picture that can't be found takes the element away.
export function iconElement(icon, image) {
	if (!icon) return null;
	const box = document.createElement("div");
	box.className = "page-icon";
	box.setAttribute("aria-hidden", "true");
	if (icon.text) {
		box.textContent = icon.text;
		return box;
	}
	box.classList.add("page-icon-img");
	const img = document.createElement("img");
	img.alt = "";
	img.decoding = "async";
	img.referrerPolicy = "no-referrer";
	img.addEventListener("error", () => box.remove());
	Promise.resolve(image ? image(icon.image) : null).then((src) => { if (src) img.src = src; else box.remove(); }, () => box.remove());
	box.append(img);
	return box;
}

export function descriptionElement(text) {
	if (!text) return null;
	const p = document.createElement("p");
	p.className = "page-desc";
	p.textContent = text;
	return p;
}
