import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage, splitSections } from "../scripts/build-site.js";

const size = () => ({ w: 1600, h: 1000 });

test("--- name lines split the page into named sections", () => {
	const s = splitSections("intro\n\n--- menu\n- [a](/a)\n---- faq\ntext");
	assert.deepEqual(s.map((x) => x.name), ["", "menu", "faq"]);
});

test("the front page gets buttons, the price box and folding questions", () => {
	const html = renderPage(`---
title: T
buy: https://shop.example/buy
---

--- menu

- [Pricing](#pricing)

--- hero

# Big<br>title

Intro text.

[Try it](https://my.wr1t3r.app/) [Buy](buy)

_Fine print._

--- pricing

## Pricing

**$20** once

- No subscription

[Buy wr1t3r](buy)

--- faq

### Is it good?

Yes.
`, { size });
	assert.match(html, /<title>T<\/title>/);
	assert.match(html, /<nav>\n<a href="#pricing">Pricing<\/a>\n<\/nav>/);
	assert.match(html, /<h1>Big<br>title<\/h1>/);
	assert.match(html, /<p class="lede">Intro text.<\/p>/);
	assert.match(html, /<a class="button primary" href="https:\/\/my.wr1t3r.app\/">Try it<\/a>\n<a class="button buy" href="https:\/\/shop.example\/buy">Buy<\/a>/);
	assert.match(html, /<p class="small">Fine print.<\/p>/);
	assert.match(html, /<div class="price-card">\n<p class="price">\$20 <span>once<\/span><\/p>[\s\S]*<a class="button primary buy" href="https:\/\/shop.example\/buy">Buy wr1t3r<\/a>\n<\/div>/);
	assert.match(html, /<details>\n<summary>Is it good\?<\/summary>\n<p>Yes.<\/p>\n<\/details>/);
});

test("a heading ending in pictures becomes a side-by-side block", () => {
	const html = renderPage("--- features\n\n## Phones\n\nText.\n\n![one](/shots/phone-a.webp)\n![two](/shots/phone-b.webp)\n", { size });
	assert.match(html, /<div class="feature">\n<div>\n<h2>Phones<\/h2>\n<p>Text.<\/p>\n<\/div>\n<div class="phones">/);
	assert.match(html, /<img class="shot phone" src="\/shots\/phone-a.webp" width="1600" height="1000" alt="one">/);
	assert.match(html, /alt="two" loading="lazy">/);
});

test("other pages keep plain links and paragraphs", () => {
	const html = renderPage("---\npage: legal\n---\n\n# Terms\n\nIntro.\n\n[mail](mailto:a@b.c)\n", { size });
	assert.match(html, /<main class="legal">/);
	assert.match(html, /<p>Intro.<\/p>/);
	assert.match(html, /<p><a href="mailto:a@b.c">mail<\/a><\/p>/);
});
