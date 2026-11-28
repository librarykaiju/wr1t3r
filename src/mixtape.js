// Personal build only: a line holding brandonj.ink's mixtape shortcode,
//   {% mixtape "https://youtu.be/…", "Title", "Artist" %}
// gets the site's tape-deck player drawn under it, the way images and video
// files show under their markdown (src/images.js). The text stays as typed.
// The player is the site's own /mixtape/ page in its compact embed mode, so
// it looks and plays exactly as it will in the post. The site's links-to-deck
// rules live in w3bz1n3's _config/tapeEmbed.js; tapeQuery below mirrors them,
// minus Plex web-app links, which only the site's build can sign.
// The iframe needs frame-src for the site, which vite.config.js adds to the
// personal build's _headers.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";

export const MIXTAPE_SITE = "https://brandonj.ink";

const LINE = /^\s*\{%-?\s*mixtape\s+(.+?)\s*-?%\}\s*$/;
const YT_LIST = /^[A-Za-z0-9_-]{10,64}$/;
const YT_VIDEO = /^[A-Za-z0-9_-]{11}$/;
const MEDIA_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|mov|ogv)$/i;

// The shortcode's arguments: "a", 'b', "c" -> ["a", "b", "c"].
export function shortcodeArgs(text) {
	const out = [];
	const re = /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*(,|$)/y;
	let m;
	while (re.lastIndex < text.length && (m = re.exec(text))) {
		out.push((m[1] ?? m[2]).replace(/\\(.)/g, "$1"));
		if (!m[3]) break;
	}
	return out;
}

// The deck's query string for a link ("v=…", "yt=…", "src=…"), else null.
export function tapeQuery(href, { title, artist } = {}) {
	let url;
	try { url = new URL(href.trim(), MIXTAPE_SITE); } catch { return null; }
	if (!/^https?:$/.test(url.protocol)) return null;
	const host = url.hostname.replace(/^(www|m)\./, "");
	const q = url.searchParams;
	if (url.origin === MIXTAPE_SITE && /^\/(mix)?tape\/?$/.test(url.pathname)) {
		const keep = new URLSearchParams();
		for (const k of ["t", "yt", "v", "src", "sc", "vm", "title", "artist"]) if (q.get(k)) keep.set(k, q.get(k));
		return ["t", "yt", "v", "src", "sc", "vm"].some((k) => keep.has(k)) ? keep.toString() : null;
	}
	const yt = (v, list) => {
		const parts = [];
		if (v && YT_VIDEO.test(v)) parts.push(`v=${v}`);
		if (list && YT_LIST.test(list) && !list.startsWith("RD")) parts.push(`yt=${list}`);
		return parts.join("&") || null;
	};
	if (["youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
		const path = /^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
		return yt(path ? path[1] : q.get("v"), q.get("list"));
	}
	if (host === "youtu.be") return yt(url.pathname.slice(1, 12), q.get("list"));
	if (["soundcloud.com", "on.soundcloud.com"].includes(host) && url.pathname.length > 1) {
		return `sc=${encodeURIComponent(`https://${host}${url.pathname.replace(/\/$/, "")}`)}`;
	}
	if (host === "vimeo.com" || host === "player.vimeo.com") {
		const m = /^\/(?:video\/)?(\d{5,12})(?:\/|$)/.exec(url.pathname);
		return m ? `vm=${m[1]}` : null;
	}
	if (MEDIA_EXT.test(url.pathname)) {
		const own = url.origin === MIXTAPE_SITE;
		let out = `src=${encodeURIComponent(own ? url.pathname + url.search : url.href)}`;
		if (title) out += `&title=${encodeURIComponent(title)}`;
		if (artist) out += `&artist=${encodeURIComponent(artist)}`;
		return out;
	}
	return null;
}

// The shortcodes in a state: [{ line (end of its line), query, href }].
export function mixtapesIn(state) {
	const out = [];
	for (let n = 1; n <= state.doc.lines; n++) {
		const line = state.doc.line(n);
		if (!line.text.includes("mixtape")) continue;
		const m = line.text.match(LINE);
		if (!m) continue;
		const [href = "", title, artist] = shortcodeArgs(m[1]);
		out.push({ line: line.to, href, query: href ? tapeQuery(href, { title, artist }) : null });
	}
	return out;
}

class MixtapeWidget extends WidgetType {
	constructor(t) { super(); this.t = t; }
	eq(o) { return o.t.query === this.t.query && o.t.href === this.t.href; }
	get estimatedHeight() { return 320; }
	toDOM() {
		const wrap = document.createElement("div");
		wrap.className = "md-image md-mixtape";
		if (!this.t.query) {
			const note = document.createElement("span");
			note.className = "md-image-note";
			note.textContent = /plex\.(tv|direct)/i.test(this.t.href) ? "Plex links turn into the player on the site" : "The mixtape player can't play this link";
			wrap.classList.add("broken");
			wrap.append(note);
			return wrap;
		}
		const frame = document.createElement("iframe");
		frame.src = `${MIXTAPE_SITE}/mixtape/?${this.t.query}&embed=1`;
		frame.title = "Mixtape player";
		frame.loading = "lazy";
		frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
		frame.referrerPolicy = "no-referrer";
		wrap.append(frame);
		return wrap;
	}
	// Clicks belong to the player, not the editor.
	ignoreEvent() { return true; }
}

function build(state) {
	const b = new RangeSetBuilder();
	for (const t of mixtapesIn(state)) b.add(t.line, t.line, Decoration.widget({ widget: new MixtapeWidget(t), block: true, side: 1 }));
	return b.finish();
}

// A function rather than a constant, so the product and self-host builds
// (which never call it) drop this whole module.
export function mixtapeField() {
	return StateField.define({
		create: build,
		update: (deco, tr) => (tr.docChanged ? build(tr.state) : deco),
		provide: (f) => EditorView.decorations.from(f),
	});
}
