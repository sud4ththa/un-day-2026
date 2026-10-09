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

Parents can open a stall's contribution form from a short link. You set the address of each form only in **`forms.txt`** (the generator copies it into the short-link pages). One stall per line:

```
slug | Stall name | form-url | year groups | note
```

Leave the form URL blank until the form is ready. Lines starting with `#` are comments. The form address is only the third column.

To publish or change a form URL, edit that third column, then run `python3 scripts/gen-go.py` and commit `forms.txt` together with the regenerated `go/` folder and the `contributions/` page. The script copies each form address into its short-link page at build time, so the page opens the form without loading anything else. Editing `forms.txt` alone does not change where a link goes.

Year groups and the optional note are the preview shown when a `/go/<slug>/` link is pasted into WhatsApp. Leave the year groups blank for a generic preview. A note replaces the sentence "Tap to pledge food or a contribution for the … stall." After editing a name, year group, or note, run `python3 scripts/gen-go.py`.

Short links (GitHub Pages):

- `https://sud4ththa.github.io/un-day-2026/go/<slug>/`
- `https://sud4ththa.github.io/un-day-2026/go/?s=<slug>` does the same thing
- `https://sud4ththa.github.io/un-day-2026/go/` with no slug shows "Please use the form link from your email."

A blank URL shows a static holding page ("This contribution form opens soon."). An `https://` URL shows a short "Opening the form…" screen with the BSC and PTC logos, the stall name, year groups and date, then replaces itself with the form after 0.4 seconds. That screen also has a "Continue to form" link in case the redirect is blocked or JavaScript is off. There is deliberately no `<meta http-equiv="refresh">`: it would skip the screen and could make link-preview crawlers use the form's preview instead of ours. The Open Graph tags stay in each page's `<head>`, so WhatsApp still shows the stall card.

To add or remove a stall, add or delete its line in `forms.txt`, then regenerate the folders:

```
python3 scripts/gen-go.py
```

Do not edit files under `go/` or `contributions/` by hand. The script rewrites them from `forms.txt` and `tracker.txt`, including the form and tracker addresses. The logos are inlined as small greyscale PNGs, and the preview images (`og.jpg`) are drawn deterministically, so unchanged stalls keep identical images.

## Parent contributions page

`https://sud4ththa.github.io/un-day-2026/contributions/` is the public page for stall contribution forms. It is generated from `forms.txt` (same order) by `python3 scripts/gen-go.py`, which writes `contributions/index.html` and the 1200×630 share image `contributions/og.png`.

Each tile shows the stall name and year groups, and links to `/un-day-2026/go/<slug>/`, not straight to the form, so the short link still records the tap and then opens the form. The picture is that form's header image, saved under `contributions/headers/` (WebP and JPG, at 1x and 2x) when the script can read the public form page. If the form cannot be fetched or has no header, the tile keeps that stall's flags. Eco Warriors is not listed. Any other stall with a blank form address is greyed out, says "Form coming soon", and is not a link.

The page says "the PTC". Commit `contributions/` together with `forms.txt` after you regenerate. Drawing the share image needs Pillow and CairoSVG (`pip install pillow cairosvg`).

The pages are self-contained. `/go/?s=<slug>` uses a stall list baked into `go/index.html`. To preview them, serve the parent of this repo while the repo folder is named `un-day-2026`, then open `http://localhost:8000/un-day-2026/go/sri-lanka/`.

## Click tracking (optional)

Short links can record an anonymous tap.

`tracker.txt` is comments, plus at most one line: the Apps Script web app address that ends in `/exec`. The UN Day menu's Web dashboard link shows that address. Leave the line out to keep tracking off. Clearing it later switches tracking off again. The address is copied into the short-link pages, so run `python3 scripts/gen-go.py` and commit after any change to `tracker.txt`. The short links open either way.

A tap sends the stall slug, a random id stored in that browser, a device type (mobile, tablet or desktop), and an optional source tag. No names and no form answers.

The tap is sent as soon as the page starts loading (`navigator.sendBeacon`, falling back to a `keepalive` request), and the form opens 0.4 seconds later. The page never waits for the tracker, and beacons are delivered even after the page has navigated away.

Add `?src=` when you want to tell taps apart, for example `https://sud4ththa.github.io/un-day-2026/go/japan/?src=whatsapp`. The tag keeps letters, numbers, dots, underscores and hyphens, up to 24 characters.

Every `/go/<slug>/` page records the tap, including a holding page ("opens soon"). `/go/` with no slug sends nothing.

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
