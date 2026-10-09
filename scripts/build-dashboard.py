#!/usr/bin/env python3
"""Build the UN Day 2026 stall dashboard: AGGREGATES ONLY.

Inputs (all outside the repo, never committed):
  <data-dir>/<slug>.csv or <slug>.json   the stall's Google Form responses,
                                         pulled from its response Sheet
  click counts                           JSON from the click logger's /exec URL
                                         (read from tracker.txt), or --clicks FILE

Outputs:
  <out>/data.json      counts only: responses, families, family Food/Money/Both,
                       item quantities, and money totals
  <out>/index.html     counts page. Download all stalls is counts only.
                       There is no per-stall download on this page.
  <out>/report-pdf.js  browser script copied from scripts/dashboard-pdf.js.
                       It reads the rendered page only (no names, phones, or emails).
  <out>/og.jpg         1200×630 link-preview image (branding and totals only)
  --private-sheets-dir
                     one two-page PDF per stall. Outside the repo and outside
                     the dashboard folder. Page 1 is the totals in data.json.
                     Page 2 is contacts from the private pledges file.
                     The PDF is refused if that file's hash is not data.json's hash.
                     Nothing under --out may be a PDF.
  --pledges FILE     row-level contacts plus the data.json hash. Outside the
                     repo and outside the dashboard folder. Not committed.
  --overrides FILE   optional fixes keyed by stall and response timestamp.
                     Outside the repo. Not committed.
  --private FILE     optional local Markdown list for the PTC. Never write it
                     inside the repo.

data.json and index.html never contain parent names, phone numbers, emails,
children's names or free-text notes. A check refuses to write them if any of
those values would show on the counts page. Contact PDFs are not written
into the public folder.

"Last updated" is the time the published figures last changed, so re-running
with the same data leaves data.json byte-for-byte unchanged.

The page head includes Open Graph and Twitter tags so a shared link shows a
preview. The preview image is redrawn from the same response and family
totals; unchanged totals keep og.jpg byte-for-byte the same. The image and
the preview text stay counts and event branding only.

Usage:
  python3 scripts/build-dashboard.py --data-dir DIR --out FOLDER
         --private-sheets-dir DIR
         [--pledges FILE] [--overrides FILE] [--private FILE]
         [--clicks FILE] [--update-menus] [--now ISO] [--self-test]
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

from PIL import Image, ImageDraw, ImageFont

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


def load_counts():
    spec = importlib.util.spec_from_file_location("count_pledges", ROOT / "scripts" / "count_pledges.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["count_pledges"] = mod
    spec.loader.exec_module(mod)
    return mod


COUNTS = load_counts()


# ---------------------------------------------------------------- inputs

def norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


FIELDS = [
    ("timestamp", lambda h: h.startswith("timestamp")),
    ("parent", lambda h: "parent" in h and "name" in h),
    ("phone", lambda h: any(k in h for k in ("mobile", "whatsapp", "phone", "contact number"))),
    ("email", lambda h: h.startswith("email")),
    ("child", lambda h: "child" in h and "name" in h),
    ("class_other", lambda h: "class" in h and "other" in h),
    ("class", lambda h: "class" in h),
    ("contrib", lambda h: "contribute" in h),
    ("food", lambda h: h.startswith("food you can bring")),
    ("notes", lambda h: "quantity" in h or "notes" in h or h == "note"),
    ("extra", lambda h: h.startswith("anything else")),
    ("amount", lambda h: is_amount_header(h)),
    ("pay_status", lambda h: h == "status" or "payment status" in h),
    ("slip", lambda h: "slip" in h or "receipt" in h or "deposit" in h),
]


def is_amount_header(h: str) -> bool:
    """Amount columns on the money stalls do not say "amount".

    SEA uses "Contribution Value (Minimum Rs 5,000)". Australia uses
    "Child's Contribution Value (Minimum Rs 3,000-5,000)". Food stalls
    still use "Monetary contribution (optional)".
    """
    if "amount" in h or "lkr" in h or h.startswith("monetary"):
        return True
    if "contribution" in h and "value" in h:
        return True
    return "minimum rs" in h


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


def child_amount_token(child: str, klass: str, amt: int) -> tuple[str, str, int]:
    """One contribution is a child in a class at one amount.

    A second submission of that same child, class, and amount is a duplicate.
    A different child, a different class, or a different amount is added.
    """
    return (norm(child).casefold(), norm(klass).casefold(), amt)


def family_key(r: dict) -> str:
    digits = COUNTS.phone_digits(r.get("phone", ""))
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

def load_overrides(path) -> dict:
    if not path:
        return {}
    file = Path(path)
    if not file.exists():
        raise SystemExit(f"--overrides file not found: {file}")
    data = json.loads(file.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or any(not isinstance(v, dict) for v in data.values()):
        raise SystemExit("--overrides must be an object keyed by stall, then by response timestamp")
    return data


def outside_repo(path: Path) -> None:
    resolved = path.resolve()
    if resolved == ROOT or ROOT in resolved.parents:
        rel = resolved.relative_to(ROOT).as_posix()
        # Local ops files live next to the checkout and are gitignored.
        if rel == "un-day-dashboard" or rel.startswith("un-day-dashboard/"):
            return
        raise SystemExit(f"{path} must be outside the repo")


def outside_out(path: Path, out: Path) -> None:
    resolved = path.resolve()
    if resolved == out or out in resolved.parents:
        raise SystemExit("pledges must be written outside the dashboard folder")


def pdfs_from_snapshot(data: dict, pledges: dict, pdf_names: dict[str, str]) -> list[tuple[str, bytes]]:
    """Page 1 is the public totals. Page 2 is the private contact rows.
    The two files must be the same snapshot."""
    if pledges.get("data_hash") != data.get("data_hash"):
        raise SystemExit("refusing stall PDFs: pledges hash does not match data.json")
    by_slug = {s.get("slug"): s for s in pledges.get("stalls") or []}
    blobs = []
    for st in data["stalls"]:
        priv = by_slug.get(st["slug"]) or {}
        targets = []
        for m in st.get("menu") or []:
            label = m.get("label") or split_need(m["item"])[0]
            if m.get("closed"):
                label = f"{label} (closed)"
            targets.append({
                "label": label,
                "needed": m.get("needed") or "—",
                "total": m.get("pledged") or "0",
                "pct": m.get("pct") or "—",
                "status": m.get("status") or "Open",
            })
        model = {
            "snapshot": True,
            "name": st["name"],
            "years": st.get("year_groups") or "",
            "kind": "money" if st.get("money_only") else "food",
            "connected": st.get("status") == "ok",
            "managed": False,
            "as_of": fmt_time(st.get("data_as_of") or data.get("updated")),
            "responses": st.get("responses"),
            "families": st.get("families"),
            "last_response": fmt_time(st.get("last_response")) if st.get("last_response") else "—",
            "contribution": st.get("contribution"),
            "menu": targets,
            "targets": targets,
            "money": st.get("money"),
            "money_line": st.get("money_line") or "",
            "contacts": list(priv.get("contacts") or []),
            "unlisted_ticks": st.get("unlisted_ticks") or 0,
            "minimum_note": st.get("minimum_note") or "",
        }
        blobs.append((pdf_names[st["slug"]], SHEET.render_pdf(model)))
    return blobs


def row_override(table: dict, slug: str, raw_ts: str, parsed: datetime | None) -> dict:
    stall = table.get(slug) or {}
    if not stall:
        return {}
    wanted = set()
    if raw_ts:
        wanted.add(norm(raw_ts))
    if parsed:
        wanted.add(parsed.isoformat(timespec="minutes"))
        wanted.add(parsed.strftime("%Y-%m-%d %H:%M"))
    for key, fix in stall.items():
        if norm(str(key)) in wanted:
            return fix or {}
    return {}


def coerce_type(raw: str) -> str:
    s = norm(raw)
    if s.lower() in ("money", "monetary", "monetary contribution"):
        return MONEY
    return contrib_type(s) if s else s


def ingest_responses(path: Path, slug: str, menu: list[str], aliases: dict, closed: set[str],
                     has_contrib: bool, money_only: bool, now: datetime, overrides: dict):
    """Read one response file. Public totals are families and quantities.
    Contact fields stay out of data.json; the caller writes them to pledges.json."""
    headers, rows = read_rows(path)
    col = map_headers(headers)
    classes: dict[str, int] = {}
    unlisted: dict[str, int] = {}
    lookup = {norm(m).lower(): m for m in menu}
    label_of = {}
    for m in menu:
        label, _needed = split_need(m)
        label_of[m] = label
        lookup.setdefault(norm(label).lower(), m)
    aliases = COUNTS.filter_aliases(aliases, menu)
    for old, new in aliases.items():
        lookup.setdefault(norm(old).lower(), new)
    known = list(menu) + list(aliases.keys())
    found_pii: set[str] = set()
    contacts = []
    last = None
    fam_types: dict[str, set[str]] = {}
    fam_items: dict[str, dict[str, tuple]] = {}
    fam_parts: dict[str, list[int]] = {}
    fam_seen: dict[str, set[tuple]] = {}
    fam_pay: dict[str, list[str]] = {}
    fam_slip: dict[str, str] = {}
    response_contrib = {k: 0 for k in CONTRIB_KEYS} if (has_contrib or money_only) else None
    extras: dict[str, set[str]] = {}
    for n, row in enumerate(rows, 1):
        r = {k: norm(row[i]) if i < len(row) else "" for k, i in col.items()}
        r["_row"] = f"{slug}:{n}"
        for k in ("parent", "phone", "email", "child", "notes", "extra", "class_other"):
            val = r.get(k, "")
            if len(val) < 3:
                continue
            # A quantity, or a value that is only a rupee amount, is not a name,
            # phone, or email. "15,000" is an amount; "Amana 15,000" is not.
            if k == "notes" and COUNTS.parse_qty(val) is not None:
                continue
            if k in ("notes", "extra") and SHEET.plain_rupees(val) is not None:
                continue
            found_pii.add(val)
        fam = family_key(r)
        t = parse_time(r.get("timestamp", ""), now)
        ov = row_override(overrides, slug, r.get("timestamp", ""), t)
        cl = norm_class(r.get("class", ""))
        if cl in ("Other", "Not given") and r.get("class_other"):
            typed = norm_class(r["class_other"])
            # Only a recognisable class goes on the counts page; anything else stays "Other".
            cl = typed if re.fullmatch(r"(Year \d{1,2}[A-Z]?|Playgroup( [A-Z])?|Nursery( [A-Z])?|Reception( [A-Z])?)", typed) else "Other"
        classes[cl] = classes.get(cl, 0) + 1
        note = r.get("notes", "")
        kn = COUNTS.note_key(note)
        items = match_items(r.get("food", ""), known)
        ticked = []
        row_unlisted = []
        for it in items:
            m = lookup.get(it.lower())
            if m and m not in ticked:
                ticked.append(m)
            elif not m:
                unlisted[it] = unlisted.get(it, 0) + 1
                row_unlisted.append(it)
        if has_contrib:
            ct = contrib_type(r.get("contrib", "")) if "contrib" in col else "Not given"
        else:
            ct = MONEY if money_only else "Food"
        if ct in ("Food", "Both") and not ticked:
            mapped = None
            if ov.get("add_items"):
                mapped = [lookup.get(norm(x).lower(), x) for x in ov["add_items"]]
            else:
                mapped = COUNTS.NOTE_ITEM.get((slug, kn))
            if mapped:
                for m in mapped:
                    if m in lookup.values() and m not in ticked:
                        ticked.append(m)
        for food, _txt in COUNTS.NOTE_OTHER.get((slug, kn), []):
            extras.setdefault(food, set()).add(fam)
        if ct == MONEY and ticked:
            ct = "Both"
        if ov.get("type"):
            ct = coerce_type(ov["type"])
        if response_contrib is not None:
            response_contrib[ct] = response_contrib.get(ct, 0) + 1
        fam_types.setdefault(fam, set()).add(ct)
        chosen = fam_items.setdefault(fam, {})
        for m in ticked:
            base = split_need(m)[0]
            qty = COUNTS.resolve_qty(slug, note, base, ov)
            prev = chosen.get(m)
            if prev is None or (prev[0] is None and qty is not None):
                chosen[m] = (qty,)
        amt = SHEET.parse_rupees(r.get("amount", "")) if r.get("amount") else None
        if amt is None and (money_only or not ticked):
            amt = SHEET.money_from_notes(note)
        if amt is None and (money_only or not ticked) and r.get("extra"):
            amt = SHEET.money_from_notes(r["extra"])
        if "amount" in ov and ov["amount"] is not None:
            amt = int(ov["amount"])
        fam_parts.setdefault(fam, [])
        if amt is not None:
            token = child_amount_token(r.get("child", ""), cl, amt)
            seen = fam_seen.setdefault(fam, set())
            if token not in seen:
                seen.add(token)
                fam_parts[fam].append(amt)
        fam_pay.setdefault(fam, []).append(r.get("pay_status", ""))
        slip = r.get("slip", "")
        if slip and not fam_slip.get(fam):
            fam_slip[fam] = slip
        if t and (last is None or t > last):
            last = t
        contacts.append({
            "time": t.isoformat(timespec="minutes") if t else "",
            "parent": r.get("parent", ""),
            "child": r.get("child", ""),
            "phone": r.get("phone", ""),
            "class": cl,
            "type": ct,
            "items": items,
            "labels": [label_of[m] for m in menu if m in ticked],
            "unlisted": row_unlisted,
            "notes": note + (f" · Anything else: {r['extra']}" if r.get("extra") else ""),
            "amount": r.get("amount", ""),
            "pay_status": r.get("pay_status", ""),
            "slip": slip,
        })
    pledges = {m: [] for m in menu}
    for chosen in fam_items.values():
        for m, (qty,) in chosen.items():
            pledges[m].append(qty)
    menu_rows, headline = COUNTS.summarize_items(menu, closed, pledges, split_need)
    fam_contrib = {k: 0 for k in CONTRIB_KEYS}
    if has_contrib or money_only:
        for types in fam_types.values():
            fam_contrib[COUNTS.family_type(types, MONEY)] += 1
    else:
        fam_contrib = None
    money = family_money(fam_parts, fam_pay, fam_slip, money_only, fam_contrib)
    return {
        "responses": len(rows),
        "families": set(fam_types) or set(),
        "by_class": [{"class": c, "count": classes[c]} for c in sorted(classes, key=class_sort)],
        "menu": menu_rows,
        "headline": headline,
        "unlisted_ticks": sum(unlisted.values()),
        "extras": [{"item": name, "families": len(fams)} for name, fams in extras.items()],
        "last": last,
        "contribution": fam_contrib,
        "contribution_responses": response_contrib,
        "money": money,
        "contacts": contacts,
        "pii": found_pii,
    }


def family_money(parts: dict, pays: dict, slips: dict, money_only: bool, contribution: dict | None) -> dict | None:
    """Add each child's amount. Payment marks and slips stay once per family.

    parts maps a family to the amounts already deduped by child, class, and
    amount. Two children in one family are both included. A repeated
    submission of the same child, class, and amount is not.
    """
    stated_rows: list[int] = []
    stated_fams: set[str] = set()
    for fam, amounts in parts.items():
        if amounts:
            stated_fams.add(fam)
            stated_rows.extend(amounts)
    if not money_only and not stated_rows and not (contribution and (contribution.get(MONEY) or contribution.get("Both"))):
        return None
    buckets = {"received": 0, "pending": 0, "unmarked": 0, "other": 0}
    other: dict[str, int] = {}
    slip_counts = {"filled": 0, "uploaded": 0, "written": 0}
    families = set(parts) | set(pays) | set(slips)
    if money_only:
        pool = families
    else:
        pool = stated_fams
    for fam in pool:
        bucket = COUNTS.best_pay(pays.get(fam) or [""], SHEET.pay_bucket) if money_only else "unmarked"
        if money_only:
            buckets[bucket] = buckets.get(bucket, 0) + 1
            if bucket == "other":
                label = norm(next((s for s in pays.get(fam) or [] if SHEET.pay_bucket(s) == "other"), ""))
                if label:
                    other[label] = other.get(label, 0) + 1
        slip = slips.get(fam) or ""
        if slip:
            slip_counts["filled"] += 1
            if "upload" in slip.lower() or slip.lower().startswith("http"):
                slip_counts["uploaded"] += 1
            else:
                slip_counts["written"] += 1
    bands: dict[int, int] = {}
    for amt in stated_rows:
        bands[amt] = bands.get(amt, 0) + 1
    total = sum(stated_rows)
    both = (contribution or {}).get("Both", 0)
    money_families = (contribution or {}).get(MONEY, 0) + both
    line = ""
    if not money_only:
        if money_families or stated_rows:
            line = f"Money: {money_families} {'family' if money_families == 1 else 'families'}"
            if both:
                line += f" ({both} also bringing food)"
            if stated_rows:
                line += f". Amounts stated add up to {SHEET.rs(total)}."
            else:
                line += ". No amounts stated on the sheet, so no money % is shown."
    return {
        "families": len(pool) if money_only else money_families,
        "both": both,
        "known": len(stated_rows),
        "total": total,
        "buckets": buckets,
        "other": other,
        "slips": slip_counts,
        "by_amount": [{"amount": SHEET.rs(n), "children": bands[n]} for n in sorted(bands)],
        "line": line,
    }


def blank_menu(menu: list[str], closed: set[str]) -> list[dict]:
    rows, _headline = COUNTS.summarize_items(menu, closed, {m: [] for m in menu}, split_need)
    return rows


def build(args, now: datetime):
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    forms = {s.slug: s for s in GEN.parse_stalls((ROOT / "forms.txt").read_text(encoding="utf-8"))}
    clicks, click_mode = load_clicks(args)
    previous = {}
    out_json = Path(args.out) / "data.json"
    if out_json.exists():
        previous = json.loads(out_json.read_text(encoding="utf-8"))
    prev_clicks = {s["slug"]: s.get("clicks") for s in previous.get("stalls", [])}

    overrides = load_overrides(getattr(args, "overrides", None))
    stalls, private, pii, pledge_stalls = [], [], set(), []
    all_families: set[str] = set()
    for sc in cfg["stalls"]:
        slug = sc["slug"]
        meta = forms.get(slug)
        menu = list(sc["menu"])
        closed = set(sc.get("closed") or [])
        money_only = bool(sc.get("money_only"))
        has_contrib = bool(sc.get("contribution_options")) or money_only
        entry = {
            "slug": slug,
            "name": meta.name if meta else slug,
            "year_groups": meta.years if meta else "",
            "minimum_note": (meta.note if meta else "") or "",
            "status": "not_connected",
            "money_only": money_only,
            "responses": 0,
            "families": 0,
            "by_class": [],
            "contribution": ({k: 0 for k in CONTRIB_KEYS} if has_contrib else None),
            "menu": blank_menu(menu, closed),
            "headline_pct": None,
            "unlisted_ticks": 0,
            "extras": [],
            "money": None,
            "money_line": "",
            "last_response": None,
            "clicks": None,
            "conversion": None,
        }
        src = next((p for p in (Path(args.data_dir) / f"{slug}.csv", Path(args.data_dir) / f"{slug}.json") if p.exists()), None)
        rows_out = []
        got = None
        if src:
            got = ingest_responses(
                src, slug, menu, sc.get("aliases") or {}, closed,
                bool(sc.get("contribution_options")), money_only, now, overrides,
            )
            pii |= got["pii"]
            rows_out = got["contacts"]
            all_families |= got["families"]
            entry["status"] = "ok"
            entry.update(
                responses=got["responses"],
                families=len(got["families"]),
                by_class=got["by_class"],
                menu=got["menu"],
                headline_pct=(got["headline"] or {}).get("pcs"),
                unlisted_ticks=got["unlisted_ticks"],
                extras=got["extras"],
                money=got["money"] if money_only else None,
                money_line="" if money_only else ((got["money"] or {}).get("line") or ""),
                last_response=got["last"].isoformat(timespec="minutes") if got["last"] else None,
            )
            if has_contrib:
                entry["contribution"] = got["contribution"]
        pledge_stalls.append({"slug": slug, "contacts": rows_out})
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
        if entry["clicks"] and entry["clicks"]["unique"] and entry["status"] == "ok":
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
        conv_unique = sum(s["clicks"]["unique"] for s in with_clicks if s["status"] == "ok")
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
    pledges = {"data_hash": digest, "stalls": pledge_stalls}
    return data, private, pii, pledges


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


def stall_open(st: dict) -> str:
    return f"""<section id="{esc(st["slug"])}">
  <h2>{GEN.heading(st["name"])}</h2>
  <p class="sub">{esc(st["year_groups"])}</p>"""


OG_FILE = "og.jpg"
OG_W, OG_H = 1200, 630
SHARE_TITLE = "BSC UN Day 2026 · Stall pledges"
SERIF_ITALIC = str(Path(GEN.SERIF).with_name("LiberationSerif-Italic.ttf"))


def totals_line(data: dict) -> str:
    s = data["summary"]
    return f"{num(s['responses'])} responses · {num(s['families'])} families"


def share_description(data: dict) -> str:
    return f"{totals_line(data)}. Friday 16 October 2026."


def published_url(out: Path) -> str | None:
    """Absolute page URL when --out is a folder inside this repo."""
    try:
        rel = out.resolve().relative_to(ROOT.resolve())
    except ValueError:
        return None
    if not rel.parts:
        return None
    return f"{GEN.SITE}/{rel.as_posix()}/"


def og_meta(data: dict, page: str) -> str:
    """Link-preview tags. Counts and event branding only; no contact details."""
    title = SHARE_TITLE
    desc = share_description(data)
    image = f"{page}{OG_FILE}"
    alt = f"{title}. {totals_line(data)}."
    fields = [
        ("name", "description", desc),
        ("property", "og:title", title),
        ("property", "og:description", desc),
        ("property", "og:image", image),
        ("property", "og:image:type", "image/jpeg"),
        ("property", "og:image:width", str(OG_W)),
        ("property", "og:image:height", str(OG_H)),
        ("property", "og:image:alt", alt),
        ("property", "og:url", page),
        ("property", "og:type", "website"),
        ("name", "twitter:card", "summary_large_image"),
        ("name", "twitter:title", title),
        ("name", "twitter:description", desc),
        ("name", "twitter:image", image),
        ("name", "twitter:image:alt", alt),
    ]
    return "\n".join(f'<meta {attr}="{name}" content="{esc(value)}">' for attr, name, value in fields)


def _playfair(size: int, weight: str) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(GEN.PLAYFAIR), size)
    font.set_variation_by_name(weight)
    return font


def _measure(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, tracking: float = 0):
    x = 0.0
    left, top, right, bottom = 10**6, 10**6, -10**6, -10**6
    for i, ch in enumerate(text):
        l, t, r, b = draw.textbbox((x, 0), ch, font=font)
        left, top = min(left, l), min(top, t)
        right, bottom = max(right, r), max(bottom, b)
        x += draw.textlength(ch, font=font)
        if i < len(text) - 1:
            x += tracking
    return left, top, right, bottom


def _draw_line(draw: ImageDraw.ImageDraw, ink_top: float, text: str, font: ImageFont.FreeTypeFont, fill, tracking: float = 0) -> float:
    left, top, right, bottom = _measure(draw, text, font, tracking)
    origin_x = (OG_W - (right - left)) / 2 - left
    origin_y = ink_top - top
    x = origin_x
    for i, ch in enumerate(text):
        draw.text((x, origin_y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font)
        if i < len(text) - 1:
            x += tracking
    return ink_top + (bottom - top)


def write_og_image(path: Path, data: dict) -> None:
    """Plain 1200×630 card: school logos, the event, and the two headline totals."""
    image = Image.new("RGB", (OG_W, OG_H), "white")
    draw = ImageDraw.Draw(image)
    ink = (17, 17, 17)
    draw.rectangle((0, 0, OG_W - 1, 6), fill=ink)
    GEN.paste_logo(image, GEN.BSC_LOGO, (48, 168, 236, 468))
    GEN.paste_logo(image, GEN.PC_LOGO, (964, 186, 1152, 450))

    kicker = ImageFont.truetype(GEN.SANS, 20)
    title = _playfair(80, "SemiBold")
    date = ImageFont.truetype(SERIF_ITALIC, 32)
    stats = ImageFont.truetype(GEN.SANS, 24)
    footer = ImageFont.truetype(GEN.SANS, 18)

    y = 178.0
    y = _draw_line(draw, y, "UN DAY 2026", kicker, ink, tracking=5) + 20
    y = _draw_line(draw, y, "Stall pledges", title, ink) + 14
    y = _draw_line(draw, y, "Friday 16 October", date, ink) + 22
    rule = 64
    draw.rectangle(((OG_W - rule) / 2, y, (OG_W + rule) / 2, y + 1), fill=ink)
    y += 20
    _draw_line(draw, y, totals_line(data), stats, ink)
    _draw_line(draw, 578, "The British School in Colombo · PTC", footer, (68, 68, 68))
    image.save(path, "JPEG", quality=85, optimize=True, subsampling=2)


def fmb_cell(st: dict, ok: bool) -> str:
    if st.get("money_only"):
        money = st.get("money") or {}
        if ok and money.get("known"):
            return SHEET.rs(money["total"])
        return "money" if ok else "—"
    c = st.get("contribution")
    if ok and c:
        return f'{c["Food"]} · {c[MONEY]} · {c["Both"]}'
    return "food only" if ok else "—"


def item_meta(m: dict) -> str:
    bits = []
    if m.get("needed"):
        bits.append(f'needed {m["needed"]}')
    if m.get("status") != "Open" and m.get("pledged"):
        bits.append(str(m["pledged"]))
    if m.get("pct") and m.get("pct") not in ("—", "–"):
        bits.append(str(m["pct"]))
    if m.get("status"):
        bits.append(m["status"])
    if m.get("closed"):
        bits.append("closed")
    return " · ".join(bits)


def bar_width(m: dict, mx: int) -> float:
    found = re.search(r"(\d+)", str(m.get("pct") or ""))
    if m.get("needed") and found and m.get("pct") not in ("—", "–"):
        return min(100, int(found.group(1)))
    return round(100 * m["count"] / mx, 1)


def render(data: dict, logos: dict, page_url: str | None) -> str:
    s = data["summary"]
    tracking = data["tracking"] == "on"
    rows = []
    for st in data["stalls"]:
        ok = st["status"] == "ok"
        fmb = fmb_cell(st, ok)
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
    summary_notes = [
        f'{s["menu_items_unpledged"]} of {s["menu_items"]} menu items have no pledge yet.',
        "Food, money, and both are families, counted once. A family that chose money and also ticked food is counted under both. Money-only stalls show their rupee total in that column.",
    ]
    if not_conn:
        summary_notes.append(f'{not_conn} of {s["stalls"]} response sheets not connected yet, shown as “—”.')
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
            + (f' <span class="need">{esc(item_meta(m))}</span>' if item_meta(m) else "")
            + f'</span><span class="n">{m["count"]}</span><span class="track"><span class="fill" style="width:{bar_width(m, mx)}%"></span></span></li>'
            for m in st["menu"]
        )
        has_need = any(m.get("needed") for m in st["menu"])
        need_note = ('<p class="note">The number on the right is families pledging that item, once each. '
                     'Needed is the menu target. Total pledged adds quantities in the same unit (grams as kilograms). '
                     'A >= mark means some pledges had no comparable number. Covered means that total meets the target. '
                     'Closed items have left the form and are still counted.</p>') if has_need else ""
        if st.get("headline_pct"):
            need_note += f'<p class="note">Piece targets: {esc(st["headline_pct"])} pledged, each item capped at its target. Open items count as zero.</p>'
        gaps = sum(1 for m in st["menu"] if m["count"] == 0)
        unlisted = ""
        if st["unlisted_ticks"]:
            unlisted = f'<p class="note">{st["unlisted_ticks"]} other tick(s) not on the current menu.</p>'
        if st.get("data_as_of"):
            unlisted += f'<p class="note">Figures from a copy of this stall\'s sheet taken {esc(fmt_time(st["data_as_of"]))}.</p>'
        if st.get("money_line"):
            unlisted += f'<p class="note">{esc(st["money_line"])}</p>'
        if st.get("extras"):
            bits = ", ".join(f'{esc(x["item"])} ({x["families"]})' for x in st["extras"])
            unlisted += f'<p class="note">Also offered: {bits}.</p>'
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
        if st.get("money_only"):
            money = st.get("money") or {}
            buckets = money.get("buckets") or {}
            if ok and money.get("known"):
                total_rs = SHEET.rs(money["total"])
            else:
                total_rs = "—" if not ok else SHEET.rs(0)
            mstats = [
                ("Families", num(st["families"]) if ok else "—", ""),
                ("Total pledged", total_rs if ok else "—", ""),
                ("Last response", fmt_time(st["last_response"]) if ok else "—", "small"),
                ("Received", num(buckets.get("received", 0)) if ok else "—", ""),
                ("Pending", num(buckets.get("pending", 0)) if ok else "—", ""),
                ("Not marked", num(buckets.get("unmarked", 0)) if ok else "—", ""),
            ]
            mdl = "".join(f'<div><dt>{a}</dt><dd class="{k}">{b}</dd></div>' for a, b, k in mstats)
            asof_note = (f'<p class="note">Figures from a copy of this stall\'s sheet taken {esc(fmt_time(st["data_as_of"]))}.</p>'
                         if st.get("data_as_of") else "")
            sections.append(f"""
{stall_open(st)}
  <dl class="stats">{mdl}</dl>
  <p class="note">Money-only stall. Families and payment marks are counted once per family. The rupee total adds each child's amount. A repeated submission of the same child, class, and amount is counted once.</p>{asof_note}
  <h3>Responses by class</h3>
  {classes}
  <h3>Short-link clicks</h3>
  {clicks_html}
</section>""")
            continue
        sections.append(f"""
{stall_open(st)}
  <dl class="stats">{dl}</dl>
  <h3>Menu · {gaps} of {len(st["menu"])} with no pledge</h3>
  <ul class="bars">{bars}</ul>{need_note}{unlisted}
  <h3>Responses by class</h3>
  {classes}
  <h3>Short-link clicks</h3>
  {clicks_html}
</section>""")

    meta = (og_meta(data, page_url) + "\n") if page_url else ""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
{meta}<title>{esc(SHARE_TITLE)}</title>
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
  <p class="note sans">Counts only on this page. No names or phone numbers.</p>
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
           "Contact PDFs are written outside the public site. They are not on the counts page.", ""]
    for entry, rows in private:
        out.append(f"## {entry['name']} ({entry['year_groups']})")
        if not rows and entry["status"] != "ok":
            out += ["", "Response sheet not connected yet.", ""]
            continue
        gaps = [m["item"] for m in entry["menu"] if m["count"] == 0]
        responses = entry["responses"] if entry["status"] == "ok" else len(rows)
        families = entry["families"] if entry["status"] == "ok" else len({family_key({"phone": r.get("phone", ""), "email": "", "parent": r.get("parent", ""), "child": r.get("child", ""), "_row": str(i)}) for i, r in enumerate(rows)})
        last_s = fmt_time(entry["last_response"])
        out += ["", f"{responses} responses · {families} families · last {last_s}",
                "", "No pledge yet: " + (", ".join(gaps) if gaps else "none"), ""]
        if not rows:
            out += ["No responses yet.", ""]
            continue
        out += ["| # | Time | Parent | Child | Class | Type | Items | Amount | Notes | Phone |",
                "|---|---|---|---|---|---|---|---|---|---|"]
        for i, r in enumerate(sorted(rows, key=lambda r: r.get("time") or ""), 1):
            raw = r.get("time") or ""
            if raw:
                t = datetime.fromisoformat(raw).strftime("%-d %b %-I:%M %p")
            else:
                t = ""
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


def assert_no_public_pdfs(out: Path) -> None:
    """The public dashboard folder must not contain a PDF."""
    if not out.exists():
        return
    found = [p for p in out.rglob("*") if p.is_file() and p.suffix.lower() == ".pdf"]
    if found:
        raise SystemExit(f"refusing to publish: {len(found)} PDF file(s) under the public dashboard folder")


def sweep_public_pdfs(out: Path) -> None:
    """Drop contact PDFs left in the public folder by an older build."""
    if not out.exists():
        return
    for pdf in list(out.rglob("*")):
        if pdf.is_file() and pdf.suffix.lower() == ".pdf":
            pdf.unlink()
    sheets = out / "sheets"
    if sheets.is_dir() and not any(sheets.iterdir()):
        sheets.rmdir()


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
        if sc.get("money_only") or not sc.get("form_id"):
            continue
        url = f"https://docs.google.com/forms/d/e/{sc['form_id']}/viewform"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            page = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
        except Exception as err:
            print(f"{sc['slug']}: form not read ({err}), menu left as is", file=sys.stderr)
            continue
        m = re.search(r"FB_PUBLIC_LOAD_DATA_ = (.*?);</script>", page, re.S)
        if not m:
            print(f"{sc['slug']}: form data not found, menu left as is", file=sys.stderr)
            continue
        items = json.loads(m.group(1))[1][1]
        live = None
        for it in items:
            title = norm(it[1]).lower()
            opts = [o[0] for o in it[4][0][1]] if it[4] and it[4][0][1] else []
            if title.startswith("food you can bring"):
                live = opts
            elif "contribute" in title:
                sc["contribution_options"] = opts
        if live is not None:
            menu, closed = COUNTS.merge_live_menu(sc.get("menu") or [], sc.get("closed") or [], live)
            sc["menu"] = menu
            if closed:
                sc["closed"] = closed
            elif "closed" in sc:
                del sc["closed"]
            if sc.get("aliases"):
                sc["aliases"] = COUNTS.filter_aliases(sc.get("aliases"), menu)
        closed_n = len(sc.get("closed") or [])
        print(f"{sc['slug']}: {len(sc.get('menu') or [])} menu items, {closed_n} closed")
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _self_test() -> None:
    cols = map_headers(["Timestamp", "Child's class", "If you chose \"Other\", please type your child's class", "Note", "Anything else?"])
    assert cols.get("class") == 1 and cols.get("class_other") == 2 and cols.get("notes") == 3 and cols.get("extra") == 4, cols
    assert COUNTS.phone_digits("0771234567.0") == "0771234567"
    assert COUNTS.phone_digits("0771234567.0") != re.sub(r"\D", "", "0771234567.0")
    same = family_key({"phone": "0771234567.0", "email": "", "parent": "A", "child": ""})
    assert same == family_key({"phone": "0771234567", "email": "", "parent": "B", "child": ""})
    assert SHEET.parse_rupees("10,000.00") == 10000
    assert SHEET.parse_rupees("5,000") == 5000
    assert SHEET.parse_rupees("5000") == 5000
    assert SHEET.parse_rupees("10,000.00") != int(re.sub(r"\D", "", "10,000.00"))
    twelve = ["10,000.00"] * 12
    if sum(SHEET.parse_rupees(x) for x in twelve) != 120_000:
        raise SystemExit("10,000.00 did not add up to Rs 120,000")
    if sum(int(re.sub(r"\D", "", x)) for x in twelve) == 120_000:
        raise SystemExit("stripping non-digits was treated as a rupee amount")
    assert SHEET.money_from_notes("25 pieces") is None
    menu, closed = COUNTS.merge_live_menu(
        ["Kokis (500)", "Milk toffee (100)", "Coconut toffee (50)", "Thala karali (100)",
         "Fish bun, please order from Paan Paan (75)"],
        [],
        ["Kokis (500)"],
    )
    for kept in ("Milk toffee (100)", "Coconut toffee (50)", "Thala karali (100)",
                 "Fish bun, please order from Paan Paan (75)"):
        if kept not in menu or kept not in closed:
            raise SystemExit(f"closed item dropped: {kept}")
    aliases = COUNTS.filter_aliases({
        "Fish bun": "Fish bun, please order from Paan Paan (75)",
        "Gone": "Not a menu item",
    }, menu)
    if "Fish bun" not in aliases or "Gone" in aliases:
        raise SystemExit(f"alias filter wrong: {aliases}")
    joined = match_items("Fish bun, please order from Paan Paan (75), Kokis (500)", menu + list(aliases))
    if joined != ["Fish bun, please order from Paan Paan (75)", "Kokis (500)"]:
        raise SystemExit(f"multi-word option split: {joined}")
    try:
        pdfs_from_snapshot({"data_hash": "aaa", "stalls": []}, {"data_hash": "bbb", "stalls": []}, {})
    except SystemExit as err:
        if "does not match" not in str(err):
            raise
    else:
        raise SystemExit("hash mismatch was accepted")
    sea_headers = ["Timestamp", "Parent name", "Mobile number", "Child's name", "Class",
                   "Contribution Value (Minimum Rs 5,000)", "Status", "Slip / receipt"]
    sea_col = map_headers(sea_headers)
    if sea_col.get("amount") != 5 or sea_col.get("child") != 3 or "contrib" in sea_col:
        raise SystemExit(f"SEA amount heading not recognised: {sea_col}")
    aus_only = map_headers(["Child's Contribution Value (Minimum Rs 3,000-5,000)"])
    if aus_only != {"amount": 0}:
        raise SystemExit(f"Australia amount heading not recognised: {aus_only}")
    now = datetime(2026, 10, 7, 9, 15, tzinfo=COLOMBO)
    folder = Path("/tmp/undash-selftest")
    folder.mkdir(parents=True, exist_ok=True)
    sl_header = ["Timestamp", "Parent name", "Mobile number", "Email", "Child's name", "Class",
                 "How would you like to contribute?", "Food you can bring", "Quantity / notes",
                 "Monetary contribution (optional)", "Status", "Slip / receipt"]
    with (folder / "sri-lanka.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(sl_header)
        writer.writerow(["2/10/2026 9:00:00", "Parent One", "0771234567.0", "a@example.com", "Child One",
                         "Playgroup A", "Food", "Milk toffee (100), Coconut toffee (50)", "25 pieces", "", "", ""])
        writer.writerow(["2/10/2026 9:05:00", "Parent One again", "0771234567", "a@example.com", "Child One",
                         "Playgroup A", "Food", "Milk toffee (100)", "20.0", "", "", ""])
        writer.writerow(["2/10/2026 9:10:00", "Parent Two", "0779999999", "b@example.com", "Child Two",
                         "Reception A", "Monetary contribution", "Kokis (500)", "", "10,000.00", "", ""])
        writer.writerow(["2/10/2026 9:20:00", "Parent Three", "0778888888", "c@example.com", "Child Three",
                         "Reception B", "Monetary contribution", "", "", "", "", ""])
    with (folder / "sea.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(sea_headers)
        writer.writerow(["2/10/2026 8:00:00", "Parent S", "0772000001", "Child S", "Year 3A", "10,000.00", "Received", "https://example.test/slip"])
        writer.writerow(["2/10/2026 8:05:00", "Parent S again", "0772000001.0", "Child S", "Year 3A", "10,000.00", "Pending", ""])
        writer.writerow(["3/10/2026 8:00:00", "Parent T", "0772000002", "Child T", "Year 3B", "5,000", "Pending", ""])
        writer.writerow(["4/10/2026 8:00:00", "Parent U", "0772000003", "Child U", "Year 3A", "5000", "", ""])
        writer.writerow(["4/10/2026 8:10:00", "Parent V", "0772000004", "Child V1", "Year 3A", "5,000", "", ""])
        writer.writerow(["4/10/2026 8:12:00", "Parent V", "0772000004", "Child V2", "Year 3A", "5,000", "", ""])
    with (folder / "australia.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["Timestamp", "Parent name", "WhatsApp number", "Email address", "Child's name", "Class",
                         "Child's Contribution Value (Minimum Rs 3,000-5,000)", "Payment status", "Deposit slip"])
        writer.writerow(["2/10/2026 8:00:00", "Parent A", "0773100001", "a@example.com", "Ann", "Year 2A", "3,000", "Received", "https://example.test/a"])
        writer.writerow(["2/10/2026 8:01:00", "Parent A", "0773100001", "a@example.com", "Ben", "Year 2A", "3,000", "Received", ""])
        writer.writerow(["2/10/2026 8:02:00", "Parent A", "0773100001.0", "a@example.com", "Ann", "Year 2A", "3,000", "Received", ""])
        writer.writerow(["2/10/2026 8:10:00", "Parent B", "0773100002", "b@example.com", "Cat", "Year 2B", "3000", "Pending", "written"])
        writer.writerow(["2/10/2026 8:11:00", "Parent B", "0773100002", "b@example.com", "Dan", "Year 2B", "3000", "Pending", ""])
        writer.writerow(["2/10/2026 8:20:00", "Parent C", "0773100003", "c@example.com", "Eve", "2A", "3,500", "Received", "https://example.test/c"])
        writer.writerow(["2/10/2026 8:21:00", "Parent C", "0773100003", "c@example.com", "Fay", "Year 2C", "3500", "", ""])
        writer.writerow(["2/10/2026 8:30:00", "Parent D", "0773100004", "d@example.com", "Gus", "Year 2A", "5,000", "", ""])
        writer.writerow(["2/10/2026 8:31:00", "Parent D", "0773100004", "d@example.com", "Gus", "Year 2B", "5,000", "", ""])
        writer.writerow(["2/10/2026 8:40:00", "Parent E", "0773100005", "e@example.com", "Hal", "Year 2A", "3,000", "", ""])
        writer.writerow(["2/10/2026 8:41:00", "Parent E", "0773100005", "e@example.com", "Hal", "Year 2A", "4,000", "", ""])
    with (folder / "food-money.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(sl_header)
        writer.writerow(["2/10/2026 9:30:00", "Parent F", "0773200001", "f@example.com", "Child A",
                         "Year 1A", "Monetary contribution", "", "", "2,000", "", ""])
        writer.writerow(["2/10/2026 9:31:00", "Parent F", "0773200001", "f@example.com", "Child B",
                         "Year 1A", "Monetary contribution", "", "", "1,500", "", ""])
        writer.writerow(["2/10/2026 9:32:00", "Parent F", "0773200001", "f@example.com", "Child A",
                         "Year 1A", "Monetary contribution", "", "", "2,000", "", ""])
        writer.writerow(["2/10/2026 9:33:00", "Parent F", "0773200001", "f@example.com", "Child A",
                         "Year 1B", "Monetary contribution", "", "", "2,000", "", ""])
    overrides = {
        "sri-lanka": {
            "2026-10-02T09:20+05:30": {"type": "Both", "amount": 6000},
        }
    }
    ov_path = folder / "overrides.json"
    ov_path.write_text(json.dumps(overrides), encoding="utf-8")
    sl_menu = [
        "Milk toffee (100)", "Coconut toffee (50)", "Kokis (500)",
        "Fish bun, please order from Paan Paan (75)",
    ]
    got = ingest_responses(
        folder / "sri-lanka.csv", "sri-lanka", sl_menu,
        {"Fish bun": "Fish bun, please order from Paan Paan (75)"},
        {"Fish bun, please order from Paan Paan (75)"},
        True, False, now, json.loads(ov_path.read_text(encoding="utf-8")),
    )
    if len(got["families"]) != 3:
        raise SystemExit(f"family key did not collapse .0 phones: {len(got['families'])}")
    by_item = {m["item"]: m for m in got["menu"]}
    milk = by_item["Milk toffee (100)"]
    if milk["count"] != 1 or milk["pledged"] != "25 pcs" or milk["status"] != "Partial":
        raise SystemExit(f"milk counted per response or wrong qty: {milk}")
    coconut = by_item["Coconut toffee (50)"]
    if coconut["count"] != 1 or coconut["pledged"] != "25 pcs":
        raise SystemExit(f"coconut not once per family: {coconut}")
    if got["contribution"]["Both"] != 2 or got["contribution"][MONEY] != 0:
        raise SystemExit(f"money plus food was not Both: {got['contribution']}")
    if not got["money"] or got["money"]["total"] != 16000:
        raise SystemExit(f"amounts were not Rs 10000 plus override 6000: {got['money']}")
    fish = by_item["Fish bun, please order from Paan Paan (75)"]
    if not fish.get("closed") or fish["count"] != 0:
        raise SystemExit(f"closed fish bun missing: {fish}")
    sea = ingest_responses(folder / "sea.csv", "sea", [], {}, set(), False, True, now, {})
    if len(sea["families"]) != 4 or sea["money"]["total"] != 30000 or sea["money"]["known"] != 5:
        raise SystemExit(f"SEA-style amounts wrong: families={len(sea['families'])} money={sea['money']}")
    if sea["money"]["buckets"] != {"received": 1, "pending": 1, "unmarked": 2, "other": 0}:
        raise SystemExit(f"payment buckets not once per family: {sea['money']['buckets']}")
    if sea["money"]["by_amount"] != [{"amount": "Rs 5,000", "children": 4}, {"amount": "Rs 10,000", "children": 1}]:
        raise SystemExit(f"SEA amount bands counted a duplicate or missed a child: {sea['money']['by_amount']}")
    aus = ingest_responses(folder / "australia.csv", "australia", [], {}, set(), False, True, now, {})
    if len(aus["families"]) != 5 or aus["money"]["total"] != 36000:
        raise SystemExit(f"Australia per-child amounts wrong: families={len(aus['families'])} money={aus['money']}")
    if aus["money"]["buckets"] != {"received": 2, "pending": 1, "unmarked": 2, "other": 0}:
        raise SystemExit(f"Australia payment buckets wrong: {aus['money']['buckets']}")
    aus_bands = {row["amount"]: row["children"] for row in aus["money"]["by_amount"]}
    if aus_bands != {"Rs 3,000": 5, "Rs 3,500": 2, "Rs 4,000": 1, "Rs 5,000": 2}:
        raise SystemExit(f"Australia amount bands wrong: {aus['money']['by_amount']}")
    food_money = ingest_responses(folder / "food-money.csv", "food-money", [], {}, set(), True, False, now, {})
    if len(food_money["families"]) != 1 or not food_money["money"] or food_money["money"]["total"] != 5500:
        raise SystemExit(f"food-stall money was not added per child: {food_money['money']}")
    if "Rs 5,500" not in (food_money["money"]["line"] or ""):
        raise SystemExit(f"food-stall money line missing the child sum: {food_money['money']['line']}")
    heading = stall_open({"slug": "sri-lanka", "name": "Sri Lanka", "year_groups": "Playgroup"})
    if "Download this stall" in heading or "sheets/" in heading or "<a " in heading:
        raise SystemExit("stall heading still offers a download")
    guard = Path("/tmp/undash-pdf-guard")
    nested = guard / "sheets"
    nested.mkdir(parents=True, exist_ok=True)
    (nested / "stall.pdf").write_bytes(b"%PDF-1.4")
    try:
        assert_no_public_pdfs(guard)
    except SystemExit as err:
        if "PDF" not in str(err):
            raise
    else:
        raise SystemExit("a PDF under the public folder was accepted")
    sweep_public_pdfs(guard)
    assert_no_public_pdfs(guard)
    if (guard / "sheets").exists():
        raise SystemExit("empty sheets directory was left in the public folder")
    amount_dir = Path("/tmp/undash-amount-note")
    amount_dir.mkdir(parents=True, exist_ok=True)
    for old in amount_dir.glob("*.csv"):
        old.unlink()
    note_header = ["Timestamp", "Parent name", "Mobile number", "Email", "Child's name", "Class",
                   "How would you like to contribute?", "Food you can bring", "Quantity / notes",
                   "Anything else?", "Monetary contribution (optional)", "Status", "Slip / receipt"]
    amount_values = (
        "15,000", "5,000", "Rs 5,000", "Rs. 5,000/-", "LKR 15,000", "15000", "15,000.00", "10k",
    )
    with (amount_dir / "notes.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(note_header)
        for raw in amount_values:
            writer.writerow(["2/10/2026 9:00:00", "Parent One", "0771234567", "b@example.com", "Child One",
                             "Year 1A", "Monetary contribution", "", raw, "", "", "", ""])
            writer.writerow(["2/10/2026 9:01:00", "Parent One", "0771234567", "b@example.com", "Child One",
                             "Year 1A", "Monetary contribution", "", "", raw, "", "", ""])
        writer.writerow(["2/10/2026 9:02:00", "Parent One", "0771234567", "b@example.com", "Child One",
                         "Year 1A", "Monetary contribution", "", "20 pieces", "", "", "", ""])
        writer.writerow(["2/10/2026 9:03:00", "Parent One", "0771234567", "b@example.com", "Child One",
                         "Year 1A", "Monetary contribution", "", "Amana 15,000", "", "", "", ""])
        writer.writerow(["2/10/2026 9:04:00", "Parent One", "", "", "Child One",
                         "Year 1A", "Monetary contribution", "", "+94 77 123 4567", "", "", "", ""])
        writer.writerow(["2/10/2026 9:05:00", "Parent One", "", "", "Child One",
                         "Year 1A", "Monetary contribution", "", "a@example.com", "", "", "", ""])
        writer.writerow(["2/10/2026 9:06:00", "Parent One", "", "", "Child One",
                         "Year 1A", "Monetary contribution", "", "", "0779999999", "", "", ""])
        writer.writerow(["2/10/2026 9:07:00", "Parent One", "", "", "Child One",
                         "Year 1A", "Monetary contribution", "", "", "25 pieces", "", "", ""])
        writer.writerow(["2/10/2026 9:08:00", "Parent One", "", "", "Child One",
                         "Year 1A", "Monetary contribution", "", "", "hello 15,000", "", "", ""])
    checked = ingest_responses(amount_dir / "notes.csv", "japan", [], {}, set(), True, False, now, {})
    for raw in amount_values:
        if raw in checked["pii"]:
            raise SystemExit(f"amount treated as personal data: {raw}")
    if "20 pieces" in checked["pii"]:
        raise SystemExit("a quantity note was treated as personal data")
    for raw in ("Amana 15,000", "+94 77 123 4567", "a@example.com", "0779999999",
                "25 pieces", "hello 15,000", "Parent One", "0771234567", "b@example.com", "Child One"):
        if raw not in checked["pii"]:
            raise SystemExit(f"personal value was not flagged: {raw}")
    with (amount_dir / "japan.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(sl_header)
        writer.writerow(["2/10/2026 9:00:00", "Parent One", "0771234567", "a@example.com", "Child One",
                         "Year 1A", "Monetary contribution", "", "15,000", "", "", ""])
    (amount_dir / "clicks.json").write_text(
        json.dumps({"total": {"clicks": 0, "unique": 0}, "stalls": {}}), encoding="utf-8")
    out_dir = amount_dir / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    built, _private, built_pii, _pledges = build(argparse.Namespace(
        data_dir=str(amount_dir), out=str(out_dir), clicks=str(amount_dir / "clicks.json"), overrides=None,
    ), now)
    japan = next(st for st in built["stalls"] if st["slug"] == "japan")
    if "15,000" not in (japan.get("money_line") or "") or "15,000" in built_pii:
        raise SystemExit(f"fixture amount did not publish cleanly: {japan.get('money_line')!r}")
    for raw in ("Parent One", "0771234567", "a@example.com", "Child One"):
        if raw not in built_pii:
            raise SystemExit(f"fixture contact was not flagged: {raw}")
    logos = {"bsc": GEN.logo_data(GEN.BSC_LOGO), "pc": GEN.logo_data(GEN.PC_LOGO, ink=True)}
    page = render(built, logos, None)
    jtext = json.dumps(built, ensure_ascii=False, indent=2) + "\n"
    safe = json.dumps(json.loads(CONFIG.read_text(encoding="utf-8"))) + (ROOT / "forms.txt").read_text(encoding="utf-8") + CSS
    safe += " ".join(x["class"] for st in built["stalls"] for x in st["by_class"])
    assert_no_pii([jtext, re.sub(r'src="data:[^"]+"', "", page)], built_pii, safe)
    if "15,000" not in jtext:
        raise SystemExit("fixture amount was not on the public page")
    try:
        assert_no_pii([jtext], {"15,000"}, safe)
    except SystemExit as err:
        if "personal value" not in str(err):
            raise
    else:
        raise SystemExit("an amount still listed as personal data was published")
    for blob, val in (
        ("Amana 15,000", "Amana 15,000"),
        ("0771234567", "0771234567"),
        ("+94 77 123 4567", "+94 77 123 4567"),
        ("a@example.com", "a@example.com"),
    ):
        try:
            assert_no_pii([blob], {val}, "")
        except SystemExit as err:
            if "personal value" not in str(err):
                raise
        else:
            raise SystemExit(f"personal value was published: {val}")
    print("dashboard self-test ok")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir")
    ap.add_argument("--out", help="dashboard folder inside the repo")
    ap.add_argument("--private-sheets-dir", help="per-stall contact PDFs, outside the repo and outside --out")
    ap.add_argument("--private", help="local Markdown file for the PTC (keep it outside the repo)")
    ap.add_argument("--pledges", help="private row-level pledges.json, outside the repo and the dashboard folder")
    ap.add_argument("--overrides", help="private stall+timestamp fixes, outside the repo")
    ap.add_argument("--clicks", help="click counts JSON instead of asking the tracker")
    ap.add_argument("--stall-as-of", action="append", default=[], metavar="SLUG=ISO",
                    help="a stall whose sheet is a manual copy, e.g. sea=2026-10-07T19:18+05:30")
    ap.add_argument("--update-menus", action="store_true", help="re-read the menus from the live forms first")
    ap.add_argument("--now", help="override the current time (ISO), for tests")
    ap.add_argument("--self-test", action="store_true", help="run counting checks and exit")
    args = ap.parse_args()
    if args.self_test:
        _self_test()
        return
    if not args.data_dir or not args.out or not args.private_sheets_dir:
        raise SystemExit("--data-dir, --out, and --private-sheets-dir are required")

    out = Path(args.out).resolve()
    sheets_dir = Path(args.private_sheets_dir).resolve()
    if out == ROOT / "email-preview" or out == ROOT / "go" or out.parent == ROOT / "go":
        raise SystemExit("stall contacts are not written to the email preview or the public short links")
    if args.private:
        outside_repo(Path(args.private))
    if args.overrides:
        outside_repo(Path(args.overrides))
    outside_repo(sheets_dir)
    outside_out(sheets_dir, out)
    pledges_path = Path(args.pledges).resolve() if args.pledges else (Path(args.data_dir).resolve() / "pledges.json")
    outside_repo(pledges_path)
    outside_out(pledges_path, out)
    if ROOT not in out.parents:
        print("note: --out is outside the repo", file=sys.stderr)
    if args.update_menus:
        update_menus()
    now = datetime.fromisoformat(args.now).astimezone(COLOMBO) if args.now else datetime.now(COLOMBO)
    data, private, pii, pledges = build(args, now)
    for spec in args.stall_as_of:
        slug, _, iso = spec.partition("=")
        st = next((x for x in data["stalls"] if x["slug"] == slug.strip()), None)
        if st is None or not iso:
            raise SystemExit(f"--stall-as-of: unknown stall or missing time in {spec!r}")
        st["data_as_of"] = datetime.fromisoformat(iso.strip()).astimezone(COLOMBO).isoformat(timespec="minutes")
    if pledges.get("data_hash") != data.get("data_hash"):
        raise SystemExit("refusing to write: pledges hash does not match data.json")
    logos = {"bsc": GEN.logo_data(GEN.BSC_LOGO), "pc": GEN.logo_data(GEN.PC_LOGO, ink=True)}
    used_names: set[str] = set()
    pdf_names: dict[str, str] = {}
    for st in data["stalls"]:
        fname = SHEET.pdf_filename(st["name"], data["updated"])
        if fname in used_names:
            fname = fname[:-4] + f"-{st['slug']}.pdf"
        used_names.add(fname)
        pdf_names[st["slug"]] = fname
    page_url = published_url(out)
    if page_url is None:
        print("note: link-preview tags omitted; --out is outside the repo", file=sys.stderr)
    page = render(data, logos, page_url)
    jtext = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    ptext = json.dumps(pledges, ensure_ascii=False, indent=2) + "\n"
    safe = json.dumps(json.loads(CONFIG.read_text(encoding="utf-8"))) + (ROOT / "forms.txt").read_text(encoding="utf-8") + CSS
    safe += " ".join(x["class"] for st in data["stalls"] for x in st["by_class"])
    # Stall PDFs and pledges.json are intentionally not part of this check.
    assert_no_pii([jtext, re.sub(r'src="data:[^"]+"', "", page)], pii, safe)

    if "Download this stall" in page or "sheets/" in page:
        raise SystemExit("refusing to publish: the counts page still links a stall PDF")
    sweep_public_pdfs(out)
    out.mkdir(parents=True, exist_ok=True)
    pledges_path.parent.mkdir(parents=True, exist_ok=True)
    pdf_js = (ROOT / "scripts" / "dashboard-pdf.js").read_text(encoding="utf-8")
    if "@" in pdf_js or re.search(r"\d{7,}", pdf_js):
        raise SystemExit("dashboard pdf script looks like it contains contact details")
    old = (out / "data.json").read_text(encoding="utf-8") if (out / "data.json").exists() else None
    (out / "data.json").write_text(jtext, encoding="utf-8")
    pledges_path.write_text(ptext, encoding="utf-8")
    # Draw the PDFs from the files just written, and refuse if the hash moved.
    blobs = pdfs_from_snapshot(json.loads((out / "data.json").read_text(encoding="utf-8")),
                               json.loads(pledges_path.read_text(encoding="utf-8")), pdf_names)
    (out / "index.html").write_text(page, encoding="utf-8")
    (out / "report-pdf.js").write_text(pdf_js, encoding="utf-8")
    publish_sheets(sheets_dir, blobs)
    write_og_image(out / OG_FILE, data)
    assert_no_public_pdfs(out)
    if args.private:
        Path(args.private).write_text(render_private(data, private, now), encoding="utf-8")
    s = data["summary"]
    print(f"{'changed' if old != jtext else 'unchanged'}: {s['responses']} responses, {s['families']} families, "
          f"{s['connected']}/{s['stalls']} sheets connected, tracking {data['tracking']}")


if __name__ == "__main__":
    main()
