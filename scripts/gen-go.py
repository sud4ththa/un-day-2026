#!/usr/bin/env python3
"""Regenerate the go/ short-link pages from forms.txt and tracker.txt.

Each /go/<slug>/ page is fully static. The form address (third column of
forms.txt) and the click-tracker address (tracker.txt) are baked into the
page when this script runs, so a page never fetches forms.txt or
tracker.txt in the browser. A page with a form address fires the click
beacon straight away (navigator.sendBeacon, which survives navigation),
shows a short "Opening the form…" screen, and replaces itself with the
form after REDIRECT_MS. It does not wait for the tracker.

Because the addresses are baked in, you MUST run this script and commit
the regenerated go/ folder after any of these changes:

  * a form address is added, changed, or cleared in forms.txt
  * a stall is added or removed, or its name, year groups, or note change
  * the tracker address in tracker.txt is set, changed, or cleared

    python3 scripts/gen-go.py

The Open Graph preview images are drawn deterministically, so a stall
whose name and year groups did not change keeps a byte-identical image.
A stall with a painted banner at assets/banners/<slug>.png gets og-v2.jpg
(the banner, extended to 1200x630, with "UN Day 2026", the stall name and
year groups set in Playfair Display above it). A stall without a banner
gets the plain black-and-white og.jpg with the school logos. The new file
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
BSC_LOGO = ROOT / "assets" / "bsc-logo.png"
PC_LOGO = ROOT / "assets" / "pc-logo.png"
BANNERS = ROOT / "assets" / "banners"
PLAYFAIR = ROOT / "assets" / "fonts" / "PlayfairDisplay.ttf"
BANNER_OG = "og-v2.jpg"
PLAIN_OG = "og.jpg"
PREVIEW_URL = re.compile(
    r"https://sud4ththa\.github\.io/un-day-2026/go/[a-z0-9-]+/(?:og(?:-v2)?\.jpg)?"
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

INDEX_HEAD_JS = """<script>
var UNDAY_GO = (function () {
  var STALLS = __STALLS__;
  var requested = (new URLSearchParams(location.search).get("s") || "").trim();
  var match = null;
  for (var i = 0; i < STALLS.length; i++) {
    if (STALLS[i].s === requested) { match = STALLS[i]; break; }
  }
__TRACK__  if (match && match.u) {
    __SEND__setTimeout(function () { location.replace(match.u); }, __DELAY__);
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


def og_image_name(stall: Stall) -> str:
    """File name of the stall's preview image inside go/<slug>/."""
    return BANNER_OG if banner_path(stall) else PLAIN_OG


def og_tags(stall: Stall) -> str:
    page = f"{SITE}/go/{stall.slug}/"
    image = f"{page}{og_image_name(stall)}"
    fields = [
        ("property", "og:title", stall.title),
        ("property", "og:description", stall.description),
        ("property", "og:image", image),
        ("property", "og:image:width", "1200"),
        ("property", "og:image:height", "630"),
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
    if stall.is_open:
        track = track_js(endpoint)
        if track:
            track += f"\n  sendClick({js(stall.slug)});\n"
        head_js = fill(
            SLUG_HEAD_JS,
            {"FORM": js(stall.url), "TRACK": track, "DELAY": str(REDIRECT_MS)},
        )
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
            "SEND": "sendClick(match.s);\n    " if track else "",
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
TEXT_MAX_W = 580  # keeps the text inside the square centre crop (630 px) of the card


def playfair(size: int, weight: str) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(PLAYFAIR), size)
    font.set_variation_by_name(weight)
    return font


def column_strip(image: Image.Image, top: int, height: int) -> Image.Image:
    """One row: the per-column average of `height` rows, softly blurred sideways."""
    row = image.crop((0, top, image.width, top + height)).resize((image.width, 1), Image.Resampling.BOX)
    return row.filter(ImageFilter.GaussianBlur(40))


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
    fade_top, fade_bottom, bottom = 36, 24, 12
    banner = Image.open(banner_file).convert("RGB")
    art_h = round(banner.height * OG_W / banner.width)
    banner = banner.resize((OG_W, art_h), Image.Resampling.LANCZOS)
    top = OG_H - art_h - bottom
    half = top + art_h // 2
    canvas = Image.new("RGB", (OG_W, OG_H))
    canvas.paste(column_strip(banner, 0, 6).resize((OG_W, half), Image.Resampling.NEAREST), (0, 0))
    canvas.paste(column_strip(banner, art_h - 6, 6).resize((OG_W, OG_H - half), Image.Resampling.NEAREST), (0, half))
    alpha = [255] * art_h
    for y in range(fade_top):
        alpha[y] = round(255 * y / fade_top)
    for y in range(fade_bottom):
        alpha[art_h - 1 - y] = round(255 * y / fade_bottom)
    canvas.paste(banner, (0, top), vertical_mask(alpha, OG_W))
    lift_end = top + fade_top
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
    y = 40 + (top + 30 - 40 - total) // 2
    for (text, font, colour, gap), box in zip(blocks, boxes):
        y += gap
        draw.text(((OG_W - (box[2] - box[0])) / 2 - box[0], y - box[1]), text, font=font, fill=colour)
        y += box[3] - box[1]
    canvas.save(path, "JPEG", quality=86, optimize=True, subsampling=2)



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
        if banner:
            write_banner_og_image(folder / BANNER_OG, stall, banner)
        else:
            write_og_image(folder / PLAIN_OG, stall)
    GO.mkdir(exist_ok=True)
    (GO / "index.html").write_text(render_index(stalls, endpoint, logos), encoding="utf-8")
    live = sum(1 for stall in stalls if stall.is_open)
    print(
        f"wrote {len(stalls)} short links ({live} with a form, {len(stalls) - live} opening soon), "
        f"previews, and go/index.html; tracking {'on' if endpoint else 'off'}"
    )


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        sys.exit(0)
