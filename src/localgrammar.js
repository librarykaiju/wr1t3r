// Grammar check without the Worker: Harper (harper.js), an open-source
// checker that runs in the page, so nothing is sent anywhere. English only,
// and it catches less style advice than LanguageTool. Its engine is a ~16 MB
// WebAssembly file, served from this site and fetched the first time the
// check runs.
//
// It answers in LanguageTool's shape (worker/grammar.js), so src/grammar.js
// doesn't know which one it's talking to.

// Lints left to the browser's own spellcheck, as LanguageTool's typo rules are.
const SKIP_KINDS = new Set(["Spelling"]);

// Harper counts characters (code points); JavaScript strings count UTF-16
// units, so an emoji is one for Harper and two here.
export function unitIndex(text) {
	const at = [0];
	for (let i = 0; i < text.length; ) {
		i += text.codePointAt(i) > 0xffff ? 2 : 1;
		at.push(i);
	}
	return (n) => at[Math.min(n, at.length - 1)];
}

// Harper's lints -> {matches: [{offset, length, message, short, replacements, rule}]}.
export function toMatches(text, lints) {
	const unit = unitIndex(text);
	const matches = [];
	for (const l of lints) {
		const kind = l.lint_kind();
		if (SKIP_KINDS.has(kind)) continue;
		const span = l.span();
		const offset = unit(span.start), end = unit(span.end);
		if (end <= offset) continue;
		matches.push({
			offset,
			length: end - offset,
			message: l.message(),
			short: "",
			replacements: l.suggestions().slice(0, 5).map((s) => s.get_replacement_text()),
			rule: kind,
		});
	}
	return { matches };
}

let linter = null;
async function harper() {
	linter ||= (async () => {
		const [{ LocalLinter }, { binary }] = await Promise.all([import("harper.js"), import("harper.js/binary")]);
		const l = new LocalLinter({ binary });
		await l.setup();
		return l;
	})().catch((e) => { linter = null; throw e; });
	return linter;
}

export async function checkHere(text) {
	const l = await harper();
	return toMatches(text, await l.lint(text, { language: "plaintext" }));
}
