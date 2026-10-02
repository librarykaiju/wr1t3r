// Grammar and style checking for the "Grammar check" setting, through
// LanguageTool. The public server (api.languagetool.org) is free and needs no
// key; a self-hosted LanguageTool can be used instead by setting the
// LANGUAGETOOL_URL variable to its address (for example
// "https://lt.example.com"). Spelling is left to the browser's own spellcheck,
// so LanguageTool's typo rules are off.
//
//   POST /api/grammar {text}  -> {matches: [{offset, length, message, short,
//                                 replacements: [...], rule}]}

import { HttpError } from "./util.js";

const PUBLIC = "https://api.languagetool.org";
export const MAX_TEXT = 20000; // the public server's limit per request

export async function grammarApi(request, env, url) {
	if (url.pathname !== "/api/grammar") return null;
	if (request.method !== "POST") throw new HttpError(405, "POST");
	const { text } = await request.json().catch(() => ({}));
	if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "Send some text");
	if (text.length > MAX_TEXT) throw new HttpError(413, "Too much text at once");
	const base = (env.LANGUAGETOOL_URL || PUBLIC).replace(/\/+$/, "");
	const form = new URLSearchParams({
		text,
		language: "auto",
		preferredVariants: "en-US,de-DE,pt-BR,ca-ES",
		disabledCategories: "TYPOS",
		disabledRules: "WHITESPACE_RULE,CONSECUTIVE_SPACES",
	});
	let res;
	try {
		res = await fetch(base + "/v2/check", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "wr1t3r" }, body: form });
	} catch {
		throw new HttpError(502, "Couldn't reach the grammar checker");
	}
	if (res.status === 429) throw new HttpError(429, "The grammar checker is busy; try again in a minute");
	if (!res.ok) throw new HttpError(502, `The grammar checker answered ${res.status}`);
	const body = await res.json().catch(() => ({}));
	const matches = (body.matches || []).map((m) => ({
		offset: m.offset,
		length: m.length,
		message: m.message || "",
		short: m.shortMessage || "",
		replacements: (m.replacements || []).slice(0, 5).map((r) => r.value),
		rule: m.rule?.id || "",
	})).filter((m) => Number.isInteger(m.offset) && m.length > 0);
	return { matches };
}
