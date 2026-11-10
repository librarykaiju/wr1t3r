# Features

The calendar, Google services, the local folder, transcripts, food search, media notes, capture, reminders, picture search, boards, website export, writing stats, first run and feature switches.

## First run

When the first sync finds the notebook empty, wr1t3r asks what it's for: writing, a journal and day planner, health and food, media logs, or research and clipping. Start turns on the areas those need and the rest off (written to `_wr1t3r/Settings.md`, see below), adds a Welcome note on how to use each area that's on (right-click a folder for Corkboard, Outliner and Draft, and so on, leaving out what the build can't do), and by default a sample `My Story/` manuscript for writing and a Home screen pinning them. Skip leaves everything on and adds nothing. **Getting started** (command palette, or the button at the top of Settings > Features) opens the Welcome note, or writes a new one for the areas on now if it's gone. It's asked once per device, and never for a notebook with anything in it. On an iPhone or iPad outside the Home Screen it also says to add wr1t3r there, since Safari otherwise clears the offline copy after about a week. The choices and starter notes are in `src/onboarding.js`.

## Features and folders

Settings > Features turns whole areas on or off for the notebook: long-form writing, boards, daily notes and planner, health and food, media logs, calendar, transcripts and voice memos, searchable pictures, capture and clipping, and reminders. A Dropbox build leaves transcripts and voice memos out of the list and calls capture just Capture, since those parts need the Worker. An area that's off leaves the command palette, menus and buttons (`data-feature` in `index.html`, `body.no-<area>` in `style.css`); the notes it made stay as they are. The same tab sets wr1t3r's own folders inside the notes' folder: the Inbox note, uploads, clippings, compiled notes and the task lists.

Both are kept in `_wr1t3r/Settings.md` beside the Home note, so every device has the same ones, and only what differs from the defaults is written. With no Settings note everything is on and the folders are the ones above (`Inbox.md`, `uploads/`, `docs/clippings/`, `compiled/`, `docs/`), with `daily/` and `weekly/` for daily and weekly notes. Older notebooks have `_uploads/`, `_clippings/`, `_compiled/`, `_docs/`, `_daily/` and `_weekly/`, or the product build's `Uploads/`... and `Lists/`, and clippings in a top-level `clippings/`: wr1t3r keeps using those while they're there, offers once on each device to rename them (links, pins and icons follow), and the palette's "Rename wr1t3r's _ folders to plain names" does it any time (`src/build.js`). A capitalized folder is renamed only where notes sync to GitHub with no folder on the computer, since Dropbox, Drive and most computers' disks don't tell `Daily` from `daily`. `_wr1t3r/` and `_templates/` keep their underscore; they're hidden from the notes list and never published. Whatever the uploads and clippings folders are called, their `dataviewjs` blocks never run and their checklists aren't sorted. `src/features.js` has the areas, the folders and which commands belong to which area. The Worker's `/api/capture` (the iPhone Shortcut) still writes to `CAPTURE_NOTE`; in-app capture goes through the Worker only while the Inbox setting is the default.

## Built-in calendar

With no Google Calendar (a Dropbox device, or a Worker without the Google settings below), the agenda, month view, Timeline and event alerts use events kept in the notebook: one note per event in `_wr1t3r/Calendar/`, so they work offline and sync like any note. Add them with **+ Add event** (it can repeat daily, weekly, monthly or yearly), or write one by hand:

```yaml
---
title: Dentist
start: 2026-10-07T15:00   # a date alone is all day
end: 2026-10-07T16:00     # all day: the last day
location: Main St
color: 7                  # a Google event color number
reminder: 30              # minutes before, or none
repeat: weekly            # daily, weekly, monthly, yearly
until: 2026-12-31
skip: [2026-10-14]        # occurrences deleted from the agenda
---
```

Alerts show while wr1t3r is open. Times are wall-clock times on the device showing them.

### Importing an .ics file

**Import .ics…** in the Add event form (or Commands, "Import calendar file (.ics)") reads a calendar file from Google, Apple or Outlook calendar, a school or a team (src/ics.js). Events already over are left out. Each event note gets a `uid:` so importing the same file again skips what's already there, and one changed occurrence of a repeating event becomes its own event with that day skipped on the repeating one. Times are moved to this device's clock. The built-in calendar repeats daily, weekly, monthly or yearly: a weekly rule on several days (Mon, Wed, Fri) becomes one weekly note per day, and a rule it can't hold (every other week, the second Tuesday) comes in as its first date only, which the import says. With Google Calendar connected, the events go to the calendar picked in the form instead, through Google's own import (`POST /api/calendar/import`), with their repeat rules as written; Google skips events it already has.

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

### Google Calendar on the paid build

With no Worker of ours holding a Google account, each person connects their own: Settings > Features > **Connect Google Calendar** (shown when the build has `VITE_GOOGLE_CLIENT_ID`). The page signs in with Google itself (src/google.js, OAuth code flow with PKCE) and calls Google Calendar from the browser (src/gcal.js, sharing `listEvents`, `eventBody`, `slimEvent` and `importEvents` with worker/calendar.js). Google only gives a lasting sign-in to an app that sends its client secret, so the product Worker (worker/product.js, worker/googleauth.js) swaps the sign-in code and refresh token for access tokens with the secret added. It stores nothing; the refresh token stays in the browser, and calendar data never passes through it. When Google ends the sign-in (revoked, or after 7 days while the Google app is in Testing), the agenda falls back to the built-in calendar and asks to connect again.

Setup, once: a Google Cloud project with the Google Calendar API on, a Web OAuth client whose redirect URI is `https://my.wr1t3r.app/`, scopes `calendar.events` and `calendar.calendarlist.readonly`; then `VITE_GOOGLE_CLIENT_ID` in .env.product.local and `npx wrangler secret put GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET -c wrangler.product.toml`.

### Notes in Google Drive (a test)

On the paid build with `VITE_GOOGLE_CLIENT_ID` set, the sign-in screen also offers **Sign in with Google Drive** (src/gdrive.js, storage kind `gdrive`). It asks only for `drive.file`, which Google grants without a security review: wr1t3r sees the files it made (notes written in wr1t3r, and anything added with Upload) and nothing else in the person's Drive. A file dropped into the folder from Drive's website or desktop app stays invisible. The notebook is a "wr1t3r" folder at the top of My Drive, found again on other devices by its appProperties. Drive works by ids, so each listing rebuilds paths from parent folders. It has no "only if unchanged" write, so writes check the version first; two devices saving in the same second can still overwrite each other. Deleting moves the file to Drive's trash. The Google Cloud project also needs the Google Drive API on, and the `drive.file` scope on the consent screen.

## Google Drive backup

Every hour, at 17 minutes past, the Worker copies the vault bucket into a folder at the top of your Google Drive (`DRIVE_BACKUP` in `wrangler.toml`, `wr1t3r-vault-backup`), with the bucket's folders inside it (`worker/backup.js`). Only files that changed since the last copy are sent. It only adds and updates: a file deleted from the bucket keeps its last copy in Drive. A run copies a batch (up to `BACKUP_CALLS` calls to Google, default 45, which fits the 50 subrequests a Worker run gets on Cloudflare's free plan) and the next run carries on. While files are left over, the every-minute cron runs another batch, so the first full copy finishes on its own; one batch runs at a time. Its progress is kept in the bucket at `.wr1t3r/backup.json`.

It uses the Google sign-in from [Google Calendar](#google-calendar), with Drive access added:

1. In the same Google Cloud project: **APIs & Services** → **Library** → **Google Drive API** → **Enable**.
2. Run `npm run google-auth` again, with the same client ID and secret, and allow both calendar and Drive access. wr1t3r asks only for the Drive files it makes itself, so it can't see or change anything else in your Drive.
3. `npm run deploy`.
4. Command palette → **Back up to Google Drive now** runs batches straight away until the backup is up to date (keep the tab open; it shows the count as it goes) and says how it went (also `GET` / `POST /api/backup`, one batch each). Later runs happen on their own.

Remove the `DRIVE_BACKUP` line to turn backups off. On a paid Workers plan you can raise `BACKUP_CALLS` (say to `"900"`) for bigger batches.

## Local folder

wr1t3r can keep the whole vault as plain files in a folder on your computer, both ways, while it's open. Chrome or Edge on a computer only (Firefox, Safari and phones can't open a folder for a page). Open **Settings → Sync and files → Choose a folder…** and pick an empty folder, or an old copy of the vault.

- **Same layout as the vault.** `content/…` and every other path, notes and attachments.
- **When.** After every sync, when the tab comes back into view, 3 seconds after you stop typing, and every 30 seconds while the tab is visible. Nothing happens while wr1t3r is closed; changes made then are picked up the next time it opens.
- **Edits in the folder** (Notepad, VS Code, anything) come into wr1t3r and from there to the vault and every device. An open note updates in place.
- **Both sides changed:** the file takes wr1t3r's version and the folder's comes in as `Name (conflict YYYY-MM-DD).md`, in both places.
- **Deletes.** A note deleted in wr1t3r is removed from the folder. A file deleted from the folder is asked about first; Cancel puts it back.
- **A folder that already has notes** gets a summary first (how many match, differ, or are only on one side), and nothing is written until you say yes.
- **Attachments** come down as the vault changes them. A new picture (png, jpg, gif, webp, avif, bmp, up to 20 MB) put in the folder goes up; other new files and edits to existing attachments stay local. If the folder and the vault have different pictures at the same name the first time, the folder's is kept as `name (conflict YYYY-MM-DD).png` and uploaded.
- Hidden files and folders (`.obsidian`, `.trash`, `.git`) are left alone.

The browser remembers the folder. After a restart it may ask again: the status says so, and **Allow again** gives it back. **Stop** forgets the folder and leaves its files where they are. What was last agreed on for each file (size, modified time, a hash of the text) is kept in IndexedDB; `src/localvault.js` has the rules and `src/localvaultview.js` does the reading and writing.

## Transcripts

**Transcribe a video or audio file** (command palette, or `/transcript` in a note) puts a transcript of the file into the open note at the cursor, with speakers told apart:

```markdown
## Transcript

*interview.mp4 · 12:40 · 2 speakers*

**Speaker 1**
[0:00] Thanks for coming on.

**Speaker 2**
[0:04] Glad to be here.
```

The browser takes the sound out of the file (anything it can play: mp4, mov, webm, m4a, mp3, wav) and sends only that, as 16 kHz mono audio, so a big video doesn't have to upload. The Worker has Deepgram's Nova-3 transcribe it on Workers AI, on the same Cloudflare account: no extra key. Up to 40 minutes per file. One speaker gets no speaker lines; rename "Speaker 1" with find and replace.

Workers AI bills Nova-3 at about half a cent per audio minute, and its daily free allowance covers roughly 20 minutes. The `[ai]` binding in `wrangler.toml` turns it on; nothing else to set. `wrangler dev` reaches Workers AI remotely, so it needs `npx wrangler login` first.

## USDA food search

The planner's Food button can look foods up in USDA FoodData Central. The Worker does the search and holds the key; the page never sees it. Get a free key at [fdc.nal.usda.gov/api-key-signup](https://fdc.nal.usda.gov/api-key-signup), then:

```sh
npx wrangler secret put USDA_API_KEY
```

Until it's set (and always on a Dropbox device), **Search USDA** searches the USDA tables shipped with the app instead (`src/foodtable.js`), on the device, FNDDS matches first: `public/food/usda-fndds.json` (FNDDS, about 5,000 foods as eaten, dishes and drinks included; USDA updates it every two years) and `public/food/usda-sr-legacy.json` (SR Legacy, about 7,800 ingredients; final). Both are public domain. `npm run food-data` makes both from USDA's downloads (`npm run food-data -- fndds path/to.zip` or `-- sr path/to.zip` from a zip you downloaded; for a new FNDDS release, change `TABLES.fndds.source` in `scripts/food-data.js`). A build missing one file searches the other.

## Media notes

The command palette's **Create movie/TV note**, **Create book note**, **Create music note**, **Create game note**, **Create comic note** and **Create podcast note** (and **New anime log**) use the same properties as the Media Notes plugin. Search, pick a result, pick a cover (every kind offers a choice, plus a box for pasting an address), and the note opens in its folder with the looked-up properties and an empty `## Notes` heading. Searches forgive punctuation and case: what's typed is tried as is, then without its punctuation, and an exact title match goes to the top, so "Spider-man Brand New Day" finds *Spider-Man: Brand New Day*. When OMDb, RAWG or Comic Vine find nothing, Wikidata is searched instead (its full-text search when the name search misses). The progress notice closes when a lookup ends, whether it worked or not. The Worker does the lookups (`worker/media.js`), since most of these services don't answer browsers directly, and it holds the keys; the page never sees them.

Books (Open Library and Apple Books, searched together so new releases Open Library hasn't added yet still turn up; type a title, an author, or both in one box. The page asks Apple itself, since Apple turns away the Worker's shared Cloudflare addresses), music (MusicBrainz, with covers from Cover Art Archive and iTunes), anime (AniList, with MyAnimeList's art through Jikan) and podcasts (iTunes) need no key. Cover choices come from every source at once, and a source that takes more than six seconds is skipped, so the picker opens quickly; a choice whose picture doesn't load is left out. An album's cover choices are the release group's own front cover, then the fronts of its single releases (many albums have art on only one release, which is why some music logs came out with none), then iTunes'. Movie and TV posters come from OMDb or Wikipedia, then iTunes for the same title and year. Anime logs go with movies and TV and have `director`, `studio`, `genre`, `episodes`, `streamingServices` (from AniList's streaming links), the cover, a `banner`, the summary and the AniList page.

For logs that already exist, **Choose a cover for this log** (command palette) finds covers by the open log's title (and artist, author or the year in its name) and opens the same picker; the pick goes in `coverImage`. **Fill missing music covers** gives every music log without a cover the first one found for its album and artist, and lists the ones it couldn't find. Movies and TV, games and comics need no key either: without one they come from Wikidata, with the summary and picture from the Wikipedia article (`worker/wikimedia.js`). Fewer details (no IGDB box art without its key, single comic issues are thin), but nothing to sign up for. A result is always titled by its name (in English, else any language Wikidata has), never by its bare id, and an item whose Wikipedia link is only a redirect (a remake listed under the original's article) gets no summary or picture from it rather than the original's. Games use the chosen entry's own id throughout; IGDB box art and the Steam banner go by the result's year, so a remake gets its own art. On a Dropbox device the page runs the same lookups itself, with no keys. A key swaps in the richer service:

```sh
npx wrangler secret put OMDB_API_KEY        # movies and TV, free at omdbapi.com/apikey.aspx
npx wrangler secret put RAWG_API_KEY        # games, free at rawg.io/apidocs
npx wrangler secret put COMICVINE_API_KEY   # comics, free at comicvine.gamespot.com/api
npx wrangler secret put IGDB_CLIENT_ID      # optional: game box art (a Twitch app at dev.twitch.tv/console/apps)
npx wrangler secret put IGDB_CLIENT_SECRET
npx wrangler secret put ANTHROPIC_API_KEY   # optional: subject headings and vibe tags for books
npx wrangler secret put GOOGLE_BOOKS_API_KEY  # optional: Google Books in book search, covers and summaries (it no longer answers without a key)
```

Notes go in `content/logs/movies-tv`, `books` (comics too), `music`, `games` and `podcasts`. Set `MEDIA_MOVIE_FOLDER`, `MEDIA_BOOK_FOLDER`, `MEDIA_MUSIC_FOLDER`, `MEDIA_GAME_FOLDER` or `MEDIA_PODCAST_FOLDER` under `[vars]` to change them.


### Stats and StoryGraph import

A folder of logs (most notes have a `rating:`, `shelf:` or `status:`) gets a **Stats** tab beside Storyboard, Outliner and Draft; Commands > Open stats picks one, and a `stats:content/logs/books` pin opens it from Home. It shows, for all time or one year: how many were finished (and pages, for books), the average rating, what's in progress and planned, finished per month (per year for all time), the ratings, and the most common genres, moods, pace, formats, authors, directors, platforms and so on, with covers for what's in progress and what got five stars (`src/mediastats.js`, `src/mediastatsview.js`). Everything is worked out on the device from the notes' properties.

A log counts as finished when its shelf or status says so ("Finished", "Read", "Watched", ...), or has none; its day is `finished:`, else `date:`. Changing a log's shelf to a finished value, in the editor or by moving its card on a board, adds `finished:` with today's date if it has none. Book lookups now fill in `pages:` from Open Library.

**Ratings and book formats** are lists of set choices. `rating` (every kind of log) is one of ⭐ to ⭐⭐⭐⭐⭐: the properties box offers the five, picking one replaces the old one, and typing a number from 1 to 5 picks that many stars. A book log's `format` is 📖Book, 📱Ebook, 🎧Audiobook or 💬Comic. Both are list properties unless Property Types says otherwise; the lookups, the built-in templates and the StoryGraph import write them this way (`src/properties.js`). Commands > **Update log ratings and formats** brings older logs over: `rating: 4` (or `4/5`, `8/10`, `★★★★`) becomes ⭐⭐⭐⭐, and 📘 Book, paperback and the like become 📖Book, 📱 Ebook, digital and Kindle 📱Ebook, 🔉 Audio 🎧Audiobook, 💬 Comic 💬Comic. Half stars and formats it doesn't know stay as they are. Stats read stars and numbers alike.

Commands > **Import StoryGraph library** takes StoryGraph's export (Manage Account > Export StoryGraph Library, a CSV) and makes a book log for each book, or fills in an existing log of the same title where it's empty (nothing already written changes): shelf, rating (rounded to whole stars), finished date, format (paperback and hardcover as 📖Book, digital as 📱Ebook, audio as 🎧Audiobook), moods and pace into `vibesAndThemes`, tags, and the review as the note's text. New logs then get a cover, page count, subjects and summary from Open Library, one at a time in the background (`src/storygraph.js`).

## Quick capture

Anything captured lands as an open task at the end of `content/Inbox.md` (change it with the `CAPTURE_NOTE` var; times use `TIMEZONE`, default `America/Chicago`).

- **In wr1t3r:** "Capture to the Inbox" and "Record a voice memo" in the command palette (pin either to Home). A voice memo goes into the open note at the cursor, or to the Inbox when no note is open.
- **Android:** install wr1t3r to the home screen, then pick it in any app's Share menu.
- **iPhone:** web apps can't join the Share menu, so make an Apple Shortcut: turn on "Show in Share Sheet" (accepts URLs and text), then add **Get Contents of URL** with URL `https://<your wr1t3r>/api/capture`, Method POST, header `Authorization: Bearer <your token>`, Request Body JSON with `text` set to Shortcut Input. Sharing to the Shortcut sends it to the Inbox.

## Reminders and repeating tasks

- **Reminders:** `/Reminder` (or right-click a task's box) adds `(@2026-10-03 14:30)` to a task, the Reminder plugin's format. A date with no time reminds at 9:00. After each sync wr1t3r sends the upcoming reminders to the Worker, which checks every minute and sends each one as a notification to every device that ran "Turn on reminders on this device". Notifications arrive with wr1t3r closed. On iPhone this only works in wr1t3r added to the Home Screen.
- **Setup, once:** `npm run vapid`, then run the two `npx wrangler secret put` commands it prints, then `npm run deploy`. The list and subscriptions live in the bucket at `.wr1t3r/reminders.json`.
- **Repeating tasks:** `🔁 every day | week | month | year`, `every 2 weeks`, `every weekday`, `every monday, thursday`, and `… when done`, as the Tasks plugin writes them. Ticking one adds the next copy on the line above, with its dates moved on.

## Searchable pictures and PDFs

The palette's "Make pictures and PDFs searchable" sends each picture (JPEG, PNG, GIF, WebP) and PDF in the vault to Claude (Haiku 4.5) once, through the Worker, to read the text in it, or to say in a sentence what a picture shows when it has no text. Sidebar search then finds them; clicking a result opens the file. While it's on, new pictures and PDFs are read after each sync, up to ten at a time. It needs the `ANTHROPIC_API_KEY` secret (the one media notes use). The texts live in the bucket at `.wr1t3r/ocr.json`. Pictures over 5 MB and PDFs over 32 MB or 100 pages are skipped.

With no Worker (Dropbox) or no `ANTHROPIC_API_KEY`, the device reads them itself: Tesseract for pictures (printed English text; no descriptions of pictures without text), and the PDF's own text layer, with the first five pages of a scanned PDF read like pictures. The engine and language data (about 7 MB) are served from this site under `/ocr/` and downloaded the first time. The texts stay on that device.

## Board column totals

In a board's Grid, click under a column to pick its total: Sum, Average, Median, Smallest, Largest, Range, Standard deviation, Earliest or Latest date, Checked, Unchecked, Filled, Empty, or Unique values. It's saved in the view's `summaries:`. Amounts written the way people write money (`$1,200.50`, `-$5`, `15%`) count in Sum and Average. When the grid is grouped, each group gets its own total row under its notes, and the bottom row totals everything.

## Budgets with boards

A board can show one row for each row of a table in a note, so a month's budget table feeds a board that adds up the year. Open a board's **Source** and set **Each row is** to "a row of a table in the note" (in the YAML: `wr1t3r: { tableRows: true }` under the view). `true` reads the first table in each note, a number reads that table (`2` is the second), and a heading name reads the table under that heading (`tableRows: Spending`). Notes with no such table add no rows.

Each row has the table's columns (the header row names them) and the note's own properties, so a table of `Category | Budget | Spent` in notes with a `month:` property gives a board with Category, Budget, Spent and month. Filter, Group, Sort and column totals all work on any of them. Group by Category to see every month's line for it, with a total under each group. Group by month for the other direction. Cells are read as numbers (`$1,200.50` is 1200.5). If a column and a property share a name, the column wins. Rows whose first cell is Total, Sum or Subtotal, and empty rows, are skipped so nothing is counted twice, which means the month's own Total row can stay in the table. Table rows show as a grid only.

The table's cells are read-only on the board: change them in the note. Property columns such as `month` can still be edited on the board. (`src/basestables.js` reads the tables, `runView` in `src/bases.js` makes the rows.)

Two built-in templates set this up (in the template list, and under your own templates when a notebook has them): **Budget month** is a note with `type: budget` and `month:`, and a Category, Budget, Spent, Left table where Left and the Total row work themselves out by formulas. **Budget overview** is a note holding a board of every note with `type: budget`, with By category and By month views and totals. Make one Budget month note a month, then open the overview. Use its Filter to look at one year or one category. It works the same in the paid app, since it only reads note text.

## Export as website

Commands, then "Export as website", turns every note with `publish: true` into a static website and downloads it as a .zip (src/website.js plans the files; src/websiteview.js is the dialog). "Add this note to my website" and "Remove this note from my website" set the property. The toolbar's globe button does both: it's highlighted while the open note is on the site, and its menu publishes or unpublishes the note and opens Export as website (`src/published.js` is the check, shared with the site builder). Everything runs in the page, so it's the same in both builds. It's the Website area in Settings > Features (src/features.js): left unset, it's on only once a note has `publish: true`, so a new notebook has no globe until it's switched on.

- Each page shows the note's other properties in a **Properties** box under the title (lists as pills, yes/no as a checkbox, dates written out, web addresses as links), leaving out the ones the page already uses or that only steer wr1t3r (`title`, `publish`, `tags`, `date`, `cover`, `cssclasses` and the like). A switch in the dialog turns it off.
- Tags are pills in the theme's rainbow, each the same color as in the app, and top-level folders keep their sidebar colors: tinted rows in the notebook layout's folders, a colored underline in the top menu.
- One .html page per note with relative links, a front page listing them by folder (a published `Home.md` or `Index.md` at the top becomes its text), `not_found.html` for Neocities, and `style.css` built from a theme picked in the dialog (any of the notebook's, starting with the one in use) and the notebook's font. With Auto the site follows each visitor's light or dark setting.
- `[[Links]]` to published notes become links; links to anything else become plain words. `%% comments %%`, block ids and dataview/base blocks never go in. Notes in `_` folders and `draft: true` notes are left out even when marked.
- Pictures and PDFs a published note uses are copied into `files/`. Audio and video only when "Include audio and video" is on, since a free Neocities site won't take them.
- Layout: "Top menu" (a link per top-level folder across the top) or "Notebook" (the folders down the left as in the app, folding open; plain `<details>`, no scripts). On phones the left column goes above the text.
- Navigation: the site title (and an optional logo, a picture from the notebook that's also the tab icon) goes to the front page; a menu links each top-level folder's own list (`folder/index.html`); each page ends with Previous and Next in its folder, newest first.
- The sidebar, beside the text or under it on phones, can hold a calendar of what was posted when (from each note's `date`), with a page per month under `archive/` and an Archive menu item, and support buttons (Ko-fi, Patreon, one link of your own). They're plain links, no third-party scripts. The right sidebar can be turned off, and can also hold "Find me on" links: one address per line (Bluesky, Mastodon `@name@server`, Instagram and so on are named for their site; an email address becomes an Email link written as character codes).
- A note with `bluesky:` set to a Bluesky post's address (the post sharing the page) shows that post's likes, reposts and replies under the page, read in the reader's browser from Bluesky's public API (`public.api.bsky.app`). Nothing is stored; readers like and reply on Bluesky. Without scripts, or if Bluesky can't be reached, it's a "Like or reply on Bluesky" link.
- Posts get Share buttons (system share sheet on phones, Copy link, Bluesky, Mastodon, Email), filled in by a few lines of script since a page only knows its address once it's online.
- The dialog remembers its settings and the pages of the last download on this device, and lists pages that have dropped off since, so they can be deleted from the host.

To put it online: unzip, then drag the files and folders into the Neocities dashboard, Netlify Drop or Cloudflare Pages.

**Publish to GitHub** (src/githubpublish.js) sends the same files straight to a GitHub repo from the page, as one commit through GitHub's API (which takes calls from browsers, so it needs no Worker and works on both builds). The person makes a fine-grained token for that repo with Contents and Pages set to Read and write; it's kept on the device only if they tick "Remember the token". Files whose git blob id already matches aren't sent again, files the last publish to that repo put there and the site no longer has are deleted, anything else in the repo is left alone, and `.nojekyll` is added. An empty repo gets a first commit; GitHub Pages is turned on for the branch if it isn't already. `https://api.github.com` is in the page's `connect-src` (public/_headers). Cloudflare Pages can watch the same repo.

Step-by-step guides with screenshots live on the product site's Help page, written in `site/pages/help.md` (setup, publishing, Neocities, GitHub Pages, Cloudflare); Settings > Help links to them.

## Writing stats, goals and fonts

- **Stats and goals:** click the word count for words, characters, sentences, words per sentence, paragraphs and reading time (238 words a minute). "Words for this note" saves `goal:` in the note, and the count then reads `1,240 / 2,000 words` with a progress fill. "Words today" is a goal per device, counting words you add while typing (deletions count against it), with a notice when you reach it.
- **Underline, text color, alignment:** toolbar buttons and slash commands. Markdown has no syntax for these, so they're saved as HTML: `<u>…</u>`, `<span style="color: #3b7dd8">…</span>`, `<p align="center">…</p>`. Inline Markdown inside `<p align>` isn't drawn by other Markdown apps.
- **Font:** Settings > Appearance > Font, per device.
- **Focus mode:** palette "Toggle focus mode" (per device). The side columns, header and toolbar fold away, the line you're typing stays in the middle of the screen, and other paragraphs dim. Esc or "Leave focus" turns it off.
