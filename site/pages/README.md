# The words on wr1t3r.app

Each `.md` file here is one page of wr1t3r.app: `index.md` is the front page, `help.md` the Help page, `legal.md` terms and privacy. Change the words, then run `npm run deploy:site`. It turns these files into the pages in `site/public/` and puts them online. To look first, `npm run preview:site` builds them and serves the site at http://localhost:8787.

Don't edit `site/public/index.html`, `help.html` or `legal.html`: they're rebuilt from these files every time and aren't kept in git.

## The rules

It's ordinary Markdown, plus a few habits the build turns into the page's layout.

- **The top of the file** (between the first two `---` lines) holds the page's title in the browser tab and search results (`title:`), the summary search engines show (`description:`), and on the front page `buy:`, the checkout link. While `buy:` is empty, the Buy buttons go to the Pricing section.
- **`--- name` starts a section.** The name is the section's address (`#pricing` links to `--- pricing`) and, for some names, its look: `publish` lays its list out in two columns, `more` its list in columns, `own` keeps its paragraph plain, `faq` draws lines between questions, `contents` spaces out the Help page's list. Keep those names as they are; new sections can have any name.
- **`--- menu`** is the list of links at the top right. **`--- footer`** is the line at the bottom.
- **`_A paragraph in italics_`** becomes small grey print.
- **A heading ending in `?`** (`### Can I get a refund?`) folds its answer away until it's clicked.
- **On the front page:**
  - The first paragraph under a section's heading is the larger intro text.
  - A paragraph of nothing but links becomes buttons; the first is the colored one. Link to `buy` (`[Buy for $20](buy)`) for a Buy button.
  - A `##` or `###` heading whose text ends with a picture puts the picture beside the text, alternating sides. Two pictures sit side by side; pictures with `phone` in the file name are drawn as phones.
  - A picture on its own elsewhere spans the page.
  - A list of pictures with a word after each (`- ![alt](/shots/x.webp) Gruvbox`) becomes the grid of themes with captions.
  - A paragraph starting with a bold price (`**$20** once`) starts the price box; everything after it in the section goes inside the box.
- **Pictures** go in `site/public/shots/` and are written `![what the picture shows](/shots/name.webp)`. The text in brackets is read aloud to people who can't see it.
- **HTML works** where Markdown has nothing for it, like `<br>` for a line break in a heading or `<kbd>/</kbd>` for a key.
