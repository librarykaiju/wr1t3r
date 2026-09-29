# wr1t3r

A markdown editor for an Obsidian vault, in the browser. Live at https://wr1t3r.brandonj.ink. It edits the same notes Obsidian does, works offline, and never reformats a note it didn't change.

## How it fits together

- **One Cloudflare Worker** (`worker/`) serves the page (built into `dist/` by Vite) and a small file API. Every `/api/` request needs `WR1T3R_TOKEN`, sent as a Bearer token, the same way Reader does it.
- **The vault** is the `w3bz1n3-vault` R2 bucket, the one Remotely Save syncs Obsidian with. An edit in wr1t3r reaches every device on its next Remotely Save sync, and the vault-sync workflow in `librarykaiju/w3bz1n3` carries it into git like any other edit.
- **The browser keeps its own copy** of every note in IndexedDB (`src/store.js`). Typing saves there first; syncing runs in the background, when the connection comes back, when the tab comes back into view, every minute, and on Ctrl/Cmd-S. The page itself is cached by a service worker (`public/sw.js`), so it opens with no connection.
- **Conflicts keep both.** Every write names the version it started from. If a note changed in the vault and in wr1t3r since the last sync, the vault's version stays at the note's name and wr1t3r's goes next to it as `Name (conflict YYYY-MM-DD).md`. An edit beats a delete from the other side. The rules are at the top of `src/sync.js`.
- **Byte-faithful.** Frontmatter, spacing, BOMs and CRLF line endings are kept exactly; a note is only written when you change it. A note with mixed line endings has them all turned into LF once you edit it. A note that isn't valid UTF-8 opens read-only.

## Editing

The open note shows as a tab in the header: its name, and × to close it. Click the name to rename or move the note (the full path shows while you edit; Enter saves, Esc cancels). The sidebar lists what's inside the vault's single top folder (`content/`) as the top level.

Source mode (CodeMirror 6): headings, emphasis, links, `[[wikilinks]]`, `==highlights==`, footnotes and YAML frontmatter are styled but stay as text. Type `/` at the start of a line or after a space for the formatting menu (tables, tasks, callouts, code blocks and so on); keep typing to filter. The list is in `src/slash.js`.

On a phone, a bar sits above the keyboard while you type (`src/kbbar.js`): **/** opens that menu, **☐** turns the line into a task (or back), **H** cycles heading levels (# to ### and off), **[[** adds a note link with the cursor inside, and **↶** undoes. Swipe the bar sideways, as in Apple Notes, for every other menu command (headings, lists, bold, callouts and so on; the table ones appear with the cursor in a table). Bold, italic and the like wrap selected text, and line-level commands start a new line when the cursor is mid-text.

Links are clickable (`src/links.js`). Web links, bare URLs and `<autolinks>` open in a new tab; `[[wikilinks]]` and markdown links to `.md` files open that note, found the way Obsidian finds it (relative path, then any note with that name), and Back returns. A `[[link]]` to a note that doesn't exist offers to create it next to the current note. Clicking a link the cursor is already in just places the cursor, so the first tap opens and the next one edits the text; Ctrl/Cmd-click always opens. Only `http`, `https` and `mailto` links leave the app. Footnotes work too: clicking `[^1]` jumps to its `[^1]:` definition, and clicking the definition's marker jumps back. Links to a heading (`[[Note#Heading]]`, `[[#Heading]]`, `[text](#heading)`) scroll to that heading.

Callouts written `> [!type]-` start folded and `> [!type]+` start open, as in Obsidian; the chevron after the title folds or unfolds them without changing the note. `%% comments %%` are shown dimmed.

Image links to web addresses (`![alt](https://...)`) show the picture under the line, as Obsidian does; `![alt|300](url)` sets the width. They load from their own sites with no referrer, and don't show offline unless the browser has them cached. Vault attachments show too: `![[pic.png]]`, `![[pic.png|300]]` or `![](attachments/pic.png)` draw the image, audio and video get player controls, and a PDF shows as a card that opens it in a new tab. They're found the way Obsidian finds them (next to the note, from the vault root, then by name), fetched through the Worker, and kept in the browser's cache by version, so one you've opened shows offline. wr1t3r never changes them. Clicking a tag (a pill in the properties or a `#tag` in the text) lists the notes with it in the sidebar; typing `#tag` in the search box does the same, including nested tags like `#tag/sub`. Block ids (`^quote-1` at a line's end) are dimmed, and `[[Note#^quote-1]]` jumps to that line. Inline footnotes `^[...]` and raw HTML tags are styled.

A line holding just `![[Note]]` shows that note in a box, as Obsidian does (`src/embeds.js`); `![[Note#Heading]]` shows that section and `![[Note#^id]]` that block. The box is read-only: click its title to open the note, or put the cursor on the line (or press ✎) to edit the embed. Embeds inside an embedded note stay as text, so notes that embed each other can't loop.

**Live Preview** (Aa panel > Markdown symbols, off by default) hides `**`, `##`, `[text](url)` parts, `[[`/`]]` and `==` on every line except the one the cursor is on, like Obsidian's Live Preview (`src/livepreview.js`). Code blocks, tables and the properties box are left as they are. The note's text never changes.

**Quick switcher and command palette** (`src/palette.js`): **Ctrl/Cmd+O** jumps to a note by name (recent ones first; letters in order are enough, so `chone` finds Chapter One), and offers to create the note when nothing matches. **Ctrl/Cmd+P**, or the ⌘ button in the header, runs any command: new note, today's note, templates, bookmark, rename, delete, close tab, reference pane, Contents, Live Preview, upload, clip, media notes, sync, the focus timer, find, and every formatting command from the slash menu.

**Templates** (`src/templates.js`): **New note from template** and **Insert template** (both in the command palette) list everything in `_templates/`. A new note is named first; inserting puts the template's text at the cursor and adds only the properties the note doesn't have yet. Templater tags (dates, the title) and Obsidian's core `{{title}}`, `{{date}}`, `{{time}}` and `{{date:FORMAT}}` are filled in without running anything; plugin fields like `{{LIST:director}}` come out empty.

**Bookmarks and tags:** the ☆ in a note's tab bookmarks it; bookmarked notes are listed at the top of the sidebar (on this device). Below them, **Tags** lists every tag with how many notes have it; click one to see them.

**Tabs:** every note opened from the sidebar (or New, Today, a search) gets a tab across the top; following a link opens it in the current tab, as Obsidian does. Close a tab with × (or a middle-click). Open tabs are remembered on the device. On a phone only the current tab shows, and the number beside it lists the others.

**Reference pane** (wide screens): the split-square button in the header shows another note, read-only, beside the one you're editing. Pick it from the list at the top (your open tabs); links clicked in it open in the pane; **Edit** swaps it with the note in the editor.

The search box takes Obsidian-style operators (`src/search.js`): words (all must appear), `"a phrase"`, `path:folder`, `file:name`, `tag:x` or `#x` (nested tags count), and `-word` to leave notes out. Results show the first matching line with the match marked.

Typing `[[` lists notes to link to, filtered as you type (`src/linkcomplete.js`); picking one writes the shortest name that finds it, as Obsidian does, and `#` after a name lists that note's headings (`[[#` this note's). Links to notes that don't exist yet are drawn fainter. Under a note, a links panel (`src/backlinks.js`) has three parts that fold: **Linked from** (notes that link to it, with the line each link is on), **Links to** (notes it links to, faded when they don't exist yet) and **Unlinked mentions** (notes that name it in plain text without linking it; folded at first). It's built from the notes on the device, so it works offline. Renaming a note (edit the name in its tab) rewrites the links to it in other notes after asking, changing only the name part of each link and keeping its headings, aliases and style (`src/vaultlinks.js`).

Frontmatter shows as a **Properties** box (`src/frontmatter.js`). Tap its header to fold it (remembered per device); **+ Add property**, or **Add property** in the slash menu, adds a `key: ` line above the closing `---`, or a new block at the top of a note that has none. Enter at the end of a property line starts the next property; in other lists (like `aliases:`) it adds an item, and Enter on an empty item ends the list. Tags show as colored pills on one line and are edited there: × removes one, the **+ tag** box adds one (Enter or comma; Backspace in the empty box removes the last). `#tags` in the body get the same color per tag. Other values get Obsidian's editors where their type is plain from the text: `true`/`false` a checkbox, dates and date-times a picker (also an empty `date`, `created`, `due` and similar), and lists (`- ` items or `[a, b]`) the same pills, uncolored, with a **+ add** box that fills a blank `- ""` item first. Each edit rewrites only that value, keeping its quotes, capitals and date format. Existing keys and their order are never touched. Notes open with the cursor just below the frontmatter. **New** notes (outside `_` folders) start with the vault's Note template properties (`title`, `publish: false`, `tags`, `status: seed`, today's `date`, `sticky`, `callout`), so the site has a fixed date instead of falling back to the file's creation time, which changes on every build.

Blocks are drawn like what they are, with the markdown still showing (`src/blocks.js`): task boxes are real checkboxes (clicking one flips `[ ]` / `[x]` in the text, and done tasks are struck through), callouts get a colored box in Obsidian's color for their type with its icon in place of `[!type]` (Backspace just after the icon removes it, to change the type), quotes a side bar (the `>` markers are always hidden; the darker left edge stands in for them, and Backspace at a line's start still removes one), code blocks a shaded box, and `---` a rule.

**Upload** turns files into notes in `content/_uploads/` (a `content/_*` folder, so the site build skips it), with a small frontmatter block naming the source file. Word (`.docx`), PDF, HTML and text files are converted in the browser, so this works offline too. Headings, lists, links, bold/italic and tables come across; images are left out. PDFs give their text layer only, with paragraphs and headings guessed from the layout, so a scanned PDF comes out empty.

**Clip** saves a web page as a note in `content/_clippings/`. The Worker fetches the page (Reader's `/api/fetch` rules: public http(s) addresses only, 5 MB, 15 s, token required), Mozilla's Readability picks out the article, and it's stored as markdown with Obsidian Web Clipper-style frontmatter (`title`, `source`, `author`, `published`, `created`, `description`, `tags: clippings`). Links and images point at the original site. Clipping needs a connection, and pages behind a login or built entirely by JavaScript may come out thin.

To clip from any page, use the bookmarklet in the **Aa** panel: drag it to the bookmarks bar on desktop. On iPhone, bookmark any page in Safari, then edit that bookmark and replace its address with:

```
javascript:location.href="https://wr1t3r.brandonj.ink/#clip="+encodeURIComponent(location.href)
```

**Aa** in the header sets the theme and text size, kept per device. Themes are Default (Reader's colors), Sepia, Dracula, Rosé Pine, Tokyo Night, Catppuccin and Kanagawa; each but Sepia has Light and Dark variants (Dracula's light one is Alucard, Rosé Pine's is Dawn, Tokyo Night's Night and Day, Catppuccin's Mocha and Latte, Kanagawa's Wave and Lotus), and Auto follows the system. Top-level folders in the sidebar take the theme's rainbow colors in turn, and their subfolders keep the same color.

The bar under the editor shows the note's word count, leaving out frontmatter. Tap it to switch to characters. When text is selected, it counts the selection.

The bar also has a pomodoro timer. Tap it to start or pause, and tap ↺ to reset. By default a focus block is 25 minutes and a break is 5; change the lengths in **Aa**. When a block ends, wr1t3r plays a chime and tells you how many words you wrote during it. It shows a notification too if you allow them. On iPhone, notifications only work once wr1t3r is added to the Home Screen. The timer keeps its place when you switch notes or reload. While the phone is locked, it only catches up once you come back.

The calendar button in the top right opens your Google Calendar agenda: today and the next week, from every calendar ticked in Google Calendar. The header also shows today's next event. On a wide screen the pin button docks it beside the note so it stays open while you write (above the Contents panel when both are open). Calendar names that are email addresses are masked: your main calendar shows as "Main". On a computer (900px and wider) a month calendar sits above the list, with ‹ › and Today to change months and dots for each day's events: clicking a day starts the list there, and clicking an empty day opens the new-event form for it.
- Tap an event to put it in the open note as a line. Tap **Open in Google** to edit it there.
- The chips at the top pick which calendars show. Until you change them, they follow the calendars ticked in Google Calendar.
- Each event is tinted with its Google color: the color set on the event, or else its calendar's color.
- **+ Add event** adds an event to the calendar you pick (it remembers your last choice), with a reminder and a color you pick. The defaults are the calendar's own reminder and color.
- Reminders pop up with a chime while wr1t3r is open, and as a notification if you allow them. When wr1t3r is closed, Google Calendar's own app does the reminding.
- Offline, it shows the last agenda it loaded.

Setting it up is covered under [Google Calendar](#google-calendar) below.

**Contents** in the bar under the editor lists the note's headings, indented by level. Tap one to jump to it. The heading you're reading is highlighted as you scroll, and the arrows fold a section's sub-headings. On a wide screen the list stays docked beside the note (and stays open next time); on a phone it closes after a jump.

Tables are drawn as grids, with bold, code and links inside cells formatted (`src/tablegrid.js`); links in a cell open on click. Wide tables scroll sideways on a phone.

**Editing in the grid:** click a cell to type in it, like a spreadsheet: typing replaces what's there (click again or use the arrow keys to change it instead). **Tab** / **Shift+Tab** move across (Tab past the last cell adds a row), **Enter** and the up/down arrows move down and up (Enter on the last row adds one), **Esc** stops without saving that cell, and clicking outside the table saves it. While a cell is open, column letters and row numbers show around the table and a bar above it has **+ Row**, **+ Column**, **− Row**, **− Column**, **Markdown** (the table as text, with the cursor in that cell) and **Done**. A cell you change rewrites the table with its columns lined up; tables you don't touch are never reshaped.

**Formulas:** type `=` in a cell under the header to start one. Row 1 is the header and column A the first column, as the letters and numbers around the grid show. `=B2*C2` is a formula for that cell; `=B*C` (column letters with no row numbers) fills the whole column, each row using its own B and C, and a row whose B and C are empty stays empty. While typing a formula, clicking a cell adds its name (Shift-click makes a range from the name before the cursor). Ranges: `B2:B5`, and `B:B` for every row of column B except the header and the cell asking, so a total row can say `=SUM(D:D)`. Operators: `+ - * / ^`, `%` (`15%`), `&` (joins text), and `= <> < > <= >=`, with spreadsheet precedence. Functions: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `COUNTBLANK`, `MEDIAN`, `PRODUCT`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `INT`, `ABS`, `SQRT`, `POWER`, `MOD`, `IF`, `IFERROR`, `AND`, `OR`, `NOT`, `SUMIF`, `COUNTIF`, `AVERAGEIF`, `CONCAT`, `LEN`, `UPPER`, `LOWER`, `TRIM` (`src/formula.js`).
- Cells read the way a spreadsheet reads them: `$1,200.50`, `15%`, `**42**` and `-3` are numbers. Results borrow their look from the cells they come from (a currency sign and two decimals, percentages, thousands commas); other results show up to two decimals.
- The cells keep the results as plain text, so Obsidian, the site and any other markdown app show the numbers. The formulas are kept in one HTML comment right under the table, which those hide: `<!-- wr1t3r formulas: D = B*C; D5 = SUM(D:D) -->`. `D5 =` with nothing after it marks a cell you typed a value into, so its column's formula leaves it alone; **No column formula** in the bar removes a column's formula and keeps its numbers.
- Results are worked out again on every change in the grid. A table you edit as markdown is worked out again when the cursor leaves it.
- Adding or removing rows and columns from the bar moves formulas with their cells, like a spreadsheet; a reference to a removed cell becomes `#REF!`. The markdown-mode commands below don't, so a row added there can leave a one-cell formula like `D5 =` pointing at the wrong row (whole-column formulas are unaffected).
- Errors show in the cell: `#DIV/0!`, `#VALUE!` (text where a number is needed), `#REF!`, `#NAME?` (an unknown function), `#CIRC!` (a formula that needs its own result) and `#ERROR!` (a formula that can't be read; hover the cell for why). They're written as `\#DIV/0!` so Obsidian doesn't read them as tags.
- Obsidian doesn't recalculate: an edit there leaves the old numbers until the table is next changed in wr1t3r.

**As markdown** (the Markdown button, or moving the cursor into a table with the keyboard): a fixed-width font until the cursor leaves it.
- **Tab** and **Shift+Tab** move between cells and pad the columns to line up. Tab past the last cell adds a row.
- **Enter** at the end of a row adds a row below it.
- With the cursor in a table, the slash menu adds **Add row below**, **Add column after**, **Delete row**, **Delete column** and **Format table**.
- Nothing is realigned unless you use one of these, so saving doesn't reshape your tables.

Rename a note by editing its path in the header and pressing Enter. Folders are made by putting a `/` in a name.

In the sidebar, drag a note or folder onto another folder to move it, or onto the empty space below the list to move it to the top level. Right-click a note or folder (long-press on a phone) for **Rename…**, **Move to…** (pick a folder, or type a new one) and **Delete**; deleting a folder deletes every note in it. Moves and renames offer to update links to the moved notes, as a rename from the header does (`src/moves.js`). Like any rename, a move is a new note plus a delete of the old one, so a published note's site address changes with it. Attachments stay where they are, since wr1t3r only reads them.

Only `.md` files are synced as notes; hidden folders (`.obsidian`, `.trash`) are skipped. Images, PDFs, audio and video are listed separately (`GET /api/attachments`) and read one at a time (`GET /api/attachment?path=`), read-only. Folders and files named in `EXCLUDE` in `wrangler.toml` (for now `_includes/`, the site templates, and `content/404.md`, the site's not-found page) are refused by the Worker itself: never listed, read, written or deleted.

`dataviewjs` blocks run and show their output in place of the code, as in Obsidian with the Dataview plugin (`src/dataview.js`); **</>** or moving the cursor into a block shows the script. Each block runs in `public/dv-sandbox.html`, loaded in a sandboxed iframe with its own opaque origin: it can't see the token, storage or the page, and its CSP allows no network. It gets its note's Dataview page (`src/dvpage.js`: frontmatter fields, `file.lists` with their headings, and so on) plus the pages of notes in the same folder or linked from it, and asks the app for anything else: `dv.io.load` and `app.vault.read` read notes on the device, and `requestUrl` fetches public pages through `/api/fetch`. Scripts can't write: `vault.modify` fails with a message and `processFrontMatter` does nothing, so notes only change when you edit them (Obsidian keeps doing those writes). A script that calls `dv.pages()` gets every note's page instead (sources like `"folder"`, `#tag`, `[[note]]` and `outgoing([[note]])`, joined with `and`, `or` and `-`), with Dataview's `DataArray` methods (`where`, `sort`, `groupBy`, `map`, field swizzling), dates as a Luxon-like `DateTime` (`toFormat`, `plus`, `diff`), `file.link`, `file.day`, `file.tasks`, `file.inlinks` and `file.outlinks`, and note links in the output that open the note. Plain ```` ```dataview ```` query blocks (`TABLE`, `LIST`, `TASK` with `FROM`, `WHERE`, `SORT`, `GROUP BY`, `FLATTEN`, `LIMIT` and Dataview's common functions) are read by `src/dql.js` and drawn by the app itself; they're interpreted, not run as code, so they need no sandbox. Inline `= expr` fields and `CALENDAR` queries aren't supported. Blocks in `_clippings/` and `_uploads/` never run, since that text comes from outside the vault.

**Today** opens today's daily note, `_daily/YYYY-MM-DD.md`, or makes it from `_templates/Daily.md` (`src/daily.js`). The template is filled in the way Obsidian's Templater does it (`tp.date.now`, `tp.file.title`), and its script block is read rather than run: it makes the companion `YYYY-MM-DD Health` note from `_templates/Daily Health.md` and writes the link to it, so the files match what Obsidian would create byte for byte. Nothing in a template is ever executed.

**Daily note timeline:** pick a calendar under Aa > Daily note timeline (off until you do; per device) and Today puts that day's events into the note's `# Timeline` section as tasks, `- [ ] 09:30 - 10:15 | Dentist` or `- [ ] All day | Trip`, and the Timeline's items are sorted by start time: all-day first, anything you added there included, with lines indented under an item moving with it, and an item with no time staying under the one above it (`src/timeline.js`). An empty slot an event covers is replaced by it; slots you've written in are left alone. For a note Obsidian made, or events added later, run **Add calendar events to the timeline** from the command palette: it fills the open daily note (or today's), and skips events already listed, so running it twice changes nothing. A moved event is added at its new time and the old line stays.

With no note open, the main window shows a quote about writing or making art that changes at local midnight. The list is in `src/quotes.js` and ships with the app, so it works offline; add or remove lines there to change the rotation. Under it is a writing prompt question, also one a day (`src/prompts.js`, 60 of them). Tap it to start a journal entry for it in `journal/`, titled with the prompt and with the frontmatter from `_templates/Journal.md` (you can change the name first), or tap ↻ for another prompt.

## Setup

1. Make a token: a long random string (32+ characters) from your password manager.
2. From the repo root:
   ```sh
   npm install
   npx wrangler secret put WR1T3R_TOKEN
   npm run deploy
   ```
3. Cloudflare dashboard → **Workers & Pages** → `wr1t3r` → **Settings** → **Domains & Routes** → **Add** → **Custom domain** → `wr1t3r.brandonj.ink`.
4. Open it, paste the token. On iPhone, **Share** → **Add to Home Screen**; otherwise Safari may clear the offline copy after about a week without use.

## Google Calendar

This is a one-time setup, done in a browser and a terminal on your computer.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project, for example `wr1t3r`.
2. **APIs & Services** → **Library** → **Google Calendar API** → **Enable**.
3. **Google Auth Platform** (it may be labeled **OAuth consent screen**) → **Get started**:
   - App name `wr1t3r`, with your email as the support email.
   - Audience **External**, with your email as the contact email.
   - Create it.
4. **Audience** → **Publish app**, so it's "In production". Otherwise Google ends the sign-in after 7 days. The app doesn't need Google's verification because you're its only user.
5. **Clients** → **Create client** → Application type **Desktop app** → **Create**. Keep the page with the client ID and secret open.
6. In the wr1t3r folder, run:
   ```sh
   npm run google-auth
   ```
   - Paste the client ID and secret when it asks.
   - Sign in on the page that opens. Google warns that the app isn't verified; choose **Advanced** → **Go to wr1t3r**, then allow calendar access.
   - The script saves `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN` as Worker secrets. Nothing is saved on disk.
7. Reload wr1t3r.

If the agenda ever says the Google sign-in has expired, run `npm run google-auth` again. To cut wr1t3r off, remove it at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

The first sync downloads every note (a few MB for this vault).

## Media notes

The command palette's **Create movie/TV note**, **Create book note**, **Create music note**, **Create game note**, **Create comic note** and **Create podcast note** do what the Media Notes Obsidian plugin does, with the same properties, so a note made here matches one made in Obsidian. Search, pick a result (and a cover, for books and games), and the note opens in its folder with the looked-up properties and an empty `## Notes` heading. The Worker does the lookups (`worker/media.js`), since most of these services don't answer browsers directly, and it holds the keys; the page never sees them.

Books (Open Library and Google Books), music (MusicBrainz and Cover Art Archive) and podcasts (iTunes) need no key. The others show up once their keys are set:

```sh
npx wrangler secret put OMDB_API_KEY        # movies and TV, free at omdbapi.com/apikey.aspx
npx wrangler secret put RAWG_API_KEY        # games, free at rawg.io/apidocs
npx wrangler secret put COMICVINE_API_KEY   # comics, free at comicvine.gamespot.com/api
npx wrangler secret put IGDB_CLIENT_ID      # optional: game box art (a Twitch app at dev.twitch.tv/console/apps)
npx wrangler secret put IGDB_CLIENT_SECRET
npx wrangler secret put ANTHROPIC_API_KEY   # optional: subject headings and vibe tags for books
```

Notes go in `content/logs/movies-tv`, `books` (comics too), `music`, `games` and `podcasts`. Set `MEDIA_MOVIE_FOLDER`, `MEDIA_BOOK_FOLDER`, `MEDIA_MUSIC_FOLDER`, `MEDIA_GAME_FOLDER` or `MEDIA_PODCAST_FOLDER` under `[vars]` to change them.

## Using a GitHub repo instead of R2

For a vault that lives in git without Remotely Save, set `BACKEND = "github"`, `GITHUB_REPO`, `GITHUB_BRANCH` and `VAULT_PREFIX` in `wrangler.toml`, and `npx wrangler secret put GITHUB_TOKEN` with a fine-grained token that has Contents read/write on that repo only. Each save becomes one commit. Don't point this at `librarykaiju/w3bz1n3`: its R2 → git sync runs every 10 minutes and can overwrite a commit that hasn't reached R2 yet.

## Development

```sh
npm test                     # sync rules (node --test)
npm run build
npx wrangler dev             # page + API on http://localhost:8787, with a local, empty bucket
node scripts/seed-local.js ../w3bz1n3 content _includes/snippets   # copy a vault checkout into it
```

Put `WR1T3R_TOKEN=anything` in `.dev.vars` for local runs.
