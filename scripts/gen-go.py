#!/usr/bin/env python3
"""Regenerate the go/ short-link pages from the slugs in forms.txt.

Each page only knows its slug. It fetches forms.txt in the browser and
redirects from there, so form addresses are never written into go/.

Run this after adding or removing a slug. Changing a form URL does not
need a regeneration.
"""

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
FORMS = ROOT / "forms.txt"
GO = ROOT / "go"
SITE = "https://sud4ththa.github.io/un-day-2026"
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SERIF = "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf"
SANS = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
BSC_LOGO = ROOT / "assets" / "bsc-logo.png"
PC_LOGO = ROOT / "assets" / "pc-logo.png"
PREVIEW_URL = re.compile(
    r"https://sud4ththa\.github\.io/un-day-2026/go/[a-z0-9-]+/(?:og\.jpg)?"
)


@dataclass
class Stall:
    slug: str
    name: str
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

SLUG_MAIN = """<main id="app">
  <p class="kicker">BSC UN Day 2026, the PTC</p>
  <h1 id="title">Contribution form</h1>
  <p class="lead" id="message">Opening the form…</p>
  <p id="actions" class="hidden"><a id="continue" class="continue" href="">Continue to form</a></p>
  <ul id="list" class="stalls hidden"></ul>
</main>"""

INDEX_MAIN = """<main id="app">
  <p class="kicker hidden" id="kicker">BSC UN Day 2026, the PTC</p>
  <h1 id="title" class="hidden">Contribution form</h1>
  <p class="lead" id="message">Please use the form link from your email.</p>
  <p id="actions" class="hidden"><a id="continue" class="continue" href="">Continue to form</a></p>
  <ul id="list" class="stalls hidden"></ul>
</main>"""

INDEX_BOOT = """if (!REQUESTED) return;
  document.getElementById("kicker").classList.remove("hidden");
  titleEl.classList.remove("hidden");
  messageEl.textContent = "Opening the form…";
"""

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
__OG__<title>__TITLE__</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    background: #fff;
    color: #111;
    font-family: Palatino, "Palatino Linotype", Georgia, serif;
    border-top: 4px solid #111;
  }
  main {
    max-width: 36rem;
    margin: 0 auto;
    padding: 4.5rem 1.5rem 3rem;
  }
  .kicker {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    margin: 0 0 1.25rem;
  }
  h1 {
    font-weight: normal;
    font-size: 2.25rem;
    line-height: 1.15;
    margin: 0 0 1.25rem;
  }
  .lead {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 1.05rem;
    line-height: 1.55;
    margin: 0 0 2rem;
  }
  a.continue {
    font-family: system-ui, -apple-system, sans-serif;
    color: #111;
    border-bottom: 1px solid #111;
    text-decoration: none;
    padding-bottom: 0.1rem;
  }
  ul.stalls { list-style: none; padding: 0; margin: 0; }
  ul.stalls li { border-top: 1px solid #111; }
  ul.stalls li:last-child { border-bottom: 1px solid #111; }
  ul.stalls a {
    display: block;
    padding: 0.9rem 0;
    color: #111;
    text-decoration: none;
    font-family: system-ui, -apple-system, sans-serif;
  }
  .hidden { display: none; }
</style>
</head>
<body>
<noscript>
  <style>#app { display: none; }</style>
  <main>
    <p class="kicker">BSC UN Day 2026, the PTC</p>
    <h1>Contribution form</h1>
    <p class="lead">JavaScript is required to open this form. The address is read from the form list when the page loads.</p>
  </main>
</noscript>
__MAIN__
<script>
(function () {
  var BASE = "/un-day-2026";
  var TRACK_WAIT_MS = 400;
  var REQUESTED = __REQUESTED__;
  var titleEl = document.getElementById("title");
  var messageEl = document.getElementById("message");
  var actionsEl = document.getElementById("actions");
  var continueEl = document.getElementById("continue");
  var listEl = document.getElementById("list");

  __BOOT__

  var trackerP = fetch(BASE + "/tracker.txt?t=" + Date.now(), { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) return "";
      return res.text();
    })
    .then(trackerEndpoint)
    .catch(function () { return ""; });

  function trackerEndpoint(text) {
    var lines = String(text || "").split(/\\r?\\n/);
    var i, line;
    for (i = 0; i < lines.length; i++) {
      line = lines[i].trim();
      if (!line || line.charAt(0) === "#") continue;
      return line.indexOf("https://") === 0 ? line : "";
    }
    return "";
  }

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

  function sendClick(endpoint, slug) {
    if (!endpoint) return;
    try {
      var url = endpoint + "?t=click&s=" + encodeURIComponent(slug)
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

  function withTracker(slug, redirect) {
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      redirect();
    }
    var timer = setTimeout(finish, TRACK_WAIT_MS);
    trackerP.then(function (endpoint) {
      if (done) return;
      clearTimeout(timer);
      sendClick(endpoint, slug);
      finish();
    }, function () {
      if (done) return;
      clearTimeout(timer);
      finish();
    });
  }

  function parse(text) {
    var stalls = [];
    text.split(/\\r?\\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line || line.charAt(0) === "#") return;
      var parts = line.split("|");
      if (parts.length < 2) return;
      var slug = parts[0].trim();
      var name = parts[1].trim();
      var url = (parts.length > 2 ? parts[2] : "").trim();
      if (!slug || !name) return;
      stalls.push({ slug: slug, name: name, url: url });
    });
    return stalls;
  }

  function showList(stalls, heading, message) {
    titleEl.textContent = heading;
    messageEl.textContent = message;
    document.title = heading + " · BSC UN Day 2026";
    listEl.textContent = "";
    stalls.forEach(function (stall) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = BASE + "/go/" + encodeURIComponent(stall.slug) + "/";
      a.textContent = stall.name;
      li.appendChild(a);
      listEl.appendChild(li);
    });
    listEl.classList.remove("hidden");
  }

  function showSoon(name) {
    titleEl.textContent = name;
    messageEl.textContent = "This contribution form opens soon. Please check back later.";
    document.title = name + " · BSC UN Day 2026";
  }

  function openForm(stall) {
    titleEl.textContent = stall.name;
    document.title = stall.name + " · BSC UN Day 2026";
    if (stall.url.indexOf("https://") === 0) {
      messageEl.textContent = "Opening the form…";
      continueEl.href = stall.url;
      actionsEl.classList.remove("hidden");
      withTracker(stall.slug, function () {
        window.location.replace(stall.url);
      });
      return;
    }
    showSoon(stall.name);
  }

  function fail() {
    titleEl.textContent = "Contribution form";
    messageEl.textContent = "The form list could not be loaded. Please check back later.";
  }

  fetch(BASE + "/forms.txt?t=" + Date.now(), { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("bad status");
      return res.text();
    })
    .then(function (text) {
      var stalls = parse(text);
      var match = null;
      for (var i = 0; i < stalls.length; i++) {
        if (stalls[i].slug === REQUESTED) {
          match = stalls[i];
          break;
        }
      }
      if (!match) {
        showList(
          stalls,
          "Stall not found",
          "That short link does not match a stall. Choose one below."
        );
        return;
      }
      openForm(match);
    })
    .catch(fail);
})();
</script>
</body>
</html>
"""


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
        stalls.append(
            Stall(
                slug=slug,
                name=parts[1],
                years=parts[3] if len(parts) > 3 else "",
                note=parts[4] if len(parts) > 4 else "",
            )
        )
    if not stalls:
        raise SystemExit("forms.txt has no stalls")
    return stalls


def og_tags(stall: Stall) -> str:
    page = f"{SITE}/go/{stall.slug}/"
    image = f"{page}og.jpg"
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


def render(requested: str, *, index: bool, stall: Stall | None = None) -> str:
    if index or stall is None:
        og = ""
        title = "BSC UN Day 2026"
        main = INDEX_MAIN
        boot = INDEX_BOOT
    else:
        og = og_tags(stall)
        title = html.escape(stall.title)
        main = SLUG_MAIN
        boot = ""
    page = (
        PAGE.replace("__MAIN__", main)
        .replace("__BOOT__", boot)
        .replace("__OG__", og)
        .replace("__TITLE__", title)
        .replace("__REQUESTED__", requested)
    )
    if "__" in page:
        raise SystemExit("page template was not filled in")
    stripped = PREVIEW_URL.sub("", page)
    if re.search(r"https://[A-Za-z0-9]", stripped):
        raise SystemExit("generated page contains a URL; form addresses belong only in forms.txt")
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


def main() -> None:
    stalls = parse_stalls(FORMS.read_text(encoding="utf-8"))
    if GO.exists():
        shutil.rmtree(GO)
    for stall in stalls:
        folder = GO / stall.slug
        folder.mkdir(parents=True)
        (folder / "index.html").write_text(
            render(json.dumps(stall.slug), index=False, stall=stall),
            encoding="utf-8",
        )
        write_og_image(folder / "og.jpg", stall)
    GO.mkdir(exist_ok=True)
    (GO / "index.html").write_text(
        render('(new URLSearchParams(location.search).get("s") || "").trim()', index=True),
        encoding="utf-8",
    )
    print(f"wrote {len(stalls)} short links, previews, and go/index.html")


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        sys.exit(0)
