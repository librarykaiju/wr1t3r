// Shared by the page and the Worker: what counts as a note path.
// A relative path to a .md file, with no hidden folders (.obsidian, .trash)
// and nothing that could climb out of the vault.
export function isNotePath(path) {
	if (typeof path !== "string" || !path || path.length > 1000) return false;
	if (!/\.md$/i.test(path) || path.includes("\\") || path.includes("\0")) return false;
	return path.split("/").every((seg) => seg && seg !== ".." && !seg.startsWith("."));
}
