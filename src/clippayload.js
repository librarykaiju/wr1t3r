// The clip bookmarklet carries the page itself to wr1t3r, the way Obsidian's
// Web Clipper hands a page to the app: it copies the page you're reading
// (scripts, styles and other dead weight taken out, or only the selection),
// compresses it and opens wr1t3r at #clip-page=<payload>. Nothing goes through
// a server, so it works on every build, and it clips pages you're signed in to.
//
// Payload: "z" + base64url(deflate-raw(JSON)), or "j" + base64url(JSON) where
// the browser has no CompressionStream. JSON: { u: address, h: HTML, s: 1 when
// it's only the selection }.

// Past this the address is too long for some browsers to open.
export const MAX_PAYLOAD = 1_000_000;

const DROP = "script,style,noscript,svg,iframe,link,template,object,embed,canvas,video,audio,form,button,input,select,textarea,dialog";

// The bookmarklet's code, run on the page being clipped. It has to stand on
// its own (no imports, nothing from this file), so it's written out here as
// one function and turned into a javascript: address by bookmarklet().
function run(origin, drop, max) {
	const w = window.open("", "_blank");
	(async () => {
		const sel = getSelection();
		const part = sel && !sel.isCollapsed && String(sel).trim() ? sel : null;
		const root = document.documentElement.cloneNode(true);
		if (part) {
			let body = root.querySelector("body");
			if (!body) body = root.appendChild(document.createElement("body"));
			body.replaceChildren();
			for (let i = 0; i < part.rangeCount; i++) body.append(part.getRangeAt(i).cloneContents());
		}
		root.querySelectorAll(drop).forEach((el) => el.remove());
		root.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"));
		const json = JSON.stringify({ u: location.href, h: root.outerHTML, s: part ? 1 : 0 });
		let bytes, kind = "z";
		if (window.CompressionStream) {
			bytes = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
		} else {
			bytes = new TextEncoder().encode(json);
			kind = "j";
		}
		let bin = "";
		for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
		const payload = kind + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
		if (payload.length > max) throw new Error("this page is too big to clip whole. Select the part you want and click again.");
		const to = origin + "/#clip-page=" + payload;
		if (w) { w.opener = null; w.location.href = to; } else location.href = to;
	})().catch((e) => { if (w) w.close(); alert("wr1t3r couldn't clip this page: " + e.message); });
}

// The javascript: address to save as a bookmark, opening wr1t3r at origin.
export function bookmarklet(origin) {
	const code = `(${run.toString()})(${JSON.stringify(origin)},${JSON.stringify(DROP)},${MAX_PAYLOAD})`;
	// One line, and no "%" left bare: browsers decode a javascript: address
	// before running it.
	return "javascript:" + encodeURIComponent(code.replace(/\n\s*/g, " ")).replace(/'/g, "%27");
}

// { url, html, selection } from a #clip-page= payload; throws if it's damaged.
export async function readPayload(payload) {
	let data;
	try {
		const kind = payload[0];
		if (kind !== "z" && kind !== "j") throw 0;
		const b64 = payload.slice(1).replace(/-/g, "+").replace(/_/g, "/");
		const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
		let bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
		if (kind === "z") bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
		data = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new Error("the link is damaged or cut short");
	}
	if (typeof data?.u !== "string" || typeof data?.h !== "string" || !/^https?:\/\//i.test(data.u)) throw new Error("that link isn't a wr1t3r clip");
	return { url: data.u, html: data.h, selection: !!data.s };
}
