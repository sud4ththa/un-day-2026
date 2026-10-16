#!/usr/bin/env python3
"""Upload a --contacts dashboard bundle to the Netlify Blobs store the OTP gate reads.

The folder must come from:

  python3 scripts/build-dashboard.py --data-dir DIR --out /var/tmp/undash-private --contacts

It is not committed. This script refuses a folder inside the repo.

Env:
  NETLIFY_AUTH_TOKEN   personal access token that can write this site's blobs
  NETLIFY_SITE_ID      Project ID (site id) of the gated Netlify site

The store name is stall-dashboard. @netlify/blobs prefixes site stores with
"site:", and the gate function opens the same store in region us-east-2.
Keep those three values in step with dashboard-gate/netlify/functions/gate.mjs.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORE_NAME = "stall-dashboard"
API_STORE = "site:" + STORE_NAME
REGION = "us-east-2"
API_BASE = "https://api.netlify.com"
REQUIRED = ("index.html", "data.json", "report-pdf.js", "og.jpg")
HREF_RE = re.compile(r'href="(sheets/[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.pdf)"')


class PublishError(SystemExit):
    pass


def inside_repo(path: Path) -> bool:
    try:
        path.resolve().relative_to(ROOT.resolve())
    except ValueError:
        return False
    return True


def collect_files(directory: Path) -> dict[str, bytes]:
    if not directory.is_dir():
        raise PublishError(f"not a directory: {directory}")
    if inside_repo(directory):
        raise PublishError("refusing to upload a folder inside the repo")
    marker_path = directory / "private-bundle.json"
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        raise PublishError(
            "missing private-bundle.json. Rebuild with --contacts into a folder outside the repo."
        ) from err
    if marker.get("kind") != "stall-dashboard-private" or marker.get("contacts") is not True:
        raise PublishError("this folder is not a contact bundle. Rebuild with --contacts.")

    files: dict[str, bytes] = {}
    for name in REQUIRED:
        path = directory / name
        if not path.is_file():
            raise PublishError(f"missing {name}")
        files[name] = path.read_bytes()

    html = files["index.html"].decode("utf-8")
    visible = re.sub(r"<style[\s\S]*?</style>", "", html, flags=re.I)
    visible = re.sub(r'src="data:[^"]+"', "", visible)
    if re.search(r"\d{7,}", visible):
        raise PublishError("refusing to upload: index.html contains a long number")
    if re.search(r"[\w.+-]+@[\w.-]+\.\w+", visible):
        raise PublishError("refusing to upload: index.html contains an email address")

    hrefs = HREF_RE.findall(html)
    if not hrefs:
        raise PublishError("index.html has no stall PDF links. Rebuild with --contacts.")
    sheets = directory / "sheets"
    linked = set(hrefs)
    for href in hrefs:
        path = directory / href
        if not path.is_file():
            raise PublishError(f"missing {href}")
        blob = path.read_bytes()
        if not blob.startswith(b"%PDF"):
            raise PublishError(f"{href} is not a PDF")
        files[href] = blob
    if sheets.is_dir():
        for pdf in sorted(sheets.glob("*.pdf")):
            key = f"sheets/{pdf.name}"
            if key not in linked:
                raise PublishError(f"unlinked contact PDF: {pdf.name}")
    return files


def _api_url(api_base: str, site_id: str, key: str | None = None, extra: dict | None = None) -> str:
    path = f"/api/v1/blobs/{urllib.parse.quote(site_id, safe='')}/{API_STORE}"
    if key:
        path += "/" + key
    query = {"region": REGION}
    if extra:
        query.update(extra)
    return api_base.rstrip("/") + path + "?" + urllib.parse.urlencode(query)


def urllib_exchange(method: str, url: str, headers: dict, body: bytes | None = None):
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def _signed_put(exchange, api_base: str, site_id: str, token: str, key: str, body: bytes) -> None:
    status, raw = exchange(
        "PUT",
        _api_url(api_base, site_id, key),
        {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json;type=signed-url",
        },
        None,
    )
    if status != 200:
        raise PublishError(f"could not start upload for {key} ({status})")
    try:
        signed = json.loads(raw.decode("utf-8"))["url"]
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError) as err:
        raise PublishError(f"upload for {key} did not return a signed URL") from err
    put_status, _ = exchange(
        "PUT",
        signed,
        {"cache-control": "max-age=0, stale-while-revalidate=60"},
        body,
    )
    if put_status not in (200, 201):
        raise PublishError(f"upload for {key} failed ({put_status})")


def _list_keys(exchange, api_base: str, site_id: str, token: str) -> list[str]:
    keys: list[str] = []
    extra: dict[str, str] = {}
    while True:
        status, raw = exchange(
            "GET",
            _api_url(api_base, site_id, extra=extra or None),
            {"Authorization": f"Bearer {token}"},
            None,
        )
        if status == 404:
            return keys
        if status != 200:
            raise PublishError(f"could not list stored files ({status})")
        try:
            page = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as err:
            raise PublishError("could not read the stored-file list") from err
        for item in page.get("blobs") or []:
            key = item.get("key") if isinstance(item, dict) else None
            if not key:
                continue
            prefix = API_STORE + "/"
            if key.startswith(prefix):
                key = key[len(prefix):]
            keys.append(key)
        cursor = page.get("next_cursor")
        if not cursor:
            return keys
        extra = {"cursor": cursor}


def _delete_key(exchange, api_base: str, site_id: str, token: str, key: str) -> None:
    status, _ = exchange(
        "DELETE",
        _api_url(api_base, site_id, key),
        {"Authorization": f"Bearer {token}"},
        None,
    )
    if status not in (200, 204, 404):
        raise PublishError(f"could not remove old file {key} ({status})")


def publish(directory: Path, *, site_id: str, token: str, exchange=urllib_exchange, api_base: str = API_BASE) -> list[str]:
    if not site_id or not token:
        raise PublishError("Set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN.")
    files = collect_files(directory)
    order = [k for k in files if k != "index.html"] + ["index.html"]
    for key in order:
        _signed_put(exchange, api_base, site_id, token, key, files[key])
    keep = set(files)
    for old in _list_keys(exchange, api_base, site_id, token):
        if old not in keep:
            _delete_key(exchange, api_base, site_id, token, old)
    return order


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python3 scripts/publish-dashboard.py FOLDER")
    uploaded = publish(
        Path(sys.argv[1]),
        site_id=os.environ.get("NETLIFY_SITE_ID", "").strip(),
        token=os.environ.get("NETLIFY_AUTH_TOKEN", "").strip(),
    )
    print(f"uploaded {len(uploaded)} files to {STORE_NAME}")


if __name__ == "__main__":
    main()
