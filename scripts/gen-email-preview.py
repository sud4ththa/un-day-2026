#!/usr/bin/env python3
"""Write email-preview/index.html and email-preview/og.jpg.

The letter text lives in this script. Run it again after the wording changes:

    python3 scripts/gen-email-preview.py
"""

import html
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "email-preview" / "index.html"
OG_IMAGE = ROOT / "email-preview" / "og.jpg"
SITE = "https://sud4ththa.github.io/un-day-2026"
PAGE_URL = f"{SITE}/email-preview/"


def load_gen_go():
    """scripts/gen-go.py (forms.txt parser and og.jpg drawing helpers)."""
    spec = importlib.util.spec_from_file_location("gen_go", ROOT / "scripts" / "gen-go.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["gen_go"] = module
    sys.dont_write_bytecode = True
    spec.loader.exec_module(module)
    return module


GEN_GO = load_gen_go()

CELL = "border:1px solid #111;padding:6px 10px;vertical-align:top"
P = "margin:0 0 14px;"
EMAIL_STYLE = (
    "max-width:640px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;"
    "color:#111;font-size:15px;line-height:1.55"
)

ROWS = [
    ("Playgroup and Reception", "Sri Lanka", "sri-lanka"),
    ("Nursery and Year 1", "Japan", "japan"),
    ("Year 2", "Australia/Philippines/Indonesia/New Zealand", "australia"),
    ("Year 3", "Singapore/Malaysia/Vietnam", "sea"),
    ("Year 4", "The Americas/Canada", "americas"),
    ("Year 5", "Middle East and Palestine", "middle-east"),
    ("Year 6", "Europe", "europe"),
    ("Year 7", "India", "india"),
    ("Year 8", "Middle East and Palestine", "middle-east"),
    ("Year 9", "China", "china"),
    ("Year 10", "Maldives", "maldives"),
    ("Year 11", "India", "india"),
    ("Year 12 and Year 13", "China", "china"),
]


def paragraph(inner: str) -> str:
    return f'<p style="{P}">{inner}</p>'


def table() -> str:
    def cell(tag: str, text: str) -> str:
        align = " align=left" if tag == "th" else ""
        return f'<{tag}{align} style="{CELL}">{text}</{tag}>'

    header = "".join(
        cell("th", label)
        for label in ("Year Group/s", "Country/Countries", "Link to FORM")
    )
    body = []
    for year, country, slug in ROWS:
        href = f"https://sud4ththa.github.io/un-day-2026/go/{slug}/"
        link = f'<a href="{href}" style="color:#1a0dab;">{country} FORM</a>'
        body.append(
            "<tr>"
            + cell("td", year)
            + cell("td", country)
            + cell("td", link)
            + "</tr>"
        )
    return (
        '<table role=presentation '
        'style="border-collapse:collapse;width:100%;margin:6px 0 18px;font-size:14px;">'
        f"<tr>{header}</tr>"
        + "".join(body)
        + "</table>"
    )


def email_html() -> str:
    before = [
        paragraph("Monday 5th October 2026"),
        paragraph(
            "<em>Please note that this is a repeat of the letter sent last Friday about our upcoming UN Day. It now includes the FORM links to all the countries for the purpose of parent contributions.</em>"
        ),
        paragraph("Dear Parents,"),
        paragraph("<strong>UN Day \u2013 Friday 16th October 2026</strong>"),
        paragraph(
            "I write about our upcoming UN Day, one of the most highly anticipated days of the school year."
        ),
        paragraph(
            "With Peace as the central theme of our UN Day this year, students will explore the important role of the United Nations and, in an age-appropriate way, how conflict and struggle are affecting children around the world. Through assemblies, curriculum learning and our UN Zone, we hope to build awareness and empathy, while encouraging students to consider how we can all contribute to building a more peaceful, compassionate world."
        ),
        paragraph(
            "UN Day will, of course, also be a wonderful celebration of the rich diversity and cultures within our BSC community, with students enjoying food, games and experiences from around the world through the stalls organised by our wonderful parents. This much-loved event simply would not be possible without the many parents who generously volunteer their time, both in the build-up and on the day itself, as well as those who contribute food and other donations."
        ),
        paragraph(
            "Thank you, as always, for helping us make UN Day such a special occasion for our children. It takes the whole community to come together and provide such a happy experience."
        ),
        paragraph("<strong>My sincere thanks to all families in advance of your food donations.</strong>"),
    ]
    after = [
        paragraph(
            "Please note that the food donations are sent by all parents but organised by our amazing parent volunteers so please direct any questions to the parent contacts on the FORM that will be sent early next week."
        ),
        paragraph(
            "On UN Day, please send your child to school with an empty food box and cutlery so that they can collect some treats from each stall they visit in addition to their usual lunch. If your child has allergies or dietary requirements, please ensure that their class teacher/form tutor is aware."
        ),
        paragraph(
            "All children across the school are invited to wear the national dress of a country to which they are affiliated or their formal BSC uniform. Please ensure that the national dress of any and every country is respectful and worn properly. This is not \u201cfancy dress\u201d but a reflection of our children\u2019s international identity."
        ),
        paragraph("With my best wishes,"),
        paragraph("Mrs Hannah Wells<br>Principal"),
    ]
    inner = "\n".join(before) + "\n" + table() + "\n" + "\n".join(after)
    return f'<div id="email" style="{EMAIL_STYLE}">\n{inner}\n</div>'


# WhatsApp messages for Amrit and the stall volunteers. One card per stall in
# forms.txt that has an https address, in forms.txt order, named as in
# forms.txt. A stall not listed in WA_BODY gets DEFAULT_BODY. Messages end
# with the stall's contact line (WA_CONTACT) and carry no sign-off.
# WA_SRC tags the short link; a new value also makes WhatsApp build a fresh
# preview card for the link (v2 posts of 4 Oct: "g2").
WA_SRC = "g2"
DEFAULT_BODY = (
    "Thank you for supporting the {stall} stall! Please use the form below to let us know "
    "what food you can send in, or if you'd like to make a monetary contribution."
)
WA_BODY = {
    "europe": (
        "Thank you for supporting the {stall} stall! Please use the form below to let us know "
        "what food you can send in."
    ),
    "americas": (
        "Thank you for supporting the {stall} stall! Please use the form below to let us know "
        "what food you can send in, or if you'd like to make a monetary contribution "
        "(we suggest Rs 3,000 to 5,000), or both."
    ),
    # Year 3 made its own form; the body uses its facts and wording.
    "sea": (
        "Thank you for supporting the Year 3 food stall! This year the team is collecting funds "
        "and arranging the food centrally through selected vendors. They kindly request a minimum "
        "contribution of LKR 5,000 per child. Please see the menu, bank details and form here:"
    ),
    "japan": (
        "Thank you for supporting the {stall} stall! Please use the form below to let us know "
        "how you can contribute."
    ),
}
# Who parents should ask, from Subs (4 Oct) and the Team Japan letter.
WA_CONTACT = {
    "sri-lanka": "Avanthi (0777557800) or Melanie (0770657150)",
    "japan": "Tomo (0779851630)",
    "americas": "Mina (0778388388)",
    "europe": "Dinusha (077 638 3877) or Gothami (071 271 2041)",
    "india": "Gaja (0773935886)",
    "middle-east": "Dil (077 769 8857)",
    "sea": "Anisha Mawzoon (077 956 7567) or Tina Lobo (076 033 3333)",
    "maldives": "Sharu (077 629 4427) or Hawwa Shareefa (076 610 6776)",
}
# Message title where the stall's own wording differs from the forms.txt name.
WA_TITLE = {"sea": "Singapore, Malaysia, Vietnam & Thailand"}
# A stall team's own WhatsApp write-up, used word for word: the only change
# is that its form link is swapped for our counted short link. These cards
# use the forms.txt stall name and get no contact line from us.
STALL_WA_DIR = ROOT / "assets" / "wa-messages"


def stall_wa_text(stall) -> str | None:
    path = STALL_WA_DIR / f"{stall.slug}.txt"
    return path.read_text(encoding="utf-8").strip("\n") if path.is_file() else None


# Shown on the card only (not part of the message).
WA_HINT = {
        "australia": "The Year 2 team\u2019s own message, word for word; only the form link is our short link.",
}


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def wa_stalls() -> list:
    stalls = GEN_GO.parse_stalls((ROOT / "forms.txt").read_text(encoding="utf-8"))
    return [stall for stall in stalls if stall.url.startswith("https://")]


def wa_name(stall) -> str:
    return stall.name


def wa_message(stall) -> str:
    own = stall_wa_text(stall)
    if own is not None:
        return own
    name = wa_name(stall)
    second = f"{stall.years} \u00b7 Friday 16 October" if stall.years else "Friday 16 October"
    body = WA_BODY.get(stall.slug, DEFAULT_BODY).format(stall=name)
    link = f"{SITE}/go/{stall.slug}/?src={WA_SRC}"
    lines = [f"*UN Day 2026 \u2013 {WA_TITLE.get(stall.slug, name)} stall*", second, "", body, link]
    contact = WA_CONTACT.get(stall.slug)
    if contact:
        lines += ["", f"Questions? Please contact {contact}."]
    text = "\n".join(lines)
    if "PTC" in text:
        raise SystemExit(f"{stall.slug}: WhatsApp message must not mention the PTC")
    return text


def wa_section() -> str:
    cards = []
    for stall in wa_stalls():
        name = wa_name(stall)
        msg_id = f"wa-{stall.slug}"
        meta = esc(stall.years) + " \u00b7 " if stall.years else ""
        hint = WA_HINT.get(stall.slug)
        hint_html = f'\n  <p class="wa-hint">{esc(hint)}</p>' if hint else ""
        cards.append(
            f"""<article class="wa-card">
  <img class="wa-og" src="../go/{stall.slug}/{GEN_GO.og_image_name(stall)}" width="1200" height="630" loading="lazy" alt="WhatsApp link preview: {esc(name)} stall">
  <div class="wa-body">
  <h3>{esc(name)}</h3>
  <p class="wa-meta">{meta}Friday 16 October</p>{hint_html}
  <pre class="wa-msg" id="{msg_id}">{esc(wa_message(stall))}</pre>
  <div class="wa-actions"><button type="button" class="wa-copy" data-target="{msg_id}">Copy</button><span class="wa-state" role="status"></span></div>
  </div>
</article>"""
        )
    return (
        '<section class="wa" aria-labelledby="wa-title">\n'
        '<h2 id="wa-title">For sharing on WhatsApp</h2>\n'
        '<p class="wa-intro">For Amrit (class WhatsApp groups) and the stall volunteers. '
        "Copy a message and paste it into WhatsApp. Keep the link on its own line so "
        "WhatsApp shows the preview card pictured above each message.</p>\n"
        + "\n".join(cards)
        + "\n</section>"
    )


def og_tags() -> str:
    image = f"{SITE}/email-preview/og.jpg"
    fields = [
        ("property", "og:title", "UN Day 2026 \u00b7 Parent email (preview)"),
        ("property", "og:description", "Letter to parents with each year group's food contribution form. Friday 16 October 2026."),
        ("property", "og:image", image),
        ("property", "og:image:width", "1200"),
        ("property", "og:image:height", "630"),
        ("property", "og:url", PAGE_URL),
        ("property", "og:type", "website"),
        ("name", "twitter:card", "summary_large_image"),
        ("name", "twitter:image", image),
    ]
    return "\n".join(f'<meta {attr}="{name}" content="{esc(value)}">' for attr, name, value in fields)


def write_og_image() -> None:
    card = GEN_GO.Stall(slug="email-preview", name="Parent email", url="", years="", note="")
    GEN_GO.write_og_image(OG_IMAGE, card)


PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name=robots content=noindex>
<title>UN Day 2026 parent email (draft preview)</title>
__OG__
<style>
  body { margin: 0; background: #f4f4f4; }
  .bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 10px 16px;
    background: #000;
    color: #fff;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.35;
  }
  .bar p { margin: 0; flex: 1 1 16rem; }
  .bar button {
    font: inherit;
    color: #fff;
    background: #000;
    border: 1px solid #fff;
    padding: 4px 8px;
    cursor: pointer;
  }
  .card {
    background: #fff;
    max-width: 700px;
    margin: 24px auto;
    padding: 32px 28px;
  }
  .wa {
    max-width: 700px;
    margin: 56px auto 48px;
    padding: 0 16px;
    font-family: Georgia, 'Times New Roman', serif;
    color: #111;
  }
  .wa h2 {
    font-weight: normal;
    font-size: 26px;
    letter-spacing: -0.01em;
    margin: 0 0 10px;
    padding-top: 28px;
    border-top: 2px solid #111;
  }
  .wa-intro {
    font-size: 15px;
    line-height: 1.55;
    margin: 0 0 24px;
    color: #333;
  }
  .wa-card {
    background: #fff;
    border: 1px solid #111;
    margin: 0 0 24px;
  }
  .wa-og {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 1200 / 630;
    border-bottom: 1px solid #111;
  }
  .wa-body { padding: 18px 20px 20px; }
  .wa-card h3 {
    font-weight: normal;
    font-size: 22px;
    line-height: 1.2;
    margin: 0 0 4px;
  }
  .wa-meta {
    font-style: italic;
    font-size: 15px;
    margin: 0 0 14px;
    color: #333;
  }
  .wa-hint {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 13px;
    margin: -6px 0 14px;
    padding-left: 10px;
    border-left: 2px solid #111;
  }
  .wa-msg {
    margin: 0;
    padding: 14px 16px;
    background: #f7f7f7;
    border: 1px solid #ccc;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    -webkit-user-select: text;
    user-select: text;
  }
  .wa-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
  }
  .wa-copy {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 14px;
    color: #fff;
    background: #000;
    border: 1px solid #000;
    padding: 8px 18px;
    min-width: 96px;
    cursor: pointer;
  }
  .wa-copy.is-copied { background: #fff; color: #000; }
  .wa-state {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 13px;
    color: #333;
  }
  /* The letter table is wider than a phone; scroll it inside the card
     instead of widening the whole page. */
  .card { overflow-x: auto; }
  @media (max-width: 480px) {
    .card { margin: 0; padding: 24px 16px; }
    .wa { margin-top: 40px; padding: 0 12px; }
    .wa-body { padding: 16px 14px 18px; }
  }
</style>
</head>
<body>
<div class="bar">
  <p>Draft email preview, not sent. The Principal\u2019s 2 Oct 2026 letter with FORM links added, in last year\u2019s format.</p>
  <button type="button" id="copy-email">Copy email</button>
  <button type="button" id="copy-source">Copy HTML source</button>
  <span id="status" role="status"></span>
</div>
<div class="card">
<!-- COPY FROM HERE -->
__EMAIL__
<!-- COPY TO HERE -->
</div>
__WA__
<script>
(function () {
  var statusEl = document.getElementById("status");

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function selectCopy(el) {
    var range = document.createRange();
    range.selectNode(el);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    var ok = document.execCommand("copy");
    selection.removeAllRanges();
    if (!ok) throw new Error("copy failed");
  }

  document.getElementById("copy-email").addEventListener("click", function () {
    var el = document.getElementById("email");
    var html = el.outerHTML;
    var text = el.innerText;
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" })
        })
      ]).then(function () {
        setStatus("Copied");
      }, function () {
        try {
          selectCopy(el);
          setStatus("Copied");
        } catch (err) {
          setStatus("Copy failed");
        }
      });
      return;
    }
    try {
      selectCopy(el);
      setStatus("Copied");
    } catch (err) {
      setStatus("Copy failed");
    }
  });

  document.getElementById("copy-source").addEventListener("click", function () {
    var html = document.getElementById("email").outerHTML;
    function textareaCopy() {
      var area = document.createElement("textarea");
      area.value = html;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(area);
      if (!ok) throw new Error("copy failed");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(html).then(function () {
        setStatus("Copied");
      }, function () {
        try {
          textareaCopy();
          setStatus("Copied");
        } catch (err) {
          setStatus("Copy failed");
        }
      });
      return;
    }
    try {
      textareaCopy();
      setStatus("Copied");
    } catch (err) {
      setStatus("Copy failed");
    }
  });
  Array.prototype.forEach.call(document.querySelectorAll(".wa-copy"), function (button) {
    var box = document.getElementById(button.getAttribute("data-target"));
    var state = button.parentNode.querySelector(".wa-state");
    var timer = null;

    function selectBox() {
      var range = document.createRange();
      range.selectNodeContents(box);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return selection;
    }

    function copied() {
      button.textContent = "Copied";
      button.classList.add("is-copied");
      state.textContent = "";
      clearTimeout(timer);
      timer = setTimeout(function () {
        button.textContent = "Copy";
        button.classList.remove("is-copied");
      }, 2000);
    }

    function fallback() {
      var selection = selectBox();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (err) {}
      if (ok) {
        selection.removeAllRanges();
        copied();
      } else {
        state.textContent = "Text selected: copy it from the menu";
      }
    }

    button.addEventListener("click", function () {
      var text = box.textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(copied, fallback);
        return;
      }
      fallback();
    });
  });
})();
</script>
</body>
</html>
"""


def main() -> None:
    page = (
        PAGE.replace("__EMAIL__", email_html())
        .replace("__OG__", og_tags())
        .replace("__WA__", wa_section())
    )
    for marker in ("__EMAIL__", "__OG__", "__WA__"):
        if marker in page:
            raise SystemExit(f"{marker} was not inserted")
    if page.count("<title>") != 1 or page.count("<head>") != 1:
        raise SystemExit("page must have exactly one <head> and one <title>")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    write_og_image()
    print(f"wrote {OUT.relative_to(ROOT)} ({len(wa_stalls())} WhatsApp cards) and {OG_IMAGE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
