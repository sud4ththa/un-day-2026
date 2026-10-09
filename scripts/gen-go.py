#!/usr/bin/env python3
"""Regenerate the go/ short-link pages and the parent contributions page.

Reads forms.txt and tracker.txt.

Each /go/<slug>/ page is fully static. The form address (third column of
forms.txt) and the click-tracker address (tracker.txt) are baked into the
page when this script runs, so a page never fetches forms.txt or
tracker.txt in the browser. Every stall page fires the click beacon straight away
(navigator.sendBeacon, which survives navigation) when tracker.txt has an
address. A page with a form address shows a short "Opening the form…"
screen and replaces itself with the form after REDIRECT_MS. A holding
page records the tap and stays put. Nothing waits for the tracker.

Because the addresses are baked in, you MUST run this script and commit
the regenerated go/ folder and contributions/ page after any of these
changes:

  * a form address is added, changed, or cleared in forms.txt
  * a stall is added or removed, or its name, year groups, or note change
  * the tracker address in tracker.txt is set, changed, or cleared

    python3 scripts/gen-go.py

That run also rewrites contributions/index.html, contributions/og.png
and the header images under contributions/headers/. The page lists stalls
in forms.txt order, except Eco Warriors, which is left off. A stall with
a form address links to /un-day-2026/go/<slug>/ (the short link, so the
tap is still logged). The picture is that form's header when the public
page can be read; otherwise the tile keeps the stall's flags. A blank
address, other than Eco Warriors, is a greyed "Form coming soon" tile
and is not a link. Flags use the same name-to-flag mapping as app.js.

The Open Graph preview images are drawn deterministically, so a stall
whose name and year groups did not change keeps a byte-identical image.
A stall with a painted banner at assets/banners/<slug>.png gets og-v2.jpg
(the banner, extended to 1200x630, with "UN Day 2026", the stall name and
year groups set in Playfair Display above it). A stall without a banner
gets the plain black-and-white og.jpg with the school logos.

Stall-made graphics win: if a stall team made its own preview art, save it
as assets/custom-og/<slug>.jpg (1200x630) and it is copied as-is to
og-v3.jpg, with no text added by us. The new file
name matters: WhatsApp caches a preview by its image URL, so a redesigned
preview needs a new name to show up in fresh shares.
"""

from __future__ import annotations

import base64
import html
import io
import json
import re
from dataclasses import dataclass
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
FORMS = ROOT / "forms.txt"
TRACKER = ROOT / "tracker.txt"
GO = ROOT / "go"
SITE = "https://sud4ththa.github.io/un-day-2026"
BASE = "/un-day-2026"
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SERIF = "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf"
SANS = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
SANS_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
BSC_LOGO = ROOT / "assets" / "bsc-logo.png"
PC_LOGO = ROOT / "assets" / "pc-logo.png"
BANNERS = ROOT / "assets" / "banners"
PLAYFAIR = ROOT / "assets" / "fonts" / "PlayfairDisplay.ttf"
BANNER_OG = "og-v2.jpg"
CUSTOM_OG_DIR = ROOT / "assets" / "custom-og"
CUSTOM_OG = "og-v3.jpg"
PLAIN_OG = "og.jpg"
FLAGS = ROOT / "flags"
CONTRIBUTIONS = ROOT / "contributions"
CONTRIB_OG_NAME = "og.png"
CONTRIB_TITLE = "UN Day 2026 · Parent Contributions"
CONTRIB_DESCRIPTION = "Tap your child's stall to pledge food or a contribution."
CONTRIB_INTRO = "Tap your child’s stall to open its contribution form."
CONTRIB_FOOTER = "The PTC · The British School in Colombo"
# Eco Warriors has no form yet, so the contributions page leaves it off.
CONTRIB_SKIP = frozenset({"eco"})
# Public form headers are 1600x400. Cards keep that ratio so the centred title stays visible.
HEADER_RATIO = 4 / 1
HEADER_WIDTHS = (("1x", 640), ("2x", 1280))
HEADER_MAX_BYTES = 120_000
# Enough eager tiles for the first row at the widest layout (4 columns).
HEADER_EAGER = 4
FORM_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
UN_BLUE = (0, 158, 219)
PC_PURPLE = (53, 30, 91)
PREVIEW_URL = re.compile(
    r"https://sud4ththa\.github\.io/un-day-2026/go/[a-z0-9-]+/(?:og(?:-v[23])?\.jpg)?"
)
# How long the "Opening the form…" screen shows before the redirect. The
# click beacon is sent before this timer starts and is never waited for.
REDIRECT_MS = 400
# Logos are inlined as small greyscale PNGs (2x their 56px display height).
LOGO_HEIGHT = 112
LOGO_COLOURS = 64


@dataclass
class Stall:
    slug: str
    name: str
    url: str
    years: str
    note: str

    @property
    def title(self) -> str:
        return f"UN Day 2026 · {self.name} stall"

    @property
    def description(self) -> str:
        pledge = self.note or f"Tap to pledge food or a contribution for the {self.name} stall."
        if self.years:
            return f"{self.years} · Friday 16 October. {pledge}"
        return f"Friday 16 October. {pledge}"

    @property
    def is_open(self) -> bool:
        return self.url.startswith("https://")

# Click beacon, baked into a page only when tracker.txt has an endpoint.
# Payload: t=click, s=slug, v=visitor id (localStorage unday26.vid),
# d=device class, src=optional ?src= tag. Sent before the redirect timer
# starts; nothing ever waits for it.
TRACK_JS = """  var ENDPOINT = __ENDPOINT__;

  function randomVid() {
    var bytes = new Array(12);
    var i;
    try {
      var buf = new Uint8Array(12);
      crypto.getRandomValues(buf);
      for (i = 0; i < 12; i++) bytes[i] = buf[i];
    } catch (err) {
      for (i = 0; i < 12; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    var hex = "";
    for (i = 0; i < 12; i++) hex += ("0" + bytes[i].toString(16)).slice(-2);
    return hex;
  }

  function visitorId() {
    var key = "unday26.vid";
    try {
      var existing = localStorage.getItem(key);
      if (existing && /^[A-Za-z0-9_-]{6,64}$/.test(existing)) return existing;
      var id = randomVid();
      try { localStorage.setItem(key, id); } catch (err) {}
      return id;
    } catch (err) {
      return randomVid();
    }
  }

  function deviceClass() {
    var ua = navigator.userAgent || "";
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return "tablet";
    if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return "tablet";
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "tablet";
    if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return "mobile";
    return "desktop";
  }

  function srcTag() {
    var raw = new URLSearchParams(location.search).get("src") || "";
    return raw.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 24);
  }

  function sendClick(slug) {
    try {
      var url = ENDPOINT + "?t=click&s=" + encodeURIComponent(slug)
        + "&v=" + encodeURIComponent(visitorId())
        + "&d=" + encodeURIComponent(deviceClass());
      var src = srcTag();
      if (src) url += "&src=" + encodeURIComponent(src);
      var sent = false;
      try {
        if (navigator.sendBeacon) sent = navigator.sendBeacon(url);
      } catch (err) {}
      if (!sent) {
        try {
          fetch(url, { method: "POST", mode: "no-cors", keepalive: true, credentials: "omit" });
        } catch (err2) {}
      }
    } catch (err) {}
  }
"""

# Runs as the first thing in <head>: beacon now, redirect after REDIRECT_MS.
SLUG_HEAD_JS = """<script>
(function () {
  var FORM = __FORM__;
__TRACK__  setTimeout(function () { location.replace(FORM); }, __DELAY__);
})();
</script>
"""

# Holding pages have no form. They still record the tap, then stay put.
HOLD_HEAD_JS = """<script>
(function () {
__TRACK__})();
</script>
"""

INDEX_HEAD_JS = """<script>
var UNDAY_GO = (function () {
  var STALLS = __STALLS__;
  var requested = (new URLSearchParams(location.search).get("s") || "").trim();
  var match = null;
  for (var i = 0; i < STALLS.length; i++) {
    if (STALLS[i].s === requested) { match = STALLS[i]; break; }
  }
__TRACK__  __SEND__if (match && match.u) {
    setTimeout(function () { location.replace(match.u); }, __DELAY__);
  }
  return { base: __BASE__, stalls: STALLS, requested: requested, match: match };
})();
</script>
"""

INDEX_BODY_JS = """<script>
(function () {
  var go = UNDAY_GO;
  if (!go.requested) return;
  function el(id) { return document.getElementById(id); }
  function show(id) { el(id).hidden = false; }
  var title = el("title");
  var message = el("message");
  var sub = el("sub");
  show("title");
  if (!go.match) {
    title.textContent = "Stall not found";
    message.textContent = "That short link does not match a stall.";
    sub.textContent = "Choose one below.";
    show("sub");
    var list = el("list");
    go.stalls.forEach(function (stall) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = go.base + "/go/" + encodeURIComponent(stall.s) + "/";
      a.textContent = stall.n;
      li.appendChild(a);
      list.appendChild(li);
    });
    show("list");
    return;
  }
  title.textContent = go.match.n;
  document.title = "UN Day 2026 · " + go.match.n + " stall";
  if (go.match.y) { el("years").textContent = go.match.y; show("years"); }
  show("date");
  if (go.match.u) {
    message.textContent = "Opening the form…";
    el("continue").href = go.match.u;
    show("bar");
    show("actions");
    return;
  }
  message.textContent = "This contribution form opens soon.";
  sub.textContent = "Please check back later.";
  show("sub");
})();
</script>
"""

CSS = """  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { margin: 0; }
  body {
    min-height: 100vh;
    min-height: 100svh;
    display: flex;
    flex-direction: column;
    background: #fff;
    color: #111;
    font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    width: 100%;
    max-width: 40rem;
    margin: 0 auto;
    padding: 3.5rem 1.75rem 2rem;
  }
  .logos {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    margin: 0 0 2.75rem;
  }
  .logos img { display: block; height: 56px; width: auto; }
  .logos .rule { width: 1px; height: 40px; background: #111; opacity: 0.2; }
  .kicker {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 0.72rem;
    font-weight: 500;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    margin: 0 0 1.25rem;
    padding-left: 0.28em;
  }
  h1 {
    font-weight: normal;
    font-size: clamp(2.25rem, 9vw, 3.75rem);
    line-height: 1.08;
    letter-spacing: -0.01em;
    margin: 0 0 1.25rem;
    text-wrap: balance;
  }
  .detail {
    font-style: italic;
    font-size: 1.15rem;
    line-height: 1.45;
    margin: 0;
  }
  .status {
    margin-top: 3rem;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .lead { font-size: 0.95rem; letter-spacing: 0.01em; margin: 0; }
  .sub { font-size: 0.85rem; color: #555; margin: 0.5rem 0 0; }
  .bar {
    width: 8.5rem;
    height: 1px;
    margin: 1.1rem auto 0;
    background: rgba(17, 17, 17, 0.12);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: #111;
    transform: scaleX(0);
    transform-origin: left center;
    animation: fill 1.6s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
  }
  @keyframes fill { to { transform: scaleX(1); } }
  @media (prefers-reduced-motion: reduce) {
    .bar span { animation: none; transform: scaleX(0.6); }
  }
  .actions { margin: 1.75rem 0 0; }
  a.continue {
    font-size: 0.85rem;
    color: #111;
    text-decoration: none;
    border-bottom: 1px solid rgba(17, 17, 17, 0.35);
    padding-bottom: 0.1rem;
  }
  a.continue:hover, a.continue:focus { border-bottom-color: #111; }
  ul.stalls {
    list-style: none;
    padding: 0;
    margin: 2rem auto 0;
    max-width: 22rem;
    text-align: left;
  }
  ul.stalls li { border-top: 1px solid #111; }
  ul.stalls li:last-child { border-bottom: 1px solid #111; }
  ul.stalls a {
    display: block;
    padding: 0.85rem 0;
    color: #111;
    text-decoration: none;
  }
  footer {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 0.7rem;
    letter-spacing: 0.04em;
    color: #666;
    text-align: center;
    padding: 0 1.5rem 1.75rem;
  }
  @media (min-width: 48rem) {
    .logos { gap: 2rem; margin-bottom: 3.25rem; }
    .logos img { height: 68px; }
    .logos .rule { height: 48px; }
    .detail { font-size: 1.25rem; }
  }
"""

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
__HEAD_JS__<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
__OG__<title>__TITLE__</title>
<style>
__CSS__</style>
</head>
<body>
<main>
  <div class="logos">
    <img src="__BSC_LOGO__" width="__BSC_W__" height="__BSC_H__" alt="The British School in Colombo">
    <span class="rule" aria-hidden="true"></span>
    <img src="__PC_LOGO__" width="__PC_W__" height="__PC_H__" alt="BSC Parent Collective">
  </div>
__CONTENT__</main>
<footer>The British School in Colombo · PTC</footer>
__BODY_JS__</body>
</html>
"""

PLACEHOLDER = re.compile(r"__([A-Z_]+)__")


def fill(template: str, values: dict[str, str]) -> str:
    """Substitute __KEY__ placeholders in one pass (values are not rescanned)."""
    missing = set(PLACEHOLDER.findall(template)) - values.keys()
    if missing:
        raise SystemExit(f"page template was not filled in: {sorted(missing)}")
    return PLACEHOLDER.sub(lambda m: values[m.group(1)], template)


def js(value: object) -> str:
    """A JSON literal that is safe inside an inline <script>."""
    return json.dumps(value).replace("</", "<\\/")


def esc(value: str) -> str:
    return html.escape(value, quote=True)


def esc_double(value: str) -> str:
    """Escape for a double-quoted attribute, keeping apostrophes as characters."""
    return html.escape(value, quote=False).replace('"', "&quot;")


def heading(name: str) -> str:
    # Let long names such as "Australia/NZ/Philippines/Indonesia" wrap at the slashes.
    return esc(name).replace("/", "/<wbr>")


def logo_data(path: Path, *, ink: bool = False) -> tuple[str, int, int]:
    """A small inline greyscale PNG. ink=True draws a one-colour logo in near-black."""
    logo = Image.open(path).convert("RGBA")
    grey = ImageOps.grayscale(logo.convert("RGB"))
    width = round(logo.width * LOGO_HEIGHT / logo.height)
    grey = grey.resize((width, LOGO_HEIGHT), Image.Resampling.LANCZOS)
    if ink:
        grey = Image.new("L", grey.size, 17)
    alpha = logo.getchannel("A").resize((width, LOGO_HEIGHT), Image.Resampling.LANCZOS)
    rgba = Image.merge("RGBA", (grey, grey, grey, alpha))
    small = rgba.quantize(LOGO_COLOURS, method=Image.Quantize.FASTOCTREE)
    buf = io.BytesIO()
    small.save(buf, "PNG", optimize=True)
    uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    return uri, width // 2, LOGO_HEIGHT // 2


def parse_stalls(text: str) -> list[Stall]:
    stalls: list[Stall] = []
    seen: set[str] = set()
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [part.strip() for part in line.split("|")]
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise SystemExit(f"forms.txt:{lineno}: expected slug | Stall name | form-url | year groups | note")
        slug = parts[0]
        if not SLUG_RE.fullmatch(slug):
            raise SystemExit(f"forms.txt:{lineno}: slug must be lowercase letters, numbers and hyphens")
        if slug in seen:
            raise SystemExit(f"forms.txt:{lineno}: duplicate slug {slug}")
        seen.add(slug)
        url = parts[2] if len(parts) > 2 else ""
        if url and not url.startswith("https://"):
            print(f"forms.txt:{lineno}: {slug}: form address must start with https://; showing 'opens soon'", file=sys.stderr)
            url = ""
        if re.search(r"\s", url):
            raise SystemExit(f"forms.txt:{lineno}: form address must not contain spaces")
        stalls.append(
            Stall(
                slug=slug,
                name=parts[1],
                url=url,
                years=parts[3] if len(parts) > 3 else "",
                note=parts[4] if len(parts) > 4 else "",
            )
        )
    if not stalls:
        raise SystemExit("forms.txt has no stalls")
    return stalls


def parse_tracker(text: str) -> str:
    """The first non-comment line of tracker.txt, or "" when tracking is off."""
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if not line.startswith("https://") or re.search(r"\s", line):
            print(f"tracker.txt:{lineno}: not an https:// address; tracking stays off", file=sys.stderr)
            return ""
        return line
    return ""


def banner_path(stall: Stall) -> Path | None:
    path = BANNERS / f"{stall.slug}.png"
    return path if path.is_file() else None


def custom_og_path(stall: Stall) -> Path | None:
    """The stall team's own preview art, used as-is (see the module docstring)."""
    path = CUSTOM_OG_DIR / f"{stall.slug}.jpg"
    return path if path.is_file() else None


def og_image_name(stall: Stall) -> str:
    """File name of the stall's preview image inside go/<slug>/."""
    if custom_og_path(stall):
        return CUSTOM_OG
    return BANNER_OG if banner_path(stall) else PLAIN_OG


def og_image_size(stall: Stall) -> tuple[int, int]:
    custom = custom_og_path(stall)
    if custom:
        with Image.open(custom) as image:
            return image.size
    return 1200, 630


def og_tags(stall: Stall) -> str:
    page = f"{SITE}/go/{stall.slug}/"
    image = f"{page}{og_image_name(stall)}"
    fields = [
        ("property", "og:title", stall.title),
        ("property", "og:description", stall.description),
        ("property", "og:image", image),
        ("property", "og:image:width", str(og_image_size(stall)[0])),
        ("property", "og:image:height", str(og_image_size(stall)[1])),
        ("property", "og:url", page),
        ("property", "og:type", "website"),
        ("name", "twitter:card", "summary_large_image"),
        ("name", "twitter:image", image),
    ]
    lines = [
        f'<meta {attr}="{name}" content="{html.escape(value, quote=True)}">'
        for attr, name, value in fields
    ]
    return "\n".join(lines) + "\n"


def track_js(endpoint: str) -> str:
    return fill(TRACK_JS, {"ENDPOINT": js(endpoint)}) if endpoint else ""


def stall_content(stall: Stall) -> str:
    lines = [
        '  <p class="kicker">UN Day 2026</p>',
        f"  <h1>{heading(stall.name)}</h1>",
    ]
    if stall.years:
        lines.append(f'  <p class="detail">{esc(stall.years)}</p>')
    lines.append('  <p class="detail">Friday 16 October</p>')
    if stall.is_open:
        lines += [
            '  <div class="status" role="status">',
            '    <p class="lead">Opening the form…</p>',
            '    <div class="bar" aria-hidden="true"><span></span></div>',
            f'    <p class="actions"><a class="continue" href="{esc(stall.url)}">Continue to form</a></p>',
            "  </div>",
        ]
    else:
        lines += [
            '  <div class="status">',
            '    <p class="lead">This contribution form opens soon.</p>',
            '    <p class="sub">Please check back later.</p>',
            "  </div>",
        ]
    return "\n".join(lines) + "\n"


INDEX_CONTENT = """  <p class="kicker">UN Day 2026</p>
  <h1 id="title" hidden>Contribution form</h1>
  <p class="detail" id="years" hidden></p>
  <p class="detail" id="date" hidden>Friday 16 October</p>
  <div class="status" role="status">
    <p class="lead" id="message">Please use the form link from your email.</p>
    <div class="bar" id="bar" aria-hidden="true" hidden><span></span></div>
    <p class="actions" id="actions" hidden><a class="continue" id="continue" href="">Continue to form</a></p>
    <p class="sub" id="sub" hidden></p>
    <ul class="stalls" id="list" hidden></ul>
  </div>
"""


def check_urls(page: str, allowed: set[str]) -> None:
    """Only the baked-in form/tracker addresses and preview URLs may appear."""
    stripped = PREVIEW_URL.sub("", page)
    for url in sorted(allowed, key=len, reverse=True):
        for form in (url, esc(url), js(url)[1:-1]):
            stripped = stripped.replace(form, "")
    if re.search(r"https://[A-Za-z0-9]", stripped):
        raise SystemExit("generated page contains an unexpected URL")


def render_page(*, head_js: str, og: str, title: str, content: str, body_js: str, logos: dict[str, str]) -> str:
    return fill(
        PAGE,
        {
            "HEAD_JS": head_js,
            "OG": og,
            "TITLE": title,
            "CSS": CSS,
            "CONTENT": content,
            "BODY_JS": body_js,
            **logos,
        },
    )


def render_stall(stall: Stall, endpoint: str, logos: dict[str, str]) -> str:
    head_js = ""
    track = track_js(endpoint)
    if track:
        track += f"\n  sendClick({js(stall.slug)});\n"
    if stall.is_open:
        head_js = fill(
            SLUG_HEAD_JS,
            {"FORM": js(stall.url), "TRACK": track, "DELAY": str(REDIRECT_MS)},
        )
    elif track:
        head_js = fill(HOLD_HEAD_JS, {"TRACK": track})
    page = render_page(
        head_js=head_js,
        og=og_tags(stall),
        title=esc(stall.title),
        content=stall_content(stall),
        body_js="",
        logos=logos,
    )
    check_urls(page, {stall.url, endpoint} - {""})
    return page


def render_index(stalls: list[Stall], endpoint: str, logos: dict[str, str]) -> str:
    table = [
        {"s": stall.slug, "n": stall.name, "y": stall.years, "u": stall.url}
        for stall in stalls
    ]
    track = track_js(endpoint)
    head_js = fill(
        INDEX_HEAD_JS,
        {
            "STALLS": js(table),
            "TRACK": track,
            "SEND": "if (match) sendClick(match.s);\n  " if track else "",
            "DELAY": str(REDIRECT_MS),
            "BASE": js(BASE),
        },
    )
    page = render_page(
        head_js=head_js,
        og="",
        title="BSC UN Day 2026",
        content=INDEX_CONTENT,
        body_js=INDEX_BODY_JS,
        logos=logos,
    )
    check_urls(page, ({stall.url for stall in stalls} | {endpoint}) - {""})
    return page


def fit_lines(draw: ImageDraw.ImageDraw, text: str, font_path: str, max_width: int, start: int, floor: int) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    size = start
    while size >= floor:
        font = ImageFont.truetype(font_path, size)
        words = text.split()
        lines: list[str] = []
        current = ""
        for word in words:
            trial = word if not current else f"{current} {word}"
            if draw.textlength(trial, font=font) <= max_width:
                current = trial
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
        if len(lines) <= 2 and all(draw.textlength(line, font=font) <= max_width for line in lines):
            return font, lines
        size -= 2
    font = ImageFont.truetype(font_path, floor)
    return font, [text]


def paste_logo(canvas: Image.Image, path: Path, box: tuple[int, int, int, int]) -> None:
    logo = Image.open(path).convert("RGBA")
    rgb = ImageOps.grayscale(logo.convert("RGB"))
    logo = Image.merge("RGBA", (rgb, rgb, rgb, logo.getchannel("A")))
    max_w, max_h = box[2] - box[0], box[3] - box[1]
    scale = min(max_w / logo.width, max_h / logo.height)
    size = (max(1, round(logo.width * scale)), max(1, round(logo.height * scale)))
    logo = logo.resize(size, Image.Resampling.LANCZOS)
    x = box[0] + (max_w - size[0]) // 2
    y = box[1] + (max_h - size[1]) // 2
    canvas.paste(logo, (x, y), logo)


def write_og_image(path: Path, stall: Stall) -> None:
    image = Image.new("RGB", (1200, 630), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1199, 10), fill="black")
    paste_logo(image, BSC_LOGO, (36, 150, 250, 480))
    paste_logo(image, PC_LOGO, (950, 170, 1164, 460))
    name_font, name_lines = fit_lines(draw, stall.name, SERIF, 680, 68, 36)
    kicker = ImageFont.truetype(SERIF, 34)
    detail = ImageFont.truetype(SERIF, 30)
    footer = ImageFont.truetype(SANS, 24)
    blocks: list[tuple[str, ImageFont.FreeTypeFont]] = [("UN Day 2026", kicker)]
    blocks.extend((line, name_font) for line in name_lines)
    if stall.years:
        blocks.append((stall.years, detail))
    blocks.append(("Friday 16 October", detail))
    gap = 14
    heights = [draw.textbbox((0, 0), text, font=font)[3] for text, font in blocks]
    total = sum(heights) + gap * (len(blocks) - 1)
    y = 150 + (360 - total) // 2
    for (text, font), height in zip(blocks, heights):
        width = draw.textlength(text, font=font)
        draw.text(((1200 - width) / 2, y), text, font=font, fill="black")
        y += height + gap
    foot = "The British School in Colombo · PTC"
    width = draw.textlength(foot, font=footer)
    draw.text(((1200 - width) / 2, 560), foot, font=footer, fill="black")
    image.save(path, "JPEG", quality=85, optimize=True, subsampling=2)


# Banner previews: the 1600x400 banner is scaled to the full 1200 px width
# (so every landmark stays in view) and sits at the bottom of the card. The
# sky above and the ground below are the banner's own edge rows, blurred
# sideways and faded into the art, then lifted toward cream behind the text.
OG_W, OG_H = 1200, 630
INK = (26, 26, 26)
SOFT_INK = (58, 52, 44)
CREAM = (250, 245, 234)
TEXT_BOTTOM = 348  # text block is centred between y=40 and this line
TEXT_MAX_W = 580  # keeps the text inside the square centre crop (630 px) of the card


def playfair(size: int, weight: str) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(PLAYFAIR), size)
    font.set_variation_by_name(weight)
    return font


def column_strip(image: Image.Image, top: int, height: int, clean: bool = False) -> tuple[Image.Image, float]:
    """One row: the per-column average of `height` rows, softly blurred sideways.

    With clean=True, columns far from the open-sky colour (the mean of the
    lighter half of the row), such as a tree cut off by the top edge, are
    replaced by that colour so they don't smear upward. Also returns the
    share of columns that were replaced.
    """
    row = image.crop((0, top, image.width, top + height)).resize((image.width, 1), Image.Resampling.BOX)
    if not clean:
        return row.filter(ImageFilter.GaussianBlur(40)), 0.0
    raw = row.tobytes()
    pixels = [tuple(raw[i:i + 3]) for i in range(0, len(raw), 3)]
    light = sorted(pixels, key=sum)[len(pixels) // 2:]
    sky = tuple(round(sum(p[i] for p in light) / len(light)) for i in range(3))
    far = [max(abs(p[i] - sky[i]) for i in range(3)) > 40 for p in pixels]
    if any(far):
        row.putdata([sky if f else p for p, f in zip(pixels, far)])
    return row.filter(ImageFilter.GaussianBlur(40)), sum(far) / len(far)


def vertical_mask(values: list[int], width: int) -> Image.Image:
    mask = Image.new("L", (1, len(values)))
    mask.putdata(values)
    return mask.resize((width, len(values)), Image.Resampling.NEAREST)


def name_lines(draw: ImageDraw.ImageDraw, name: str) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    """The stall name on one line if it fits, else split in two after a "/" or space."""
    for size in range(64, 47, -2):
        font = playfair(size, "SemiBold")
        if draw.textlength(name, font=font) <= TEXT_MAX_W:
            return font, [name]
    breaks = [i + 1 for i, ch in enumerate(name) if ch in "/ "]
    candidates = sorted(breaks, key=lambda i: abs(i - len(name) / 2))
    for size in range(56, 35, -2):
        font = playfair(size, "SemiBold")
        for at in candidates:
            lines = [name[:at].strip(), name[at:].strip()]
            if all(draw.textlength(line, font=font) <= TEXT_MAX_W for line in lines):
                return font, lines
    return playfair(36, "SemiBold"), [name]


def write_banner_og_image(path: Path, stall: Stall, banner_file: Path) -> None:
    """Banner preview. assets/banners/<slug>-og.png, if present, is a taller
    crop of the same painting used here instead of the 4:1 banner; its top
    must be open sky across the text area (x 300-900, y above ~300 once
    scaled to 1200 px wide and sat on the bottom edge)."""
    fade_top, fade_bottom, bottom = 36, 24, 12
    tall = banner_file.with_name(f"{banner_file.stem}-og.png")
    banner = Image.open(tall if tall.is_file() else banner_file).convert("RGB")
    art_h = min(round(banner.height * OG_W / banner.width), OG_H - bottom)
    banner = ImageOps.fit(banner, (OG_W, art_h), Image.Resampling.LANCZOS, centering=(0.5, 1.0))
    top = OG_H - art_h - bottom
    half = top + art_h // 2
    canvas = Image.new("RGB", (OG_W, OG_H))
    sky, cut_off = column_strip(banner, 0, 6, clean=True)
    ground, _ = column_strip(banner, art_h - 6, 6)
    if cut_off > 0.15:  # a lot runs off the top edge: dissolve it gently into the sky
        fade_top = 110
    canvas.paste(sky.resize((OG_W, half), Image.Resampling.NEAREST), (0, 0))
    canvas.paste(ground.resize((OG_W, OG_H - half), Image.Resampling.NEAREST), (0, half))
    alpha = [255] * art_h
    for y in range(fade_top):
        alpha[y] = round(255 * y / fade_top)
    for y in range(fade_bottom):
        alpha[art_h - 1 - y] = round(255 * y / fade_bottom)
    canvas.paste(banner, (0, top), vertical_mask(alpha, OG_W))
    lift_end = max(top + fade_top, TEXT_BOTTOM + 6)
    lift = [round(140 * (1 - y / lift_end) ** 1.2) if y < lift_end else 0 for y in range(OG_H)]
    canvas = Image.composite(Image.new("RGB", (OG_W, OG_H), CREAM), canvas, vertical_mask(lift, OG_W))

    draw = ImageDraw.Draw(canvas)
    name_font, names = name_lines(draw, stall.name)
    detail = f"{stall.years} \u00b7 Friday 16 October" if stall.years else "Friday 16 October"
    blocks: list[tuple[str, ImageFont.FreeTypeFont, tuple[int, int, int], int]] = [
        ("UN Day 2026", playfair(96, "Bold"), INK, 0)
    ]
    for i, line in enumerate(names):
        blocks.append((line, name_font, INK, 22 if i == 0 else 10))
    detail_size = 30
    while detail_size > 22 and draw.textlength(detail, font=playfair(detail_size, "Regular")) > TEXT_MAX_W:
        detail_size -= 1
    blocks.append((detail, playfair(detail_size, "Regular"), SOFT_INK, 20))
    boxes = [draw.textbbox((0, 0), text, font=font) for text, font, _, _ in blocks]
    total = sum(box[3] - box[1] for box in boxes) + sum(gap for *_, gap in blocks)
    y = 40 + (TEXT_BOTTOM - 40 - total) // 2
    for (text, font, colour, gap), box in zip(blocks, boxes):
        y += gap
        draw.text(((OG_W - (box[2] - box[0])) / 2 - box[0], y - box[1]), text, font=font, fill=colour)
        y += box[3] - box[1]
    canvas.save(path, "JPEG", quality=86, optimize=True, subsampling=2)


# Same stall → flag files as STALL_FLAGS in app.js (code in flags/, readable name).
# A third item is the full alt text. The two extra keys are the forms.txt
# spellings of stalls the WhatsApp page names differently.
_STALL_FLAG_ROWS: dict[str, list[tuple[str, ...]]] = {
    "Sri Lanka": [("lk", "Sri Lanka")],
    "India": [("in", "India")],
    "USA/Canada": [("us", "United States"), ("ca", "Canada")],
    "Europe": [("eu", "European Union")],
    "Japan": [("jp", "Japan")],
    "Singapore/Malaysia/Thailand": [("sg", "Singapore"), ("my", "Malaysia"), ("th", "Thailand")],
    "Middle East": [("ae", "United Arab Emirates"), ("sa", "Saudi Arabia"), ("jo", "Jordan"), ("om", "Oman")],
    "China": [("cn", "China")],
    "Eco Warriors": [("eco", "Eco Warriors", "Green leaf")],
    "Australia/NZ/Philippines/Indonesia": [
        ("au", "Australia"),
        ("nz", "New Zealand"),
        ("ph", "Philippines"),
        ("id", "Indonesia"),
    ],
    "Palestine and UN Zone": [("ps", "Palestine"), ("un", "United Nations")],
    "Maldives": [("mv", "Maldives")],
}
_STALL_FLAG_ROWS["Singapore/Malaysia/Vietnam/Thailand"] = _STALL_FLAG_ROWS["Singapore/Malaysia/Thailand"]
_STALL_FLAG_ROWS["UN Zone / Palestine"] = _STALL_FLAG_ROWS["Palestine and UN Zone"]


def _norm_stall_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower().replace("&", "and"))


FLAG_LOOKUP = {_norm_stall_name(name): rows for name, rows in _STALL_FLAG_ROWS.items()}


def _has_banned_word(text: str) -> bool:
    """Reject wording the public page must not use. Pieces stay split so the
    source does not spell those words."""
    folded = text.casefold()
    blocked = (
        "dona" + "te",
        "dona" + "tion",
        "organis" + "ers",
        "organis" + "ing team",
    )
    if any(word in folded for word in blocked):
        return True
    return re.search(r"\b" + "pt" + "a" + r"\b", folded) is not None


def stall_flags(stall: Stall) -> list[tuple[str, str]]:
    """Flag file code and alt text, using the same loose name match as app.js."""
    rows = FLAG_LOOKUP.get(_norm_stall_name(stall.name))
    if not rows:
        print(f"contributions: no flag mapping for {stall.name!r}; using globe", file=sys.stderr)
        rows = [("globe", "Globe")]
    flags: list[tuple[str, str]] = []
    for row in rows:
        alt = row[2] if len(row) > 2 else f"{row[1]} flag"
        flags.append((row[0], alt))
    return flags


def _media(stall: Stall, *, header: bool, index: int) -> str:
    eager = index < HEADER_EAGER
    loading = "eager" if eager else "lazy"
    priority = ' fetchpriority="high"' if index == 0 else ""
    if header:
        alt = esc(f"{stall.name} stall")
        base = f"headers/{stall.slug}"
        return (
            '          <div class="banner">\n'
            "            <picture>\n"
            f'              <source type="image/webp" srcset="{base}-1x.webp 1x, {base}-2x.webp 2x">\n'
            f'              <img src="{base}-1x.jpg" srcset="{base}-1x.jpg 1x, {base}-2x.jpg 2x"'
            f' alt="{alt}" width="1280" height="320" decoding="async" loading="{loading}"{priority}>\n'
            "            </picture>\n"
            "          </div>"
        )
    flags = stall_flags(stall)
    images = "\n".join(
        "            "
        f'<img src="../flags/{esc(code)}.svg" alt="{esc(alt)}" width="640" height="480"'
        f' decoding="async" loading="{loading}">'
        for code, alt in flags
    )
    return (
        f'          <div class="flags n{len(flags)}">\n'
        f"{images}\n"
        "          </div>"
    )


def render_tile(stall: Stall, *, header: bool, index: int) -> str:
    name = esc(stall.name).replace("/", "/\u200b")
    parts = [
        _media(stall, header=header, index=index),
        f'          <div class="name">{name}</div>',
    ]
    if stall.is_open:
        if stall.years:
            parts.append(f'          <div class="label">{esc(stall.years)}</div>')
        aria = stall.name if not stall.years else f"{stall.name}, {stall.years}"
        href = f"{BASE}/go/{stall.slug}/"
        body = "\n".join(parts)
        return (
            "      <li>\n"
            f'        <a class="tile" href="{esc(href)}" aria-label="{esc(aria)}">\n'
            f"{body}\n"
            "        </a>\n"
            "      </li>"
        )
    if stall.years:
        parts.append(f'          <div class="years">{esc(stall.years)}</div>')
    parts.append('          <div class="label">Form coming soon</div>')
    body = "\n".join(parts)
    return (
        "      <li>\n"
        f'        <div class="tile off" aria-disabled="true" aria-label="{esc(stall.name)}, form coming soon">\n'
        f"{body}\n"
        "        </div>\n"
        "      </li>"
    )


def render_contributions(stalls: list[Stall], header_slugs: set[str]) -> str:
    image = f"{SITE}/contributions/{CONTRIB_OG_NAME}"
    page_url = f"{SITE}/contributions/"
    tiles = "\n".join(
        render_tile(stall, header=stall.slug in header_slugs, index=index)
        for index, stall in enumerate(stalls)
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta property="og:title" content="{esc(CONTRIB_TITLE)}">
  <meta property="og:description" content="{esc_double(CONTRIB_DESCRIPTION)}">
  <meta property="og:image" content="{esc(image)}">
  <meta property="og:image:secure_url" content="{esc(image)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="{esc(CONTRIB_TITLE)}">
  <meta property="og:url" content="{esc(page_url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="The PTC">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{esc(CONTRIB_TITLE)}">
  <meta name="twitter:description" content="{esc_double(CONTRIB_DESCRIPTION)}">
  <meta name="twitter:image" content="{esc(image)}">
  <link rel="image_src" href="{esc(image)}">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>{esc(CONTRIB_TITLE)}</title>
  <meta name="description" content="{esc_double(CONTRIB_DESCRIPTION)}">
  <meta name="theme-color" content="#009edb">
  <link rel="icon" href="../flags/un.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../style.css">
  <style>
    main {{ max-width: 1120px; }}
    .site-header .hint {{
      max-width: min(22.5rem, calc(100% - 4px));
      line-height: 1.35;
    }}
    .grid {{ grid-template-columns: 1fr; gap: 14px; }}
    @media (min-width: 640px) {{
      .grid {{ grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }}
    }}
    @media (min-width: 960px) {{
      .grid {{ grid-template-columns: repeat(3, minmax(0, 1fr)); }}
    }}
    @media (min-width: 1440px) {{
      .grid {{ grid-template-columns: repeat(4, minmax(0, 1fr)); }}
      main {{ max-width: 1280px; }}
    }}
    .banner, .tile .flags {{
      aspect-ratio: 4 / 1;
      overflow: hidden;
      border-radius: 10px;
      background: #e7eef3;
    }}
    .banner img {{
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center center;
    }}
    .tile .flags {{
      background: #f4f7fa;
      gap: 3%;
    }}
    .tile .flags img {{
      width: auto;
      height: 68%;
      max-width: 28%;
    }}
    .tile .flags.n1 img {{ height: 84%; max-width: 42%; }}
    .tile .flags.n2 img {{ height: 74%; max-width: 32%; }}
    .tile .flags.n3 img,
    .tile .flags.n4 img {{ height: 40%; max-width: 22%; }}
    .years {{
      margin-top: 6px;
      text-align: center;
      font-size: .82rem;
      font-weight: 600;
      line-height: 1.3;
      color: var(--ink);
    }}
    a.tile, .tile.off {{ padding: 12px 12px 14px; }}
    a.tile {{ touch-action: manipulation; }}
    .tile.off .years {{ color: var(--muted); }}
  </style>
</head>
<body>
  <header class="site-header">
    <div class="brand">
      <img class="logo logo-bsc" src="../assets/bsc-logo.png" alt="The British School in Colombo" width="180" height="240">
      <h1>UN Day 2026 <span class="dot">·</span> <span class="nowrap">Parent Contributions</span></h1>
      <img class="logo logo-pc" src="../assets/pc-logo.png" alt="BSC Parent Collective" width="247" height="240">
    </div>
    <p class="sub">The PTC · Fri 16 Oct</p>
    <p class="hint">{esc(CONTRIB_INTRO)}</p>
  </header>

  <main>
    <ul class="grid" aria-label="Stalls">
{tiles}
    </ul>
  </main>

  <footer class="site-footer">
    <span>{esc(CONTRIB_FOOTER)}</span>
  </footer>
</body>
</html>
"""


def _check_contributions(page: str, stalls: list[Stall], header_slugs: set[str]) -> None:
    if _has_banned_word(page):
        raise SystemExit("contributions page contains wording that is not allowed")
    if esc(CONTRIB_TITLE) not in page or esc_double(CONTRIB_DESCRIPTION) not in page:
        raise SystemExit("contributions page is missing its title or description")
    if esc(CONTRIB_INTRO) not in page or esc(CONTRIB_FOOTER) not in page:
        raise SystemExit("contributions page is missing the intro or footer")
    if any(token in page for token in ("docs.google.com", "forms.gle", "googleusercontent", "forms-images")):
        raise SystemExit("contributions page must not hotlink a form or its header")
    if "Eco Warriors" in page or "/go/eco/" in page:
        raise SystemExit("Eco Warriors must not appear on the contributions page")
    if page.count("<li>") != len(stalls):
        raise SystemExit("tile count does not match forms.txt")
    cursor = 0
    soon = 0
    for stall in stalls:
        for code, _alt in stall_flags(stall):
            if not (FLAGS / f"{code}.svg").is_file():
                raise SystemExit(f"missing flags/{code}.svg for {stall.slug}")
        href = f'href="{BASE}/go/{stall.slug}/"'
        if stall.slug in header_slugs:
            for name in (
                f"headers/{stall.slug}-1x.jpg",
                f"headers/{stall.slug}-2x.jpg",
                f"headers/{stall.slug}-1x.webp",
                f"headers/{stall.slug}-2x.webp",
            ):
                if name not in page:
                    raise SystemExit(f"contributions page is missing {name}")
        elif f"headers/{stall.slug}-" in page:
            raise SystemExit(f"{stall.slug} should keep its flags")
        if stall.is_open:
            pos = page.find(href, cursor)
            if pos < 0:
                raise SystemExit(f"contributions page is missing {href}")
            cursor = pos + len(href)
            if stall.url and stall.url in page:
                raise SystemExit(f"contributions page includes the form address for {stall.slug}")
        else:
            soon += 1
            if href in page:
                raise SystemExit(f"{stall.slug} has no form address and must not be a link")
    if page.count("Form coming soon") != soon:
        raise SystemExit("coming-soon tile count does not match forms.txt")


def _raster_svg(path: Path, width: int, height: int) -> Image.Image:
    try:
        import cairosvg
    except ImportError as err:
        raise SystemExit(
            "cairosvg is required to draw contributions/og.png. Install it with: pip install cairosvg"
        ) from err
    png = cairosvg.svg2png(url=str(path), output_width=width, output_height=height)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def _fit_rgba(path: Path, height: int) -> Image.Image:
    logo = Image.open(path).convert("RGBA")
    width = max(1, round(logo.width * height / logo.height))
    return logo.resize((width, height), Image.Resampling.LANCZOS)


def _pc_badge(diameter: int) -> Image.Image:
    badge = Image.new("RGBA", (diameter, diameter), (0, 0, 0, 0))
    ImageDraw.Draw(badge).ellipse((0, 0, diameter - 1, diameter - 1), fill=(*PC_PURPLE, 255))
    logo = _fit_rgba(PC_LOGO, diameter - 16)
    badge.alpha_composite(logo, ((diameter - logo.width) // 2, (diameter - logo.height) // 2))
    return badge


def _flag_card(code: str, card_w: int, card_h: int) -> Image.Image:
    pad = 8
    flag_w = card_w - pad * 2
    flag_h = card_h - pad * 2
    flag = _raster_svg(FLAGS / f"{code}.svg", flag_w * 2, flag_h * 2)
    flag = flag.resize((flag_w, flag_h), Image.Resampling.LANCZOS)
    mask = Image.new("L", flag.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, flag_w - 1, flag_h - 1), radius=5, fill=255)
    flag.putalpha(mask)
    ring = Image.new("RGBA", flag.size, (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle(
        (0, 0, flag_w - 1, flag_h - 1), radius=5, outline=(0, 0, 0, 48), width=1
    )
    card = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    ImageDraw.Draw(card).rounded_rectangle((0, 0, card_w - 1, card_h - 1), radius=12, fill=(255, 255, 255, 255))
    card.alpha_composite(flag, (pad, pad))
    card.alpha_composite(ring, (pad, pad))
    return card


def _card_shadow(card_w: int, card_h: int) -> tuple[Image.Image, tuple[int, int]]:
    blur = 5
    extra = blur * 2
    shadow = Image.new("RGBA", (card_w + extra * 2, card_h + extra * 2), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (extra, extra + 3, extra + card_w - 1, extra + card_h + 2),
        radius=14,
        fill=(0, 30, 60, 90),
    )
    return shadow.filter(ImageFilter.GaussianBlur(blur)), (-extra, -extra + 1)


def _header_image_url(html: str) -> str:
    """The form's own header banner, not the social-preview crop."""
    banners = re.findall(
        r"background-image:\s*url\((https://(?:docs\.google\.com/forms-images-rt|lh\d+\.googleusercontent\.com)/[^)\s]+)\)",
        html,
    )
    if not banners:
        banners = re.findall(
            r'property="og:image" content="(https://lh\d+\.googleusercontent\.com/[^"]+)"',
            html,
        )
    if not banners:
        return ""
    url = banners[0]
    if re.search(r"=w\d+", url):
        return re.sub(r"=w\d+.*$", "=w1600", url)
    return url + "=w1600"


def _http_bytes(url: str, timeout: int) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": FORM_UA})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def fetch_form_header(stall: Stall) -> Image.Image | None:
    if not stall.is_open:
        return None
    try:
        html = _http_bytes(stall.url, 30).decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        print(f"contributions: {stall.slug}: form page HTTP {err.code}; keeping flags", file=sys.stderr)
        return None
    except Exception as err:
        print(f"contributions: {stall.slug}: form page not available ({type(err).__name__}); keeping flags", file=sys.stderr)
        return None
    image_url = _header_image_url(html)
    if not image_url:
        print(f"contributions: {stall.slug}: no header image; keeping flags", file=sys.stderr)
        return None
    try:
        return Image.open(io.BytesIO(_http_bytes(image_url, 40)))
    except urllib.error.HTTPError as err:
        print(f"contributions: {stall.slug}: header HTTP {err.code}; keeping flags", file=sys.stderr)
        return None
    except Exception as err:
        print(f"contributions: {stall.slug}: header not available ({type(err).__name__}); keeping flags", file=sys.stderr)
        return None


def _cover_rgb(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    image = image.convert("RGB")
    width, height = size
    scale = max(width / image.width, height / image.height)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.Resampling.LANCZOS)
    left = max(0, (resized.width - width) // 2)
    top = max(0, (resized.height - height) // 2)
    return resized.crop((left, top, left + width, top + height))


def _save_under(image: Image.Image, path: Path, kind: str) -> None:
    qualities = (82, 74, 66, 58, 50) if kind == "JPEG" else (80, 70, 60, 50)
    last = b""
    for quality in qualities:
        buf = io.BytesIO()
        if kind == "JPEG":
            image.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
        else:
            image.save(buf, "WEBP", quality=quality, method=6)
        last = buf.getvalue()
        if len(last) <= HEADER_MAX_BYTES:
            break
    path.write_bytes(last)


def save_header_files(image: Image.Image, folder: Path, slug: str) -> None:
    for label, width in HEADER_WIDTHS:
        height = max(1, round(width / HEADER_RATIO))
        sized = _cover_rgb(image, (width, height))
        _save_under(sized, folder / f"{slug}-{label}.jpg", "JPEG")
        _save_under(sized, folder / f"{slug}-{label}.webp", "WEBP")


def _rounded_photo(image: Image.Image, size: tuple[int, int], radius: int) -> Image.Image:
    photo = _cover_rgb(image, size).convert("RGBA")
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    photo.putalpha(mask)
    return photo


def _write_flag_og(path: Path, stalls: list[Stall]) -> None:
    """1200x630 flag collage on UN blue, titled for parent contributions."""
    width, height = 1200, 630
    measure = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    title_font = ImageFont.truetype(SANS_BOLD, 60)
    line_font = ImageFont.truetype(SANS_BOLD, 40)
    detail_font = ImageFont.truetype(SANS, 26)
    title = "UN Day 2026"
    line = "Parent Contributions"
    detail = "The PTC · Fri 16 Oct"
    for text in (title, line, detail, CONTRIB_TITLE, CONTRIB_DESCRIPTION):
        if _has_banned_word(text):
            raise SystemExit("contributions share image contains wording that is not allowed")

    def bounds(text: str, font: ImageFont.FreeTypeFont) -> tuple[int, int, int, int]:
        return measure.textbbox((0, 0), text, font=font)

    bsc = _fit_rgba(BSC_LOGO, 108)
    badge = _pc_badge(100)
    logo_gap = 28
    title_box = bounds(title, title_font)
    line_box = bounds(line, line_font)
    while (line_box[2] - line_box[0]) > 520 and line_font.size > 30:
        line_font = ImageFont.truetype(SANS_BOLD, line_font.size - 2)
        line_box = bounds(line, line_font)
    detail_box = bounds(detail, detail_font)
    title_w, title_h = title_box[2] - title_box[0], title_box[3] - title_box[1]
    line_w, line_h = line_box[2] - line_box[0], line_box[3] - line_box[1]
    detail_w, detail_h = detail_box[2] - detail_box[0], detail_box[3] - detail_box[1]
    text_w = max(title_w, line_w)
    text_h = title_h + 10 + line_h
    row_h = max(bsc.height, badge.height, text_h)
    header_h = row_h + 16 + detail_h

    cols = 6 if len(stalls) > 6 else max(1, len(stalls))
    row_count = (len(stalls) + cols - 1) // cols
    gap_x, gap_y = 12, 14
    card_w = 94
    flag_w = card_w - 16
    card_h = round(flag_w * 3 / 4) + 16
    grid_h = row_count * card_h + (row_count - 1) * gap_y
    block_h = header_h + 32 + grid_h
    top = max(24, (height - block_h) // 2)

    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    row_w = bsc.width + logo_gap + text_w + logo_gap + badge.width
    x0 = (width - row_w) // 2
    overlay.alpha_composite(bsc, (x0, top + (row_h - bsc.height) // 2))
    text_x = x0 + bsc.width + logo_gap
    title_y = top + (row_h - text_h) // 2
    draw.text(
        (text_x + (text_w - title_w) / 2 - title_box[0], title_y - title_box[1]),
        title, font=title_font, fill=(255, 255, 255, 255),
    )
    draw.text(
        (text_x + (text_w - line_w) / 2 - line_box[0], title_y + title_h + 10 - line_box[1]),
        line, font=line_font, fill=(255, 255, 255, 255),
    )
    overlay.alpha_composite(badge, (text_x + text_w + logo_gap, top + (row_h - badge.height) // 2))
    detail_y = top + row_h + 16
    draw.text(
        ((width - detail_w) / 2 - detail_box[0], detail_y - detail_box[1]),
        detail, font=detail_font, fill=(255, 255, 255, 235),
    )

    grid_top = detail_y + detail_h + 32
    for index, stall in enumerate(stalls):
        row, col = divmod(index, cols)
        in_row = min(cols, len(stalls) - row * cols)
        row_pixels = in_row * card_w + (in_row - 1) * gap_x
        x = (width - row_pixels) // 2 + col * (card_w + gap_x)
        y = grid_top + row * (card_h + gap_y)
        card = _flag_card(stall_flags(stall)[0][0], card_w, card_h)
        shadow, offset = _card_shadow(card_w, card_h)
        overlay.alpha_composite(shadow, (x + offset[0], y + offset[1]))
        overlay.alpha_composite(card, (x, y))

    image = Image.alpha_composite(Image.new("RGBA", (width, height), (*UN_BLUE, 255)), overlay)
    image.convert("RGB").save(path, "PNG", optimize=True)


def _write_header_og(path: Path, photos: list[Image.Image]) -> None:
    """1200x630 collage of a few form headers under the page title."""
    width, height = 1200, 630
    canvas = Image.new("RGBA", (width, height), (*UN_BLUE, 255))
    draw = ImageDraw.Draw(canvas)
    title_font = ImageFont.truetype(SANS_BOLD, 54)
    line_font = ImageFont.truetype(SANS_BOLD, 36)
    detail_font = ImageFont.truetype(SANS, 24)
    title, line, detail = "UN Day 2026", "Parent Contributions", "The PTC · Fri 16 Oct"
    bsc = _fit_rgba(BSC_LOGO, 78)
    badge = _pc_badge(74)

    def place(text: str, font: ImageFont.FreeTypeFont, y: int) -> int:
        box = draw.textbbox((0, 0), text, font=font)
        draw.text(((width - (box[2] - box[0])) / 2 - box[0], y - box[1]), text, font=font, fill=(255, 255, 255, 255))
        return box[3] - box[1]

    canvas.alpha_composite(bsc, (36, 28))
    canvas.alpha_composite(badge, (width - 36 - badge.width, 30))
    y = 36
    y += place(title, title_font, y) + 6
    y += place(line, line_font, y) + 8
    place(detail, detail_font, y)

    shown = photos[:4]
    cols = 2 if len(shown) > 1 else 1
    rows = (len(shown) + cols - 1) // cols
    gap = 16
    margin = 36
    banner_w = (width - margin * 2 - gap * (cols - 1)) // cols
    banner_h = max(1, round(banner_w / HEADER_RATIO))
    grid_h = rows * banner_h + (rows - 1) * gap
    grid_top = height - 28 - grid_h
    for index, photo in enumerate(shown):
        row, col = divmod(index, cols)
        x = margin + col * (banner_w + gap)
        y = grid_top + row * (banner_h + gap)
        frame = Image.new("RGBA", (banner_w, banner_h), (0, 0, 0, 0))
        ImageDraw.Draw(frame).rounded_rectangle((0, 0, banner_w - 1, banner_h - 1), radius=14, fill=(255, 255, 255, 255))
        frame.alpha_composite(_rounded_photo(photo, (banner_w - 8, banner_h - 8), 10), (4, 4))
        canvas.alpha_composite(frame, (x, y))
    canvas.convert("RGB").save(path, "PNG", optimize=True)


def write_contributions_og(path: Path, stalls: list[Stall], headers: dict[str, Image.Image]) -> None:
    photos = [headers[stall.slug] for stall in stalls if stall.slug in headers]
    if len(photos) >= 2:
        _write_header_og(path, photos)
        return
    _write_flag_og(path, stalls)


def write_contributions(stalls: list[Stall]) -> None:
    shown = [stall for stall in stalls if stall.slug not in CONTRIB_SKIP]
    headers: dict[str, Image.Image] = {}
    for stall in shown:
        image = fetch_form_header(stall)
        if image is not None:
            headers[stall.slug] = image
    page = render_contributions(shown, set(headers))
    _check_contributions(page, shown, set(headers))
    if CONTRIBUTIONS.exists():
        shutil.rmtree(CONTRIBUTIONS)
    header_dir = CONTRIBUTIONS / "headers"
    header_dir.mkdir(parents=True)
    for slug, image in headers.items():
        save_header_files(image, header_dir, slug)
        for label, _width in HEADER_WIDTHS:
            for ext in ("jpg", "webp"):
                size = (header_dir / f"{slug}-{label}.{ext}").stat().st_size
                if size > HEADER_MAX_BYTES:
                    raise SystemExit(f"{slug}-{label}.{ext} is {size} bytes, over {HEADER_MAX_BYTES}")
    (CONTRIBUTIONS / "index.html").write_text(page, encoding="utf-8")
    image_path = CONTRIBUTIONS / CONTRIB_OG_NAME
    write_contributions_og(image_path, shown, headers)
    with Image.open(image_path) as image:
        if image.size != (1200, 630):
            raise SystemExit(f"contributions share image must be 1200x630, got {image.size}")
    flagged = [stall.slug for stall in shown if stall.slug not in headers]
    print(
        f"contributions: {len(headers)} header images, {len(flagged)} flag cards"
        + (f" ({', '.join(flagged)})" if flagged else "")
        + ", eco omitted"
    )


def main() -> None:
    stalls = parse_stalls(FORMS.read_text(encoding="utf-8"))
    endpoint = parse_tracker(TRACKER.read_text(encoding="utf-8")) if TRACKER.exists() else ""
    bsc, bsc_w, bsc_h = logo_data(BSC_LOGO)
    pc, pc_w, pc_h = logo_data(PC_LOGO, ink=True)
    logos = {
        "BSC_LOGO": bsc, "BSC_W": str(bsc_w), "BSC_H": str(bsc_h),
        "PC_LOGO": pc, "PC_W": str(pc_w), "PC_H": str(pc_h),
    }
    if GO.exists():
        shutil.rmtree(GO)
    for stall in stalls:
        folder = GO / stall.slug
        folder.mkdir(parents=True)
        (folder / "index.html").write_text(render_stall(stall, endpoint, logos), encoding="utf-8")
        banner = banner_path(stall)
        custom = custom_og_path(stall)
        if custom:
            shutil.copyfile(custom, folder / CUSTOM_OG)
        elif banner:
            write_banner_og_image(folder / BANNER_OG, stall, banner)
        else:
            write_og_image(folder / PLAIN_OG, stall)
    GO.mkdir(exist_ok=True)
    (GO / "index.html").write_text(render_index(stalls, endpoint, logos), encoding="utf-8")
    write_contributions(stalls)
    live = sum(1 for stall in stalls if stall.is_open)
    print(
        f"wrote {len(stalls)} short links ({live} with a form, {len(stalls) - live} opening soon), "
        f"previews, go/index.html and contributions/; tracking {'on' if endpoint else 'off'}"
    )


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        sys.exit(0)
