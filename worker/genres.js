// Genres from a book's subjects. Open Library lists everything under
// "subjects": Library of Congress headings ("Fantasy fiction", "Robots --
// Fiction"), bookstore categories ("Fiction, science fiction, general"),
// places, people, and housekeeping ("Accessible book"). This picks out the
// ones that name a genre, as StoryGraph-style labels. Subjects that name no
// genre stay where they are; nothing here removes them.
//
// Used by the book lookup (worker/media.js, in the Worker and in the page)
// and the StoryGraph import (src/storygraph.js).

// [label, pattern]. Order is the order genres are listed in.
const FICTION = [
	["Fantasy", /\bfantasy\b|sword and sorcery|\bdragons?\b.*fiction|\bwizards?\b|\bmagic\b.*fiction/],
	["Science Fiction", /science fiction|sci-fi|space opera|cyberpunk|\bsteampunk|time travel|life on other planets|extraterrestrial|interplanetary|space warfare|\bandroids?\b|robots?\b.*fiction|artificial intelligence.*fiction/],
	["Dystopian", /dystopia|post-apocalyptic|apocalyptic/],
	["Mystery", /mystery|mysteries|detective|whodunit|private investigators|police procedural|amateur sleuth/],
	["Thriller", /thriller|suspense|espionage|\bspy\b|spies/],
	["Horror", /horror|ghost stories|\bghosts?\b.*fiction|vampires|zombies|haunted|occult fiction/],
	["Paranormal", /paranormal|supernatural|witches|werewolves|shapeshift/],
	["Romance", /\bromance\b(?! languages| philology)|love stories/],
	["Historical Fiction", /historical fiction|fiction, historical|historical novels|\bhistory\b.*fiction/],
	["Literary Fiction", /literary fiction|fiction, literary/],
	["Classics", /\bclassics?\b|classic literature/],
	["Adventure", /adventure/],
	["Western", /western stories|\bwesterns\b|fiction, western/],
	["Mythology & Folklore", /mytholog|fairy tales|folklore|legends|retellings?/],
	["Short Stories", /short stories|anthologies/],
	["Humor", /humou?r|humorous|comedy|comic fiction|satire|parody/],
	["Graphic Novel", /graphic novels?|comic books|\bcomics\b|manga/],
	["Poetry", /poetry|\bpoems\b|\bverse\b/],
	["Young Adult", /young adult|teenage|\bteens?\b|\bya\b/],
	["Children's", /juvenile|children's|picture books|middle grade/],
];
const NONFICTION = [
	["Memoir", /memoir|autobiograph/],
	["Biography", /biograph/],
	["True Crime", /true crime|murder.*case studies|criminal investigation|serial murder/],
	["History", /^history\b|\bhistory\b(?!.*fiction)|historiography/],
	["Science", /\bscience\b|physics|biology|astronomy|chemistry|evolution|neuroscience|mathematics|cosmology/],
	["Nature", /\bnature\b|natural history|ecology|environment|animals|birds|plants/],
	["Psychology", /psycholog/],
	["Philosophy", /philosoph|ethics/],
	["Religion", /religio|theology|christianity|spirituality|\bbible\b|buddhism|islam|judaism/],
	["Politics", /politic|government|social justice|activism/],
	["Business", /business|economics|management|finance|entrepreneur/],
	["Self-Help", /self-help|self-actualization|personal development|conduct of life|success|motivation/],
	["Health", /health|medicine|medical|fitness|nutrition/],
	["Cooking", /cooking|cookery|recipes|\bfood\b/],
	["Travel", /\btravel\b|description and travel/],
	["Art", /\bart\b|\barts\b|painting|photography|\bdesign\b/],
	["Music", /\bmusic\b|musicians/],
	["Sports", /\bsports?\b|athletes|baseball|football|basketball/],
	["Writing", /authorship|creative writing|\bwriting\b/],
	["Essays", /\bessays\b/],
];
// Either kind of book.
const ANY = [["LGBTQIA+", /\bgay\b|lesbian|lgbt|queer|transgender|bisexual|homosexuality/]];

// Subjects that tell the book is fiction (so "History" or "Science" in its
// subjects is a setting, not what it is).
const IS_FICTION = /\bfiction\b|\bnovels?\b|\bstories\b|\btales\b|fantasy|romance|thriller|mystery|poetry|drama/;
// Nonfiction even with a "-- Fiction" heading somewhere.
const IS_NONFICTION = /nonfiction|non-fiction|biography|memoir|autobiograph|essays|true crime|history and criticism/;

// Subjects that are about the record, not the book.
export const JUNK_SUBJECT = /^(accessible book|protected daisy|in library|lending library|large type books|open library staff picks|overdrive|internet archive wishlist|reading level-.*|long now manual for civilization|new york times.*|fiction|general|nonfiction|non-fiction|literature|english literature|american literature|translations.*|textbooks)$/i;

// Genre labels for a list of subjects, at most max of them.
export function genresFromSubjects(subjects, max = 5) {
	const subs = [];
	for (const s of subjects || []) {
		// "nyt:hardcover-fiction=2021-05-02" and other tag-style subjects.
		if (/^[a-z_]+:/i.test(s)) continue;
		const t = String(s).toLowerCase().replace(/\s+/g, " ").trim();
		if (t && !JUNK_SUBJECT.test(t)) subs.push(t);
	}
	const raw = (subjects || []).map((s) => String(s).toLowerCase());
	const fiction = subs.some((s) => IS_FICTION.test(s)) || raw.includes("fiction");
	const nonfiction = !fiction || subs.filter((s) => IS_NONFICTION.test(s)).length > subs.filter((s) => IS_FICTION.test(s)).length;
	const rules = [...(fiction ? FICTION : []), ...(nonfiction ? NONFICTION : []), ...ANY];
	const out = [];
	for (const [label, re] of rules) if (subs.some((s) => re.test(s))) out.push(label);
	return out.slice(0, max);
}
