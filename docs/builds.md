# Builds and storage options

Dropbox storage, the license key, the paid build at my.wr1t3r.app, the wr1t3r.app site, and the free self-host build.

## Dropbox instead of the Worker

A build with a Dropbox app key shows **Use Dropbox** on the sign-in screen. Notes then live in the person's own Dropbox, in `Apps/<app name>/`, and the page talks to Dropbox directly: no Worker token, no R2.

1. At https://www.dropbox.com/developers/apps, create an app: Scoped access, **App folder**.
2. Permissions: `files.metadata.read`, `files.content.read`, `files.content.write`. Submit.
3. Settings: add the page's address as a Redirect URI (`https://your.host/`, with the slash). Copy the **App key** (the secret isn't used).
4. Build with it: `VITE_DROPBOX_APP_KEY=<app key> npm run deploy`.

The calendar switches to the built-in one (below), task reminders show while wr1t3r is open (any tab) instead of being pushed, and picture search, grammar, word lookup, the food table and media lookups run on the device. What still needs the Worker (transcripts, voice memos, the Drive backup and clipping from an address) isn't offered on a Dropbox build; the clip bookmarklet works there. A new Dropbox app is in development status, which allows 500 linked accounts until Dropbox approves it for production.

## Nextcloud instead of the Worker

Every build shows a **Nextcloud** button on the sign-in screen (`src/nextcloud.js`). The person enters their Nextcloud's address, their username and an app password (Nextcloud: Personal settings › Security › Create new app password), plus a folder for the notebook (`wr1t3r` by default). The page talks WebDAV to their server directly; nothing goes through a server of ours. Details are kept in localStorage (`wr1t3r-nextcloud`) and deleted on sign-out; the person can revoke the app password in Nextcloud at any time. Everything said above about Dropbox builds without the Worker applies here too.

- **The server has to allow the page.** Nextcloud sends no CORS headers by default, so the server's admin installs the [WebAppPassword](https://apps.nextcloud.com/apps/webapppassword) app and adds the page's origin (`https://my.wr1t3r.app`) under its WebDAV/CalDAV origins, or adds CORS headers in their web server. When a request can't be read, the sign-in screen shows those steps. Nextcloud's own sign-in flow (Login Flow v2) is blocked from browsers, and WebAppPassword's pop-up passwords expire after a day, hence the pasted app password.
- **Versions** are `etag|size|sha1`. A Nextcloud ETag only changes once a second has passed since the last write, so every write sends `OC-Checksum: SHA1:<hash>`, which Nextcloud stores and lists. A write by another app clears or replaces it, so a change in the same second still shows up.
- **Idle syncs** ask only for the notebook folder's ETag, which changes whenever anything inside it does; the full listing (one `PROPFIND` with `Depth: infinity`, or folder by folder where the server refuses that) runs when it moves, and at least every 10 minutes.
- **Writes** are conditional (`If-Match`, or `If-None-Match: *` to create), so the keep-both conflict rules in `src/sync.js` apply unchanged. Missing folders are made with `MKCOL`. Deletes go to Nextcloud's trash bin.
- **A 401** stops syncing at once and signs out, because Nextcloud's brute-force protection slows down an address that keeps sending a bad password.
- The page's `connect-src` (`public/_headers`) allows any `https:` address, since the server could be anywhere. An `http://` server is refused from an `https://` page.

### Nextcloud Calendar

Settings > Features > **Nextcloud Calendar** (`src/caldav.js`) works on any build, Worker included: the calendar has its own sign-in (localStorage `wr1t3r-nextcloud-calendar`, `{server, user, uid, password}`, or `{same: true}` to reuse the notebook's Nextcloud sign-in). When connected, its calendars show next to Google's (or the notebook's): `src/calmerge.js` puts both sources behind the same calls, prefixes Nextcloud's calendar ids with `nc:`, and sends each add, delete and import to the side its calendar id belongs to. One side failing still shows the other. Nextcloud's main calendar is the default for new events only when the other side is the notebook's calendar. It's a reminders target like Google (`googleSide`).

- **Reads** are a `PROPFIND` of `/remote.php/dav/calendars/<uid>/` (names, colors, write access, `oc:calendar-enabled` for which show by default; task-only lists are left out), then a `REPORT` calendar-query per calendar with `<expand>`, so repeats come back one per occurrence, in UTC, with a `RECURRENCE-ID`.
- **Event ids** are the `.ics` file's name, plus `|<RECURRENCE-ID>` for one occurrence. Deleting an occurrence adds an `EXDATE` to the main event (and drops a changed copy of it), with `If-Match`.
- **Writes** are `PUT` with `If-None-Match: *`. Times carry the device's `TZID` and a `VTIMEZONE` built from `Intl` (daylight saving as yearly rules), so repeats keep their wall-clock time. Timed events get a 10-minute `VALARM` unless the form says otherwise; reminders get one at the time. A reminder's file is named after its id, so a second device sending it gets 412, which counts as already sent. `MKCALENDAR` makes the "wr1t3r reminders" calendar.
- **A 401** disconnects only the calendar, not the notebook.

`test/caldav.test.js` runs against `test/fakecaldav.js`, which expands daily and weekly rules the way Sabre does.

The Nextcloud-specific part is the `/remote.php/dav/files/<user>/` path; the rest is plain WebDAV. `test/nextcloud.test.js` runs against a fake server (`test/fakenextcloud.js`) that follows what a real Nextcloud 35 with WebAppPassword did in a browser test on 2026-10-28.

## License key (product build)

A build with `VITE_POLAR_ORG_ID` set asks for a [Polar](https://polar.sh) license key. Without it (the personal build) nothing here applies and there's no License tab.

Each device gets a 14-day free trial from the day it's first opened. After that a window asks for the key; the notes stay in the user's own storage throughout. Activating a key registers the device with Polar as an activation (labelled like "wr1t3r on iPhone"), so the license key benefit's activation limit caps devices, and Settings > License can remove a device to free its place. Keys are checked again about once a week while online; a revoked or disabled key (Polar revokes it on a refund), or a removed device, goes back to asking. Being offline never does. The check runs in the page (`src/license.js`), so it keeps honest people honest and no more.

1. In Polar, make a **License Keys** benefit with an activation limit (5 devices, say), and a one-time-purchase product that grants it.
2. Note the organization ID (Settings > General) and the benefit's ID (Benefits, open the license key benefit), and copy the product's checkout link.
3. Build with them: `VITE_POLAR_ORG_ID=<organization id> VITE_POLAR_BENEFIT_ID=<benefit id> VITE_BUY_URL=<checkout link> npm run build`. The benefit ID is optional; without it any license key from the organization is accepted.

The checks use Polar's customer-portal license key endpoints (`activate`, `validate`, `deactivate`), which need no token and accept calls from any site. `VITE_LICENSE_API` points them somewhere other than `https://api.polar.sh/v1/customer-portal/license-keys`, such as `https://sandbox-api.polar.sh/v1/customer-portal/license-keys` to test against Polar's sandbox (already allowed in `connect-src` in `public/_headers`; add any other host there too).

## The product build (my.wr1t3r.app) and wr1t3r.app

The version sold to other people is the same code built without the Worker: the page alone, served from https://my.wr1t3r.app, with each person's notes in their own Dropbox and a Polar license key. `site/` is the page at https://wr1t3r.app that describes it and links to the checkout.

1. Make the Dropbox app (above), with `https://my.wr1t3r.app/` as its Redirect URI.
2. Make the Polar product (above).
3. Create `.env.product.local` (not in git) with the IDs:
   ```
   VITE_DROPBOX_APP_KEY=<app key>
   VITE_POLAR_ORG_ID=<organization id>
   VITE_POLAR_BENEFIT_ID=<benefit id>
   VITE_BUY_URL=<checkout link>
   ```
   `.env.product` already sets `VITE_DROPBOX_ONLY=1`, which makes the sign-in screen offer only Dropbox.
4. `npm run deploy:product` builds into `dist-product/` and deploys it as the `wr1t3r-user` Worker (`wrangler.product.toml`: static files only, on the `my.wr1t3r.app` custom domain).
5. Put the checkout link in `site/pages/index.md` (the `buy:` line at the top), then `npm run deploy:site` builds the pages and deploys `site/public/` as the `wr1t3r-site` Worker on `wr1t3r.app` and `www.wr1t3r.app`.

The site's words are Markdown files in `site/pages/` (`index.md`, `help.md`, `legal.md`). `scripts/build-site.js` turns each into `site/public/<name>.html`, which git ignores; `site/pages/README.md` has the layout rules. `npm run preview:site` serves the built site locally.

Both custom domains are created by the deploy, since wr1t3r.app is a zone on the same Cloudflare account. The personal build (`npm run deploy`) is unaffected.

## The self-host build (free)

Anyone can host their own copy for free: the product build with no license check, on their own Dropbox app. `site/pages/self-host.md` (https://wr1t3r.app/self-host.html) is the step-by-step guide for people who've never done it; this is the short version.

- **`npm run build:selfhost`** builds with `.env.selfhost` (`VITE_DROPBOX_ONLY=1` like the product build, plus `VITE_SELF_HOST=1`) into `dist-selfhost/`. It needs `VITE_DROPBOX_APP_KEY` from the shell, the host's build variables or `.env.selfhost.local`, and stops with a pointer to the guide without it. No `VITE_POLAR_*`, so there's no trial, key or License tab. `VITE_SELF_HOST` only changes where the sign-in screen and Settings say the notes are, since a self-hoster's Dropbox app has its own name.
- **Cloudflare:** a fork imported into Workers Builds, build command empty, deploy command `npm run deploy:selfhost`, which deploys `wrangler.selfhost.toml` (the product Worker's setup, named `wr1t3r`, on workers.dev, no custom domain). The Worker name in the dashboard has to match.
- **GitHub Pages:** `.github/workflows/self-host-pages.yml` builds and deploys on every push to a fork's `main` (never in this repo), with the key from the `DROPBOX_APP_KEY` repository variable. The page assumes it's at the top of its address, so the fork is named `yourname.github.io`. Pages ignores `public/_headers`, so that copy runs without the Content-Security-Policy.
- **Google Drive and Calendar** work on Cloudflare if the self-hoster also sets `VITE_GOOGLE_CLIENT_ID` and the Worker's `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, as on the product build; the guide leaves them out.
- **Updates** reach a fork when its owner clicks Sync fork; the host rebuilds on the push.

The code is open source under the GNU AGPL v3 (`LICENSE`): anyone can use, change and share it for any purpose, and anyone who runs a changed copy for other people has to offer them its source.
