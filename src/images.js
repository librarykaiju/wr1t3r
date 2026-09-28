// Web images: a line with ![alt](https://...) gets the picture drawn under it,
// as Obsidian shows linked images. The markdown stays as typed. Obsidian's size
// syntax works too: ![alt|300](url) is 300px wide, ![alt|300x200](url) sets both.
// Images load from their own sites (no referrer is sent); vault attachments
// aren't shown, since wr1t3r doesn't sync them.

import { StateField, RangeSetBuilder } from "@codemirror/state";
import { EditorView, Decoration, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

// "alt|300" or "alt|300x200" -> { alt, width, height }.
export function imageSize(alt) {
	const m = alt.match(/^(.*?)\|(\d+)(?:x(\d+))?$/);
	return m ? { alt: m[1].trim(), width: Number(m[2]), height: m[3] ? Number(m[3]) : null } : { alt, width: null, height: null };
}

// The web images in a state: [{ line (end of the line they're on), url, alt, width, height }].
export function imagesIn(state) {
	const out = [];
	syntaxTree(state).iterate({
		enter(n) {
			if (n.name !== "Image") return;
			const u = n.node.getChild("URL");
			if (!u) return false;
			const url = state.sliceDoc(u.from, u.to).replace(/^<|>$/g, "");
			if (!/^https:\/\//i.test(url)) return false;
			const marks = n.node.getChildren("LinkMark");
			const alt = marks.length >= 2 ? state.sliceDoc(marks[0].to, marks[1].from) : "";
			out.push({ line: state.doc.lineAt(n.to).to, url, ...imageSize(alt) });
			return false;
		},
	});
	return out;
}

class ImageWidget extends WidgetType {
	constructor(img) { super(); this.img = img; }
	eq(o) { return ["url", "alt", "width", "height"].every((k) => o.img[k] === this.img[k]); }
	get estimatedHeight() { return this.img.height || 200; }
	toDOM(view) {
		const wrap = document.createElement("div");
		wrap.className = "md-image";
		const img = document.createElement("img");
		img.src = this.img.url;
		img.alt = this.img.alt;
		img.loading = "lazy";
		img.decoding = "async";
		img.referrerPolicy = "no-referrer";
		if (this.img.width) img.width = this.img.width;
		if (this.img.height) img.height = this.img.height;
		// Its height changes once it loads (or fails); tell the editor, so clicks
		// below it still land where they look.
		img.addEventListener("load", () => view.requestMeasure());
		img.addEventListener("error", () => {
			wrap.classList.add("broken");
			wrap.textContent = navigator.onLine ? "Image didn't load" : "Image not shown offline";
			view.requestMeasure();
		});
		wrap.append(img);
		return wrap;
	}
	ignoreEvent() { return false; }
}

function build(state) {
	const b = new RangeSetBuilder();
	for (const img of imagesIn(state)) b.add(img.line, img.line, Decoration.widget({ widget: new ImageWidget(img), block: true, side: 1 }));
	return b.finish();
}

export const webImages = StateField.define({
	create: build,
	update(deco, tr) {
		if (tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state);
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});
