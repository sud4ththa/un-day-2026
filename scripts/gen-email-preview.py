#!/usr/bin/env python3
"""Write email-preview/index.html.

The letter text lives in this script. Run it again after the wording changes:

    python3 scripts/gen-email-preview.py
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "email-preview" / "index.html"

CELL = "border:1px solid #111;padding:6px 10px;vertical-align:top"
P = "margin:0 0 14px"
EMAIL_STYLE = (
    "max-width:640px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;"
    "color:#111;font-size:15px;line-height:1.55"
)

ROWS = [
    ("Playgroup / Reception", "Sri Lanka", "sri-lanka"),
    ("Nursery/Year 1", "Japan", "japan"),
    ("Year 2", "Australia/Philippines/Indonesia/New Zealand", "australia"),
    ("Year 3", "Singapore/Malaysia/Thailand", "sea"),
    ("Year 4", "The Americas/Canada", "americas"),
    ("Year 5", "Middle East", "middle-east"),
    ("Year 6", "Europe", "europe"),
    ("Year 7", "India", "india"),
    ("Year 8", "UN Zone and Palestine", "un-zone"),
    ("Year 9", "China", "china"),
    ("Year 10", "Maldives", "maldives"),
    ("Year 11", "India", "india"),
    ("Year 12", "China", "china"),
    ("Year 13", "UN Zone and Palestine", "un-zone"),
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
        paragraph("Dear Parents,"),
        paragraph("<strong>UN Day \u2013 Friday 16th October 2026</strong>"),
        paragraph(
            "I write about our upcoming UN Day, one of the most highly anticipated days of the school year."
        ),
        paragraph(
            "This will be a fantastic opportunity for students from across the school to learn about the role of and the importance of the UN; the Convention on the Rights of the Child; the ways that conflict are impacting their peers globally as well as how we can support children in Sri Lanka. These educational aspects will come through assemblies and through curriculum time both on our UN Day itself as well as on the build up to it."
        ),
        paragraph(
            "The day will of course also be a wonderful celebration of the diversity and culture within our community and students will enjoy having the opportunity to continue their learning, and discover foods and games from around the world by exploring the stalls organised by our wonderful parents."
        ),
        paragraph(
            "This loved event would not be possible each year without the support of those who volunteer their hours of time leading up to the event as well as on the day and send in food donations."
        ),
        paragraph("<strong>My sincere thanks to everyone involved.</strong>"),
    ]
    after = [
        paragraph(
            "Please note that the food donations are organised by our amazing parent volunteers so please direct any questions to the parent contacts on the FORM that will be sent early next week."
        ),
        paragraph(
            "On UN Day, please send your child to school with an empty food box so that they can collect some treats from each stall they visit in addition to their usual lunch. If your child has allergies or dietary requirements, please ensure that their class teacher/form tutor is aware."
        ),
        paragraph(
            "All children across the school are invited to wear the national dress of a country to which they are affiliated or their formal BSC uniform. Please ensure that the national dress of any and every country is respectful and worn properly. This is not \u201cfancy dress\u201d but a reflection of our children\u2019s international identity."
        ),
        paragraph("With my best wishes,"),
        paragraph("Mrs Hannah Wells, Principal"),
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
  <p>Draft email preview, not sent. Based on the 2025 letter, with 2026 year groups and form links.</p>
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
