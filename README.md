# UN Day 2026 · Stall WhatsApp Groups

A tiny static page for the **BSC Parent Collective UN Day 2026 (Fri 16 Oct 2026)**.
Parents tap a stall's flag(s) to open that stall's WhatsApp group invite link.
No build step, no backend – just static files.

```
index.html   page shell + header text
style.css    styles (mobile-first, 2 columns on phones, 3–6 on wider screens)
app.js       reads links.txt and builds the grid; stall → flag mapping lives here
links.txt    THE ONLY FILE YOU NEED TO EDIT
flags/       local SVG flags (no hotlinking)
```

## Adding / changing links

Edit **`links.txt`**. One stall per line:

```
Stall Name | https://chat.whatsapp.com/XXXXXXXXXXXX
```

- Paste the WhatsApp invite link after the `|`. Leave it empty (`Sri Lanka |`) until you have it.
- Lines starting with `#` are comments; blank lines are ignored.
- The order of lines is the order on the page.
- Keep stall names as they are – they select the flags. (Matching ignores case, spaces and
  punctuation, so `usa / canada` also works.) A name app.js doesn't know shows a globe icon.
- Only `https://` links are used; anything else is ignored (logged in the browser console).

Stalls with a link show in full colour with "Join group ↗" and open the group in a new tab.
Stalls without a link are greyed out, not tappable, and say "Link coming soon".
The page loads `links.txt` with `cache: no-cache`, so a refresh picks up edits once the host has
the new file (GitHub Pages can take a minute or two to redeploy).

To add a brand-new stall, add its line to `links.txt` and (optionally) an entry in
`STALL_FLAGS` at the top of `app.js`, e.g. `"Korea": [["kr", "South Korea"]]`, plus the
matching `flags/kr.svg` from flag-icons (`flags/4x3/kr.svg`).

## Previewing locally

`app.js` uses `fetch()` to read `links.txt`, which browsers block for pages opened directly
from disk (`file://`). Serve the folder instead:

```
cd un-day-links
python3 -m http.server 8000
# open http://localhost:8000
```

## Hosting

**Netlify Drop (quickest):** go to https://app.netlify.com/drop and drag the `un-day-links`
folder (or the unzipped folder) onto the page. You get a URL like `https://xyz.netlify.app`
(rename it in Site settings). To update links later: edit `links.txt` and drag the folder
again onto the site's *Deploys* tab.

**GitHub Pages:** create a public repo, upload all the files (keep `flags/` as a folder),
then *Settings → Pages → Build and deployment → Deploy from a branch → `main` / root*.
The site appears at `https://<user>.github.io/<repo>/`. To update, edit `links.txt` in the
GitHub web editor and commit.

Note: anyone with the page URL can see the invite links, so share the page only in the parent
volunteer group. You can reset a WhatsApp invite link from the group's settings if needed.

## Flags – source and licence

- Country flags plus the EU and UN flags: **flag-icons** by Panayiotis Lipiridis,
  https://github.com/lipis/flag-icons (4x3 SVGs), **MIT licence**.
  Files: lk, in, us, ca, eu, jp, sg, my, th, ae, sa, jo, om, cn, au, nz, ph, id, ps, un, mv.
- African Union flag (`flags/african-union.svg`): Wikimedia Commons,
  https://commons.wikimedia.org/wiki/File:Flag_of_the_African_Union.svg – **public domain**
  (numeric precision reduced to make the file smaller; no visible change).
- `flags/globe.svg` (fallback icon): made for this page.

Middle East stall uses a neutral cluster of UAE, Saudi Arabia, Jordan and Oman flags.
Flags are trademarks/emblems of their respective states and organisations; used here only
to identify the stalls.
