// After a deploy, a page opened before it still names the old build's lazy
// parts (the photo reader, PDF import, ...), and those files are gone from the
// server, so loading one fails ("Importing a module script failed" in Safari).
// An iPhone keeps a home-screen app's page alive for days, so this happens.

// -> whether the server has a newer build than the one this page is running.
// The no-store request goes past the service worker's cached page (public/sw.js).
export async function newerBuild() {
	const mine = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute("src");
	if (!mine) return false;
	try {
		const res = await fetch("/", { cache: "no-store" });
		if (!res.ok) return false;
		const theirs = (await res.text()).match(/<script type="module"[^>]*\ssrc="([^"]+)"/)?.[1];
		return !!theirs && theirs !== mine;
	} catch {
		return false;
	}
}
