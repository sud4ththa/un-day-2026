"""Family-level pledge totals for the stall dashboard.

Item counts are once per family. Quantities follow the food-update rules:
the same unit as the menu target (grams converted to kilograms), tbc when a
pledge has no number, a dash when units are mixed, and >= when some pledges
could not be added in. Covered means the comparable total meets the target.
The headline percent caps each item at its target; open items count as zero.

Hand-checked note rewrites are keyed by stall and note text, never by a
parent's name. A private overrides file (stall + response timestamp) can
replace them at build time and is not stored in this repo.
"""
from __future__ import annotations

import re

NOTE_FIX = {
    ("sri-lanka", "25 pieces", "*"): ("25 pcs", (25, "pcs")),
    ("sri-lanka", "milk toffee 20,coconut toffee 20", "Milk toffee"): ("20 pcs", (20, "pcs")),
    ("sri-lanka", "milk toffee 20,coconut toffee 20", "Coconut toffee"): ("20 pcs", (20, "pcs")),
    ("sri-lanka", "20 from milk toffee and 20 from coconut toffee", "Milk toffee"): ("20 pcs", (20, "pcs")),
    ("sri-lanka", "20 from milk toffee and 20 from coconut toffee", "Coconut toffee"): ("20 pcs", (20, "pcs")),
    ("sri-lanka", "20 milk toffee", "*"): ("20 pcs", (20, "pcs")),
    ("sri-lanka", "20pieces", "*"): ("20 pcs", (20, "pcs")),
    ("sri-lanka", "konda kawum - 40 nos", "*"): ("40 pcs", (40, "pcs")),
    ("sri-lanka", "40.0", "*"): ("40 pcs", (40, "pcs")),
    ("sri-lanka", "50.0", "*"): ("50 pcs", (50, "pcs")),
    ("sri-lanka", "20.0", "*"): ("20 pcs", (20, "pcs")),
    ("sri-lanka", "75.0", "*"): ("75 pcs", (75, "pcs")),
    ("sri-lanka", "100.0", "*"): ("100 pcs", (100, "pcs")),
    ("sri-lanka", "fish bun 20 pcs and butter cake 1 kg", "Cake"): ("1 kg butter cake", (1, "kg")),
    ("sri-lanka", "fish bun 20 pcs and butter cake 1 kg", "Fish bun, please order from Paan Paan"): ("20 pcs", (20, "pcs")),
    ("sri-lanka", "quantity of 20 for each item", "*"): ("20 pcs", (20, "pcs")),
    ("india", "50 jalebli", "*"): ("50 pcs", (50, "pcs")),
    ("india", "boondi 500 g each", "*"): ("500 g each", (0.5, "kg")),
    ("india", "boondi. 1kg", "*"): ("1 kg", (1, "kg")),
    ("india", "will send mixture and sweets", "*"): ("mixture (and sweets), qty tbc", None),
    ("india", "as per needed", "*"): ("“as needed”, qty tbc", None),
    ("americas", "80 mini cookies", "*"): ("80 mini cookies", (80, "pcs")),
    ("americas", "how many should i bring ?", "*"): ("qty tbc (asked how many)", None),
    ("europe", "3 packets of washed strawberries", "*"): ("3 packets washed strawberries", (3, "packs")),
    ("europe", "2 strawberry packs", "*"): ("2 packs strawberries", (2, "packs")),
    ("europe", "2 boxes strawberry", "*"): ("2 boxes strawberries", (2, "packs")),
    ("europe", "2 packs", "*"): ("2 packs", (2, "packs")),
    ("europe", "happy to order separately. will dm you", "*"): ("will order it in, qty tbc", None),
    ("europe", "mini pizza-veg-25 nos", "*"): ("25 pcs (veg)", (25, "pcs")),
    ("europe", "brownie (40 pieces)", "*"): ("40 brownies", (40, "pcs")),
    ("china", "non spicy", "*"): ("non-spicy, qty tbc", None),
}
NOTE_ITEM = {
    ("india", "will send mixture and sweets"): ["Murukku or mixture (5 kg)"],
    ("india", "boondi. 1kg"): ["Boondi (5 kg)"],
}
NOTE_OTHER = {
    ("india", "will send mixture and sweets"): [("Sweets (type not given)", "qty tbc; offered with the mixture")],
}
UNIT_WORD = {"pcs": "pcs", "kg": "kg", "packs": "packs"}


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def note_key(s: str) -> str:
    return norm(s).lower()


def phone_digits(raw: str) -> str:
    """Digits of a phone, after dropping an Excel trailing '.0'.

    '0771234567.0' and '0771234567' are the same number. Stripping every
    non-digit first would keep that trailing zero and change the last nine.
    """
    s = re.sub(r"\.0+$", "", norm(raw))
    return re.sub(r"\D", "", s)


def parse_need(need: str | None):
    if not need:
        return None
    m = re.match(r"(\d+(?:\.\d+)?)\s*(kg|g|packs?|pieces|pcs)?", need, re.I)
    if not m:
        return None
    v = float(m.group(1))
    u = (m.group(2) or "").lower()
    if u == "kg":
        return (v, "kg")
    if u == "g":
        return (v / 1000, "kg")
    if u.startswith("pack"):
        return (v, "packs")
    return (v, "pcs")


def parse_qty(note: str):
    """A free-text quantity, or None when it is not a single clear number."""
    n = norm(note)
    if not n or re.search(r"how many|\?", n, re.I):
        return None
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(kg|g)", n, re.I)
    if m:
        v = float(m.group(1))
        return (v if m.group(2).lower() == "kg" else v / 1000, "kg")
    m = re.fullmatch(r"(\d+)\s*(pcs|pieces|piece|nos|no)?\.?", n, re.I)
    if m:
        return (int(m.group(1)), "pcs")
    m = re.fullmatch(r"(\d+)\.0+", n)
    if m:
        return (int(m.group(1)), "pcs")
    m = re.fullmatch(r"(\d+)\s*(packs?|packets?|boxes|box)", n, re.I)
    if m:
        return (int(m.group(1)), "packs")
    return None


def fmt_num(v) -> str:
    if isinstance(v, float):
        return f"{v:g}"
    return f"{v:,}"


def resolve_qty(slug: str, note: str, base: str, override: dict | None):
    """(display is unused publicly, quantity or None). Override wins, then note map, then parse."""
    spec = None
    if override:
        qty = override.get("qty") or {}
        spec = qty.get(base)
        if spec is None:
            spec = qty.get("*")
    if spec is not None:
        if spec.get("value") is None:
            return None
        return (spec["value"], spec["unit"])
    kn = note_key(note)
    fx = NOTE_FIX.get((slug, kn, base)) or NOTE_FIX.get((slug, kn, "*"))
    if fx:
        return fx[1]
    return parse_qty(note)


def family_type(types: set[str], money: str) -> str:
    if "Both" in types or ("Food" in types and money in types):
        return "Both"
    for key in ("Food", money, "Not given"):
        if key in types:
            return key
    return "Not given"


def summarize_items(menu: list[str], closed: set[str], pledges: dict[str, list], split_need) -> tuple[list[dict], dict]:
    """Public menu rows plus the capped headline percent by unit.

    pledges[option] is one entry per family: (qty or None).
    """
    rows = []
    units_tot: dict[str, list] = {}
    for option in menu:
        base, need = split_need(option)
        nq = parse_need(need)
        got = pledges.get(option) or []
        known = [q for q in got if q]
        unk = len(got) - len(known)
        units = {u for _, u in known}
        comp = sum(v for v, u in known if nq and u == nq[1])
        if nq:
            bucket = units_tot.setdefault(nq[1], [0, 0])
            bucket[0] += min(comp, nq[0])
            bucket[1] += nq[0]
        if not got:
            total, pct, status = "0", ("0%" if nq else "—"), "Open"
        else:
            if known and len(units) == 1:
                u = known[0][1]
                tot = sum(v for v, _ in known)
                total = f"{fmt_num(tot)} {UNIT_WORD.get(u, u)}" + (f" + {unk} tbc" if unk else "")
            elif not known:
                total = "tbc"
            else:
                total = "–"
            nonc = len(got) - len([q for q in known if nq and q[1] == nq[1]]) if nq else len(got)
            if nq and comp > 0:
                pct = (">=" if nonc else "") + f"{round(100 * comp / nq[0])}%"
            elif nq:
                pct = "—" if nonc else "0%"
            else:
                pct = "—"
            status = "Covered" if (nq and comp >= nq[0]) else "Partial"
        entry = {
            "item": option,
            "count": len(got),
            "pledged": total,
            "pct": pct,
            "status": status,
        }
        if need:
            entry.update(label=base, needed=need)
        else:
            entry["label"] = base
        if option in closed:
            entry["closed"] = True
        rows.append(entry)
    headline = {}
    for unit, (got, need) in units_tot.items():
        if need:
            headline[unit] = f"{round(100 * got / need)}%"
    return rows, headline


def merge_live_menu(menu: list[str], closed: list[str], live: list[str]) -> tuple[list[str], list[str]]:
    """Live form options stay open. Options that left the form stay, marked closed.

    Targets and any pledges against those labels are kept. Order is the live
    form, then closed items in their previous order.
    """
    live_list = list(dict.fromkeys(norm(x) for x in live if norm(x)))
    live_l = {x.lower() for x in live_list}
    seen = set()
    kept_closed = []
    for item in list(menu) + list(closed):
        item = norm(item)
        if not item or item.lower() in live_l or item.lower() in seen:
            continue
        seen.add(item.lower())
        kept_closed.append(item)
    new_menu = list(live_list)
    have = {x.lower() for x in new_menu}
    for item in kept_closed:
        if item.lower() not in have:
            new_menu.append(item)
            have.add(item.lower())
    return new_menu, kept_closed


def filter_aliases(aliases: dict | None, menu: list[str]) -> dict:
    """An alias counts only while its target is still on the menu, including closed items."""
    have = {norm(m).lower() for m in menu}
    out = {}
    for old, new in (aliases or {}).items():
        if norm(new).lower() in have:
            out[old] = new
    return out


def best_pay(statuses: list[str], bucket) -> str:
    ranks = {"received": 3, "pending": 2, "other": 1, "unmarked": 0}
    best = "unmarked"
    for status in statuses:
        b = bucket(status)
        if ranks.get(b, 0) > ranks.get(best, 0):
            best = b
    return best
