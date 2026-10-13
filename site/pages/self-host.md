---
title: Host your own wr1t3r for free
description: Step by step, put your own free copy of wr1t3r online with Cloudflare or GitHub Pages. Your notes stay in your own Dropbox. No coding needed.
page: help
---

--- menu

- [Help](/help.html)
- [Open the app](https://my.wr1t3r.app/)

--- contents

# Host your own wr1t3r for free

You can pay $20 and use wr1t3r at [my.wr1t3r.app](https://my.wr1t3r.app/) right away. Or you can put your own copy online for free. It's the same app. You just do the setup yourself.

I want wr1t3r to be for everyone. If money is tight, or you want to learn how websites go online, this page is for you. If you like it and can pay later, that helps me keep making it.

**What you need**

- A computer with a web browser. You won't type any commands.
- A free [GitHub](https://github.com/) account. GitHub keeps the app's code.
- A free [Dropbox](https://www.dropbox.com/) account. Dropbox keeps your notes.
- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account, if you pick Cloudflare in step 3.
- About 20 minutes.

**The steps**

- [Step 1: Copy wr1t3r to your GitHub](#copy)
- [Step 2: Make your Dropbox key](#dropbox)
- [Step 3: Put it online with Cloudflare](#cloudflare) (best choice)
- [Or step 3: Put it online with GitHub Pages](#github)
- [Step 4: Tell Dropbox your address](#address)
- [Step 5: Open your wr1t3r](#open)
- [Getting updates](#updates)
- [If something goes wrong](#trouble)
- [How it's different from the paid app](#different)

--- copy

## Step 1: Copy wr1t3r to your GitHub

A copy of code on GitHub is called a _fork_. Your fork is yours. Nothing you do there changes my copy.

1.  **Sign in to GitHub.**

2.  **Open [github.com/librarykaiju/wr1t3r](https://github.com/librarykaiju/wr1t3r).**

3.  **Click _Fork_** near the top right.

4.  **Leave the name as `wr1t3r`.** If you plan to use GitHub Pages in step 3, change the name now to `yourname.github.io`. Use your GitHub username in place of _yourname_. For Cloudflare, keep `wr1t3r`.

5.  **Click _Create fork_.** In a few seconds you have your own copy.

--- dropbox

## Step 2: Make your Dropbox key

Your wr1t3r needs its own key to talk to Dropbox. The key is not a password. It just tells Dropbox which app is asking.

1.  **Go to [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)** and sign in.

2.  **Click _Create app_.**

3.  **Pick these choices:**

    - _Scoped access_
    - _App folder_. This means the app can only see its own folder, not the rest of your Dropbox.
    - For the name, type something like `wr1t3r-yourname`. Each name on Dropbox has to be new, so `wr1t3r` alone won't work. Your notes will go in a folder with this name, inside _Apps_ in your Dropbox.

4.  **Click _Create app_.**

5.  **Open the _Permissions_ tab.** Check these three boxes:

    - `files.metadata.read`
    - `files.content.read`
    - `files.content.write`

    Then click _Submit_ at the bottom of the page. This is easy to miss!

6.  **Open the _Settings_ tab.** Find _App key_. Copy it and keep it handy. You'll paste it in step 3.

    You'll come back to this page in step 4, so leave it open.

--- cloudflare

## Step 3: Put it online with Cloudflare

This is the best choice. It's what I use for my own copy.

1.  **Sign in to [Cloudflare](https://dash.cloudflare.com/).** Make a free account if you need one. You don't need a card.

2.  **Open _Workers & Pages_** from the menu on the left. (It may be inside _Compute_.)

3.  **Click _Create_.** Then pick _Import a repository_. If it asks, connect your GitHub account and let Cloudflare see your `wr1t3r` fork.

4.  **Pick your `wr1t3r` fork** and click _Next_ or _Begin setup_.

5.  **Fill in the settings:**

    - **Project name:** `wr1t3r`. Keep this exact name.
    - **Build command:** leave it empty.
    - **Deploy command:** `npm run deploy:selfhost`
    - Open _Advanced settings_. Under _Build variables_, click _Add variable_.
      - **Variable name:** `VITE_DROPBOX_APP_KEY`
      - **Value:** the App key you copied in step 2.

6.  **Click _Deploy_.** Wait a few minutes. When it's done, Cloudflare shows your address. It looks like this: `https://wr1t3r.yourname.workers.dev`

    Copy that address. Now go to [step 4](#address).

--- github

## Or step 3: Put it online with GitHub Pages

Use this if you don't want a Cloudflare account. Your fork must be named `yourname.github.io` (see step 1). If you forgot, open your fork's _Settings_, change the _Repository name_, and click _Rename_.

1.  **Turn on GitHub Actions.** In your fork, click the _Actions_ tab. Click the green button that says _I understand my workflows, go ahead and enable them_.

2.  **Add your Dropbox key.** In your fork, open _Settings_. On the left, click _Secrets and variables_, then _Actions_. Click the _Variables_ tab, then _New repository variable_.

    - **Name:** `DROPBOX_APP_KEY`
    - **Value:** the App key you copied in step 2.

    Click _Add variable_.

3.  **Turn on Pages.** Still in _Settings_, click _Pages_ on the left. Under _Source_, pick _GitHub Actions_.

4.  **Start it.** Go to the _Actions_ tab. Click _Self-host on GitHub Pages_ on the left. Click _Run workflow_, then the green _Run workflow_ button.

5.  **Wait a few minutes.** A green check means it worked. Your address is `https://yourname.github.io`

    Copy that address. Now go to [step 4](#address).

--- address

## Step 4: Tell Dropbox your address

Dropbox only lets your key work on the address you give it.

1.  **Go back to your Dropbox app's _Settings_ tab** from step 2.

2.  **Find _Redirect URIs_.** Paste your address. Add a `/` at the very end, like this:

    `https://wr1t3r.yourname.workers.dev/`

3.  **Click _Add_.**

--- open

## Step 5: Open your wr1t3r

1.  **Open your address** in your browser.

2.  **Click _Sign in with Dropbox_** and say yes.

3.  **You're in!** Your notes are saved as plain files in your Dropbox, in _Apps_, in the folder named after your Dropbox app.

On an iPhone or iPad, tap _Share_, then _Add to Home Screen_. Open wr1t3r from there. If you don't, Safari may delete wr1t3r's saved data after a few weeks.

You can open the same address on every device you own. Sign in to the same Dropbox on each one.

The [Help page](/help.html) shows how to use wr1t3r and how to publish your notes as a website.

--- updates

## Getting updates

When I fix something or add something, your copy doesn't change by itself. To get the new version:

1.  **Open your fork on GitHub.**

2.  **Click _Sync fork_**, then _Update branch_.

That's it. Cloudflare or GitHub Pages sees the change and puts the new version online in a few minutes. Close wr1t3r and open it again to see it.

--- trouble

## If something goes wrong

- **The build failed and says to add `VITE_DROPBOX_APP_KEY`.** The Dropbox key is missing. On Cloudflare, open your Worker, then _Settings_, then _Build_, and add it under _Build variables_. On GitHub, check that the variable is named `DROPBOX_APP_KEY` exactly. Then build again.
- **Cloudflare says the name doesn't match.** Your Worker has to be called `wr1t3r`. Make a new one with that name.
- **Dropbox says "Invalid redirect_uri".** The address in step 4 doesn't match. Check that it starts with `https://` and ends with `/`.
- **Dropbox says the app can't do something.** Go back to step 2, number 5. Check all three boxes and click _Submit_.
- **The GitHub Pages site is a blank page.** The fork must be named `yourname.github.io`, with your real username.
- **Still stuck?** Look at the build's log. On Cloudflare, it's under _Deployments_. On GitHub, it's in the _Actions_ tab. The red lines near the bottom say what went wrong.

--- different

## How it's different from the paid app

- **It's free.** No trial and no license key.
- **Dropbox only.** Google Drive and Google Calendar need a lot more setup, so this guide leaves them out. Everything else works the same.
- **You get updates when you click _Sync fork_.** The paid app updates by itself.
- **It's open source.** Use your copy for anything, even paid work like writing a book you sell. You can change the code too. If you change it and let other people use your changed copy, you have to share your changes with them. The [license](https://github.com/librarykaiju/wr1t3r/blob/main/LICENSE) has the exact words.

### Want to build it on your own computer?

If you want to learn more, you can build wr1t3r yourself. Install [Node.js](https://nodejs.org/) (version 22 or newer) and [Git](https://git-scm.com/). Then, in a terminal (PowerShell on Windows):

```
git clone https://github.com/yourname/wr1t3r
cd wr1t3r
npm install
```

Make a file called `.env.selfhost.local` in that folder with one line: `VITE_DROPBOX_APP_KEY=your-key`. Then `npm run build:selfhost` builds the app into the `dist-selfhost` folder, and `npx wrangler login` followed by `npm run deploy:selfhost` puts it on Cloudflare.

--- footer

[wr1t3r](/) · [Help](/help.html) · [Terms and refunds](/legal.html) · [Privacy policy](/privacy.html) · [hello@wr1t3r.app](mailto:hello@wr1t3r.app)
