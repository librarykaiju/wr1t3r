// Icons for notes and folders: an emoji (or a short symbol) shown before the
// name in the sidebar, bookmarks, search results and tabs. A note's is its
// `icon:` property, so it travels with the note; a folder's is kept in the
// notebook's Settings note (src/features.js), under icons:, by its path
// inside the notes' folder.

// The longest icon kept: an emoji with skin tone and joiners fits, a word doesn't.
const MAX = 12;

// s as an icon, or "" when it's empty or too long to be one.
export function cleanIcon(s) {
	const t = String(s ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
	if (!t || t.length > MAX || /[\n:#[\]{}]/.test(t)) return "";
	return t;
}

// A note's icon: its icon: property, or "".
export function noteIcon(text) {
	const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text || "");
	if (!m) return "";
	const line = /^icon[ \t]*:[ \t]*(.*)$/im.exec(m[1]);
	return line ? cleanIcon(line[1].replace(/\s+#.*$/, "")) : "";
}

// Folder icons follow a folder when it's renamed or moved, subfolders too.
// icons: { "Drafts": "✏️", "Drafts/Old": "📦" }; from, to: those keys.
export function moveFolderIcons(icons, from, to) {
	const out = {};
	let changed = false;
	for (const [k, v] of Object.entries(icons || {})) {
		if (k === from || k.startsWith(from + "/")) { out[to + k.slice(from.length)] = v; changed = true; }
		else out[k] = v;
	}
	return changed ? out : null;
}

// The picker's choices, a row of each.
export const ICON_CHOICES = [
	["Writing", "✏️ 📝 📖 📚 📓 📔 📒 🖋️ ✒️ 📜 🗒️ 📎 🔖 🏷️ 💬 💭"],
	["Story", "🎭 🎬 🎞️ 📺 🎨 🖼️ 🗺️ 🧭 🏰 🐉 🦄 🧙 👻 🔮 🗡️ 🛡️"],
	["Days", "📅 🗓️ ⏰ ☀️ 🌙 ⭐ 🌈 ☁️ ❄️ 🔥 🌸 🌷 🌻 🍂 🌱 🌿"],
	["Life", "🏠 💼 🎓 💡 🧠 ❤️ 💖 🎀 🧸 🎁 🎉 🎵 🎧 🎮 ✈️ 🚲"],
	["Food", "🍳 🥗 🍰 🧁 🍓 🍒 🍋 🍎 🥑 🍕 🍜 ☕ 🍵 🧋 🍷 🍪"],
	["Marks", "✅ ☑️ ⭐ 🌟 ❗ ❓ 🔴 🟠 🟡 🟢 🔵 🟣 🩷 ⚫ ⚪ 📌"],
].map(([label, row]) => [label, [...new Set(row.split(" "))]]);
