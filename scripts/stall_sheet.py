"""Two-page stall sheets for the PTC dashboard.

Page 1 is a name-free glance (targets vs pledged, or money totals).
Page 2 is the contact list for follow-up. The counts page never includes it.

The PDF is plain Helvetica, uncompressed, so a rebuild with the same
responses is byte-stable.
"""
from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

PORTRAIT_W, PORTRAIT_H = 595.28, 841.89
LAND_W, LAND_H = 841.89, 595.28
MARGIN_X = 40
TOP = 36
BOTTOM = 52
INK = (0.067, 0.067, 0.067)
MUTE = (0.4, 0.4, 0.4)
ZERO = (0.45, 0.45, 0.45)
HAIR = (0.78, 0.78, 0.78)
MONEY = "Monetary contribution"

REG = [278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 222, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
BOLD = [278, 333, 474, 556, 556, 889, 722, 278, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 278, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584]
WIN = {
    "\u00b7": 0xB7, "\u2013": 0x96, "\u2014": 0x97, "\u2018": 0x91, "\u2019": 0x92,
    "\u201c": 0x93, "\u201d": 0x94, "\u2022": 0x95, "\u2026": 0x85, "\u00a0": 0xA0,
}
SPECIAL = {"\u00b7": 278, "\u2013": 556, "\u2014": 1000, "\u2018": 222, "\u2019": 222, "\u201c": 333, "\u201d": 333, "\u2022": 350, "\u2026": 1000}


def pdf_filename(name: str, updated_iso: str) -> str:
    day = datetime.fromisoformat(updated_iso).strftime("%Y-%m-%d")
    safe = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-") or "Stall"
    return f"UN-Day-Stall-{safe}-{day}.pdf"


def norm_key(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def fmt_num(n: float) -> str:
    if abs(n - round(n)) < 1e-6:
        return str(int(round(n)))
    return f"{n:.2f}".rstrip("0").rstrip(".")


def canon_unit(raw: str | None, default: str | None = None) -> str | None:
    if not raw:
        return default
    u = raw.lower()
    if u in {"pc", "pcs", "piece", "pieces", "no", "nos"}:
        return "pcs"
    if u in {"kg", "kgs"}:
        return "kg"
    if u in {"g", "gram", "grams"}:
        return "g"
    if u in {"pack", "packs"}:
        return "packs"
    return default


def parse_needed(needed: str | None) -> tuple[float | None, str | None]:
    if not needed:
        return None, None
    m = re.match(r"^(\d+(?:\.\d+)?)\s*([A-Za-z]+)?$", needed.strip())
    if not m:
        return None, None
    unit = canon_unit(m.group(2), "pcs")
    return float(m.group(1)), unit


# Thousands commas and a decimal point are part of one number.
# "10,000.00" is Rs 10,000. Deleting every non-digit would make it 1,000,000.
_RUPEE_TOKEN = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?")
_UNIT_AFTER = re.compile(
    r"\s*(?:pcs|pc|pieces?|nos|no|kgs?|grams?|g|packs?|packets?|boxes|box)\b",
    re.I,
)


def _rupees_from_token(whole: str, frac: str | None) -> int | None:
    digits = whole.replace(",", "")
    try:
        num = Decimal(digits if frac is None else f"{digits}.{frac}")
    except Exception:
        return None
    if num <= 0 or num > Decimal("10000000"):
        return None
    return int(num.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


_K_AMOUNT = re.compile(r"(?<![\w.])(?:rs\.?|lkr)?\s*(\d{1,3}(?:\.\d)?)\s*k\b", re.I)


def k_rupees(text: str) -> int | None:
    """Shorthand like 'Rs5k' or '7.5K' in thousands."""
    m = _K_AMOUNT.search(str(text or ""))
    if not m:
        return None
    return _rupees_from_token(str(int(Decimal(m.group(1)) * 1000)), None)


def parse_rupees(raw: str) -> int | None:
    """First rupee amount in an amount cell.

    Commas group thousands and '.' is the decimal point, so '10,000.00',
    '5,000', and '5000' are 10000, 5000, and 5000.
    """
    text = str(raw or "")
    if not text.strip():
        return None
    k = k_rupees(text)
    if k is not None:
        return k
    for match in _RUPEE_TOKEN.finditer(text):
        val = _rupees_from_token(match.group(1), match.group(2))
        if val is not None:
            return val
    return None


def money_from_notes(text: str) -> int | None:
    """A stated amount in free text. Piece and weight notes are not money."""
    raw = str(text or "")
    k = k_rupees(raw)
    if k is not None:
        return k
    for match in _RUPEE_TOKEN.finditer(raw):
        if _UNIT_AFTER.match(raw[match.end():]):
            continue
        whole = match.group(1).replace(",", "")
        if not (3 <= len(whole) <= 6):
            continue
        val = _rupees_from_token(match.group(1), match.group(2))
        if val is not None:
            return val
    return None


def rs(n: int) -> str:
    return f"Rs {n:,}"


QTY_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(kgs?|grams?|g|pcs|pc|pieces?|nos|no|packs?|pack)?\b",
    re.I,
)


def find_qtys(text: str) -> list[tuple[float, str | None]]:
    out = []
    for m in QTY_RE.finditer(text or ""):
        qty = float(m.group(1))
        if qty > 10000:  # a phone number, not a pledge
            continue
        out.append((qty, canon_unit(m.group(2))))
    return out


def mentions(clause: str, label: str) -> bool:
    c = norm_key(clause)
    lab = norm_key(label)
    if not c or not lab:
        return False
    if lab in c:
        return True
    words = lab.split()
    if len(words) >= 2 and f"{words[0]} {words[1]}" in c:
        return True
    if len(words) == 1 and len(words[0]) >= 4 and re.search(rf"\b{re.escape(words[0])}\b", c):
        return True
    return False


def split_clauses(notes: str) -> list[str]:
    text = re.sub(r"(\d),(\d)", r"\1\2", notes or "")
    return [p.strip() for p in re.split(r"\s*(?:;|\band\b|,)\s*", text, flags=re.I) if p.strip()]


def assign_quantities(labels: list[str], notes: str) -> list[tuple[str, float | None, str | None]]:
    """Map a free-text quantity note onto the items that row pledged.

    A single number with no item name counts for every item on the row
    ("25 pieces" of two sweets). "20 from milk toffee and 20 from coconut
    toffee" is split per item. No number means tbc.
    """
    labels = list(labels)
    if not labels:
        return []
    notes = re.sub(r"\s+", " ", notes or "").strip()
    assigned: dict[str, tuple[float, str | None]] = {}
    if notes:
        for clause in split_clauses(notes):
            nums = find_qtys(clause)
            named = [lab for lab in labels if mentions(clause, lab)]
            if named and nums:
                qty, unit = nums[0]
                # A bare number is pieces. The menu says "about 20 pieces";
                # kilograms only count when the note itself says kg or g.
                for lab in named:
                    assigned.setdefault(lab, (qty, unit or "pcs"))
        eachish = re.search(r"\beach\b", notes, re.I)
        nums = find_qtys(notes)
        if nums and (eachish or not assigned):
            qty, unit = nums[0]
            for lab in labels:
                assigned.setdefault(lab, (qty, unit or "pcs"))
    out = []
    for lab in labels:
        if lab in assigned:
            qty, unit = assigned[lab]
            out.append((lab, qty, unit or "pcs"))
        else:
            out.append((lab, None, None))
    return out


def convert(qty: float, unit: str | None, needed_unit: str | None) -> float | None:
    if not needed_unit or not unit:
        return None
    if unit == needed_unit:
        return qty
    if unit == "g" and needed_unit == "kg":
        return qty / 1000
    if unit == "kg" and needed_unit == "g":
        return qty * 1000
    return None


def summarize_targets(menu: list[dict], contacts: list[dict]) -> list[dict]:
    pledges: dict[str, list[tuple[float | None, str | None]]] = {item["label"]: [] for item in menu}
    for row in contacts:
        labels = list(row.get("labels") or [])
        got = assign_quantities(labels, row.get("notes") or "")
        by_label = {lab: (qty, unit) for lab, qty, unit in got}
        for lab in labels:
            if lab not in pledges:
                continue
            pledges[lab].append(by_label.get(lab, (None, None)))
    rows = []
    for item in menu:
        lab = item["label"]
        needed_num, needed_unit = parse_needed(item.get("needed"))
        got = pledges.get(lab) or []
        families = len(got)
        tbc = sum(1 for qty, _unit in got if qty is None)
        sums: dict[str, float] = {}
        for qty, unit in got:
            if qty is None:
                continue
            key = unit or needed_unit or "pcs"
            sums[key] = sums.get(key, 0) + qty
        parts = [(sums[u], u) for u in ("pcs", "packs", "kg", "g") if u in sums]
        for u, q in sums.items():
            if u not in {"pcs", "packs", "kg", "g"}:
                parts.append((q, u))
        if families == 0:
            total, pct, status = "0", ("0%" if needed_num else "—"), "Open"
        else:
            bits = [f"{fmt_num(q)} {u}" for q, u in parts]
            if tbc:
                bits.append(f"{tbc} tbc" if tbc != 1 else "1 tbc")
            total = " + ".join(bits) if bits else "tbc"
            comparable = 0.0
            other = False
            for q, u in parts:
                conv = convert(q, u, needed_unit)
                if conv is None:
                    other = True
                else:
                    comparable += conv
            lower = other or tbc > 0
            if not needed_num:
                pct, status = "—", "Partial"
            elif comparable <= 0 and lower:
                pct, status = "—", "Partial"
            else:
                pct_n = round(100 * comparable / needed_num)
                pct = f">={pct_n}%" if lower else f"{pct_n}%"
                status = "Covered" if comparable >= needed_num else "Partial"
        rows.append({
            "label": lab,
            "needed": item.get("needed") or "—",
            "total": total,
            "pct": pct,
            "status": status,
        })
    return rows


def pay_bucket(status: str) -> str:
    s = re.sub(r"\s+", " ", status or "").strip().lower()
    if not s:
        return "unmarked"
    if "pending" in s:
        return "pending"
    if "received" in s or re.search(r"\bpaid\b", s):
        return "received"
    return "other"


def summarize_money(contacts: list[dict]) -> dict:
    amounts: dict[int, int] = {}
    buckets = {"received": 0, "pending": 0, "unmarked": 0, "other": 0}
    other: dict[str, int] = {}
    slips = {"filled": 0, "uploaded": 0, "written": 0}
    total = 0
    known = 0
    for row in contacts:
        amt = parse_rupees(row.get("amount") or "")
        if amt is not None:
            amounts[amt] = amounts.get(amt, 0) + 1
            total += amt
            known += 1
        bucket = pay_bucket(row.get("pay_status") or "")
        buckets[bucket] += 1
        if bucket == "other":
            label = re.sub(r"\s+", " ", row.get("pay_status") or "").strip()
            other[label] = other.get(label, 0) + 1
        slip = re.sub(r"\s+", " ", row.get("slip") or "").strip()
        if slip:
            slips["filled"] += 1
            if "upload" in slip.lower():
                slips["uploaded"] += 1
            else:
                slips["written"] += 1
    by_amount = [{"amount": rs(n), "children": amounts[n]} for n in sorted(amounts)]
    return {
        "families": len(contacts),
        "known": known,
        "total": total,
        "buckets": buckets,
        "other": other,
        "slips": slips,
        "by_amount": by_amount,
    }


def class_key(label: str):
    m = re.match(r"^Year (\d+)(.*)$", label or "")
    if m:
        return (1, int(m.group(1)), m.group(2))
    order = {"Playgroup": 0, "Nursery": 1, "Reception": 2}
    first = (label or "").split(" ")[0]
    return (0 if first in order else 2, order.get(first, 9), label or "")


def prepare(model: dict) -> dict:
    contacts = list(model.get("contacts") or [])
    contacts.sort(key=lambda r: (class_key(r.get("class") or ""), (r.get("parent") or "").lower(), (r.get("child") or "").lower()))
    model["contacts"] = contacts
    # A snapshot already has page-1 figures from data.json. Recomputing them
    # from the contact rows would let the PDF drift from the public totals.
    if model.get("snapshot"):
        return model
    if model.get("kind") == "money":
        model["money"] = summarize_money(contacts)
    else:
        model["targets"] = summarize_targets(model.get("menu") or [], contacts)
    return model


# ---------------------------------------------------------------- PDF drawing

def fmt(n: float) -> str:
    return f"{n:.2f}".rstrip("0").rstrip(".")


def glyph_width(ch: str, bold: bool) -> int:
    if ch in SPECIAL:
        return SPECIAL[ch]
    code = ord(ch)
    table = BOLD if bold else REG
    if 32 <= code <= 126:
        return table[code - 32]
    return table[31]


def measure(text: str, size: float, font: str) -> float:
    bold = font == "F2"
    return sum(glyph_width(ch, bold) for ch in text) * size / 1000


def pdf_str(s: str) -> str:
    out = ["("]
    for ch in s or "":
        code = WIN.get(ch, ord(ch))
        if code > 255:
            code = 63
        if code in (40, 41, 92):
            out.append("\\" + chr(code))
        elif 32 <= code <= 126:
            out.append(chr(code))
        else:
            out.append(f"\\{code:03o}")
    out.append(")")
    return "".join(out)


def wrap(text: str, size: float, max_w: float, font: str) -> list[str]:
    clean = re.sub(r"\s+", " ", text or "").strip()
    if not clean:
        return []
    limit = max(8, max_w - 0.6)
    lines: list[str] = []
    line = ""

    def chunks(word: str) -> list[str]:
        if measure(word, size, font) <= limit:
            return [word]
        buf, out = "", []
        for ch in word:
            trial = buf + ch
            if buf and measure(trial, size, font) > limit:
                out.append(buf)
                buf = ch
            else:
                buf = trial
        if buf:
            out.append(buf)
        return out or [word]

    for word in clean.split(" "):
        for piece in chunks(word):
            trial = f"{line} {piece}" if line else piece
            if measure(trial, size, font) <= limit:
                line = trial
            else:
                if line:
                    lines.append(line)
                line = piece
    if line:
        lines.append(line)
    return lines


class Doc:
    def __init__(self, running: str):
        self.running = running
        self.pages: list[dict] = []
        self.ops: list[str] = []
        self.w = PORTRAIT_W
        self.h = PORTRAIT_H
        self.y = 0.0
        self.kind = "glance"
        self.blank = True
        self.pad = 7.0
        self.lead = 1.3

    def cmd(self, s: str) -> None:
        self.ops.append(s)
        self.blank = False

    def _store(self) -> None:
        if self.blank and not self.pages:
            return
        self.pages.append({"w": self.w, "h": self.h, "ops": self.ops, "kind": self.kind})
        self.ops = []
        self.blank = True

    def start(self, w: float, h: float, kind: str, continuation: bool = False) -> None:
        if self.pages or not self.blank:
            self._store()
        self.w = w
        self.h = h
        self.kind = kind
        self.y = h - TOP
        if continuation:
            self.text(self.running, MARGIN_X, h - 26, size=8, font="F1", color=MUTE)
            self.hline(MARGIN_X, MARGIN_X + self.content_w, h - 32, HAIR, 0.6)
            self.y = h - 46

    @property
    def content_w(self) -> float:
        return self.w - MARGIN_X * 2

    def ensure(self, h: float) -> None:
        if self.y - h < BOTTOM and self.y < self.h - 80:
            self.start(self.w, self.h, self.kind, continuation=True)

    def gap(self, n: float) -> None:
        if self.y - n >= BOTTOM:
            self.y -= n

    def text(self, s: str, x: float, y: float, size: float, font: str = "F1", color=INK) -> None:
        if not s:
            return
        self.cmd(f"{color[0]} {color[1]} {color[2]} rg")
        self.cmd("BT")
        self.cmd(f"/{font} {fmt(size)} Tf")
        self.cmd(f"1 0 0 1 {fmt(x)} {fmt(y)} Tm")
        self.cmd(pdf_str(s) + " Tj")
        self.cmd("ET")

    def hline(self, x1: float, x2: float, y: float, color=HAIR, width: float = 0.6) -> None:
        self.cmd(f"{color[0]} {color[1]} {color[2]} RG")
        self.cmd(f"{fmt(width)} w")
        self.cmd(f"{fmt(x1)} {fmt(y)} m {fmt(x2)} {fmt(y)} l S")

    def centered(self, s: str, size: float, font: str, color=INK) -> None:
        for line in wrap(s, size, self.content_w, font) or [""]:
            if not line:
                continue
            self.ensure(size * 1.3)
            w = measure(line, size, font)
            self.text(line, MARGIN_X + (self.content_w - w) / 2, self.y - size * 0.78, size=size, font=font, color=color)
            self.y -= size * 1.28

    def section(self, label: str) -> None:
        self.gap(12)
        self.ensure(16)
        self.text(label.upper(), MARGIN_X, self.y - 9, size=8, font="F2", color=MUTE)
        self.y -= 14

    def note(self, s: str, size: float = 8.5, color=MUTE) -> None:
        if not s:
            return
        self.gap(3)
        for line in wrap(s, size, self.content_w, "F1"):
            self.ensure(size + 4)
            self.text(line, MARGIN_X, self.y - size, size=size, font="F1", color=color)
            self.y -= size + 3

    def stats(self, items: list[tuple[str, str]]) -> None:
        if not items:
            return
        self.gap(4)
        cols = 3
        col_w = self.content_w / cols
        self.hline(MARGIN_X, MARGIN_X + self.content_w, self.y, HAIR, 0.6)
        for i in range(0, len(items), cols):
            row = items[i:i + cols]
            self.ensure(36)
            for c, (label, value) in enumerate(row):
                x = MARGIN_X + c * col_w
                self.text(label.upper(), x, self.y - 12, size=7.5, font="F2", color=MUTE)
                self.text(value, x, self.y - 28, size=12, font="F1", color=INK)
            self.y -= 36
            self.hline(MARGIN_X, MARGIN_X + self.content_w, self.y, HAIR, 0.6)
        self.gap(2)

    def row_lines(self, cells: list[str], col_w: list[float], font: str, size: float) -> list[list[str]]:
        wrapped = []
        for i, cell in enumerate(cells):
            lines = wrap(cell, size, max(8, col_w[i] - 6), font)
            wrapped.append(lines or [""])
        return wrapped

    def draw_row(self, cells: list[str], col_w: list[float], font: str, size: float, *, header: bool = False, muted: bool = False, right: set[int] | None = None) -> None:
        right = right or set()
        wrapped = self.row_lines(cells, col_w, font, size)
        line_h = size * self.lead
        n = max(len(lines) for lines in wrapped)
        h = n * line_h + self.pad
        self.ensure(h)
        if header:
            self.hline(MARGIN_X, MARGIN_X + self.content_w, self.y, INK, 0.8)
        top = self.y
        color = MUTE if muted else INK
        x = MARGIN_X
        for c, lines in enumerate(wrapped):
            align_right = c in right
            for li, line in enumerate(lines):
                if not line:
                    continue
                tw = measure(line, size, font)
                tx = x + col_w[c] - 3 - tw if align_right else x + 3
                if tx < x:
                    tx = x
                self.text(line, tx, top - self.pad * 4 / 7 - size * 0.75 - li * line_h, size=size, font=font, color=color)
            x += col_w[c]
        self.y = top - h
        rule = INK if header else HAIR
        self.hline(MARGIN_X, MARGIN_X + self.content_w, self.y, rule, 0.8 if header else 0.4)

    def table(self, headers: list[str], rows: list[list[str]], col_w: list[float], *, size: float = 8.5, right: set[int] | None = None, mute_row=None) -> None:
        head = [h.upper() for h in headers]
        self.draw_row(head, col_w, "F2", 7.5, header=True, right=right)

        def draw_head() -> None:
            self.draw_row(head, col_w, "F2", 7.5, header=True, right=right)

        # The first header is already drawn; continuation pages redraw it.
        drawn_header = True
        for i, cells in enumerate(rows):
            wrapped = self.row_lines(cells, col_w, "F1", size)
            h = max(len(lines) for lines in wrapped) * size * self.lead + self.pad
            if self.y - h < BOTTOM and not (drawn_header and i == 0 and self.y > self.h - 120):
                self.start(self.w, self.h, self.kind, continuation=True)
                draw_head()
            muted = bool(mute_row and mute_row(i))
            self.draw_row(cells, col_w, "F1", size, muted=muted, right=right)
            drawn_header = True

    def close(self, school: str) -> list[dict]:
        self._store()
        total = len(self.pages)
        for i, page in enumerate(self.pages):
            ops = page["ops"]
            w = page["w"]
            content = w - MARGIN_X * 2
            if page["kind"] == "contacts":
                foot = "For PTC follow-up only. Please don't share these details further. Questions? Message Subraja."
            else:
                foot = "No names on this page."
            ops.append(f"{HAIR[0]} {HAIR[1]} {HAIR[2]} RG")
            ops.append("0.6 w")
            ops.append(f"{fmt(MARGIN_X)} 40 m {fmt(MARGIN_X + content)} 40 l S")
            ops.append(f"{MUTE[0]} {MUTE[1]} {MUTE[2]} rg")
            ops.append(f"BT /F1 7.5 Tf 1 0 0 1 {fmt(MARGIN_X)} 28 Tm {pdf_str(foot)} Tj ET")
            label = f"Page {i + 1} of {total}"
            lw = measure(label, 8, "F1")
            ops.append(f"BT /F1 8 Tf 1 0 0 1 {fmt(MARGIN_X + content - lw)} 16 Tm {pdf_str(label)} Tj ET")
            sw = measure(school, 8, "F1")
            ops.append(f"BT /F1 8 Tf 1 0 0 1 {fmt(MARGIN_X + (content - sw) / 2)} 16 Tm {pdf_str(school)} Tj ET")
        return self.pages


def encode_pdf(pages: list[dict], title: str) -> bytes:
    parts: list[bytes] = []
    offsets = [0]

    def add(b: bytes) -> None:
        parts.append(b)

    def obj(body: bytes) -> None:
        offsets.append(sum(len(p) for p in parts))
        n = len(offsets) - 1
        add(f"{n} 0 obj\n".encode())
        add(body)
        add(b"\nendobj\n")

    add(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    n = len(pages)
    kids = " ".join(f"{7 + i * 2} 0 R" for i in range(n))
    obj(b"<< /Type /Catalog /Pages 2 0 R /PageLayout /OneColumn >>")
    obj(f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode())
    obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>")
    obj(f"<< /Title {pdf_str(title)} /Producer (UN Day stall dashboard) >>".encode())
    resources = b"<< /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >>"
    for i, page in enumerate(pages):
        page_id = 7 + i * 2
        content_id = page_id + 1
        stream = "\n".join(page["ops"]).encode("latin-1", "replace")
        obj(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {fmt(page['w'])} {fmt(page['h'])}] "
            f"/Contents {content_id} 0 R /Resources {resources.decode()} >>".encode()
        )
        obj(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
    xref_at = sum(len(p) for p in parts)
    size = 7 + n * 2
    add(f"xref\n0 {size}\n".encode())
    add(b"0000000000 65535 f \n")
    for i in range(1, size):
        add(f"{offsets[i]:010d} 00000 n \n".encode())
    add(f"trailer\n<< /Size {size} /Root 1 0 R /Info 6 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode())
    return b"".join(parts)


def _dash(value) -> str:
    if value is None or value == "":
        return "—"
    return str(value)


def _header(doc: Doc, model: dict) -> None:
    doc.centered("UN Day 2026", 9, "F2", MUTE)
    doc.gap(6)
    doc.centered(model["name"], 20, "F1", INK)
    doc.gap(2)
    if model.get("years"):
        doc.centered(model["years"], 11, "F3", INK)
        doc.gap(3)
    doc.centered(f"Updated {model.get('as_of') or '—'}, Colombo", 9, "F1", MUTE)


def _contact_cells(row: dict, kind: str) -> list[str]:
    parent = _dash(row.get("parent"))
    child = _dash(row.get("child"))
    klass = _dash(row.get("class"))
    phone = _dash(row.get("phone"))
    notes = _dash(row.get("notes"))
    amount = parse_rupees(row.get("amount") or "")
    if kind == "money":
        status = " · ".join(x for x in (row.get("pay_status") or "", row.get("notes") or "") if x)
        slip = row.get("slip") or ""
        if slip.startswith("http"):
            slip = "Uploaded"
        return [parent, child, klass, _dash(rs(amount) if amount else ""), _dash(status), _dash(slip), phone]
    labels = list(row.get("labels") or []) + list(row.get("unlisted") or [])
    item = ", ".join(labels)
    if not item:
        item = "Monetary contribution" if row.get("type") in (MONEY, "Both") or amount else "—"
    elif row.get("type") == "Both":
        item = f"{item} · food and money"
    if amount:
        item = f"{item} · {rs(amount)}" if item != "—" else rs(amount)
    return [parent, child, klass, item, notes, phone]


def render_pdf(model: dict) -> bytes:
    model = prepare(model)
    title = f"UN Day 2026 · {model['name']}"
    doc = Doc(title)
    doc.start(PORTRAIT_W, PORTRAIT_H, "glance")
    _header(doc, model)
    if model.get("kind") == "money":
        _money_glance(doc, model)
    else:
        _food_glance(doc, model)
    doc.start(LAND_W, LAND_H, "contacts")
    _contacts(doc, model)
    school = "The British School in Colombo · PTC"
    pages = doc.close(school)
    return encode_pdf(pages, title)


def _food_glance(doc: Doc, model: dict) -> None:
    connected = bool(model.get("connected"))
    doc.section("Details at a glance")
    contrib = model.get("contribution")
    if not connected:
        responses = families = last = "—"
    else:
        responses = str(model.get("responses") or 0)
        families = str(model.get("families") if model.get("families") is not None else 0)
        last = model.get("last_response") or "—"
    if contrib:
        stats = [
            ("Responses", responses), ("Families", families), ("Last response", last),
            ("Food", str(contrib.get("Food", 0)) if connected else "—"),
            ("Money", str(contrib.get(MONEY, 0)) if connected else "—"),
            ("Both", str(contrib.get("Both", 0)) if connected else "—"),
        ]
    else:
        targets = model.get("targets") or []
        pledged = sum(1 for t in targets if t["status"] != "Open")
        covered = sum(1 for t in targets if t["status"] == "Covered")
        still = sum(1 for t in targets if t["status"] == "Open")
        stats = [
            ("Responses", responses), ("Families", families), ("Last response", last),
            ("With a pledge", str(pledged) if connected else "—"),
            ("Still open", str(still) if connected else "—"),
            ("Covered", str(covered) if connected else "—"),
        ]
    doc.stats(stats)
    if model.get("managed") and not connected:
        doc.note("This stall keeps its own responses. No response sheet was included in this build.")
    elif not connected:
        doc.note("Response sheet not connected yet, so the menu below shows as open.")
    doc.section("Targets vs pledged")
    targets = model.get("targets") or []
    if not targets:
        doc.note("No food menu on this stall.")
    else:
        counts = {"Covered": 0, "Partial": 0, "Open": 0}
        for t in targets:
            counts[t["status"]] = counts.get(t["status"], 0) + 1
        doc.note(f"{counts.get('Covered', 0)} covered · {counts.get('Partial', 0)} partial · {counts.get('Open', 0)} open", color=INK)
        width = doc.content_w
        cols = [width - 62 - 118 - 58 - 64, 62, 118, 58, 64]
        doc.table(
            ["Item", "Needed", "Total pledged", "% of target", "Status"],
            [[t["label"], t["needed"], t["total"], t["pct"], t["status"]] for t in targets],
            cols,
            right={1, 2, 3},
            mute_row=lambda i: targets[i]["status"] == "Open",
        )
        doc.note("Needed is the quantity on the menu. Total pledged adds the numbers parents wrote (tbc means no number). % uses the same unit; >= means some pledges could not be added in. Covered means that total meets the target.")
    if connected:
        if model.get("snapshot"):
            n = int(model.get("unlisted_ticks") or 0)
            doc.note(
                f"Other foods offered (not on the menu): {n} tick(s)."
                if n else "Other foods offered (not on the menu): none so far."
            )
        else:
            unlisted = model.get("unlisted") or {}
            if unlisted:
                bits = [f"{name} ({n})" if n > 1 else name for name, n in sorted(unlisted.items())]
                doc.note("Other foods offered (not on the menu): " + "; ".join(bits) + ".")
            else:
                doc.note("Other foods offered (not on the menu): none so far.")
        line = _money_line(model)
        if line:
            doc.note(line, color=INK)


def _money_line(model: dict) -> str:
    published = model.get("money_line")
    if model.get("snapshot") and published is not None:
        return published
    contrib = model.get("contribution") or {}
    money_n = int(contrib.get(MONEY, 0) or 0)
    both = int(contrib.get("Both", 0) or 0)
    amounts = [parse_rupees(c.get("amount") or "") for c in model.get("contacts") or []]
    amounts = [a for a in amounts if a]
    if not money_n and not both and not amounts:
        return ""
    families = money_n + both
    line = f"Money: {families} {'family' if families == 1 else 'families'}"
    if both:
        line += f" ({both} also bringing food)"
    if amounts:
        line += f". Amounts stated add up to {rs(sum(amounts))}."
    else:
        line += ". No amounts stated on the sheet, so no money % is shown."
    return line


def _money_glance(doc: Doc, model: dict) -> None:
    connected = bool(model.get("connected"))
    money = model.get("money") or summarize_money([])
    doc.section("Details at a glance")
    if not connected:
        doc.stats([
            ("Families", "—"), ("Total pledged", "—"), ("Last response", "—"),
            ("Received", "—"), ("Pending", "—"), ("Not marked", "—"),
        ])
        if model.get("managed"):
            doc.note("Money-only stall. This stall keeps its own responses. No response sheet was included in this build.")
        else:
            doc.note("Money-only stall. Response sheet not connected yet.")
        if model.get("minimum_note"):
            doc.note(model["minimum_note"])
        doc.note("No stall total is set, so there is no money target and no %.")
        return
    buckets = money["buckets"]
    total = rs(money["total"]) if money["known"] else "—"
    doc.stats([
        ("Families", str(money["families"])),
        ("Total pledged", total),
        ("Last response", model.get("last_response") or "—"),
        ("Received", str(buckets["received"])),
        ("Pending", str(buckets["pending"])),
        ("Not marked", str(buckets["unmarked"])),
    ])
    doc.note("Money-only stall, no food pledges to list.")
    if model.get("minimum_note"):
        doc.note(model["minimum_note"])
    doc.note("The form asks a minimum per child, not a stall total, so there is no money target and no %. Each child's amount is added. A repeated submission of the same child, class, and amount is counted once.")
    if money["other"]:
        bits = [f"{name} {n}" for name, n in sorted(money["other"].items())]
        doc.note("Other status marks: " + "; ".join(bits) + ".")
    doc.section("Amounts pledged")
    if not money["by_amount"]:
        doc.note("No amounts on the sheet yet.")
    else:
        cols = [doc.content_w * 0.62, doc.content_w * 0.38]
        rows = [[a["amount"], str(a.get("children", a.get("families", 0)))] for a in money["by_amount"]]
        rows.append([f"Total · {total}", str(money.get("known", money["families"]))])
        doc.table(["Amount", "Children"], rows, cols, right={0, 1})
    slips = money["slips"]
    if money["families"]:
        doc.note(
            f"Deposit slip filled for {slips['filled']} of {money['families']} "
            f"({slips['uploaded']} uploaded, {slips['written']} written)."
        )


def _contacts(doc: Doc, model: dict) -> None:
    kind = model.get("kind") or "food"
    doc.centered("Contacts for PTC follow-up", 9, "F2", MUTE)
    doc.gap(4)
    doc.centered(model["name"], 16, "F1", INK)
    doc.gap(2)
    if model.get("years"):
        doc.centered(model["years"], 10, "F3", INK)
        doc.gap(2)
    contacts = model.get("contacts") or []
    if kind == "money" and model.get("connected"):
        money = model.get("money") or {}
        total = rs(money["total"]) if money.get("known") else "no amounts"
        fam = money.get("families", len(contacts))
        sub = f"{fam} {'family' if fam == 1 else 'families'} · {total} pledged · money-only · as of {model.get('as_of') or '—'}"
    elif model.get("connected"):
        sub = f"{len(contacts)} {'response' if len(contacts) == 1 else 'responses'} · as of {model.get('as_of') or '—'}"
    else:
        sub = "No response sheet in this build"
    doc.centered(sub, 9, "F1", MUTE)
    doc.gap(8)
    if not contacts:
        if model.get("managed"):
            doc.note("No contact rows in this build. The stall team keeps its own sheet until that file is included in the dashboard build.", color=INK)
        elif not model.get("connected"):
            doc.note("No contact rows in this build. The response sheet is not connected yet.", color=INK)
        else:
            doc.note("No responses yet.", color=INK)
        return
    if kind == "money":
        headers = ["Parent", "Child", "Class", "Amount", "Status", "Slip / receipt", "Phone"]
        width = doc.content_w
        cols = [118, 110, 52, 68, 120, width - 118 - 110 - 52 - 68 - 120 - 92, 92]
    else:
        headers = ["Parent", "Child", "Class", "Item(s) / amount", "Notes", "Phone"]
        width = doc.content_w
        cols = [110, 110, 78, 160, width - 110 - 110 - 78 - 160 - 96, 96]
    rows = [_contact_cells(r, kind) for r in contacts]
    # Keep the contacts on one landscape page: shrink type and row padding step by step.
    size = 8
    head = [h.upper() for h in headers]
    for size, pad, lead in [(8, 7, 1.3), (7.5, 5, 1.2), (7, 4, 1.15), (6.5, 3.5, 1.12), (6, 3, 1.1)]:
        doc.pad, doc.lead = pad, lead
        need = max(len(x) for x in doc.row_lines(head, cols, "F2", 7.5)) * 7.5 * lead + pad
        need += sum(max(len(x) for x in doc.row_lines(r, cols, "F1", size)) * size * lead + pad for r in rows)
        if doc.y - need >= BOTTOM:
            break
    doc.table(headers, rows, cols, size=size)
    doc.pad, doc.lead = 7.0, 1.3


def _self_test() -> None:
    assert money_from_notes("Transferred Rs5k to Natasha") == 5000
    assert parse_rupees("7.5K") == 7500 and parse_rupees("Rs 5,000") == 5000
    assert money_from_notes("1kg") is None and money_from_notes("500g pack") is None
    # "10,000.00" is ten thousand. Stripping every non-digit yields a million.
    assert parse_rupees("10,000.00") == 10000
    assert parse_rupees("5,000") == 5000
    assert parse_rupees("5000") == 5000
    assert parse_rupees("Rs 10,000.00") == 10000
    assert int(re.sub(r"\D", "", "10,000.00")) == 1_000_000
    assert parse_rupees("10,000.00") != int(re.sub(r"\D", "", "10,000.00"))
    assert money_from_notes("10,000.00") == 10000
    assert money_from_notes("LKR 5,000") == 5000
    assert money_from_notes("25 pieces") is None
    assert money_from_notes("1 kg") is None
    menu = [
        {"label": "Milk toffee", "needed": "100"},
        {"label": "Coconut toffee", "needed": "50"},
        {"label": "Cake", "needed": "5 kg"},
        {"label": "Kokis", "needed": "500"},
        {"label": "Asmi", "needed": "150"},
    ]
    food_rows = [
        ("Milk toffee", "20"),
        ("Milk toffee", "40"),
        ("Milk toffee", ""),
        ("Milk toffee", "20"),
        ("Milk toffee", "20"),
        ("Milk toffee", "20"),
        ("Milk toffee", "50"),
        (["Milk toffee", "Coconut toffee"], "25 pieces"),
        (["Milk toffee", "Coconut toffee"], "20 from milk toffee and 20 from coconut toffee"),
        (["Milk toffee", "Coconut toffee"], "Milk toffee 20, coconut toffee 20"),
        ("Coconut toffee", ""),
        ("Cake", "25 pcs"),
        ("Cake", "butter cake 1 kg"),
        (["Kokis", "Cake"], "Quantity of 20 for each item"),
    ]
    # The "20 for each" row also pledges cake and kokis; milk figures above are the eight families
    # plus two more milk rows (the split notes). Recount against the rows actually listed.
    contacts = []
    for i, (labels, notes) in enumerate(food_rows, 1):
        if isinstance(labels, str):
            labels = [labels]
        contacts.append({
            "parent": f"Parent {i}", "child": f"Child {i}", "class": "Playgroup A" if i < 8 else "Reception A",
            "phone": f"07700000{i:02d}", "notes": notes, "labels": labels, "unlisted": [],
            "type": "Food", "amount": "", "pay_status": "", "slip": "",
        })
    targets = {row["label"]: row for row in summarize_targets(menu, contacts)}
    milk = targets["Milk toffee"]
    # 20+40+20+20+20+50+25+20+20 = 235, plus 1 tbc, and the each-item row is kokis/cake not milk.
    # Listed milk rows: 20, 40, tbc, 20, 20, 20, 50, 25 (with coconut), 20 (split), 20 (split) = 9 numbers + 1 tbc.
    # 20+40+20+20+20+50+25+20+20 = 235. Yes.
    if milk["total"] != "235 pcs + 1 tbc" or milk["status"] != "Covered" or milk["pct"] != ">=235%":
        raise SystemExit(f"milk toffee summary wrong: {milk}")
    coconut = targets["Coconut toffee"]
    # 25 + 20 + 20 + tbc = 65
    if coconut["total"] != "65 pcs + 1 tbc" or coconut["status"] != "Covered":
        raise SystemExit(f"coconut summary wrong: {coconut}")
    cake = targets["Cake"]
    # 25 pcs + 1 kg + 20 pcs from the each-item row. Comparable kg = 1 of 5 = 20%, plus pcs.
    if cake["status"] != "Partial" or "1 kg" not in cake["total"] or cake["pct"] != ">=20%":
        raise SystemExit(f"cake summary wrong: {cake}")
    kokis = targets["Kokis"]
    if kokis["total"] != "20 pcs" or kokis["status"] != "Partial" or kokis["pct"] != "4%":
        raise SystemExit(f"kokis summary wrong: {kokis}")
    if targets["Asmi"]["status"] != "Open" or targets["Asmi"]["pct"] != "0%":
        raise SystemExit(f"open item wrong: {targets['Asmi']}")
    both = assign_quantities(["Milk toffee", "Coconut toffee"], "25 pieces")
    if [q for _, q, _ in both] != [25, 25]:
        raise SystemExit(f"shared quantity wrong: {both}")
    money_contacts = [
        {"parent": "Parent M", "child": "Child M", "class": "Year 2A", "phone": "0770000091", "amount": "Rs 5,000", "pay_status": "Received", "slip": "Slip uploaded", "notes": "", "labels": [], "type": MONEY},
        {"parent": "Parent N", "child": "Child N", "class": "Year 2B", "phone": "0770000092", "amount": "3500", "pay_status": "Pending", "slip": "Sent on WhatsApp", "notes": "", "labels": [], "type": MONEY},
        {"parent": "Parent O", "child": "Child O", "class": "Year 2A", "phone": "0770000093", "amount": "Rs 5,000", "pay_status": "", "slip": "", "notes": "", "labels": [], "type": MONEY},
    ]
    money = summarize_money(money_contacts)
    if money["total"] != 13500 or money["buckets"]["received"] != 1 or money["buckets"]["pending"] != 1 or money["buckets"]["unmarked"] != 1:
        raise SystemExit(f"money summary wrong: {money}")
    if money["by_amount"] != [{"amount": "Rs 3,500", "children": 1}, {"amount": "Rs 5,000", "children": 2}]:
        raise SystemExit(f"amount bands wrong: {money['by_amount']}")
    food_pdf = render_pdf({
        "name": "Sri Lanka", "years": "Playgroup & Reception", "kind": "food", "connected": True,
        "managed": False, "as_of": "Wed 7 Oct, 9:15 am", "responses": len(contacts), "families": len(contacts),
        "last_response": "Wed 7 Oct, 8:00 am", "contribution": {"Food": len(contacts), MONEY: 0, "Both": 0, "Not given": 0},
        "menu": menu, "contacts": contacts, "unlisted": {}, "minimum_note": "",
    })
    money_pdf = render_pdf({
        "name": "Australia/NZ/Philippines/Indonesia", "years": "Year 2", "kind": "money", "connected": True,
        "managed": True, "as_of": "Wed 7 Oct, 9:15 am", "responses": 3, "families": 3,
        "last_response": "Wed 7 Oct, 8:00 am", "contribution": None, "menu": [],
        "contacts": money_contacts, "unlisted": {}, "minimum_note": "Minimum asked per child: LKR 3,000–5,000.",
    })
    if not food_pdf.startswith(b"%PDF") or food_pdf.count(b"/Type /Page /Parent") < 2:
        raise SystemExit("food pdf is not two pages")
    if b"Parent 1" not in food_pdf or b"0770000001" not in food_pdf:
        raise SystemExit("food pdf missing a contact row")
    if b"TARGETS VS PLEDGED" not in food_pdf or b"TOTAL PLEDGED" not in food_pdf:
        raise SystemExit("food pdf missing the glance table")
    if not money_pdf.startswith(b"%PDF") or money_pdf.count(b"/Type /Page /Parent") < 2:
        raise SystemExit("money pdf is not two pages")
    if b"Parent M" not in money_pdf or b"Rs 13,500" not in money_pdf or b"0770000091" not in money_pdf:
        raise SystemExit("money pdf missing totals or contacts")
    name = pdf_filename("Australia/NZ/Philippines/Indonesia", "2026-10-07T09:15+05:30")
    if name != "UN-Day-Stall-Australia-NZ-Philippines-Indonesia-2026-10-07.pdf":
        raise SystemExit(f"filename wrong: {name}")


if __name__ == "__main__":
    _self_test()
    print("stall sheet self-test ok")
