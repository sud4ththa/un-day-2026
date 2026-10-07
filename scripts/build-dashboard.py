#!/usr/bin/env python3
"""Build the UN Day 2026 stall dashboard: AGGREGATES ONLY.

Inputs (all outside the repo, never committed):
  <data-dir>/<slug>.csv or <slug>.json   the stall's Google Form responses,
                                         pulled from its response Sheet
  click counts                           JSON from the click logger's /exec URL
                                         (read from tracker.txt), or --clicks FILE

Outputs:
  <out>/data.json      counts only
  <out>/index.html     counts page. Download all stalls is counts only.
                       Each stall also has a Download this stall link.
  <out>/report-pdf.js  browser script copied from scripts/dashboard-pdf.js.
                       It reads the rendered page only (no names, phones, or emails).
  <out>/sheets/*.pdf   one PDF per stall, written only into this folder.
                       Page 1 is targets or money totals, with no names.
                       Page 2 is parent, child, class, item or amount, notes, phone.
                       The dashboard path is already unlisted. These contacts are
                       not copied to the marketing site, the email preview, or go/.
  --private FILE     optional local Markdown list for the PTC (names, classes,
                     items, notes, phones). Never write it inside the repo.

data.json and index.html never contain parent names, phone numbers, emails,
children's names or free-text notes. A check refuses to write them if any of
those values would show on the counts page. The stall PDFs are the exception,
and only inside this folder.

"Last updated" is the time the published figures last changed, so re-running
with the same data leaves data.json byte-for-byte unchanged.

Usage:
  python3 scripts/build-dashboard.py --data-dir DIR --out FOLDER [--private FILE]
         [--clicks FILE] [--update-menus] [--now ISO]
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import importlib.util
import io
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "scripts" / "dashboard-stalls.json"
COLOMBO = timezone(timedelta(hours=5, minutes=30), "Asia/Colombo")
EVENT = "Friday 16 October 2026"
LEADS_DUE = "Tuesday 6 October"
FORMS_OPENED = datetime(2026, 10, 1, tzinfo=COLOMBO)
MONEY = "Monetary contribution"
CONTRIB_KEYS = ["Food", MONEY, "Both", "Not given"]


sys.dont_write_bytecode = True


def load_gen_go():
    spec = importlib.util.spec_from_file_location("gen_go", ROOT / "scripts" / "gen-go.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["gen_go"] = mod
    spec.loader.exec_module(mod)
    return mod


GEN = load_gen_go()


def load_stall_sheet():
    spec = importlib.util.spec_from_file_location("stall_sheet", ROOT / "scripts" / "stall_sheet.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["stall_sheet"] = mod
    spec.loader.exec_module(mod)
    return mod


SHEET = load_stall_sheet()


# ---------------------------------------------------------------- inputs

def norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


FIELDS = [
    ("timestamp", lambda h: h.startswith("timestamp")),
    ("parent", lambda h: "parent" in h and "name" in h),
    ("phone", lambda h: any(k in h for k in ("mobile", "whatsapp", "phone"))),
    ("email", lambda h: h.startswith("email")),
    ("child", lambda h: "child" in h and "name" in h),
    ("class", lambda h: "class" in h),
    ("contrib", lambda h: "contribute" in h),
    ("food", lambda h: h.startswith("food you can bring")),
    ("notes", lambda h: "quantity" in h or "notes" in h),
    ("amount", lambda h: "amount" in h or "lkr" in h),
    ("pay_status", lambda h: h == "status" or "payment status" in h),
    ("slip", lambda h: "slip" in h or "receipt" in h or "deposit" in h),
]


def map_headers(headers: list[str]) -> dict[str, int]:
    found: dict[str, int] = {}
    for i, raw in enumerate(headers):
        h = norm(raw).lower()
        for key, test in FIELDS:
            if key not in found and test(h):
                found[key] = i
                break
    return found


def read_rows(path: Path) -> tuple[list[str], list[list[str]]]:
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix == ".json":
        data = json.loads(text)
        if isinstance(data, dict) and "headers" in data:
            return [str(h) for h in data["headers"]], [[str(c) for c in r] for r in data.get("rows", [])]
        if isinstance(data, list):
            headers = list(data[0].keys()) if data else []
            return headers, [[str(r.get(h, "")) for h in headers] for r in data]
        raise SystemExit(f"{path}: unsupported JSON shape")
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return [], []
    return rows[0], [r for r in rows[1:] if any(c.strip() for c in r)]


def parse_time(raw: str, now: datetime) -> datetime | None:
    s = norm(raw)
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.astimezone(COLOMBO) if dt.tzinfo else dt.replace(tzinfo=COLOMBO)
    except ValueError:
        pass
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$", s)
    if not m:
        return None
    a, b, y = int(m[1]), int(m[2]), int(m[3])
    hh, mm, ss = int(m[4] or 0), int(m[5] or 0), int(m[6] or 0)
    cands = []
    for day, month in ((a, b), (b, a)):  # D/M/Y first, then M/D/Y
        try:
            cands.append(datetime(y, month, day, hh, mm, ss, tzinfo=COLOMBO))
        except ValueError:
            pass
    # Responses can only fall between the forms opening and now, which settles 4/10 vs 10/4.
    plausible = [c for c in cands if FORMS_OPENED <= c <= now + timedelta(days=1)]
    return (plausible or cands or [None])[0]


def family_key(r: dict) -> str:
    digits = re.sub(r"\D", "", r.get("phone", ""))
    if len(digits) >= 7:
        return "p:" + digits[-9:]
    if r.get("email"):
        return "e:" + r["email"].lower()
    return "n:" + (r.get("parent", "").lower() or r.get("child", "").lower() or r.get("_row", ""))


def norm_class(raw: str) -> str:
    s = norm(raw)
    if not s:
        return "Not given"
    s = re.sub(r"^(year|yr|grade|class)\s*", "", s, flags=re.I)
    m = re.match(r"^(\d{1,2})\s*[-/]?\s*([A-Za-z])$", s)
    if m:
        return f"Year {int(m[1])}{m[2].upper()}"
    if re.fullmatch(r"\d{1,2}", s):
        return f"Year {int(s)}"
    return " ".join(w if w.isupper() else w.capitalize() for w in s.split(" "))


def class_sort(label: str):
    m = re.match(r"^Year (\d+)(.*)$", label)
    order = {"Playgroup": 0, "Pg": 0, "Nursery": 1, "Reception": 2}
    if m:
        return (1, int(m[1]), m[2])
    first = label.split(" ")[0]
    return (0 if first in order else 2, order.get(first, 9), label)


NEED_RE = re.compile(r"\s*\((\d+(?:\.\d+)?)\s*([A-Za-z]+)?\)\s*$")


def split_need(option: str) -> tuple[str, str | None]:
    """'Kokis (500)' -> ('Kokis', '500'); 'Cake (5 kg)' -> ('Cake', '5 kg').

    The number in brackets at the end of a menu option is the quantity the
    stall needs in total. It is shown beside the tick count, never combined
    with it: a tick is one family pledging, not one piece.
    """
    m = NEED_RE.search(option)
    if not m:
        return option, None
    return option[: m.start()].strip(), m[1] + (f" {m[2]}" if m[2] else "")


def match_items(cell: str, known: list[str]) -> list[str]:
    """Split a checkbox answer into options. Google joins ticks with ", ", and
    an option may itself contain ", " (e.g. "Fish bun, please order from …"),
    so consecutive pieces are joined back whenever they spell a known option."""
    known_l = {norm(k).lower() for k in known}
    parts = [norm(x) for x in norm(cell).split(", ")]
    out, i = [], 0
    while i < len(parts):
        for j in range(len(parts), i, -1):
            joined = ", ".join(parts[i:j])
            if j == i + 1 or joined.lower() in known_l:
                if joined:
                    out.append(joined)
                i = j
                break
    return out


def contrib_type(raw: str) -> str:
    s = norm(raw).lower()
    if "both" in s:
        return "Both"
    if "food" in s:
        return "Food"
    if "money" in s or "monetary" in s:  # the option was renamed from "Money" on 4 Oct
        return MONEY
    return "Not given"


# ---------------------------------------------------------------- clicks

def load_clicks(args) -> tuple[dict | None, str]:
    if args.clicks:
        return json.loads(Path(args.clicks).read_text(encoding="utf-8")), "file"
    tracker = ROOT / "tracker.txt"
    endpoint = GEN.parse_tracker(tracker.read_text(encoding="utf-8")) if tracker.exists() else ""
    if not endpoint:
        return None, "off"
    try:
        req = urllib.request.Request(endpoint + "?t=stats", headers={"User-Agent": "un-day-dashboard"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if not data.get("ok"):
            raise ValueError("tracker did not answer ok")
        return data, "live"
    except Exception as err:  # keep the last published numbers rather than publish zeros
        print(f"warning: click counts unavailable ({err}); keeping the previous figures", file=sys.stderr)
        return None, "unavailable"


# ---------------------------------------------------------------- aggregate

def ingest_responses(path: Path, slug: str, menu: list[str], aliases: dict, has_contrib: bool, money_only: bool, now: datetime):
    """Read one response file. Counts stay in the returned dict; the caller
    decides whether they are published. Contact fields stay out of data.json."""
    headers, rows = read_rows(path)
    col = map_headers(headers)
    fams, classes, unlisted = set(), {}, {}
    counts = {m: 0 for m in menu}
    lookup = {norm(m).lower(): m for m in menu}
    label_of = {}
    for m in menu:
        label, _needed = split_need(m)
        label_of[m] = label
        lookup.setdefault(norm(label).lower(), m)
    for old, new in (aliases or {}).items():
        if new in counts:
            lookup.setdefault(norm(old).lower(), new)
    known = list(menu) + list((aliases or {}).keys())
    contribution = {k: 0 for k in CONTRIB_KEYS} if has_contrib else None
    found_pii: set[str] = set()
    contacts = []
    last = None
    for n, row in enumerate(rows, 1):
        r = {k: norm(row[i]) if i < len(row) else "" for k, i in col.items()}
        r["_row"] = f"{slug}:{n}"
        for k in ("parent", "phone", "email", "child", "notes"):
            if len(r.get(k, "")) >= 3:
                found_pii.add(r[k])
        fams.add(family_key(r))
        cl = norm_class(r.get("class", ""))
        classes[cl] = classes.get(cl, 0) + 1
        if has_contrib:
            ct = contrib_type(r.get("contrib", "")) if "contrib" in col else "Not given"
            contribution[ct] += 1
        else:
            ct = MONEY if money_only else "Food"
        items = match_items(r.get("food", ""), known)
        ticked = set()
        row_unlisted = []
        for it in items:
            m = lookup.get(it.lower())
            if m:
                ticked.add(m)
            else:
                unlisted[it] = unlisted.get(it, 0) + 1
                row_unlisted.append(it)
        for m in ticked:
            counts[m] += 1
        t = parse_time(r.get("timestamp", ""), now)
        if t and (last is None or t > last):
            last = t
        contacts.append({
            "time": t,
            "parent": r.get("parent", ""),
            "child": r.get("child", ""),
            "phone": r.get("phone", ""),
            "class": cl,
            "type": ct,
            "items": items,
            "labels": [label_of[m] for m in menu if m in ticked],
            "unlisted": row_unlisted,
            "notes": r.get("notes", ""),
            "amount": r.get("amount", ""),
            "pay_status": r.get("pay_status", ""),
            "slip": r.get("slip", ""),
        })
    return {
        "responses": len(rows),
        "families": fams,
        "by_class": [{"class": c, "count": classes[c]} for c in sorted(classes, key=class_sort)],
        "menu": [menu_entry(m, counts[m]) for m in menu],
        "unlisted": unlisted,
        "unlisted_ticks": sum(unlisted.values()),
        "last": last,
        "contribution": contribution,
        "contacts": contacts,
        "pii": found_pii,
    }


def menu_entry(option: str, count: int) -> dict:
    label, needed = split_need(option)
    entry = {"item": option, "count": count}
    if needed:
        entry.update(label=label, needed=needed)
    return entry


def build(args, now: datetime):
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    forms = {s.slug: s for s in GEN.parse_stalls((ROOT / "forms.txt").read_text(encoding="utf-8"))}
    clicks, click_mode = load_clicks(args)
    previous = {}
    out_json = Path(args.out) / "data.json"
    if out_json.exists():
        previous = json.loads(out_json.read_text(encoding="utf-8"))
    prev_clicks = {s["slug"]: s.get("clicks") for s in previous.get("stalls", [])}

    stalls, private, pii, sheets = [], [], set(), []
    all_families: set[str] = set()
    for sc in cfg["stalls"]:
        slug = sc["slug"]
        meta = forms.get(slug)
        menu = sc["menu"]
        managed = bool(sc.get("stall_managed"))
        money_only = bool(sc.get("money_only"))
        has_contrib = bool(sc.get("contribution_options"))
        entry = {
            "slug": slug,
            "name": meta.name if meta else slug,
            "year_groups": meta.years if meta else "",
            "status": "stall_managed" if managed else "not_connected",
            "responses": 0,
            "families": 0,
            "by_class": [],
            "contribution": ({k: 0 for k in CONTRIB_KEYS} if has_contrib else None),
            "menu": [menu_entry(m, 0) for m in menu],
            "unlisted_ticks": 0,
            "last_response": None,
            "clicks": None,
            "conversion": None,
        }
        # Stall-managed sheets are read for the per-stall PDF only. Their
        # counts stay off the public page, which still shows clicks.
        src = next((p for p in (Path(args.data_dir) / f"{slug}.csv", Path(args.data_dir) / f"{slug}.json") if p.exists()), None)
        rows_out = []
        unlisted = {}
        got = None
        if src:
            got = ingest_responses(src, slug, menu, sc.get("aliases") or {}, has_contrib, money_only, now)
            pii |= got["pii"]
            rows_out = got["contacts"]
            unlisted = got["unlisted"]
            if not managed:
                all_families |= got["families"]
                entry["status"] = "ok"
                entry.update(
                    responses=got["responses"],
                    families=len(got["families"]),
                    by_class=got["by_class"],
                    menu=got["menu"],
                    # Ticks that match no current menu item (e.g. an option renamed later). Only the
                    # number is published: the text could be free text and stays in the private list.
                    unlisted_ticks=got["unlisted_ticks"],
                    last_response=got["last"].isoformat(timespec="minutes") if got["last"] else None,
                )
                if has_contrib:
                    entry["contribution"] = got["contribution"]
        kind = "money" if money_only or (not menu and any(r.get("amount") for r in rows_out)) else "food"
        sheets.append({
            "slug": slug,
            "name": entry["name"],
            "years": entry["year_groups"],
            "kind": kind,
            "connected": src is not None,
            "managed": managed,
            "responses": got["responses"] if got else None,
            "families": len(got["families"]) if got else None,
            "last_iso": got["last"].isoformat(timespec="minutes") if got and got["last"] else None,
            "contribution": None if managed else entry["contribution"],
            "menu": [{"label": m.get("label") or split_need(m["item"])[0], "needed": m.get("needed")} for m in entry["menu"]],
            "contacts": rows_out,
            "unlisted": unlisted,
            "minimum_note": (meta.note if meta else "") or "",
        })
        if clicks is not None:
            c = (clicks.get("stalls") or {}).get(slug) or {}
            entry["clicks"] = {
                "total": int(c.get("clicks", 0)),
                "unique": int(c.get("unique", 0)),
                "by_src": dict(sorted((c.get("by_src") or {}).items(), key=lambda kv: (-kv[1], kv[0]))),
                "by_device": dict(sorted((c.get("by_device") or {}).items(), key=lambda kv: (-kv[1], kv[0]))),
            }
        elif click_mode == "unavailable":
            entry["clicks"] = prev_clicks.get(slug)
        if entry["clicks"] and entry["clicks"]["unique"] and not managed:
            entry["conversion"] = round(entry["responses"] / entry["clicks"]["unique"], 3)
        stalls.append(entry)
        private.append((entry, rows_out))

    connected = [s for s in stalls if s["status"] == "ok"]
    summary = {
        "stalls": len(stalls),
        "connected": len(connected),
        "stall_managed": sum(1 for s in stalls if s["status"] == "stall_managed"),
        "responses": sum(s["responses"] for s in stalls),
        "families": len(all_families),
        "contribution": {k: sum((s["contribution"] or {}).get(k, 0) for s in stalls) for k in CONTRIB_KEYS},
        "menu_items": sum(len(s["menu"]) for s in stalls),
        "menu_items_unpledged": sum(1 for s in stalls for m in s["menu"] if m["count"] == 0),
        "last_response": max((s["last_response"] for s in stalls if s["last_response"]), default=None),
        "clicks": None,
        "conversion": None,
    }
    with_clicks = [s for s in stalls if s["clicks"]]
    if with_clicks:
        if clicks is not None:
            tot = clicks.get("total") or {}
            total, unique = int(tot.get("clicks", 0)), int(tot.get("unique", 0))
        else:
            prev = (previous.get("summary") or {}).get("clicks") or {}
            total, unique = int(prev.get("total", 0)), int(prev.get("unique", 0))
        stall_unique = sum(s["clicks"]["unique"] for s in with_clicks)
        summary["clicks"] = {"total": sum(s["clicks"]["total"] for s in with_clicks),
                             "unique": stall_unique,
                             "all_links": {"total": total, "unique": unique}}
        # Stall-managed forms have no response count here, so their visitors
        # stay out of the conversion figure.
        conv_unique = sum(s["clicks"]["unique"] for s in with_clicks if s["status"] != "stall_managed")
        if conv_unique:
            summary["conversion"] = round(summary["responses"] / conv_unique, 3)

    payload = {
        "event": {"name": "UN Day 2026", "date": "2026-10-16", "leads_summary": "2026-10-06"},
        "tracking": "on" if with_clicks else "off",
        "summary": summary,
        "stalls": stalls,
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
    if previous.get("data_hash") == digest and previous.get("updated"):
        updated = previous["updated"]
    else:
        updated = now.isoformat(timespec="minutes")
    data = {"updated": updated, "data_hash": digest, **payload}
    return data, private, pii, sheets


# ---------------------------------------------------------------- render

def esc(s) -> str:
    return html.escape(str(s), quote=True)


def fmt_time(iso: str | None) -> str:
    if not iso:
        return "—"
    dt = datetime.fromisoformat(iso).astimezone(COLOMBO)
    return dt.strftime("%a %-d %b, %-I:%M %p").replace("AM", "am").replace("PM", "pm")


def pct(x: float | None) -> str:
    return "—" if x is None else f"{round(x * 100)}%"


def num(n) -> str:
    return "—" if n is None else f"{n:,}"


CSS = """
:root { color-scheme: light; --ink: #111; --mute: #666; --hair: rgba(17,17,17,.14); }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: #fff; color: var(--ink);
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; line-height: 1.45; }
.sans, .kicker, table, .stats, .bars, .meta, footer, .note, .chips, .actions, .pdf-status, .pdf-scope { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 46rem; margin: 0 auto; padding: 2.75rem 1.25rem 2rem; }
.logos { display: flex; align-items: center; justify-content: center; gap: 1.25rem; margin: 0 0 2rem; }
.logos img { display: block; height: 44px; width: auto; }
.logos .rule { width: 1px; height: 32px; background: var(--ink); opacity: .2; }
header.top { text-align: center; margin-bottom: 2.5rem; }
.kicker { font-size: .7rem; font-weight: 500; letter-spacing: .28em; text-transform: uppercase; margin: 0 0 1rem; padding-left: .28em; }
h1 { font-weight: normal; font-size: clamp(2rem, 8vw, 3.1rem); line-height: 1.08; letter-spacing: -.01em; margin: 0 0 1rem; text-wrap: balance; }
.detail { font-style: italic; font-size: 1.08rem; margin: 0; }
.meta { font-size: .78rem; color: var(--mute); margin: 1.1rem 0 0; letter-spacing: .01em; }
h2 { font-weight: normal; font-size: 1.65rem; line-height: 1.15; margin: 0; }
.stall-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem 1rem; }
.stall-head h2 { flex: 1 1 12rem; }
h3 { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: .68rem; font-weight: 600;
  letter-spacing: .2em; text-transform: uppercase; margin: 1.75rem 0 .6rem; }
.sub { font-style: italic; color: #333; margin: .2rem 0 0; }
section { border-top: 1px solid var(--ink); padding: 1.6rem 0 2.2rem; }
table { width: 100%; border-collapse: collapse; font-size: .86rem; font-variant-numeric: tabular-nums; }
th, td { padding: .55rem .35rem; text-align: right; border-bottom: 1px solid var(--hair); vertical-align: baseline; }
th:first-child, td:first-child { text-align: left; padding-left: 0; }
th:last-child, td:last-child { padding-right: 0; }
thead th.wrap { max-width: 9.5rem; line-height: 1.35; }
thead th { font-size: .64rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; border-bottom: 1px solid var(--ink); }
tr.total td { font-weight: 600; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--ink); }
td a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--hair); }
.stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; margin: 1.25rem 0 0; border-top: 1px solid var(--hair); }
.stats div { padding: .7rem 0; border-bottom: 1px solid var(--hair); }
.stats dt { font-size: .62rem; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--mute); }
.stats dd { margin: .15rem 0 0; font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; font-size: 1.45rem; font-variant-numeric: tabular-nums; }
.stats dd.small { font-size: 1rem; padding-top: .3rem; }
.bars { list-style: none; margin: 0; padding: 0; font-size: .86rem; }
.bars li { display: grid; grid-template-columns: minmax(0, 1fr) 2.2rem; grid-template-rows: auto 3px; column-gap: .75rem;
  padding: .45rem 0 .5rem; border-bottom: 1px solid var(--hair); }
.bars .label { overflow-wrap: anywhere; }
.bars .need { font-size: .76rem; color: var(--mute); white-space: nowrap; margin-left: .35rem; }
.bars .n { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.bars .track { grid-column: 1 / -1; margin-top: .35rem; height: 3px; background: rgba(17,17,17,.07); }
.bars .fill { display: block; height: 100%; background: var(--ink); }
.bars li.zero .label, .bars li.zero .n { color: #8a8a8a; }
.bars li.zero .n::after { content: ""; }
.chips { font-size: .84rem; margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: .4rem .5rem; }
.chips li { border: 1px solid var(--hair); padding: .2rem .55rem; border-radius: 999px; font-variant-numeric: tabular-nums; }
.chips li b { font-weight: 600; margin-left: .3rem; }
.note { font-size: .8rem; color: var(--mute); margin: .6rem 0 0; }
.off { font-size: .86rem; margin: 0; padding: .6rem 0; border-top: 1px solid var(--hair); border-bottom: 1px solid var(--hair); color: #333; }
footer { font-size: .7rem; letter-spacing: .04em; color: var(--mute); text-align: center; padding: 0 1.5rem 2rem; }
.actions { display: flex; justify-content: center; margin: 1.35rem 0 0; }
.pdf { appearance: none; -webkit-appearance: none; font: 600 .72rem/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  letter-spacing: .14em; text-transform: uppercase; color: #fff; background: var(--ink); border: 1px solid var(--ink);
  border-radius: 999px; padding: .7rem 1.25rem; min-height: 44px; cursor: pointer; }
a.pdf { display: inline-block; text-align: center; text-decoration: none; }
.pdf:hover { background: #000; }
.pdf:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.pdf:disabled { opacity: .55; cursor: progress; }
.pdf-status { text-align: center; font-size: .78rem; color: var(--mute); margin: .55rem 0 0; }
.pdf-status:empty { display: none; }
.pdf-scope { text-align: center; margin-top: .45rem; }
@media (max-width: 40rem) { .actions { display: block; } .pdf { width: 100%; } }
@media print { .actions, .pdf-status, .pdf-scope, .stall-head .pdf { display: none !important; } a { border: 0; color: inherit; } }
@media (min-width: 40rem) {
  main { padding-top: 3.5rem; }
  .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .logos img { height: 56px; }
  table { font-size: .92rem; }
}
@media (max-width: 26rem) { .hide-xs { display: none; } th, td { padding-left: .2rem; padding-right: .2rem; } }
"""


def stall_open(st: dict, pdf_name: str) -> str:
    href = "sheets/" + pdf_name
    return f"""<section id="{esc(st["slug"])}">
  <div class="stall-head">
    <h2>{GEN.heading(st["name"])}</h2>
    <a class="pdf" href="{esc(href)}" download="{esc(pdf_name)}">Download this stall</a>
  </div>
  <p class="sub">{esc(st["year_groups"])}</p>"""


def render(data: dict, logos: dict, pdf_names: dict[str, str]) -> str:
    s = data["summary"]
    tracking = data["tracking"] == "on"
    rows = []
    for st in data["stalls"]:
        ok = st["status"] == "ok"
        c = st["contribution"]
        fmb = f'{c["Food"]} · {c[MONEY]} · {c["Both"]}' if (ok and c) else ("food only" if ok else "—")
        if st["status"] == "stall_managed":
            fmb = "stall form"
        rows.append(
            f'<tr><td><a href="#{esc(st["slug"])}">{esc(st["name"])}</a></td>'
            f'<td>{num(st["responses"]) if ok else "—"}</td><td>{num(st["families"]) if ok else "—"}</td>'
            f'<td class="hide-xs">{fmb}</td>'
            + (f'<td>{num(st["clicks"]["total"]) if st["clicks"] else "—"}</td><td>{pct(st["conversion"])}</td>' if tracking else "")
            + "</tr>"
        )
    sc = s["contribution"]
    rows.append(
        f'<tr class="total"><td>All stalls</td><td>{num(s["responses"])}</td><td>{num(s["families"])}</td>'
        f'<td class="hide-xs">{sc["Food"]} · {sc[MONEY]} · {sc["Both"]}</td>'
        + (f'<td>{num(s["clicks"]["total"])}</td><td>{pct(s["conversion"])}</td>' if tracking and s["clicks"] else "")
        + "</tr>"
    )
    head = ('<tr><th>Stall</th><th>Responses</th><th>Families</th><th class="hide-xs wrap">Food · Monetary contribution · Both</th>'
            + ("<th>Clicks</th><th>Conv.</th>" if tracking else "") + "</tr>")
    not_conn = sum(1 for st in data["stalls"] if st["status"] == "not_connected")
    summary_notes = [f'{s["menu_items_unpledged"]} of {s["menu_items"]} menu items have no pledge yet.']
    if not_conn:
        summary_notes.append(f'{not_conn} of {s["stalls"]} response sheets not connected yet, shown as “—”.')
    managed = [st["name"] for st in data["stalls"] if st["status"] == "stall_managed"]
    if managed:
        summary_notes.append(f'Stall-managed form{"s" if len(managed) > 1 else ""} ({", ".join(managed)}): '
                             'the stall team keeps its own responses, so only short-link clicks are shown.')
    if not tracking:
        summary_notes.append("Click tracking off.")
    else:
        summary_notes.append('Families are counted once across all stalls. Conversion = responses ÷ unique visitors who tapped the stall’s short link.')

    sections = []
    for st in data["stalls"]:
        ok = st["status"] == "ok"
        mx = max([m["count"] for m in st["menu"]] + [1])
        bars = "".join(
            f'<li class="{"zero" if m["count"] == 0 else ""}"><span class="label">{esc(m.get("label", m["item"]))}'
            + (f' <span class="need">needed {esc(m["needed"])}</span>' if m.get("needed") else "")
            + f'</span><span class="n">{m["count"]}</span><span class="track"><span class="fill" style="width:{round(100 * m["count"] / mx, 1)}%"></span></span></li>'
            for m in st["menu"]
        )
        has_need = any(m.get("needed") for m in st["menu"])
        need_note = ('<p class="note">The number on the right is families pledging the item; “needed” is the '
                     'total quantity the stall needs. A family can send several pieces, so the two are not '
                     'directly comparable.</p>') if has_need else ""
        gaps = sum(1 for m in st["menu"] if m["count"] == 0)
        unlisted = ""
        if st["unlisted_ticks"]:
            unlisted = f'<p class="note">{st["unlisted_ticks"]} other tick(s) not on the current menu.</p>'
        c = st["contribution"]
        stats = [("Responses", num(st["responses"]) if ok else "—", ""), ("Families", num(st["families"]) if ok else "—", "")]
        stats.append(("Last response", fmt_time(st["last_response"]) if ok else "—", "small"))
        if c:
            stats += [(k, num(c[k]) if ok else "—", "") for k in ("Food", MONEY, "Both")]
        else:
            stats.append(("Contribution", "Food only", "small"))
        dl = "".join(f'<div><dt>{a}</dt><dd class="{k}">{b}</dd></div>' for a, b, k in stats)
        if ok:
            classes = ("<ul class=\"chips\">" + "".join(f'<li>{esc(x["class"])}<b>{x["count"]}</b></li>' for x in st["by_class"]) + "</ul>") if st["by_class"] else '<p class="note">No responses yet.</p>'
        else:
            classes = '<p class="note">Response sheet not connected yet.</p>'
        if st["status"] == "stall_managed":
            if st["clicks"]:
                ck = st["clicks"]
                cdl = "".join(f'<div><dt>{a}</dt><dd>{b}</dd></div>' for a, b in
                              [("Clicks", num(ck["total"])), ("Unique visitors", num(ck["unique"]))])
                src = "".join(f'<li>{esc(k)}<b>{v}</b></li>' for k, v in ck["by_src"].items()) or "<li>none yet</li>"
                dev = "".join(f'<li>{esc(k)}<b>{v}</b></li>' for k, v in ck["by_device"].items()) or "<li>none yet</li>"
                clicks_html = (f'<dl class="stats">{cdl}</dl><h3>By source</h3><ul class="chips">{src}</ul>'
                               f'<h3>By device</h3><ul class="chips">{dev}</ul>')
            else:
                clicks_html = '<p class="off">Click tracking off</p>'
            sections.append(f"""
{stall_open(st, pdf_names[st["slug"]])}
  <p class="note">Stall-managed form. The stall team keeps its own responses, so only short-link clicks are shown here. Download this stall for the follow-up sheet when a response file was included in the build.</p>
  <h3>Short-link clicks</h3>
  {clicks_html}
</section>""")
            continue
        if st["clicks"]:
            ck = st["clicks"]
            cstats = [("Clicks", num(ck["total"])), ("Unique visitors", num(ck["unique"])), ("Conversion", pct(st["conversion"]))]
            cdl = "".join(f'<div><dt>{a}</dt><dd>{b}</dd></div>' for a, b in cstats)
            src = "".join(f'<li>{esc(k)}<b>{v}</b></li>' for k, v in ck["by_src"].items()) or "<li>none yet</li>"
            dev = "".join(f'<li>{esc(k)}<b>{v}</b></li>' for k, v in ck["by_device"].items()) or "<li>none yet</li>"
            clicks_html = (f'<dl class="stats">{cdl}</dl><h3>By source</h3><ul class="chips">{src}</ul>'
                           f'<h3>By device</h3><ul class="chips">{dev}</ul>')
        else:
            clicks_html = '<p class="off">Click tracking off</p>'
        sections.append(f"""
{stall_open(st, pdf_names[st["slug"]])}
  <dl class="stats">{dl}</dl>
  <h3>Menu · {gaps} of {len(st["menu"])} with no pledge</h3>
  <ul class="bars">{bars}</ul>{need_note}{unlisted}
  <h3>Responses by class</h3>
  {classes}
  <h3>Short-link clicks</h3>
  {clicks_html}
</section>""")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>UN Day 2026 · Stall responses</title>
<style>{CSS}</style>
</head>
<body>
<main>
  <header class="top">
    <div class="logos">
      <img src="{logos["bsc"][0]}" width="{logos["bsc"][1]}" height="{logos["bsc"][2]}" alt="The British School in Colombo">
      <span class="rule" aria-hidden="true"></span>
      <img src="{logos["pc"][0]}" width="{logos["pc"][1]}" height="{logos["pc"][2]}" alt="BSC Parent Collective">
    </div>
    <p class="kicker">UN Day 2026</p>
    <h1>Stall responses</h1>
    <p class="detail">{EVENT}</p>
    <p class="meta">Last updated {fmt_time(data["updated"])} (Colombo)<br>Leads summarise {LEADS_DUE}</p>
    <div class="actions">
      <button type="button" class="pdf" id="download-pdf">Download all stalls</button>
    </div>
    <p class="note pdf-scope">Counts only. No names or phone numbers.</p>
    <p class="pdf-status" id="pdf-status" role="status"></p>
  </header>
  <section aria-label="All stalls">
    <table>
      <thead>{head}</thead>
      <tbody>{"".join(rows)}</tbody>
    </table>
    {"".join(f'<p class="note">{esc(n)}</p>' for n in summary_notes)}
  </section>
  {"".join(sections)}
  <p class="note sans">Counts only on this page. Each stall PDF adds the contact list for PTC follow-up, and that file stays in this folder.</p>
</main>
<footer>The British School in Colombo · PTC</footer>
<script src="report-pdf.js"></script>
</body>
</html>
"""


# ---------------------------------------------------------------- private list

def md(s: str) -> str:
    return str(s).replace("|", "\\|").replace("\n", " ")


def render_private(data: dict, private: list, now: datetime) -> str:
    out = [f"# UN Day 2026 · stall responses (PRIVATE, PTC only)", "",
           f"Generated {now.strftime('%a %-d %b %Y, %-I:%M %p')} (Colombo). Not for the public site.",
           "The same contacts are in each stall PDF inside the dashboard folder. They are not on the counts page.", ""]
    for entry, rows in private:
        out.append(f"## {entry['name']} ({entry['year_groups']})")
        if not rows and entry["status"] == "stall_managed":
            out += ["", "Stall-managed form: no response file in this build. The stall team keeps its own responses.", ""]
            continue
        if not rows and entry["status"] != "ok":
            out += ["", "Response sheet not connected yet.", ""]
            continue
        if entry["status"] == "stall_managed":
            out += ["", "Included for the stall PDF and this list. The counts page still shows clicks only.", ""]
        gaps = [m["item"] for m in entry["menu"] if m["count"] == 0]
        responses = len(rows) if entry["status"] != "ok" else entry["responses"]
        families = len({family_key({"phone": r.get("phone", ""), "email": "", "parent": r.get("parent", ""), "child": r.get("child", ""), "_row": str(i)}) for i, r in enumerate(rows)}) if entry["status"] != "ok" else entry["families"]
        last = max((r["time"] for r in rows if r.get("time")), default=None)
        last_s = fmt_time(last.isoformat(timespec="minutes")) if last and entry["status"] != "ok" else fmt_time(entry["last_response"])
        out += ["", f"{responses} responses · {families} families · last {last_s}",
                "", "No pledge yet: " + (", ".join(gaps) if gaps else "none"), ""]
        if not rows:
            out += ["No responses yet.", ""]
            continue
        out += ["| # | Time | Parent | Child | Class | Type | Items | Amount | Notes | Phone |",
                "|---|---|---|---|---|---|---|---|---|---|"]
        for i, r in enumerate(sorted(rows, key=lambda r: r["time"] or datetime.min.replace(tzinfo=COLOMBO)), 1):
            t = r["time"].strftime("%-d %b %-I:%M %p") if r["time"] else ""
            out.append(
                f"| {i} | {t} | {md(r['parent'])} | {md(r.get('child', ''))} | {md(r['class'])} | {r['type']} | "
                f"{md(', '.join(r['items']))} | {md(r.get('amount', ''))} | {md(r['notes'])} | {md(r.get('phone', ''))} |"
            )
        out.append("")
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------- guard + main

def assert_no_pii(texts: list[str], pii: set[str], safe: str) -> None:
    blob = "\n".join(texts).lower()
    safe = safe.lower()
    leaks = []
    for v in pii:
        pat = r"(?<![\w])" + re.escape(v.lower()) + r"(?![\w])"
        if re.search(pat, blob) and not re.search(pat, safe):
            leaks.append(v)
        digits = re.sub(r"\D", "", v)[-9:]
        if len(digits) >= 7 and re.search(r"[\s-]?".join(digits), blob):
            leaks.append("<phone>")
    if leaks:
        raise SystemExit(f"refusing to write: {len(leaks)} personal value(s) would appear on the public page")


def publish_sheets(folder: Path, files: list[tuple[str, bytes]]) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    keep = set()
    for name, blob in files:
        if "/" in name or "\\" in name or name.startswith("."):
            raise SystemExit(f"bad stall pdf name: {name}")
        (folder / name).write_bytes(blob)
        keep.add(name)
    for old in folder.glob("*.pdf"):
        if old.name not in keep:
            old.unlink()


def update_menus() -> None:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    for sc in cfg["stalls"]:
        if sc.get("stall_managed") or not sc.get("form_id"):
            continue
        url = f"https://docs.google.com/forms/d/e/{sc['form_id']}/viewform"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        page = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
        m = re.search(r"FB_PUBLIC_LOAD_DATA_ = (.*?);</script>", page, re.S)
        if not m:
            print(f"{sc['slug']}: form data not found, menu left as is", file=sys.stderr)
            continue
        items = json.loads(m.group(1))[1][1]
        for it in items:
            title = norm(it[1]).lower()
            opts = [o[0] for o in it[4][0][1]] if it[4] and it[4][0][1] else []
            if title.startswith("food you can bring"):
                sc["menu"] = opts
            elif "contribute" in title:
                sc["contribution_options"] = opts
        print(f"{sc['slug']}: {len(sc['menu'])} menu items")
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--out", required=True, help="dashboard folder inside the repo")
    ap.add_argument("--private", help="local Markdown file for the PTC (keep it outside the repo)")
    ap.add_argument("--clicks", help="click counts JSON instead of asking the tracker")
    ap.add_argument("--update-menus", action="store_true", help="re-read the menus from the live forms first")
    ap.add_argument("--now", help="override the current time (ISO), for tests")
    args = ap.parse_args()

    out = Path(args.out).resolve()
    if out == ROOT / "email-preview" or out == ROOT / "go" or out.parent == ROOT / "go":
        raise SystemExit("stall contacts are not written to the email preview or the public short links")
    if args.private and ROOT in Path(args.private).resolve().parents:
        raise SystemExit("--private must be outside the repo")
    if ROOT not in out.parents:
        print("note: --out is outside the repo", file=sys.stderr)
    if args.update_menus:
        update_menus()
    now = datetime.fromisoformat(args.now).astimezone(COLOMBO) if args.now else datetime.now(COLOMBO)
    data, private, pii, sheets = build(args, now)
    logos = {"bsc": GEN.logo_data(GEN.BSC_LOGO), "pc": GEN.logo_data(GEN.PC_LOGO, ink=True)}
    used_names: set[str] = set()
    pdf_names: dict[str, str] = {}
    for model in sheets:
        fname = SHEET.pdf_filename(model["name"], data["updated"])
        if fname in used_names:
            fname = fname[:-4] + f"-{model['slug']}.pdf"
        used_names.add(fname)
        pdf_names[model["slug"]] = fname
        model["filename"] = fname
        model["as_of"] = fmt_time(data["updated"])
        model["last_response"] = fmt_time(model.get("last_iso")) if model.get("last_iso") else "—"
    page = render(data, logos, pdf_names)
    jtext = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    safe = json.dumps(json.loads(CONFIG.read_text(encoding="utf-8"))) + (ROOT / "forms.txt").read_text(encoding="utf-8") + CSS
    safe += " ".join(x["class"] for st in data["stalls"] for x in st["by_class"])
    # Stall PDFs are intentionally not part of this check. Names and phones
    # stay out of data.json and index.html, including the email preview and go/.
    assert_no_pii([jtext, re.sub(r'src="data:[^"]+"', "", page)], pii, safe)
    blobs = [(model["filename"], SHEET.render_pdf(model)) for model in sheets]

    out.mkdir(parents=True, exist_ok=True)
    pdf_js = (ROOT / "scripts" / "dashboard-pdf.js").read_text(encoding="utf-8")
    if "@" in pdf_js or re.search(r"\d{7,}", pdf_js):
        raise SystemExit("dashboard pdf script looks like it contains contact details")
    old = (out / "data.json").read_text(encoding="utf-8") if (out / "data.json").exists() else None
    (out / "data.json").write_text(jtext, encoding="utf-8")
    (out / "index.html").write_text(page, encoding="utf-8")
    (out / "report-pdf.js").write_text(pdf_js, encoding="utf-8")
    publish_sheets(out / "sheets", blobs)
    if args.private:
        Path(args.private).write_text(render_private(data, private, now), encoding="utf-8")
    s = data["summary"]
    print(f"{'changed' if old != jtext else 'unchanged'}: {s['responses']} responses, {s['families']} families, "
          f"{s['connected']}/{s['stalls']} sheets connected, tracking {data['tracking']}")


if __name__ == "__main__":
    main()
