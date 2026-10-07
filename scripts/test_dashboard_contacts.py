#!/usr/bin/env python3
"""Counts builds omit contact PDFs. --contacts writes them only outside the repo."""
from __future__ import annotations

import importlib.util
import json
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


def run(out: Path, extra: list[str]) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as raw:
        data = Path(raw)
        (data / "sri-lanka.csv").write_text(
            "Timestamp,Parent name,Mobile number,Email,Child name,Class,What would you like to contribute?,Food you can bring,Quantity and notes\n"
            f"7/10/2026 9:00:00,{PARENT},{PHONE},{EMAIL},{CHILD},Year 4A,Food,Kokis (500),one tin\n",
            encoding="utf-8",
        )
        clicks = data / "clicks.json"
        clicks.write_text('{"ok": true, "stalls": {}, "total": {"clicks": 0, "unique": 0}}\n', encoding="utf-8")
        return subprocess.run(
            [PY, str(ROOT / "scripts" / "build-dashboard.py"),
             "--data-dir", str(data), "--out", str(out), "--clicks", str(clicks), "--now", NOW, *extra],
            cwd=ROOT, text=True, capture_output=True, check=False,
        )


def check(cond: bool, message: str) -> None:
    if not cond:
        raise SystemExit(message)


def main() -> None:
    inside = ROOT / "scripts" / "_contacts_should_not_exist"
    refused = run(inside, ["--contacts"])
    check(refused.returncode != 0, refused.stderr)
    check("outside the repo" in refused.stderr, refused.stderr)
    check(not inside.exists(), "contacts build wrote inside the repo")

    with tempfile.TemporaryDirectory() as raw:
        out = Path(raw) / "counts"
        out.mkdir()
        sheets = out / "sheets"
        sheets.mkdir()
        (sheets / "leftover.pdf").write_bytes(b"%PDF-leftover")
        (out / "private-bundle.json").write_text("{}\n", encoding="utf-8")
        counts = run(out, [])
        check(counts.returncode == 0, counts.stderr + counts.stdout)
        html = (out / "index.html").read_text(encoding="utf-8")
        data = (out / "data.json").read_text(encoding="utf-8")
        for secret in (PARENT, PHONE, EMAIL, CHILD, "one tin"):
            check(secret not in html, f"counts page leaked {secret}")
            check(secret not in data, f"data.json leaked {secret}")
        check("Download this stall" not in html, "counts page still links a contact PDF")
        check("sheets/" not in html, "counts page still points at sheets/")
        check(not sheets.exists(), "counts build left contact PDFs in place")
        check(not (out / "private-bundle.json").exists(), "counts build left the private marker")
        check((out / "report-pdf.js").is_file() and (out / "og.jpg").is_file(), "counts files missing")

    with tempfile.TemporaryDirectory() as raw:
        out = Path(raw) / "private"
        built = run(out, ["--contacts"])
        check(built.returncode == 0, built.stderr + built.stdout)
        html = (out / "index.html").read_text(encoding="utf-8")
        data = (out / "data.json").read_text(encoding="utf-8")
        for secret in (PARENT, PHONE, EMAIL, CHILD):
            check(secret not in html, f"private counts page leaked {secret}")
            check(secret not in data, f"private data.json leaked {secret}")
        check("Download this stall" in html, "contact bundle has no stall download")
        marker = json.loads((out / "private-bundle.json").read_text(encoding="utf-8"))
        check(marker == {"kind": "stall-dashboard-private", "contacts": True}, marker)
        pdfs = list((out / "sheets").glob("*.pdf"))
        check(pdfs, "no contact PDFs")
        sri = next(p for p in pdfs if "Sri-Lanka" in p.name)
        blob = sri.read_bytes()
        check(blob.startswith(b"%PDF"), "stall file is not a pdf")
        check(PARENT.encode() in blob, "contact PDF missing the parent")
        check(PHONE.encode() in blob, "contact PDF missing the phone")
        check(f'sheets/{sri.name}' in html, "page does not link the contact PDF")
        spec = importlib.util.spec_from_file_location("publish_dashboard", ROOT / "scripts" / "publish-dashboard.py")
        pub = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pub)
        uploaded = pub.collect_files(out)
        check("private-bundle.json" not in uploaded, "marker would be uploaded")
        check(f"sheets/{sri.name}" in uploaded, "publisher skipped the contact PDF")
        check(PARENT.encode() not in uploaded["index.html"], "publisher accepted a page with a name")
    print("dashboard contact build checks ok")


if __name__ == "__main__":
    main()
