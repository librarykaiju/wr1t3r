import { test } from "node:test";
import assert from "node:assert/strict";
import { genresFromSubjects } from "../worker/genres.js";

// Subject lists as Open Library has them (trimmed).
test("fiction: genres from headings and bookstore categories", () => {
	assert.deepEqual(genresFromSubjects([
		"Fiction", "Fantasy fiction", "Magic -- Fiction", "Dragons", "Fiction, fantasy, epic",
		"Accessible book", "Protected DAISY", "nyt:hardcover-fiction=2021-05-02", "Middle Earth (Imaginary place)",
	]), ["Fantasy"]);
	assert.deepEqual(genresFromSubjects([
		"Science fiction", "Space flight -- Fiction", "Life on other planets", "Fiction, science fiction, action & adventure", "Astronauts",
	]), ["Science Fiction", "Adventure"]);
	assert.deepEqual(genresFromSubjects([
		"Fiction", "Missing persons -- Fiction", "Fiction, thrillers, suspense", "Fiction, mystery & detective, general", "Married people -- Fiction",
	]), ["Mystery", "Thriller"]);
	assert.deepEqual(genresFromSubjects([
		"Love stories", "Fiction, romance, contemporary", "Gay men -- Fiction", "Large type books",
	]), ["Romance", "LGBTQIA+"]);
	assert.deepEqual(genresFromSubjects([
		"Young adult fiction", "Dystopias", "Television programs -- Fiction", "Survival -- Fiction", "Juvenile fiction",
	]), ["Dystopian", "Young Adult", "Children's"]);
	assert.deepEqual(genresFromSubjects([
		"United States -- History -- Civil War, 1861-1865 -- Fiction", "Slavery -- Fiction", "Ghost stories",
	]), ["Horror", "Historical Fiction"]);
});

test("a setting in history or science doesn't make a novel nonfiction", () => {
	const g = genresFromSubjects(["Fiction", "Science -- Fiction", "Physics", "Scientists -- Fiction"]);
	assert.ok(!g.includes("Science"), g.join());
});

test("nonfiction: memoir, history, science", () => {
	assert.deepEqual(genresFromSubjects([
		"Westover, Tara", "Women -- Idaho -- Biography", "Survivalism", "Autobiography", "Biography & Autobiography / Personal Memoirs",
	]), ["Memoir", "Biography"]);
	assert.deepEqual(genresFromSubjects(["World War, 1939-1945", "History", "Military history"]), ["History"]);
	assert.deepEqual(genresFromSubjects(["Physics", "Cosmology", "Popular works"]), ["Science"]);
});

test("nothing that names a genre, nothing made up", () => {
	assert.deepEqual(genresFromSubjects(["Accessible book", "Protected DAISY", "In library", "Fiction"]), []);
	assert.deepEqual(genresFromSubjects([]), []);
	assert.deepEqual(genresFromSubjects(undefined), []);
});

test("at most five", () => {
	assert.equal(genresFromSubjects(["Fantasy fiction", "Science fiction", "Horror tales", "Love stories", "Detective and mystery stories", "Humorous stories", "Poetry"]).length, 5);
});
