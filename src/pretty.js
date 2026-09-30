// Banners and covers, drawn from properties the way the Pretty Properties
// Obsidian plugin draws them, with its default property names:
//   banner: <image>           a wide picture across the top of the note
//   banner_position: 0-100    which part of it shows (50, the middle, if unset)
//   cover: <image>            a picture beside the properties box; the Media
//                             Notes plugin's coverImage, the vault's older
//                             image, and thumbnail count too (the first one
//                             set wins)
//   cover_shape: initial | initial-2 | initial-3 | vertical-cover |
//                vertical-contain | horizontal-cover | horizontal-contain |
//                square | circle
//   cover_position: left (default) | right | top | bottom
// An image is a web address (https), [[a vault file]], [text](a/vault/file),
// a bare vault path ending in an image type, or data:image/... A YouTube
// watch link shows its thumbnail.
// These properties stay out of the properties box until you click the banner
// or cover (frontmatter.js). The banner spans the whole note pane, and its
// Reposition button lets you drag it up or down, which writes
// banner_position; nothing else here changes the note.

import { StateField, StateEffect } from "@codemirror/state";
import { EditorView, ViewPlugin, Decoration, WidgetType } from "@codemirror/view";
import { snippet } from "@codemirror/autocomplete";
import { vaultHost, notePath, vaultChanged } from "./vault.js";
import { frontmatterLines, propertiesFolded, showImageProps, imagePropsShown } from "./frontmatter.js";
import { attachmentKind } from "./attachments.js";

export const BANNER_KEY = "banner";
export const BANNER_POSITION_KEY = "banner_position";
export const COVER_KEYS = ["cover", "coverImage", "image", "thumbnail"];
export const COVER_SHAPES = ["initial", "initial-2", "initial-3", "vertical-cover", "vertical-contain", "horizontal-cover", "horizontal-contain", "square", "circle"];
// Widths in px, Pretty Properties' defaults.
export const COVER_WIDTHS = { initial: 200, "initial-2": 250, "initial-3": 300, "vertical-cover": 200, "vertical-contain": 200, "horizontal-cover": 300, "horizontal-contain": 300, square: 250, circle: 250 };
export const COVER_POSITIONS = ["left", "right", "top", "bottom"];

// A YAML scalar as written on one line, without its quotes.
function unquote(v) {
	v = v.replace(/\s+#.*$/, "").trim();
	if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
	if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
	return v;
}

// The top-level properties of a note as strings (a list gives its first
// item), for the keys asked for. A CodeMirror Text in, { key: value } out.
export function readProperties(doc, keys) {
	const fm = frontmatterLines(doc);
	const out = {};
	if (!fm) return out;
	const want = new Set(keys);
	for (let n = fm.open + 1; n < fm.close; n++) {
		const m = doc.line(n).text.match(/^([^\s#-][^:]*?)\s*:(?:\s+(.*))?$/);
		if (!m || !want.has(m[1]) || m[1] in out) continue;
		let v = (m[2] || "").trim();
		if (v.startsWith("[")) v = v.replace(/^\[|\]$/g, "").split(",")[0] || "";
		else if (!v && n + 1 < fm.close) v = doc.line(n + 1).text.match(/^\s+-\s+(.*)$/)?.[1] || "";
		out[m[1]] = unquote(v);
	}
	return out;
}

const IMAGE_PATH = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;

// What a property's value points at: { url } for a web or data: image,
// { name } for a vault file (as written, for resolveAttachment), or null.
export function imageRef(value) {
	let v = String(value ?? "").trim();
	if (!v || v.includes("{{")) return null; // empty, or a template's placeholder
	let m = v.match(/^!?\[\[([^\]]+)\]\]$/);
	if (m) return { name: m[1].split("|")[0].split("#")[0].trim() };
	m = v.match(/^!?\[[^\]]*\]\((.+)\)$/);
	if (m) v = m[1].trim().replace(/^<(.*)>$/, "$1").replace(/\s+"[^"]*"$/, "");
	if (/^data:image\//i.test(v)) return { url: v };
	const yt = v.match(/^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]+)/i) || v.match(/^https:\/\/youtu\.be\/([\w-]+)/i);
	if (yt) return { url: `https://img.youtube.com/vi/${yt[1]}/maxresdefault.jpg` };
	if (/^https:\/\/\S+$/i.test(v)) return { url: v };
	if (/^[a-z][\w+.-]*:/i.test(v)) return null; // http: (blocked by the page's rules), file:, ...
	let name = v;
	try { name = decodeURI(v); } catch {}
	return IMAGE_PATH.test(name) ? { name } : null;
}

// The banner and cover for a note's text, or nulls:
// { banner: { ref, position }, cover: { ref, shape, position } }.
export function prettyOf(doc) {
	const p = readProperties(doc, [BANNER_KEY, BANNER_POSITION_KEY, "cover_shape", "cover_position", ...COVER_KEYS]);
	let banner = null, cover = null;
	const bref = imageRef(p[BANNER_KEY]);
	if (bref) {
		const pos = Number(p[BANNER_POSITION_KEY]);
		banner = { ref: bref, position: p[BANNER_POSITION_KEY] !== "" && Number.isFinite(pos) ? Math.min(100, Math.max(0, pos)) : 50 };
	}
	for (const k of COVER_KEYS) {
		const ref = imageRef(p[k]);
		if (!ref) continue;
		cover = {
			ref,
			shape: COVER_SHAPES.includes(p.cover_shape) ? p.cover_shape : "initial",
			position: COVER_POSITIONS.includes(p.cover_position) ? p.cover_position : "left",
		};
		break;
	}
	return { banner, cover };
}

// A ref with its vault file looked up: { url } | { path, version } | null
// (a vault file that isn't there, or the list of files hasn't come yet).
function resolve(state, ref) {
	if (ref.url) return { url: ref.url };
	const host = state.facet(vaultHost);
	if (!host?.attachments) return null;
	const path = host.resolveAttachment(ref.name, state.facet(notePath));
	const file = path && attachmentKind(path) === "image" && host.attachments().find((f) => f.path === path);
	return file ? { path, version: file.version } : null;
}

function imageEl(view, src, onGone) {
	const img = document.createElement("img");
	img.alt = "";
	img.decoding = "async";
	img.draggable = false;
	img.referrerPolicy = "no-referrer";
	img.addEventListener("load", () => view.requestMeasure());
	img.addEventListener("error", onGone);
	if (src.url) img.src = src.url;
	else view.state.facet(vaultHost)?.attachmentURL(src.path).then((u) => { img.src = u; }, onGone);
	return img;
}

const sameSrc = (a, b) => a.url === b.url && a.path === b.path && a.version === b.version;

// The change that sets banner_position to value (0-100, whole numbers): its
// line rewritten, or a new line under banner:. Null without a banner line.
export function bannerPositionChange(doc, value) {
	const fm = frontmatterLines(doc);
	if (!fm) return null;
	const v = String(Math.round(Math.min(100, Math.max(0, value))));
	let bannerEnd = null;
	for (let n = fm.open + 1; n < fm.close; n++) {
		const l = doc.line(n);
		const m = l.text.match(/^(banner_position\s*:[ \t]*)(.*?)[ \t]*(#.*)?$/);
		if (m) {
			const from = l.from + m[1].length;
			return { from, to: from + m[2].length, insert: v };
		}
		if (/^banner\s*:/.test(l.text)) {
			let last = n;
			while (last + 1 < fm.close && /^\s+\S/.test(doc.line(last + 1).text)) last++;
			bannerEnd = doc.line(last).to;
		}
	}
	return bannerEnd == null ? null : { from: bannerEnd, insert: `\n${BANNER_POSITION_KEY}: ${v}` };
}

// Where a vertical drag of dy pixels moves the banner's focal point, from
// start (0-100): dragging the picture down shows more of its top.
export function draggedPosition(start, dy, overflow) {
	if (!(overflow > 0)) return start;
	return Math.min(100, Math.max(0, start - (dy / overflow) * 100));
}

function reposition(view, wrap, img, start) {
	if (view.state.readOnly || wrap.classList.contains("md-banner-moving")) return;
	let pos = start;
	wrap.classList.add("md-banner-moving");
	const bar = document.createElement("div");
	bar.className = "md-banner-bar";
	const hint = document.createElement("span");
	hint.textContent = "Drag the picture up or down";
	const done = document.createElement("button");
	done.type = "button";
	done.textContent = "Save";
	const cancel = document.createElement("button");
	cancel.type = "button";
	cancel.textContent = "Cancel";
	bar.append(hint, cancel, done);
	wrap.append(bar);
	const show = (p) => img.style.setProperty("object-position", `center ${p}%`);
	// How much of the picture is cut off top and bottom, at its drawn width.
	const overflow = () => {
		const w = img.clientWidth, h = img.clientHeight;
		return img.naturalWidth ? img.naturalHeight * (w / img.naturalWidth) - h : 0;
	};
	let drag = null;
	const down = (e) => {
		if (e.button !== 0 || e.target.closest(".md-banner-bar")) return;
		e.preventDefault();
		drag = { y: e.clientY, from: pos, overflow: overflow() };
		wrap.setPointerCapture?.(e.pointerId);
	};
	const move = (e) => {
		if (!drag) return;
		pos = draggedPosition(drag.from, e.clientY - drag.y, drag.overflow);
		show(pos);
	};
	const up = () => { drag = null; };
	const finish = (save) => {
		wrap.removeEventListener("pointerdown", down);
		wrap.removeEventListener("pointermove", move);
		wrap.removeEventListener("pointerup", up);
		wrap.removeEventListener("pointercancel", up);
		document.removeEventListener("keydown", esc, true);
		bar.remove();
		wrap.classList.remove("md-banner-moving");
		const change = save && Math.round(pos) !== Math.round(start) && bannerPositionChange(view.state.doc, pos);
		if (change) view.dispatch({ changes: change, userEvent: "input.banner" });
		else show(start);
	};
	const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } };
	wrap.addEventListener("pointerdown", down);
	wrap.addEventListener("pointermove", move);
	wrap.addEventListener("pointerup", up);
	wrap.addEventListener("pointercancel", up);
	document.addEventListener("keydown", esc, true);
	for (const b of [done, cancel]) b.addEventListener("pointerdown", (e) => e.preventDefault());
	done.addEventListener("click", () => finish(true));
	cancel.addEventListener("click", () => finish(false));
}

// Clicking the banner or cover shows (or hides again) the image properties.
const toggleImageProps = (view) => view.dispatch({ effects: showImageProps.of(!imagePropsShown(view.state)) });

class BannerWidget extends WidgetType {
	constructor(src, position) { super(); this.src = src; this.position = position; }
	eq(o) { return sameSrc(o.src, this.src) && o.position === this.position; }
	updateDOM(dom) {
		if (!sameSrc(dom.wr1t3rSrc || {}, this.src)) return false;
		dom.wr1t3rPosition = this.position;
		if (!dom.classList.contains("md-banner-moving")) dom.querySelector("img")?.style.setProperty("object-position", `center ${this.position}%`);
		return true;
	}
	get estimatedHeight() { return 150; }
	toDOM(view) {
		const wrap = document.createElement("div");
		wrap.className = "md-banner";
		wrap.wr1t3rSrc = this.src;
		wrap.wr1t3rPosition = this.position;
		const img = imageEl(view, this.src, () => { wrap.classList.add("gone"); view.requestMeasure(); });
		img.style.objectPosition = `center ${this.position}%`;
		img.title = "Click to show the banner's properties";
		img.addEventListener("mousedown", (e) => e.preventDefault());
		img.addEventListener("click", () => { if (!wrap.classList.contains("md-banner-moving")) toggleImageProps(view); });
		wrap.append(img);
		if (!view.state.readOnly) {
			const move = document.createElement("button");
			move.type = "button";
			move.className = "md-banner-move";
			move.textContent = "Reposition";
			move.title = "Drag the banner to pick which part shows";
			move.addEventListener("mousedown", (e) => e.preventDefault());
			move.addEventListener("click", () => reposition(view, wrap, img, wrap.wr1t3rPosition));
			wrap.append(move);
		}
		return wrap;
	}
	ignoreEvent() { return true; }
}

// The banner reaches across the whole note pane, past the readable line
// length's margins: measured from the editor's scroller and content.
const bannerFit = ViewPlugin.fromClass(class {
	constructor(view) { this.view = view; this.measure(); }
	update(u) { if (u.geometryChanged || u.viewportChanged || u.docChanged) this.measure(); }
	measure() {
		this.view.requestMeasure({
			key: this,
			read: (view) => {
				const s = view.scrollDOM, c = view.contentDOM;
				const sr = s.getBoundingClientRect(), cr = c.getBoundingClientRect();
				return { left: cr.left - sr.left - s.clientLeft, width: s.clientWidth };
			},
			write: ({ left, width }, view) => {
				const style = view.contentDOM.style;
				if (style.getPropertyValue("--bleed-left") !== left + "px") style.setProperty("--bleed-left", left + "px");
				if (style.getPropertyValue("--bleed-w") !== width + "px") style.setProperty("--bleed-w", width + "px");
			},
		});
	}
});

class CoverWidget extends WidgetType {
	constructor(src, shape, position) { super(); this.src = src; this.shape = shape; this.position = position; }
	eq(o) { return sameSrc(o.src, this.src) && o.shape === this.shape && o.position === this.position; }
	toDOM(view) {
		const wrap = document.createElement("span");
		wrap.className = `md-cover ${this.shape} ${this.position}`;
		wrap.style.setProperty("--cover-w", COVER_WIDTHS[this.shape] + "px");
		wrap.append(imageEl(view, this.src, () => { wrap.classList.add("gone"); view.requestMeasure(); }));
		wrap.title = "Click to show the cover's properties";
		wrap.addEventListener("mousedown", (e) => e.preventDefault());
		wrap.addEventListener("click", () => toggleImageProps(view));
		return wrap;
	}
	ignoreEvent() { return true; }
}

// How far the properties box has to grow at the bottom so a cover beside it
// fits inside it (measured; see coverFit).
const setReserve = StateEffect.define();
const reserve = StateField.define({
	create: () => 0,
	update(v, tr) {
		for (const e of tr.effects) if (e.is(setReserve)) v = e.value;
		return v;
	},
});

function build(state) {
	const out = [];
	const b = { add: (from, to, d) => out.push(d.range(from, to)), finish: () => Decoration.set(out, true) };
	const { banner, cover } = prettyOf(state.doc);
	const fm = frontmatterLines(state.doc);
	if (banner) {
		const src = resolve(state, banner.ref);
		if (src) b.add(0, 0, Decoration.widget({ widget: new BannerWidget(src, banner.position), block: true, side: -1 }));
	}
	// Folding the box hides the cover too (Pretty Properties' "hide cover
	// when collapsed"), so a folded box stays one line.
	const src = fm && cover && !propertiesFolded(state) && resolve(state, cover.ref);
	if (!src) return b.finish();
	const last = fm.close;
	const side = cover.position === "left" || cover.position === "right";
	const at = cover.position === "bottom" ? state.doc.line(last).to : state.doc.line(fm.open).from;
	for (let n = fm.open; n <= last; n++) {
		const l = state.doc.line(n);
		const attrs = { class: "md-has-cover" + (side ? " md-cover-" + cover.position : "") };
		if (side) attrs.style = `--cover-w: ${COVER_WIDTHS[cover.shape]}px` + (n === last ? `; --md-cover-reserve: ${state.field(reserve)}px` : "");
		if (side || n === fm.open) b.add(l.from, l.from, Decoration.line({ attributes: attrs }));
		if (l.from <= at && at <= l.to && n === (cover.position === "bottom" ? last : fm.open)) {
			b.add(at, at, Decoration.widget({ widget: new CoverWidget(src, cover.shape, cover.position), side: cover.position === "bottom" ? 1 : -1 }));
		}
	}
	return b.finish();
}

const decorations = StateField.define({
	create: build,
	update(deco, tr) {
		if (tr.docChanged || propertiesFolded(tr.startState) !== propertiesFolded(tr.state) || tr.effects.some((e) => e.is(vaultChanged) || e.is(setReserve))) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

// A cover beside the box hangs down from its first line; the box's last line
// gets padding at the bottom (never margin: CodeMirror leaves margins out of
// its line heights) so the box is at least as tall as the cover.
const coverFit = ViewPlugin.fromClass(class {
	constructor(view) { this.view = view; this.measure(); }
	update(u) { if (u.docChanged || u.geometryChanged || u.viewportChanged || u.transactions.some((t) => t.effects.length)) this.measure(); }
	measure() {
		this.view.requestMeasure({
			key: this,
			read: (view) => {
				const cover = view.contentDOM.querySelector(".md-cover.left, .md-cover.right");
				const lines = view.contentDOM.querySelectorAll(".cm-line.md-has-cover");
				const current = view.state.field(reserve);
				if (!lines.length) return null; // scrolled out of the drawn part
				if (!cover || cover.classList.contains("gone") || getComputedStyle(cover).position !== "absolute") return current ? 0 : null;
				const lastLine = lines[lines.length - 1];
				const bottom = lastLine.getBoundingClientRect().bottom - parseFloat(getComputedStyle(lastLine).borderBottomWidth || "0") - current;
				const need = Math.max(0, Math.ceil(cover.getBoundingClientRect().bottom + 8 - bottom));
				return Math.abs(need - current) > 1 ? need : null;
			},
			write: (need, view) => {
				if (need != null) Promise.resolve().then(() => view.dispatch({ effects: setReserve.of(need) }));
			},
		});
	}
});

// Command: put the cursor on a property's value, adding the property when the
// note doesn't have it yet (Palette: "Banner image", "Cover image").
export function editProperty(view, key) {
	if (view.state.readOnly) return false;
	const doc = view.state.doc;
	const fm = frontmatterLines(doc);
	if (fm) {
		for (let n = fm.open + 1; n < fm.close; n++) {
			const l = doc.line(n);
			if (new RegExp(`^${key}\\s*:`).test(l.text)) {
				view.dispatch({ selection: { anchor: l.to }, scrollIntoView: true });
				view.focus();
				return true;
			}
		}
	}
	const at = fm ? doc.line(fm.close).from : 0;
	snippet(fm ? `${key}: \${}\n` : `---\n${key}: \${}\n---\n`)(view, null, at, at);
	view.focus();
	return true;
}
export const editBanner = (view) => editProperty(view, BANNER_KEY);
export const editCover = (view) => {
	const have = readProperties(view.state.doc, COVER_KEYS);
	return editProperty(view, COVER_KEYS.find((k) => k in have) || COVER_KEYS[0]);
};

export const prettyProperties = [reserve, decorations, coverFit, bannerFit];
