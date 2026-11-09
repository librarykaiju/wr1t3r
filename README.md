# wr1t3r

A markdown notebook in the browser. It works offline, syncs in the background, and never reformats a note it didn't change. Live at https://wr1t3r.brandonj.ink.

One Cloudflare Worker serves the page and a small file API over an R2 bucket of notes. The browser keeps its own copy, so typing never waits on the network. Other builds store notes in the user's own Dropbox instead (see [docs/builds.md](docs/builds.md)).

## Deploy

You need a Cloudflare account and a token: any long random string (32+ characters) from your password manager.

**From the Cloudflare dashboard (no terminal):**

1. **Workers & Pages** → **Create** → **Import a repository**, and pick this repo.
2. Leave the build command empty. Set the deploy command to `npm run deploy`.
3. After the first deploy, open the `wr1t3r` Worker → **Settings** → **Variables and Secrets** → add a secret named `WR1T3R_TOKEN` with your token.
4. **Settings** → **Domains & Routes** → **Add** → **Custom domain** if you want your own address.

Every push to `main` deploys again.

**From a terminal:**

```sh
npm install
npx wrangler secret put WR1T3R_TOKEN
npm run deploy
```

Then open the site and paste the token. On iPhone, use **Share** → **Add to Home Screen**, or Safari may clear the offline copy after about a week without use.

## Develop

```sh
npm test
npm run dev    # builds, then serves page + API on http://localhost:8787
```

Put `WR1T3R_TOKEN=anything` in `.dev.vars` for local runs.

## More

- [docs/architecture.md](docs/architecture.md): how sync, storage and conflicts work; using a GitHub repo instead of R2
- [docs/editing.md](docs/editing.md): everything the editor does
- [docs/features.md](docs/features.md): calendar, Google setup, Drive backup, transcripts, food search, reminders, website export and the rest
- [docs/builds.md](docs/builds.md): Dropbox storage, the paid build, wr1t3r.app, and the free self-host build

## License

GNU AGPL v3. See [LICENSE](LICENSE).
