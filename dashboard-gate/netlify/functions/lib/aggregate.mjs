/**
 * Family-level stall counts. Kept in step with scripts/build-dashboard.py,
 * scripts/count_pledges.py, and the rupee parsing in scripts/stall_sheet.py.
 * Sheet ids are not in the vendored config.
 */
import { createHash } from "node:crypto"
import forms from "./vendor/forms.json" with { type: "json" }
import stallsDoc from "./vendor/stalls.json" with { type: "json" }
import trackerDoc from "./vendor/tracker.json" with { type: "json" }

export const STALLS = stallsDoc.stalls
export const FORMS = forms
export const TRACKER_URL = trackerDoc.url || ""

export const MONEY = "Monetary contribution"
const CONTRIB_KEYS = ["Food", MONEY, "Both", "Not given"]
const FORMS_OPENED_MS = Date.parse("2026-10-01T00:00:00+05:30")
const DAY_MS = 24 * 60 * 60 * 1000

const NOTE_FIX_ROWS = [
  ["sri-lanka", "25 pieces", "*", [25, "pcs", true]],
  ["sri-lanka", "milk toffee 20,coconut toffee 20", "Milk toffee", [20, "pcs", true]],
  ["sri-lanka", "milk toffee 20,coconut toffee 20", "Coconut toffee", [20, "pcs", true]],
  ["sri-lanka", "20 from milk toffee and 20 from coconut toffee", "Milk toffee", [20, "pcs", true]],
  ["sri-lanka", "20 from milk toffee and 20 from coconut toffee", "Coconut toffee", [20, "pcs", true]],
  ["sri-lanka", "20 milk toffee", "*", [20, "pcs", true]],
  ["sri-lanka", "20pieces", "*", [20, "pcs", true]],
  ["sri-lanka", "konda kawum - 40 nos", "*", [40, "pcs", true]],
  ["sri-lanka", "40.0", "*", [40, "pcs", true]],
  ["sri-lanka", "50.0", "*", [50, "pcs", true]],
  ["sri-lanka", "20.0", "*", [20, "pcs", true]],
  ["sri-lanka", "75.0", "*", [75, "pcs", true]],
  ["sri-lanka", "100.0", "*", [100, "pcs", true]],
  ["sri-lanka", "fish bun 20 pcs and butter cake 1 kg", "Cake", [1, "kg", true]],
  ["sri-lanka", "fish bun 20 pcs and butter cake 1 kg", "Fish bun, please order from Paan Paan", [20, "pcs", true]],
  ["sri-lanka", "quantity of 20 for each item", "*", [20, "pcs", true]],
  ["india", "50 jalebli", "*", [50, "pcs", true]],
  ["india", "boondi 500 g each", "*", [0.5, "kg", false]],
  ["india", "boondi. 1kg", "*", [1, "kg", true]],
  ["india", "will send mixture and sweets", "*", null],
  ["india", "as per needed", "*", null],
  ["americas", "80 mini cookies", "*", [80, "pcs", true]],
  ["americas", "how many should i bring ?", "*", null],
  ["europe", "3 packets of washed strawberries", "*", [3, "packs", true]],
  ["europe", "2 strawberry packs", "*", [2, "packs", true]],
  ["europe", "2 boxes strawberry", "*", [2, "packs", true]],
  ["europe", "2 packs", "*", [2, "packs", true]],
  ["europe", "happy to order separately. will dm you", "*", null],
  ["europe", "mini pizza-veg-25 nos", "*", [25, "pcs", true]],
  ["europe", "brownie (40 pieces)", "*", [40, "pcs", true]],
  ["china", "non spicy", "*", null],
]
const NOTE_FIX = new Map(NOTE_FIX_ROWS.map(([slug, note, base, qty]) => [`${slug}\n${note}\n${base}`, qty]))
const NOTE_ITEM = new Map([
  ["india\nwill send mixture and sweets", ["Murukku or mixture (5 kg)"]],
  ["india\nboondi. 1kg", ["Boondi (5 kg)"]],
])
const NOTE_OTHER = new Map([
  ["india\nwill send mixture and sweets", ["Sweets (type not given)"]],
])
const UNIT_WORD = { pcs: "pcs", kg: "kg", packs: "packs" }

const FIELDS = [
  ["timestamp", (h) => h.startsWith("timestamp")],
  ["parent", (h) => h.includes("parent") && h.includes("name")],
  ["phone", (h) => ["mobile", "whatsapp", "phone", "contact number"].some((k) => h.includes(k))],
  ["email", (h) => h.startsWith("email")],
  ["child", (h) => h.includes("child") && h.includes("name")],
  ["class", (h) => h.includes("class")],
  ["contrib", (h) => h.includes("contribute")],
  ["food", (h) => h.startsWith("food you can bring")],
  ["notes", (h) => h.includes("quantity") || h.includes("notes")],
  ["amount", (h) => isAmountHeader(h)],
  ["pay_status", (h) => h === "status" || h.includes("payment status")],
  ["slip", (h) => h.includes("slip") || h.includes("receipt") || h.includes("deposit")],
]

export function norm(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim()
}

export function noteKey(s) {
  return norm(s).toLowerCase()
}

export function phoneDigits(raw) {
  const stripped = norm(raw).replace(/\.0+$/, "")
  return stripped.replace(/\D/g, "")
}

export function isAmountHeader(h) {
  if (h.includes("amount") || h.includes("lkr") || h.startsWith("monetary")) return true
  if (h.includes("contribution") && h.includes("value")) return true
  return h.includes("minimum rs")
}

export function mapHeaders(headers) {
  const found = {}
  headers.forEach((raw, i) => {
    const h = norm(raw).toLowerCase()
    for (const [key, test] of FIELDS) {
      if (found[key] == null && test(h)) {
        found[key] = i
        break
      }
    }
  })
  return found
}

function rupeesFromToken(whole, frac) {
  const digits = whole.replace(/,/g, "")
  if (!/^\d+$/.test(digits)) return null
  let num
  if (frac == null) {
    num = BigInt(digits)
  } else {
    if (!/^\d+$/.test(frac)) return null
    const scale = frac.length
    const base = BigInt(digits + frac)
    const div = 10n ** BigInt(scale)
    const q = base / div
    const r = base % div
    num = r * 2n >= div ? q + 1n : q
  }
  if (num <= 0n || num > 10000000n) return null
  return Number(num)
}

const RUPEE_TOKEN = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g
const UNIT_AFTER = /^\s*(?:pcs|pc|pieces?|nos|no|kgs?|grams?|g|packs?|packets?|boxes|box)\b/i

export function parseRupees(raw) {
  const text = String(raw ?? "")
  if (!text.trim()) return null
  RUPEE_TOKEN.lastIndex = 0
  let match
  while ((match = RUPEE_TOKEN.exec(text))) {
    const val = rupeesFromToken(match[1], match[2])
    if (val != null) return val
  }
  return null
}

export function moneyFromNotes(text) {
  const raw = String(text ?? "")
  RUPEE_TOKEN.lastIndex = 0
  let match
  while ((match = RUPEE_TOKEN.exec(raw))) {
    if (UNIT_AFTER.test(raw.slice(match.index + match[0].length))) continue
    const whole = match[1].replace(/,/g, "")
    if (whole.length < 3 || whole.length > 6) continue
    const val = rupeesFromToken(match[1], match[2])
    if (val != null) return val
  }
  return null
}

export function rs(n) {
  return `Rs ${n.toLocaleString("en-US")}`
}

export function payBucket(status) {
  const s = norm(status).toLowerCase()
  if (!s) return "unmarked"
  if (s.includes("pending")) return "pending"
  if (s.includes("received") || /\bpaid\b/.test(s)) return "received"
  return "other"
}

export function bestPay(statuses) {
  const ranks = { received: 3, pending: 2, other: 1, unmarked: 0 }
  let best = "unmarked"
  for (const status of statuses) {
    const bucket = payBucket(status)
    if ((ranks[bucket] ?? 0) > (ranks[best] ?? 0)) best = bucket
  }
  return best
}

function pyRound(n) {
  const neg = n < 0
  const x = Math.abs(n)
  const f = Math.floor(x)
  const frac = x - f
  let r
  if (frac > 0.5 + 1e-9) r = f + 1
  else if (frac < 0.5 - 1e-9) r = f
  else r = f % 2 === 0 ? f : f + 1
  return neg ? -r : r
}

function parseNeed(need) {
  if (!need) return null
  const m = /^(\d+(?:\.\d+)?)\s*(kg|g|packs?|pieces|pcs)?/i.exec(need)
  if (!m) return null
  const v = Number(m[1])
  const u = (m[2] || "").toLowerCase()
  if (u === "kg") return [v, "kg"]
  if (u === "g") return [v / 1000, "kg"]
  if (u.startsWith("pack")) return [v, "packs"]
  return [v, "pcs"]
}

function parseQty(note) {
  const n = norm(note)
  if (!n || /how many|\?/i.test(n)) return null
  let m = /^(\d+(?:\.\d+)?)\s*(kg|g)$/i.exec(n)
  if (m) {
    const v = Number(m[1])
    return [m[2].toLowerCase() === "kg" ? v : v / 1000, "kg", false]
  }
  m = /^(\d+)\s*(pcs|pieces|piece|nos|no)?\.?$/i.exec(n)
  if (m) return [Number(m[1]), "pcs", true]
  m = /^(\d+)\.0+$/.exec(n)
  if (m) return [Number(m[1]), "pcs", true]
  m = /^(\d+)\s*(packs?|packets?|boxes|box)$/i.exec(n)
  if (m) return [Number(m[1]), "packs", true]
  return null
}

function fmtNum(value, isInt) {
  if (!isInt) {
    if (Number.isInteger(value)) return String(value)
    return String(value)
  }
  return value.toLocaleString("en-US")
}

function resolveQty(slug, note, base, override) {
  if (override) {
    const qty = override.qty || {}
    const spec = qty[base] != null ? qty[base] : qty["*"]
    if (spec != null) {
      if (spec.value == null) return null
      const value = spec.value
      return [value, spec.unit, Number.isInteger(value)]
    }
  }
  const kn = noteKey(note)
  if (NOTE_FIX.has(`${slug}\n${kn}\n${base}`)) return NOTE_FIX.get(`${slug}\n${kn}\n${base}`)
  if (NOTE_FIX.has(`${slug}\n${kn}\n*`)) return NOTE_FIX.get(`${slug}\n${kn}\n*`)
  return parseQty(note)
}

function familyType(types) {
  if (types.has("Both") || (types.has("Food") && types.has(MONEY))) return "Both"
  for (const key of ["Food", MONEY, "Not given"]) {
    if (types.has(key)) return key
  }
  return "Not given"
}

function splitNeed(option) {
  const m = /\s*\((\d+(?:\.\d+)?)\s*([A-Za-z]+)?\)\s*$/.exec(option)
  if (!m) return [option, null]
  return [option.slice(0, m.index).trim(), m[1] + (m[2] ? ` ${m[2]}` : "")]
}

export function filterAliases(aliases, menu) {
  const have = new Set(menu.map((m) => norm(m).toLowerCase()))
  const out = {}
  for (const [old, next] of Object.entries(aliases || {})) {
    if (have.has(norm(next).toLowerCase())) out[old] = next
  }
  return out
}

function summarizeItems(menu, closed, pledges) {
  const rows = []
  const unitsTot = {}
  for (const option of menu) {
    const [base, need] = splitNeed(option)
    const nq = parseNeed(need)
    const got = pledges[option] || []
    const known = got.filter(Boolean)
    const unk = got.length - known.length
    const units = new Set(known.map((q) => q[1]))
    let comp = 0
    let compInt = true
    for (const q of known) {
      if (nq && q[1] === nq[1]) {
        comp += q[0]
        if (!q[2]) compInt = false
      }
    }
    if (nq) {
      const bucket = unitsTot[nq[1]] || [0, 0]
      bucket[0] += Math.min(comp, nq[0])
      bucket[1] += nq[0]
      unitsTot[nq[1]] = bucket
    }
    let total
    let pct
    let status
    if (!got.length) {
      total = "0"
      pct = nq ? "0%" : "\u2014"
      status = "Open"
    } else {
      if (known.length && units.size === 1) {
        const u = known[0][1]
        let tot = 0
        let totInt = true
        for (const q of known) {
          tot += q[0]
          if (!q[2]) totInt = false
        }
        total = `${fmtNum(tot, totInt)} ${UNIT_WORD[u] || u}` + (unk ? ` + ${unk} tbc` : "")
      } else if (!known.length) {
        total = "tbc"
      } else {
        total = "\u2013"
      }
      const comparable = nq ? known.filter((q) => q[1] === nq[1]).length : 0
      const nonc = nq ? got.length - comparable : got.length
      if (nq && comp > 0) pct = (nonc ? ">=" : "") + `${pyRound((100 * comp) / nq[0])}%`
      else if (nq) pct = nonc ? "\u2014" : "0%"
      else pct = "\u2014"
      status = nq && comp >= nq[0] ? "Covered" : "Partial"
    }
    const entry = { item: option, count: got.length, pledged: total, pct, status }
    if (need) {
      entry.label = base
      entry.needed = need
    } else {
      entry.label = base
    }
    if (closed.has(option)) entry.closed = true
    rows.push(entry)
  }
  const headline = {}
  for (const [unit, [got, need]] of Object.entries(unitsTot)) {
    if (need) headline[unit] = `${pyRound((100 * got) / need)}%`
  }
  return [rows, headline]
}

export function blankMenu(menu, closed) {
  const pledges = {}
  for (const item of menu) pledges[item] = []
  return summarizeItems(menu, closed, pledges)[0]
}

function matchItems(cell, known) {
  const knownL = new Set(known.map((k) => norm(k).toLowerCase()))
  const parts = norm(cell).split(", ").map((x) => norm(x))
  const out = []
  let i = 0
  while (i < parts.length) {
    for (let j = parts.length; j > i; j -= 1) {
      const joined = parts.slice(i, j).join(", ")
      if (j === i + 1 || knownL.has(joined.toLowerCase())) {
        if (joined) out.push(joined)
        i = j
        break
      }
    }
  }
  return out
}

function contribType(raw) {
  const s = norm(raw).toLowerCase()
  if (s.includes("both")) return "Both"
  if (s.includes("food")) return "Food"
  if (s.includes("money") || s.includes("monetary")) return MONEY
  return "Not given"
}

function coerceType(raw) {
  const s = norm(raw)
  if (["money", "monetary", "monetary contribution"].includes(s.toLowerCase())) return MONEY
  return s ? contribType(s) : s
}

function colomboDate(y, month, d, hh, mm, ss) {
  return new Date(Date.UTC(y, month - 1, d, hh, mm, ss) - 5.5 * 60 * 60 * 1000)
}

export function colomboParts(date) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
  const bag = {}
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value
  if (bag.hour === "24") bag.hour = "00"
  return bag
}

export function colomboIsoMinutes(date) {
  const p = colomboParts(date)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}+05:30`
}

export function parseTime(raw, now) {
  const s = norm(raw)
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = s.endsWith("Z") ? s.replace("Z", "+00:00") : s
    const dt = new Date(iso)
    if (!Number.isNaN(dt.getTime())) return dt
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  const y = Number(m[3])
  const hh = Number(m[4] || 0)
  const mm = Number(m[5] || 0)
  const ss = Number(m[6] || 0)
  const cands = []
  for (const [day, month] of [[a, b], [b, a]]) {
    if (month < 1 || month > 12 || day < 1 || day > 31) continue
    const dt = colomboDate(y, month, day, hh, mm, ss)
    const back = colomboParts(dt)
    if (Number(back.day) === day && Number(back.month) === month) cands.push(dt)
  }
  const limit = now.getTime() + DAY_MS
  const plausible = cands.filter((c) => c.getTime() >= FORMS_OPENED_MS && c.getTime() <= limit)
  return (plausible.length ? plausible : cands)[0] || null
}

export function familyKey(r) {
  const digits = phoneDigits(r.phone || "")
  if (digits.length >= 7) return `p:${digits.slice(-9)}`
  if (r.email) return `e:${r.email.toLowerCase()}`
  return `n:${(r.parent || "").toLowerCase() || (r.child || "").toLowerCase() || r._row || ""}`
}

function normClass(raw) {
  let s = norm(raw)
  if (!s) return "Not given"
  s = s.replace(/^(year|yr|grade|class)\s*/i, "")
  const m = /^(\d{1,2})\s*[-/]?\s*([A-Za-z])$/.exec(s)
  if (m) return `Year ${Number(m[1])}${m[2].toUpperCase()}`
  if (/^\d{1,2}$/.test(s)) return `Year ${Number(s)}`
  return s.split(" ").map((w) => (w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ")
}

function classSortKey(label) {
  const m = /^Year (\d+)(.*)$/.exec(label)
  const order = { Playgroup: 0, Pg: 0, Nursery: 1, Reception: 2 }
  if (m) return [1, Number(m[1]), m[2]]
  const first = label.split(" ")[0]
  return [Object.prototype.hasOwnProperty.call(order, first) ? 0 : 2, order[first] ?? 9, label]
}

function cmpClass(a, b) {
  const ka = classSortKey(a)
  const kb = classSortKey(b)
  for (let i = 0; i < 3; i += 1) {
    if (ka[i] < kb[i]) return -1
    if (ka[i] > kb[i]) return 1
  }
  return 0
}

function childAmountToken(child, klass, amt) {
  return `${norm(child).toLowerCase()}\0${norm(klass).toLowerCase()}\0${amt}`
}

function rowOverride(table, slug, rawTs, parsed) {
  const stall = (table || {})[slug] || {}
  const wanted = new Set()
  if (rawTs) wanted.add(norm(rawTs))
  if (parsed) {
    wanted.add(colomboIsoMinutes(parsed))
    const p = colomboParts(parsed)
    wanted.add(`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`)
  }
  for (const [key, fix] of Object.entries(stall)) {
    if (wanted.has(norm(String(key)))) return fix || {}
  }
  return {}
}

export function ingestRows(headers, rows, slug, menu, aliasesIn, closedList, hasContrib, moneyOnly, now, overrides) {
  const col = mapHeaders(headers)
  const closed = closedList instanceof Set ? closedList : new Set(closedList || [])
  const classes = {}
  const unlisted = {}
  const lookup = {}
  const labelOf = {}
  for (const item of menu) {
    lookup[norm(item).toLowerCase()] = item
    const [label] = splitNeed(item)
    labelOf[item] = label
    if (lookup[norm(label).toLowerCase()] == null) lookup[norm(label).toLowerCase()] = item
  }
  const aliases = filterAliases(aliasesIn, menu)
  for (const [old, next] of Object.entries(aliases)) {
    if (lookup[norm(old).toLowerCase()] == null) lookup[norm(old).toLowerCase()] = next
  }
  const known = menu.concat(Object.keys(aliases))
  const lookupValues = new Set(Object.values(lookup))
  const pii = new Set()
  const contacts = []
  let last = null
  const famTypes = new Map()
  const famItems = new Map()
  const famParts = new Map()
  const famSeen = new Map()
  const famPay = new Map()
  const famSlip = new Map()
  const responseContrib = hasContrib || moneyOnly ? Object.fromEntries(CONTRIB_KEYS.map((k) => [k, 0])) : null
  const extras = new Map()

  rows.forEach((row, index) => {
    const r = { _row: `${slug}:${index + 1}` }
    for (const [key, i] of Object.entries(col)) r[key] = norm(i < row.length ? row[i] : "")
    for (const key of ["parent", "phone", "email", "child", "notes"]) {
      const value = r[key] || ""
      if (value.length >= 3 && !(key === "notes" && parseQty(value))) pii.add(value)
    }
    const fam = familyKey(r)
    const t = parseTime(r.timestamp || "", now)
    const ov = rowOverride(overrides, slug, r.timestamp || "", t)
    const cl = normClass(r.class || "")
    classes[cl] = (classes[cl] || 0) + 1
    const note = r.notes || ""
    const kn = noteKey(note)
    const items = matchItems(r.food || "", known)
    const ticked = []
    const rowUnlisted = []
    for (const it of items) {
      const mapped = lookup[it.toLowerCase()]
      if (mapped && !ticked.includes(mapped)) ticked.push(mapped)
      else if (!mapped) {
        unlisted[it] = (unlisted[it] || 0) + 1
        rowUnlisted.push(it)
      }
    }
    let ct
    if (hasContrib) ct = col.contrib != null ? contribType(r.contrib || "") : "Not given"
    else ct = moneyOnly ? MONEY : "Food"
    if ((ct === "Food" || ct === "Both") && !ticked.length) {
      let mapped = null
      if (ov.add_items) mapped = ov.add_items.map((x) => lookup[norm(x).toLowerCase()] || x)
      else mapped = NOTE_ITEM.get(`${slug}\n${kn}`)
      if (mapped) {
        for (const item of mapped) {
          if (lookupValues.has(item) && !ticked.includes(item)) ticked.push(item)
        }
      }
    }
    for (const food of NOTE_OTHER.get(`${slug}\n${kn}`) || []) {
      if (!extras.has(food)) extras.set(food, new Set())
      extras.get(food).add(fam)
    }
    if (ct === MONEY && ticked.length) ct = "Both"
    if (ov.type) ct = coerceType(ov.type)
    if (responseContrib) responseContrib[ct] = (responseContrib[ct] || 0) + 1
    if (!famTypes.has(fam)) famTypes.set(fam, new Set())
    famTypes.get(fam).add(ct)
    if (!famItems.has(fam)) famItems.set(fam, new Map())
    const chosen = famItems.get(fam)
    for (const item of ticked) {
      const [base] = splitNeed(item)
      const qty = resolveQty(slug, note, base, ov)
      const prev = chosen.get(item)
      if (prev == null || (prev[0] == null && qty != null)) chosen.set(item, [qty])
    }
    let amt = r.amount ? parseRupees(r.amount) : null
    if (amt == null && (moneyOnly || !ticked.length)) amt = moneyFromNotes(note)
    if (Object.prototype.hasOwnProperty.call(ov, "amount") && ov.amount != null) amt = Number(ov.amount)
    if (!famParts.has(fam)) famParts.set(fam, [])
    if (amt != null) {
      const token = childAmountToken(r.child || "", cl, amt)
      if (!famSeen.has(fam)) famSeen.set(fam, new Set())
      const seen = famSeen.get(fam)
      if (!seen.has(token)) {
        seen.add(token)
        famParts.get(fam).push(amt)
      }
    }
    if (!famPay.has(fam)) famPay.set(fam, [])
    famPay.get(fam).push(r.pay_status || "")
    const slip = r.slip || ""
    if (slip && !famSlip.get(fam)) famSlip.set(fam, slip)
    if (t && (last == null || t > last)) last = t
    contacts.push({
      time: t ? colomboIsoMinutes(t) : "",
      parent: r.parent || "",
      child: r.child || "",
      phone: r.phone || "",
      class: cl,
      type: ct,
      items,
      labels: menu.filter((item) => ticked.includes(item)).map((item) => labelOf[item]),
      unlisted: rowUnlisted,
      notes: note,
      amount: r.amount || "",
      pay_status: r.pay_status || "",
      slip,
    })
  })

  const pledges = {}
  for (const item of menu) pledges[item] = []
  for (const chosen of famItems.values()) {
    for (const [item, [qty]] of chosen) pledges[item].push(qty)
  }
  const [menuRows, headline] = summarizeItems(menu, closed, pledges)
  let famContrib = null
  if (hasContrib || moneyOnly) {
    famContrib = Object.fromEntries(CONTRIB_KEYS.map((k) => [k, 0]))
    for (const types of famTypes.values()) famContrib[familyType(types)] += 1
  }
  const parts = {}
  const pays = {}
  const slips = {}
  for (const [fam, amounts] of famParts) parts[fam] = amounts
  for (const [fam, statuses] of famPay) pays[fam] = statuses
  for (const [fam, slip] of famSlip) slips[fam] = slip
  return {
    responses: rows.length,
    families: [...famTypes.keys()],
    by_class: Object.keys(classes).sort(cmpClass).map((c) => ({ class: c, count: classes[c] })),
    menu: menuRows,
    headline,
    unlisted_ticks: Object.values(unlisted).reduce((sum, n) => sum + n, 0),
    extras: [...extras.entries()].map(([name, fams]) => ({ item: name, families: fams.size })),
    last,
    contribution: famContrib,
    money: familyMoney(parts, pays, slips, moneyOnly, famContrib),
    contacts,
    pii,
  }
}

function familyMoney(parts, pays, slips, moneyOnly, contribution) {
  const statedRows = []
  const statedFams = new Set()
  for (const [fam, amounts] of Object.entries(parts)) {
    if (amounts && amounts.length) {
      statedFams.add(fam)
      statedRows.push(...amounts)
    }
  }
  const moneyFamiliesHint = (contribution?.[MONEY] || 0) + (contribution?.Both || 0)
  if (!moneyOnly && !statedRows.length && !(contribution && moneyFamiliesHint)) return null
  const buckets = { received: 0, pending: 0, unmarked: 0, other: 0 }
  const other = {}
  const slipCounts = { filled: 0, uploaded: 0, written: 0 }
  const families = new Set([...Object.keys(parts), ...Object.keys(pays), ...Object.keys(slips)])
  const pool = moneyOnly ? families : statedFams
  for (const fam of pool) {
    if (moneyOnly) {
      const bucket = bestPay(pays[fam] || [""])
      buckets[bucket] = (buckets[bucket] || 0) + 1
      if (bucket === "other") {
        const label = norm((pays[fam] || []).find((s) => payBucket(s) === "other") || "")
        if (label) other[label] = (other[label] || 0) + 1
      }
    }
    const slip = slips[fam] || ""
    if (slip) {
      slipCounts.filled += 1
      if (slip.toLowerCase().includes("upload") || slip.toLowerCase().startsWith("http")) slipCounts.uploaded += 1
      else slipCounts.written += 1
    }
  }
  const bands = new Map()
  for (const amt of statedRows) bands.set(amt, (bands.get(amt) || 0) + 1)
  const total = statedRows.reduce((sum, n) => sum + n, 0)
  const both = contribution?.Both || 0
  const moneyFamilies = (contribution?.[MONEY] || 0) + both
  let line = ""
  if (!moneyOnly && (moneyFamilies || statedRows.length)) {
    line = `Money: ${moneyFamilies} ${moneyFamilies === 1 ? "family" : "families"}`
    if (both) line += ` (${both} also bringing food)`
    line += statedRows.length
      ? `. Amounts stated add up to ${rs(total)}.`
      : ". No amounts stated on the sheet, so no money % is shown."
  }
  return {
    families: moneyOnly ? pool.size : moneyFamilies,
    both,
    known: statedRows.length,
    total,
    buckets,
    other,
    slips: slipCounts,
    by_amount: [...bands.keys()].sort((a, b) => a - b).map((n) => ({ amount: rs(n), children: bands.get(n) })),
    line,
  }
}

function sortedCountMap(obj) {
  return Object.fromEntries(Object.entries(obj || {}).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
}

function pyJson(value) {
  if (value == null) return "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("bad number")
    return Number.isInteger(value) ? String(value) : JSON.stringify(value)
  }
  if (typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => pyJson(item)).join(", ")}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}: ${pyJson(value[key])}`).join(", ")}}`
}

export function dataHash(payload) {
  return createHash("sha256").update(pyJson(payload)).digest("hex").slice(0, 16)
}

function emptyEntry(sc, meta) {
  const moneyOnly = Boolean(sc.money_only)
  const hasContrib = Boolean(sc.contribution_options) || moneyOnly
  const closed = new Set(sc.closed || [])
  return {
    slug: sc.slug,
    name: meta?.name || sc.slug,
    year_groups: meta?.years || "",
    minimum_note: meta?.note || "",
    status: "not_connected",
    money_only: moneyOnly,
    responses: 0,
    families: 0,
    by_class: [],
    contribution: hasContrib ? Object.fromEntries(CONTRIB_KEYS.map((k) => [k, 0])) : null,
    menu: blankMenu(sc.menu || [], closed),
    headline_pct: null,
    unlisted_ticks: 0,
    extras: [],
    money: null,
    money_line: "",
    last_response: null,
    clicks: null,
    conversion: null,
  }
}

function applyGot(entry, got, moneyOnly, hasContrib) {
  entry.status = "ok"
  entry.responses = got.responses
  entry.families = got.families.length
  entry.by_class = got.by_class
  entry.menu = got.menu
  entry.headline_pct = got.headline.pcs || null
  entry.unlisted_ticks = got.unlisted_ticks
  entry.extras = got.extras
  entry.money = moneyOnly ? got.money : null
  entry.money_line = moneyOnly ? "" : (got.money?.line || "")
  entry.last_response = got.last ? colomboIsoMinutes(got.last) : null
  if (hasContrib) entry.contribution = got.contribution
}

function applyClicks(entry, clicks, clickMode, prevClicks) {
  if (clicks) {
    const c = (clicks.stalls || {})[entry.slug] || {}
    entry.clicks = {
      total: Number(c.clicks || 0),
      unique: Number(c.unique || 0),
      by_src: sortedCountMap(c.by_src),
      by_device: sortedCountMap(c.by_device),
    }
  } else if (clickMode === "unavailable") {
    entry.clicks = prevClicks[entry.slug] ?? null
  }
  if (entry.clicks && entry.clicks.unique && entry.status === "ok") {
    const ratio = entry.responses / entry.clicks.unique
    const rounded = pyRound(ratio * 1000) / 1000
    entry.conversion = rounded
  }
}

/**
 * rowsBySlug[slug] is { headers, rows } when that stall was read.
 * missing[slug] === "keep" reuses kept[slug] (last good public entry, contacts, family keys).
 */
export function buildSnapshot({ rowsBySlug = {}, kept = {}, now, overrides = {}, clicks = null, clickMode = "off", previous = null }) {
  const prevClicks = {}
  for (const stall of previous?.stalls || []) prevClicks[stall.slug] = stall.clicks
  const stalls = []
  const pledgeStalls = []
  const pii = new Set()
  const allFamilies = new Set()

  for (const sc of STALLS) {
    const slug = sc.slug
    const meta = FORMS[slug]
    const moneyOnly = Boolean(sc.money_only)
    const hasContrib = Boolean(sc.contribution_options) || moneyOnly
    const entry = emptyEntry(sc, meta)
    let contacts = []
    let familyKeys = []
    const source = rowsBySlug[slug]
    const prior = kept[slug]
    if (source) {
      const got = ingestRows(
        source.headers,
        source.rows,
        slug,
        sc.menu || [],
        sc.aliases || {},
        sc.closed || [],
        Boolean(sc.contribution_options),
        moneyOnly,
        now,
        overrides,
      )
      for (const secret of got.pii) pii.add(secret)
      contacts = got.contacts
      familyKeys = got.families
      for (const key of familyKeys) allFamilies.add(key)
      applyGot(entry, got, moneyOnly, hasContrib)
    } else if (prior?.entry) {
      const copy = { ...prior.entry }
      delete copy.pdf
      Object.assign(entry, copy)
      contacts = prior.contacts || []
      familyKeys = prior.families || []
      for (const key of familyKeys) allFamilies.add(key)
    }
    applyClicks(entry, clicks, clickMode, prevClicks)
    stalls.push(entry)
    pledgeStalls.push({ slug, contacts, families: familyKeys })
  }

  const connected = stalls.filter((s) => s.status === "ok")
  const summary = {
    stalls: stalls.length,
    connected: connected.length,
    stall_managed: stalls.filter((s) => s.status === "stall_managed").length,
    responses: stalls.reduce((sum, s) => sum + s.responses, 0),
    families: allFamilies.size,
    contribution: Object.fromEntries(CONTRIB_KEYS.map((k) => [k, stalls.reduce((sum, s) => sum + ((s.contribution || {})[k] || 0), 0)])),
    menu_items: stalls.reduce((sum, s) => sum + s.menu.length, 0),
    menu_items_unpledged: stalls.reduce((sum, s) => sum + s.menu.filter((m) => m.count === 0).length, 0),
    last_response: stalls.reduce((max, s) => (s.last_response && (!max || s.last_response > max) ? s.last_response : max), null),
    clicks: null,
    conversion: null,
  }
  const withClicks = stalls.filter((s) => s.clicks)
  if (withClicks.length) {
    let total = 0
    let unique = 0
    if (clicks) {
      total = Number(clicks.total?.clicks || 0)
      unique = Number(clicks.total?.unique || 0)
    } else {
      const prev = previous?.summary?.clicks || {}
      total = Number(prev.total || 0)
      unique = Number(prev.unique || 0)
    }
    const stallUnique = withClicks.reduce((sum, s) => sum + s.clicks.unique, 0)
    summary.clicks = {
      total: withClicks.reduce((sum, s) => sum + s.clicks.total, 0),
      unique: stallUnique,
      all_links: { total, unique },
    }
    const convUnique = withClicks.filter((s) => s.status === "ok").reduce((sum, s) => sum + s.clicks.unique, 0)
    if (convUnique) summary.conversion = pyRound((summary.responses / convUnique) * 1000) / 1000
  }

  const payload = {
    event: { name: "UN Day 2026", date: "2026-10-16", leads_summary: "2026-10-06" },
    tracking: withClicks.length ? "on" : "off",
    summary,
    stalls,
  }
  const digest = dataHash(payload)
  const updated = previous?.data_hash === digest && previous?.updated ? previous.updated : colomboIsoMinutes(now)
  const data = { updated, data_hash: digest, ...payload }
  return { data, pledges: { data_hash: digest, stalls: pledgeStalls }, pii }
}

export function pdfFilename(name, updatedIso) {
  const day = String(updatedIso || "").slice(0, 10)
  const safe = String(name || "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "Stall"
  return `UN-Day-Stall-${safe}-${day}.pdf`
}

export function publicTextHasSecrets(text, secrets) {
  for (const secret of secrets) {
    if (secret && String(secret).length >= 3 && text.includes(secret)) return true
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return true
  return false
}

export function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ""
  let i = 0
  let quoted = false
  const s = String(text).replace(/^\uFEFF/, "")
  while (i < s.length) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      cell += c
      i += 1
      continue
    }
    if (c === '"') {
      quoted = true
      i += 1
      continue
    }
    if (c === ",") {
      row.push(cell)
      cell = ""
      i += 1
      continue
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i += 1
      row.push(cell)
      cell = ""
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      i += 1
      continue
    }
    cell += c
    i += 1
  }
  if (cell.length || row.length) {
    row.push(cell)
    if (row.some((value) => value.trim())) rows.push(row)
  }
  if (!rows.length) return { headers: [], rows: [] }
  return { headers: rows[0], rows: rows.slice(1) }
}

export function withinColomboWindow(date) {
  const p = colomboParts(date)
  const mins = Number(p.hour) * 60 + Number(p.minute)
  return mins >= 7 * 60 && mins <= 22 * 60 + 15
}
