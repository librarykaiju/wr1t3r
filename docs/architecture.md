# How wr1t3r fits together

How the Worker, storage, the browser's offline copy and sync work, plus running it locally.

- **One Cloudflare Worker** (`worker/`) serves the page (built into `dist/` by Vite) and a small file API. Every `/api/` request needs `WR1T3R_TOKEN`, sent as a Bearer token, the same way Reader does it.
- **The notes** live in an R2 bucket (`bucket_name` in `wrangler.toml`).
- **Storage is pluggable** (`src/storage.js`). The page reads and writes notes through one small interface (list, read, conditional write, remove, pictures). The Worker is the default; Dropbox, Google Drive and Nextcloud are the others (see [builds.md](builds.md)), and others register there without the rest of the page changing. `test/storage.test.js` checks every kind against the same rules.
- **The browser keeps its own copy** of every note in IndexedDB (`src/store.js`). Typing saves there first; syncing runs in the background, when the connection comes back, when the tab comes back into view, every minute, and on Ctrl/Cmd-S. The last sync time sits in the bottom-right corner (tap it to sync now), under any messages and reminders, which stack there too, each with an × to dismiss it. The page itself is cached by a service worker (`public/sw.js`), so it opens with no connection.
- **Conflicts keep both.** Every write names the version it started from. If a note changed in the vault and in wr1t3r since the last sync, the vault's version stays at the note's name and wr1t3r's goes next to it as `Name (conflict YYYY-MM-DD).md`. An edit beats a delete from the other side. The rules are at the top of `src/sync.js`.
- **Byte-faithful.** Frontmatter, spacing, BOMs and CRLF line endings are kept exactly; a note is only written when you change it. A note with mixed line endings has them all turned into LF once you edit it. A note that isn't valid UTF-8 opens read-only.

## Using a GitHub repo instead of R2

For notes that live in a git repo, set `BACKEND = "github"`, `GITHUB_REPO`, `GITHUB_BRANCH` and `VAULT_PREFIX` in `wrangler.toml`, and `npx wrangler secret put GITHUB_TOKEN` with a fine-grained token that has Contents read/write on that repo only. Each save becomes one commit. Don't point this at a repo that something else also writes to on a schedule, or the two can overwrite each other.

## Development

```sh
npm test                     # sync rules (node --test)
npm run build
npx wrangler dev             # page + API on http://localhost:8787, with a local, empty bucket
node scripts/seed-local.js ../my-notes content   # copy a folder of notes into it
```

Put `WR1T3R_TOKEN=anything` in `.dev.vars` for local runs.
