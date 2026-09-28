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

Links are clickable (`src/links.js`). Web links, bare URLs and `<autolinks>` open in a new tab; `[[wikilinks]]` and markdown links to `.md` files open that note, found the way Obsidian finds it (relative path, then any note with that name), and Back returns. A `[[link]]` to a note that doesn't exist offers to create it next to the current note. Clicking a link the cursor is already in just places the cursor, so the first tap opens and the next one edits the text; Ctrl/Cmd-click always opens. Only `http`, `https` and `mailto` links leave the app. Footnotes work too: clicking `[^1]` jumps to its `[^1]:` definition, and clicking the definition's marker jumps back. Links to a heading (`[[Note#Heading]]`, `[[#Heading]]`, `[text](#heading)`) scroll to that heading.

Callouts written `> [!type]-` start folded and `> [!type]+` start open, as in Obsidian; the chevron after the title folds or unfolds them without changing the note. `%% comments %%` are shown dimmed.

Image links to web addresses (`![alt](https://...)`) show the picture under the line, as Obsidian does; `![alt|300](url)` sets the width. They load from their own sites with no referrer, and don't show offline unless the browser has them cached. Vault attachments (`![[pic.png]]`) aren't shown. Clicking a tag (a pill in the properties or a `#tag` in the text) lists the notes with it in the sidebar; typing `#tag` in the search box does the same, including nested tags like `#tag/sub`. Block ids (`^quote-1` at a line's end) are dimmed, and `[[Note#^quote-1]]` jumps to that line. Inline footnotes `^[...]` and raw HTML tags are styled.

Frontmatter shows as a **Properties** box (`src/frontmatter.js`). Tap its header to fold it (remembered per device); **+ Add property**, or **Add property** in the slash menu, adds a `key: ` line above the closing `---`, or a new block at the top of a note that has none. Enter at the end of a property line starts the next property; in other lists (like `aliases:`) it adds an item, and Enter on an empty item ends the list. Tags show as colored pills on one line and are edited there: × removes one, the **+ tag** box adds one (Enter or comma; Backspace in the empty box removes the last). `#tags` in the body get the same color per tag. Existing keys and their order are never touched. Notes open with the cursor just below the frontmatter. **New** notes (outside `_` folders) start with the vault's Note template properties (`title`, `publish: false`, `tags`, `status: seed`, today's `date`, `sticky`, `callout`), so the site has a fixed date instead of falling back to the file's creation time, which changes on every build.

Blocks are drawn like what they are, with the markdown still showing (`src/blocks.js`): task boxes are real checkboxes (clicking one flips `[ ]` / `[x]` in the text, and done tasks are struck through), callouts get a colored box in Obsidian's color for their type with its icon in place of `[!type]` (Backspace just after the icon removes it, to change the type), quotes a side bar (the `>` markers are always hidden; the darker left edge stands in for them, and Backspace at a line's start still removes one), code blocks a shaded box, and `---` a rule.

**Upload** turns files into notes in `content/_uploads/` (a `content/_*` folder, so the site build skips it), with a small frontmatter block naming the source file. Word (`.docx`), PDF, HTML and text files are converted in the browser, so this works offline too. Headings, lists, links, bold/italic and tables come across; images are left out. PDFs give their text layer only, with paragraphs and headings guessed from the layout, so a scanned PDF comes out empty.

**Clip** saves a web page as a note in `content/_clippings/`. The Worker fetches the page (Reader's `/api/fetch` rules: public http(s) addresses only, 5 MB, 15 s, token required), Mozilla's Readability picks out the article, and it's stored as markdown with Obsidian Web Clipper-style frontmatter (`title`, `source`, `author`, `published`, `created`, `description`, `tags: clippings`). Links and images point at the original site. Clipping needs a connection, and pages behind a login or built entirely by JavaScript may come out thin.

To clip from any page, use the bookmarklet in the **Aa** panel: drag it to the bookmarks bar on desktop. On iPhone, bookmark any page in Safari, then edit that bookmark and replace its address with:

```
javascript:location.href="https://wr1t3r.brandonj.ink/#clip="+encodeURIComponent(location.href)
```

**Aa** in the header sets the theme (Auto, Light, Dark, Sepia) and text size, with the same colors and choices as Reader. Both are kept per device.

The bar under the editor shows the note's word count, leaving out frontmatter. Tap it to switch to characters. When text is selected, it counts the selection.

The bar also has a pomodoro timer. Tap it to start or pause, and tap ↺ to reset. By default a focus block is 25 minutes and a break is 5; change the lengths in **Aa**. When a block ends, wr1t3r plays a chime and tells you how many words you wrote during it. It shows a notification too if you allow them. On iPhone, notifications only work once wr1t3r is added to the Home Screen. The timer keeps its place when you switch notes or reload. While the phone is locked, it only catches up once you come back.

The calendar button in the top right opens your Google Calendar agenda: today and the next week, from every calendar ticked in Google Calendar. The header also shows today's next event.
- Tap an event to put it in the open note as a line. Tap **Open in Google** to edit it there.
- The chips at the top pick which calendars show. Until you change them, they follow the calendars ticked in Google Calendar.
- Each event is tinted with its Google color: the color set on the event, or else its calendar's color.
- **+ Add event** adds an event to the calendar you pick (it remembers your last choice), with a reminder and a color you pick. The defaults are the calendar's own reminder and color.
- Reminders pop up with a chime while wr1t3r is open, and as a notification if you allow them. When wr1t3r is closed, Google Calendar's own app does the reminding.
- Offline, it shows the last agenda it loaded.

Setting it up is covered under [Google Calendar](#google-calendar) below.

**Contents** in the bar under the editor lists the note's headings, indented by level. Tap one to jump to it. The heading you're reading is highlighted as you scroll, and the arrows fold a section's sub-headings. On a wide screen the list stays docked beside the note (and stays open next time); on a phone it closes after a jump.

Tables are drawn as grids, with bold, code and links inside cells formatted (`src/tablegrid.js`); links in a cell open on click. Clicking a cell puts the cursor in that cell and shows the table as markdown, in a fixed-width font, until the cursor leaves it. Wide tables scroll sideways on a phone.
- **Tab** and **Shift+Tab** move between cells and pad the columns to line up. Tab past the last cell adds a row.
- **Enter** at the end of a row adds a row below it.
- With the cursor in a table, the slash menu adds **Add row below**, **Add column after**, **Delete row**, **Delete column** and **Format table**.
- Nothing is realigned unless you use one of these, so saving doesn't reshape your tables.

Rename a note by editing its path in the header and pressing Enter. Folders are made by putting a `/` in a name.

Only `.md` files are listed; hidden folders (`.obsidian`, `.trash`) are skipped. Folders named in `EXCLUDE` in `wrangler.toml` (for now `_includes/`, the site templates) are refused by the Worker itself: never listed, read, written or deleted. Images and other attachments aren't shown (source mode doesn't render them).

With no note open, the main window shows a quote about writing or making art that changes at local midnight. The list is in `src/quotes.js` and ships with the app, so it works offline; add or remove lines there to change the rotation.

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
