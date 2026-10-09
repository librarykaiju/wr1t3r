---
title: wr1t3r help: setting up and publishing
description: Step by step: set up wr1t3r with your Dropbox or Google Drive, then publish your notes as a website on Neocities or GitHub Pages.
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
- [Sending it on to Neocities from GitHub](#neocities-github)
- [Cloudflare Pages, Netlify or Porkbun, from the same GitHub repo](#cloudflare)

--- setup

## Setting up wr1t3r

1.  **Open [my.wr1t3r.app](https://my.wr1t3r.app/)** in any browser. On an iPhone or iPad, tap Share, then _Add to Home Screen_, and open wr1t3r from there. Safari clears a website's saved data after a few weeks unless it's on the Home Screen.

2.  **Sign in with Dropbox or Google Drive.** In Dropbox, wr1t3r gets one folder of its own, _Apps › wr1t3r_, and can't see anything else in your Dropbox. In Google Drive, it keeps your notes in a folder called _wr1t3r_ and sees only the files it made. Either way, your notes go straight between your browser and your storage; they never pass through a server of mine.

    ![The first screen: Your notes live in your own Dropbox, in Apps › wr1t3r, and a Sign in with Dropbox button](/shots/help-connect.webp)

3.  **Pick what you'll use it for.** wr1t3r turns on the parts that fit. Leave _Add starter notes and a Home screen_ ticked if you'd like a few notes to start from. You can change all of this later in Settings > Features.

    ![Welcome to wr1t3r: checkboxes for Writing, Journal and day planner, Health and food, Books, films and other media, and Research and capture, with Start and Skip buttons](/shots/help-features.webp)

4.  **Read the Welcome note.** It explains each part you turned on. Delete it when you're done; Commands > _Getting started_ writes a fresh one.

5.  **Already have notes?** In Dropbox, put your Markdown files (and their pictures) in _Dropbox › Apps › wr1t3r_. They show up when you switch back to wr1t3r. In Google Drive, add them with the Upload button, since wr1t3r can only see files it put there itself.

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
    - Under _Permissions_, add _Contents_ and _Pages_, and set both to _Read and write_. If you'll also [send it on to Neocities](#neocities-github), add _Workflows_ as well, set to _Read and write_.
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

--- neocities-github

## Sending it on to Neocities from GitHub

Neocities doesn't take uploads straight from a web page, so wr1t3r can't send to it directly. It can go through GitHub instead: one click publishes to GitHub Pages and your Neocities site together. Set up [GitHub Pages](#github) first, then:

1.  **Copy your Neocities API key.** On neocities.org, open _Settings_ for your site, then _API_ (or go to _neocities.org/settings_), and generate a key. Copy it.

2.  **Give it to the repository as a secret.** In your site's repository on GitHub, open _Settings_, then _Secrets and variables_, then _Actions_, and click _New repository secret_. Name it `NEOCITIES_API_TOKEN` and paste the key.

3.  **Let the token add the step.** Edit your wr1t3r token on GitHub ([github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens)) and add _Workflows_, set to _Read and write_.

4.  **Tick _Also send it to Neocities each time_** under Publish to GitHub, and click _Publish to GitHub_. wr1t3r adds a small file to the repository (`.github/workflows/neocities.yml`) that uploads the site to Neocities after every publish.

5.  **Check it went.** A minute or two later your Neocities site has the same pages. If it doesn't, open the repository's _Actions_ tab on GitHub: a red mark there says what went wrong, usually a missing or mistyped secret. Fix it, then use _Run workflow_ on that page, or publish again.

Untick the box and publish to stop sending to Neocities; wr1t3r takes the file out again. Like dragging files in by hand, this doesn't delete pages from Neocities, so remove unpublished pages from your Neocities dashboard. If you have a paid Neocities site and tick _Include audio and video_, those go too.

--- cloudflare

## Cloudflare Pages, Netlify or Porkbun, from the same GitHub repo

These hosts can watch a GitHub repository and put each change online themselves. Publish to GitHub as above, then connect the host to your site's repository once. There's no build step anywhere: leave the build command empty and the output folder as the top of the repository. After that, every time you click _Publish to GitHub_, the host picks up the change.

- **Cloudflare Pages:** in the Cloudflare dashboard, create a Pages project, choose _Connect to Git_, and pick your site's repository and branch.
- **Netlify:** _Add new site_, then _Import an existing project_, choose GitHub, and pick the repository and branch. Leave _Build command_ empty and _Publish directory_ blank.
- **Porkbun:** for a domain with Porkbun static hosting, open its _Static Hosting_ page, click _Connect_ under _GitHub Connect_, let Porkbun see just your site's repository, then pick that repository and branch.

You can also upload the unzipped folder to Cloudflare Pages or Netlify Drop by hand, the same way as Neocities.

--- footer

[wr1t3r](/) · [Terms and refunds](/legal.html) · [Privacy policy](/privacy.html) · [hello@wr1t3r.app](mailto:hello@wr1t3r.app)
