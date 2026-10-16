#!/usr/bin/env python3
"""The public counts build has no contact PDFs. PDFs go to a private directory."""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
NOW = "2026-10-07T12:00:00+05:30"
PARENT = "Nimali Perera"
PHONE = "0775550199"
EMAIL = "nimali.perera@example.com"
CHILD = "Seth Perera"


def run(out: Path, sheets: Path) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as raw:
        data = Path(raw)
        (data / "sri-lanka.csv").write_text(
            "Timestamp,Parent name,Mobile number,Email,Child's name,Class,How would you like to contribute?,Food you can bring,Quantity / notes\n"
            f"7/10/2026 9:00:00,{PARENT},{PHONE},{EMAIL},{CHILD},Year 4A,Food,Kokis (500),one tin\n",
            encoding="utf-8",
        )
        clicks = data / "clicks.json"
        clicks.write_text('{"ok": true, "stalls": {}, "total": {"clicks": 0, "unique": 0}}\n', encoding="utf-8")
        return subprocess.run(
            [PY, str(ROOT / "scripts" / "build-dashboard.py"),
             "--data-dir", str(data), "--out", str(out),
             "--private-sheets-dir", str(sheets),
             "--clicks", str(clicks), "--now", NOW],
            cwd=ROOT, text=True, capture_output=True, check=False,
        )


def check(cond: bool, message: str) -> None:
    if not cond:
        raise SystemExit(message)


def main() -> None:
    inside = ROOT / "scripts" / "_sheets_should_not_exist"
    refused = run(Path("/tmp/undash-counts-out"), inside)
    check(refused.returncode != 0, refused.stderr)
    check("outside the repo" in refused.stderr, refused.stderr)
    check(not inside.exists(), "contact PDFs were written inside the repo")

    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        out = root / "counts"
        sheets = root / "private-sheets"
        out.mkdir()
        nested = out / "sheets"
        nested.mkdir()
        (nested / "leftover.pdf").write_bytes(b"%PDF-leftover")
        counts = run(out, sheets)
        check(counts.returncode == 0, counts.stderr + counts.stdout)
        html = (out / "index.html").read_text(encoding="utf-8")
        data = (out / "data.json").read_text(encoding="utf-8")
        for secret in (PARENT, PHONE, EMAIL, CHILD, "one tin"):
            check(secret not in html, f"counts page leaked {secret}")
            check(secret not in data, f"data.json leaked {secret}")
        check("Download this stall" not in html, "counts page still links a contact PDF")
        check("sheets/" not in html, "counts page still points at sheets/")
        check(not nested.exists(), "counts build left contact PDFs in the public folder")
        check((out / "report-pdf.js").is_file() and (out / "og.jpg").is_file(), "counts files missing")
        pdfs = list(sheets.glob("*.pdf"))
        check(pdfs, "private directory has no stall PDF")
        sri = next(p for p in pdfs if "Sri-Lanka" in p.name)
        blob = sri.read_bytes()
        check(blob.startswith(b"%PDF"), "stall file is not a pdf")
        check(PARENT.encode() in blob and PHONE.encode() in blob, "private PDF is missing the contact")
        check(PARENT.encode() not in html.encode(), "public page contains a name")
    print("dashboard contact build checks ok")


if __name__ == "__main__":
    main()
