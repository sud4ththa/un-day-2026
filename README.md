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
Stall Name | https://chat.whatsapp.com/XXXXXXXXXXXX | full
```

- Paste the WhatsApp invite link after the first `|`. Leave it empty (`Sri Lanka |`) until you have it.
- Optional third column: `full` (any case) marks the team as full. Example: `India | https://chat.whatsapp.com/XXXXXXXXXXXX | full`. The tile stays visible but is not a link, even when an invite URL is present.
- Lines starting with `#` are comments; blank lines are ignored.
- The order of lines is the order on the page.
- Keep stall names as they are – they select the flags. (Matching ignores case, spaces and
  punctuation, so `usa / canada` also works.) A name app.js doesn't know shows a globe icon.
- Only `https://` links are used; anything else is ignored (logged in the browser console).

A stall with a link shows in full colour with "Join group ↗" and opens the group in a new tab.
A stall marked `full` keeps its flags in colour but dimmed, with a "TEAM FULL" ribbon, and says "Thank you! No more volunteers needed". It is not tappable.
A stall without a link is greyed out, not tappable, and says "Link coming soon".
The line under the header counts each state, for example `4 open · 1 full · 7 coming soon`.
The page loads `links.txt` with `cache: no-cache`, so a refresh picks up edits once the host has
the new file (GitHub Pages can take a minute or two to redeploy).

To add a brand-new stall, add its line to `links.txt` and (optionally) an entry in
`STALL_FLAGS` at the top of `app.js`, e.g. `"Korea": [["kr", "South Korea"]]`, plus the
matching `flags/kr.svg` from flag-icons (`flags/4x3/kr.svg`).

## Contribution form short links

Parents can open a stall's contribution form from a short link. The address of each form lives only in **`forms.txt`**. One stall per line:

```
slug | Stall name |
slug | Stall name | https://…
```

Leave the third column blank until the form is ready. Lines starting with `#` are comments.

To publish or change a form URL, edit that third column and commit. The short links read `forms.txt` when someone opens them, so no other file needs to change.

Short links (GitHub Pages):

- `https://sud4ththa.github.io/un-day-2026/go/<slug>/`
- `https://sud4ththa.github.io/un-day-2026/go/?s=<slug>` does the same thing
- `https://sud4ththa.github.io/un-day-2026/go/` lists every stall

A blank URL shows a holding page. An `https://` URL replaces the page with the form. The pages also show a "Continue to form" link once the address is known, in case the redirect is blocked.

To add or remove a stall, add or delete its line in `forms.txt`, then regenerate the folders:

```
python3 scripts/gen-go.py
```

Do not edit files under `go/` by hand. The script rewrites them from the slugs in `forms.txt` and does not copy form URLs into them.

Those pages request `/un-day-2026/forms.txt`. To preview them, serve the parent of this repo while the repo folder is named `un-day-2026`, then open `http://localhost:8000/un-day-2026/go/sri-lanka/`.

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
- `flags/eco.svg` (Eco Warriors stall, a leaf) and `flags/globe.svg` (fallback icon): made for this page.

Middle East stall uses a neutral cluster of UAE, Saudi Arabia, Jordan and Oman flags.
Flags are trademarks/emblems of their respective states and organisations; used here only
to identify the stalls.
