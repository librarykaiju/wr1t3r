---
title: wr1t3r help: setting up and publishing
description: Step by step: set up wr1t3r with your Dropbox, then publish your notes as a website on Neocities or GitHub Pages.
page: help
---

--- menu

- [Open the app](https://my.wr1t3r.app/)

--- contents

# Help

Step by step, from first sign-in to a website with your notes on it. In the app, Settings > Help links back here.

- [Setting up wr1t3r](#setup)
- [Publishing your notes as a website](#publishing)
- [Putting the site on Neocities](#neocities)
- [Putting the site on GitHub Pages](#github)
- [Cloudflare Pages, from the same GitHub repo](#cloudflare)

--- setup

## Setting up wr1t3r

1.  **Open [my.wr1t3r.app](https://my.wr1t3r.app/)** in any browser. On an iPhone or iPad, tap Share, then _Add to Home Screen_, and open wr1t3r from there. Safari clears a website's saved data after a few weeks unless it's on the Home Screen.

2.  **Sign in with Dropbox.** wr1t3r gets one folder of its own, _Apps › wr1t3r_, and can't see anything else in your Dropbox. Your notes go straight between your browser and Dropbox; they never pass through a server of mine.

    ![The first screen: Your notes live in your own Dropbox, in Apps › wr1t3r, and a Sign in with Dropbox button](/shots/help-connect.webp)

3.  **Pick what you'll use it for.** wr1t3r turns on the parts that fit. Leave _Add starter notes and a Home screen_ ticked if you'd like a few notes to start from. You can change all of this later in Settings > Features.

    ![Welcome to wr1t3r: checkboxes for Writing, Journal and day planner, Health and food, Books, films and other media, and Research and capture, with Start and Skip buttons](/shots/help-features.webp)

4.  **Read the Welcome note.** It explains each part you turned on. Delete it when you're done; Commands > _Getting started_ writes a fresh one.

5.  **Already have notes?** Put your Markdown files (and their pictures) in _Dropbox › Apps › wr1t3r_. They show up when you switch back to wr1t3r.

6.  **Enter your license key** in Settings > License after you buy. Everything works during the 14-day trial.

![Settings › Help in the app: a Getting started guide button and links to these guides](/shots/help-settings.webp)

--- publishing

## Publishing your notes as a website

wr1t3r builds a website from the notes you choose, as plain web pages you can put on any host. Nothing is published until you say so.

1.  **Choose the notes.** Open a note, click the globe in the toolbar, and choose _Publish this note_. That adds `publish: true` to the note's properties. The globe is highlighted on notes that are on the site; the same menu unpublishes them.

    ![The globe button in the toolbar, open: This note isn't on your website, Publish this note, Export as website](/shots/help-globe.webp)

2.  **Set up the site.** In the globe menu, choose _Export as website…_. Give the site a title, pick a theme, light or dark, and a layout (a menu across the top, or folders down the left as in the app). Add Ko-fi, Patreon or your own link, and where else to find you. The preview on the right shows any page as visitors will see it.

    ![The Export as website window: site title, logo, theme, light or dark, layout and other settings on the left, and a preview of the front page on the right](/shots/help-export.webp)

3.  **Put it online.** Download it as a .zip for [Neocities](#neocities) (or any host that takes a folder of web pages), or send it straight to [GitHub Pages](#github). Both are free.

_Links to other notes stay links when those notes are published too. `%% comments %%` never go on the site. To show a note's likes and replies from Bluesky, add a `bluesky` property with the Bluesky post's address._

--- neocities

## Putting the site on Neocities

1.  **Make a site** at [neocities.org](https://neocities.org/). The free plan is plenty. The name you pick becomes the address: _yourname.neocities.org_.

2.  **Download the site from wr1t3r.** In Export as website, click _Download website (.zip)_. Leave _Include audio and video_ off; Neocities' free plan won't take those files.

    ![Export as website after a download, with directions for putting the site on Neocities](/shots/help-download.webp)

3.  **Unzip it.** On a Mac, double-click the .zip. On Windows, right-click it and choose _Extract All_. You get a folder with `index.html` and the rest of the site inside.

4.  **Upload the files.** On Neocities, open your site's dashboard (_Edit Site_). Open the unzipped folder, select everything inside it, and drag it all onto the Neocities page. Folders go up with their contents. Your `index.html` replaces the one Neocities started you with.

5.  **Visit _yourname.neocities.org_.** That's your site.

### Updating it

Download again and drag the new files in; they replace the old ones. Uploading doesn't delete anything, so when you unpublish a note, wr1t3r lists the pages to delete from your Neocities dashboard.

--- github

## Putting the site on GitHub Pages

wr1t3r can send the site to GitHub itself, so there's nothing to unzip or drag. You do the setup once.

1.  **Make a free account** at [github.com](https://github.com/) if you don't have one.

2.  **Make a repository** for the site: the _+_ at the top right of GitHub, then _New repository_.

    - Name it what you like, say `my-site`. The site will be at _yourname.github.io/my-site_. Name it `yourname.github.io` instead and the site is at _yourname.github.io_ itself.
    - Choose _Public_. GitHub Pages only works on public repositories on the free plan.
    - Nothing else needs ticking. Click _Create repository_.

3.  **Make a token** so wr1t3r can write to that one repository. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) (or your picture, _Settings_, _Developer settings_, _Personal access tokens_, _Fine-grained tokens_, _Generate new token_).

    - Name it `wr1t3r` and pick how long it lasts.
    - Under _Repository access_, choose _Only select repositories_ and pick your site's repository.
    - Under _Permissions_, add _Contents_ and _Pages_, and set both to _Read and write_.
    - Click _Generate token_ and copy it. GitHub only shows it once.

4.  **Publish from wr1t3r.** In Export as website, scroll to _Publish to GitHub_. Type the repository as `yourname/my-site`, leave the branch as `main`, paste the token, and click _Publish to GitHub_. Tick _Remember the token on this device_ if you don't want to paste it each time.

    ![The Publish to GitHub part of Export as website: repo, branch and token filled in, and a message saying the site was published, with its address](/shots/help-github.webp)

5.  **Wait a minute or two**, then open the address wr1t3r shows. The first publish turns GitHub Pages on for you.

### Updating it

Click _Publish to GitHub_ again. Only files that changed are sent, and pages you've unpublished are removed. Anything else in the repository, like a README, is left alone.

### If something goes wrong

- **"GitHub didn't accept the token":** it was copied short, or it has expired. Make a new one the same way.
- **"The token can't see a repo called…":** check the spelling, and that the token was made for that repository.
- **"The token can't write to that repo":** edit the token on GitHub and set Contents to Read and write.
- **wr1t3r couldn't turn Pages on:** in the repository on GitHub, open _Settings_, then _Pages_. Under _Source_ choose _Deploy from a branch_, pick _main_ and _/ (root)_, and save.

_The token goes from your browser straight to GitHub. wr1t3r never sees it or your site. If you tick Remember, it's kept in this browser only; you can delete the token on GitHub at any time._

--- cloudflare

## Cloudflare Pages, from the same GitHub repo

Prefer Cloudflare? Publish to GitHub as above, then let Cloudflare watch the repository. In the Cloudflare dashboard, create a Pages project, connect it to GitHub, and pick your site's repository. There's no build step: leave the build command empty and the output folder as the top of the repository. Every time you click _Publish to GitHub_, Cloudflare picks up the change.

You can also upload the unzipped folder to a Cloudflare Pages project by hand, the same way as Neocities.

--- footer

[wr1t3r](/) · [Terms, privacy and refunds](/legal.html) · [hello@wr1t3r.app](mailto:hello@wr1t3r.app)
