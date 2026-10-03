#!/usr/bin/env python3
"""Write email-preview/index.html.

The letter text lives in this script. Run it again after the wording changes:

    python3 scripts/gen-email-preview.py
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "email-preview" / "index.html"

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
        paragraph("Friday 2nd October 2026"),
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


PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name=robots content=noindex>
<title>UN Day 2026 parent email (draft preview)</title>
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
})();
</script>
</body>
</html>
"""


def main() -> None:
    page = PAGE.replace("__EMAIL__", email_html())
    if "__EMAIL__" in page:
        raise SystemExit("email was not inserted")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
