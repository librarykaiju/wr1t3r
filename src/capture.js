// Quick capture: text, a link or a voice memo sent to the Inbox note from
// anywhere (the phone's share sheet, an Apple Shortcut, the palette). Each
// capture is one open task at the end of the Inbox, so it waits to be dealt
// with and ticks off like any task. Shared by the page and the Worker.

export const INBOX = "content/Inbox.md";
const NEW_INBOX = "# Inbox\n\nThings sent here from the share sheet, a Shortcut or Capture. Tick each one off once it's filed.\n";

// "2026-10-02 08:45" in the given time zone (the Worker has none of its own).
export function stamp(date = new Date(), timeZone) {
	const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((p) => [p.type, p.value]));
	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

const oneLine = (s) => String(s ?? "").replace(/\r\n?/g, "\n").trim();

// The markdown for one capture, or "" if there's nothing in it. Text over one
// line goes indented under the task, so it stays part of it.
export function captureEntry({ title = "", text = "", url = "" } = {}, when = stamp()) {
	title = oneLine(title).replace(/\s+/g, " ");
	text = oneLine(text);
	url = oneLine(url);
	// Share sheets often put the link in the text too.
	if (!url) { const m = text.match(/^https?:\/\/\S+$/); if (m) { url = m[0]; text = ""; } }
	if (url && text.endsWith(url)) text = text.slice(0, -url.length).trim();
	// Only web links become links; anything else is kept as text.
	if (url && !/^https?:\/\//i.test(url)) { text = [text, url].filter(Boolean).join(" "); url = ""; }
	if (!title && !text && !url) return "";
	const link = url ? (title ? `[${title.replace(/[[\]]/g, "")}](${url.replace(/[()\s]/g, encodeURIComponent)})` : `<${url}>`) : title;
	const [first = "", ...rest] = text.split("\n");
	const head = [link, first].filter(Boolean).join(" · ");
	const body = rest.map((l) => (l.trim() ? "  " + l : "")).join("\n").replace(/\n+$/, "");
	return `- [ ] ${when} ${head}${body ? "\n" + body : ""}`;
}

// The Inbox note's text with the entry added at the end (made fresh if null).
export function appendCapture(noteText, entry) {
	const base = (noteText == null || !noteText.trim() ? NEW_INBOX : noteText).replace(/\s*$/, "");
	// Straight under an earlier capture, so the Inbox stays one list.
	const last = base.slice(base.lastIndexOf("\n") + 1);
	return base + (/^(\s*[-*+] |\s{2,}\S)/.test(last) ? "\n" : "\n\n") + entry + "\n";
}
