#!/usr/bin/env python3
"""Publisher checks: no in-repo upload, signed-URL writes, stale keys removed."""
from __future__ import annotations

import importlib.util
import json
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("publish_dashboard", ROOT / "scripts" / "publish-dashboard.py")
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)


def check(cond: bool, message: str) -> None:
    if not cond:
        raise SystemExit(message)


class Fake:
    def __init__(self) -> None:
        self.files = {"sheets/UN-Day-Stall-Old-2026-10-06.pdf": b"%PDF-old"}
        self.pending: str | None = None
        self.order: list[str] = []
        self.deleted: list[str] = []

    def __call__(self, method: str, url: str, headers: dict, body: bytes | None = None):
        if url.startswith("https://signed.example/"):
            check(self.pending is not None, "signed upload without a key")
            check(headers.get("cache-control", "").startswith("max-age=0"), "missing cache-control")
            self.files[self.pending] = body or b""
            self.order.append(self.pending)
            self.pending = None
            return 200, b""
        parsed = urllib.parse.urlparse(url)
        check(parsed.netloc == "api.netlify.com", parsed.netloc)
        check("/api/v1/blobs/site-123/site:stall-dashboard" in parsed.path, parsed.path)
        check(urllib.parse.parse_qs(parsed.query).get("region") == ["us-east-2"], parsed.query)
        check(headers.get("Authorization") == "Bearer token-123", "missing token")
        if method == "PUT":
            key = parsed.path.split("/site:stall-dashboard/", 1)[1]
            check(body is None, "file bytes must not be sent to the API host")
            check(headers.get("Accept") == "application/json;type=signed-url", "missing signed-url accept")
            self.pending = urllib.parse.unquote(key)
            return 200, json.dumps({"url": "https://signed.example/put"}).encode()
        if method == "GET":
            blobs = [{"key": key, "etag": "1"} for key in self.files]
            return 200, json.dumps({"blobs": blobs, "next_cursor": None}).encode()
        if method == "DELETE":
            key = urllib.parse.unquote(parsed.path.split("/site:stall-dashboard/", 1)[1])
            self.deleted.append(key)
            self.files.pop(key, None)
            return 204, b""
        raise SystemExit(f"unexpected {method}")


def bundle(directory: Path) -> None:
    (directory / "sheets").mkdir()
    html = """<!DOCTYPE html><html><head></head><body>
<a class="pdf" href="sheets/UN-Day-Stall-Sri-Lanka-2026-10-07.pdf" download="UN-Day-Stall-Sri-Lanka-2026-10-07.pdf">Download this stall</a>
</body></html>"""
    (directory / "index.html").write_text(html, encoding="utf-8")
    (directory / "data.json").write_text("{}\n", encoding="utf-8")
    (directory / "report-pdf.js").write_text("/* counts */\n", encoding="utf-8")
    (directory / "og.jpg").write_bytes(b"\xff\xd8\xff")
    (directory / "sheets" / "UN-Day-Stall-Sri-Lanka-2026-10-07.pdf").write_bytes(b"%PDF-1.4\n")
    (directory / "private-bundle.json").write_text(
        json.dumps({"kind": "stall-dashboard-private", "contacts": True}) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    try:
        pub.publish(ROOT / "scripts", site_id="site-123", token="token-123", exchange=Fake())
    except SystemExit as err:
        check("inside the repo" in str(err), f"in-repo refusal missing: {err}")
    else:
        raise SystemExit("in-repo folder was accepted")

    import tempfile
    with tempfile.TemporaryDirectory() as raw:
        directory = Path(raw)
        bundle(directory)
        fake = Fake()
        uploaded = pub.publish(directory, site_id="site-123", token="token-123", exchange=fake)
        check(uploaded[-1] == "index.html", "index.html should upload last")
        check("sheets/UN-Day-Stall-Sri-Lanka-2026-10-07.pdf" in fake.files, "pdf missing after upload")
        check("private-bundle.json" not in fake.files, "marker must not be uploaded")
        check(fake.deleted == ["sheets/UN-Day-Stall-Old-2026-10-06.pdf"], f"stale key not removed: {fake.deleted}")
        check(fake.files["index.html"].startswith(b"<!DOCTYPE html>"), "html bytes not stored")

        (directory / "private-bundle.json").unlink()
        try:
            pub.collect_files(directory)
        except SystemExit as err:
            check("private-bundle" in str(err), str(err))
        else:
            raise SystemExit("missing marker was accepted")
    print("publish dashboard checks ok")


if __name__ == "__main__":
    main()
