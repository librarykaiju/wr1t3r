// A quote about writing and making art for the empty screen, a different one
// each day. Only quotes with a known source (book, essay, letter, interview):
// many popular "writing quotes" are misattributed, so those are left out. The
// list ships with the app, so it works offline, and the same date gives the
// same quote on every device.

export const QUOTES = [
	["There is no greater agony than bearing an untold story inside you.", "Maya Angelou", "I Know Why the Caged Bird Sings"],
	["If you want to be a writer, you must do two things above all others: read a lot and write a lot.", "Stephen King", "On Writing"],
	["How we spend our days is, of course, how we spend our lives.", "Annie Dillard", "The Writing Life"],
	["Ever tried. Ever failed. No matter. Try again. Fail again. Fail better.", "Samuel Beckett", "Worstward Ho"],
	["All you have to do is write one true sentence. Write the truest sentence that you know.", "Ernest Hemingway", "A Moveable Feast"],
	["Almost all good writing begins with terrible first efforts. You need to start somewhere.", "Anne Lamott", "Bird by Bird"],
	["If you hear a voice within you say ‘you cannot paint,’ then by all means paint, and that voice will be silenced.", "Vincent van Gogh", "letter to Theo van Gogh, 1883"],
	["I write entirely to find out what I’m thinking, what I’m looking at, what I see and what it means.", "Joan Didion", "Why I Write"],
	["A word after a word after a word is power.", "Margaret Atwood", "Spelling"],
	["Be regular and orderly in your life, like a bourgeois, so that you may be violent and original in your work.", "Gustave Flaubert", "letter to Gertrude Tennant, 1876"],
	["Talent is insignificant. I know a lot of talented ruins. Beyond talent lie all the usual words: discipline, love, luck, but most of all, endurance.", "James Baldwin", "The Paris Review, 1984"],
	["Writing is thinking on paper.", "William Zinsser", "Writing to Learn"],
	["Great things are done by a series of small things brought together.", "Vincent van Gogh", "letter to Theo van Gogh, 1882"],
	["Amateurs sit and wait for inspiration, the rest of us just get up and go to work.", "Stephen King", "On Writing"],
	["No tears in the writer, no tears in the reader. No surprise for the writer, no surprise for the reader.", "Robert Frost", "The Figure a Poem Makes"],
	["A woman must have money and a room of her own if she is to write fiction.", "Virginia Woolf", "A Room of One’s Own"],
	["Instructions for living a life: / Pay attention. / Be astonished. / Tell about it.", "Mary Oliver", "Sometimes"],
	["The difference between the almost right word and the right word is really a large matter—’tis the difference between the lightning-bug and the lightning.", "Mark Twain", "letter to George Bainton, 1888"],
	["Writing a novel is like driving a car at night. You can see only as far as your headlights, but you can make the whole trip that way.", "E. L. Doctorow", "The Paris Review, 1986"],
	["One of the few things I know about writing is this: spend it all, shoot it, play it, lose it, all, right away, every time.", "Annie Dillard", "The Writing Life"],
	["Imagination is the beginning of creation.", "George Bernard Shaw", "Back to Methuselah"],
	["You must stay drunk on writing so reality cannot destroy you.", "Ray Bradbury", "Zen in the Art of Writing"],
	["Omit needless words.", "William Strunk Jr.", "The Elements of Style"],
	["Every artist was first an amateur.", "Ralph Waldo Emerson", "Progress of Culture"],
	["Bird by bird, buddy. Just take it bird by bird.", "Anne Lamott", "Bird by Bird"],
	["The scariest moment is always just before you start.", "Stephen King", "On Writing"],
	["Poetry is the spontaneous overflow of powerful feelings", "William Wordsworth", "Preface to Lyrical Ballads"],
	["Murder your darlings.", "Arthur Quiller-Couch", "On the Art of Writing"],
	["Art enables us to find ourselves and lose ourselves at the same time.", "Thomas Merton", "No Man Is an Island"],
	["Nulla dies sine linea. (Not a day without a line.)", "Apelles", "as told in Pliny the Elder’s Natural History"],
	["A writer is someone for whom writing is more difficult than it is for other people.", "Thomas Mann", "Tristan"],
	["Tell all the truth but tell it slant", "Emily Dickinson", "Tell all the truth but tell it slant"],
	["Attention is the beginning of devotion.", "Mary Oliver", "Upstream"],
	["Either write things worth reading, or do things worth the writing.", "Benjamin Franklin", "Poor Richard’s Almanack, 1738"],
	["True ease in writing comes from art, not chance, / As those move easiest who have learn’d to dance.", "Alexander Pope", "An Essay on Criticism"],
	["We tell ourselves stories in order to live.", "Joan Didion", "The White Album"],
	["Ah, but a man’s reach should exceed his grasp, / Or what’s a heaven for?", "Robert Browning", "Andrea del Sarto"],
	["Clear thinking becomes clear writing; one can’t exist without the other.", "William Zinsser", "On Writing Well"],
	["Poets are the unacknowledged legislators of the world.", "Percy Bysshe Shelley", "A Defence of Poetry"],
	["The artist must be in his work as God is in creation, invisible and all-powerful.", "Gustave Flaubert", "letter to Louise Colet, 1852"],
	["Make good art.", "Neil Gaiman", "commencement address, University of the Arts, 2012"],
	["Brevity is the soul of wit.", "William Shakespeare", "Hamlet"],
	["I must Create a System, or be enslav’d by another Man’s", "William Blake", "Jerusalem"],
	["It begins in delight and ends in wisdom.", "Robert Frost", "The Figure a Poem Makes"],
	["Art is a lie that makes us realize truth.", "Pablo Picasso", "“Picasso Speaks,” The Arts, 1923"],
	["If I read a book and it makes my whole body so cold no fire can ever warm me, I know that is poetry.", "Emily Dickinson", "as reported by Thomas Wentworth Higginson, 1870"],
	["In art, the hand can never execute anything higher than the heart can imagine.", "Ralph Waldo Emerson", "Art (Society and Solitude)"],
	["Ars longa, vita brevis. (Art is long, life is short.)", "Hippocrates", "Aphorisms"],
	["Well, less is more, Lucrezia", "Robert Browning", "Andrea del Sarto"],
	["No man but a blockhead ever wrote, except for money.", "Samuel Johnson", "in Boswell’s Life of Johnson"],
	["You write in order to change the world, knowing perfectly well that you probably can’t, but also knowing that literature is indispensable to the world.", "James Baldwin", "The Paris Review, 1984"],
	["Beneath the rule of men entirely great, / The pen is mightier than the sword.", "Edward Bulwer-Lytton", "Richelieu"],
];

// Days since 1970-01-01 on the local calendar, so the quote turns over at local midnight.
export function dayNumber(date = new Date()) {
	return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

export function quoteFor(date = new Date()) {
	const [text, author, work] = QUOTES[dayNumber(date) % QUOTES.length];
	return { text, author, work };
}
