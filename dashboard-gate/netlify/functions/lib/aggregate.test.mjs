import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  buildSnapshot,
  dataHash,
  familyKey,
  ingestRows,
  mapHeaders,
  moneyFromNotes,
  parseCsv,
  parseRupees,
  phoneDigits,
  withinColomboWindow,
} from "./aggregate.mjs"

const ROOT = join(import.meta.dirname, "../../../../")

function csvEscape(value) {
  const text = String(value ?? "")
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

function writeCsv(path, rows) {
  writeFileSync(path, `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`)
}

function comparable(got) {
  return {
    responses: got.responses,
    families: got.families.length,
    by_class: got.by_class,
    menu: got.menu,
    contribution: got.contribution,
    money: got.money,
    unlisted_ticks: got.unlisted_ticks,
    extras: got.extras,
    headline: got.headline,
  }
}

test("rupee amounts, phones, and the Colombo window match the Python rules", () => {
  assert.equal(phoneDigits("0771234567.0"), "0771234567")
  assert.equal(familyKey({ phone: "0771234567.0", email: "", parent: "A", child: "" }), familyKey({ phone: "0771234567", email: "", parent: "B", child: "" }))
  assert.equal(parseRupees("10,000.00"), 10000)
  assert.equal(parseRupees("5,000"), 5000)
  assert.equal(parseRupees("5000"), 5000)
  assert.equal(parseRupees("10,000.50"), 10001)
  assert.notEqual(parseRupees("10,000.00"), Number("10,000.00".replace(/\D/g, "")))
  assert.equal(moneyFromNotes("25 pieces"), null)
  const sea = mapHeaders(["Timestamp", "Parent name", "Mobile number", "Child's name", "Class", "Contribution Value (Minimum Rs 5,000)", "Status", "Slip / receipt"])
  assert.equal(sea.amount, 5)
  assert.equal(sea.child, 3)
  assert.equal(sea.contrib, undefined)
  assert.deepEqual(mapHeaders(["Child's Contribution Value (Minimum Rs 3,000-5,000)"]), { amount: 0 })
  assert.equal(withinColomboWindow(new Date("2026-10-07T01:07:00Z")), false)
  assert.equal(withinColomboWindow(new Date("2026-10-07T01:30:00Z")), true)
  assert.equal(withinColomboWindow(new Date("2026-10-07T01:37:00Z")), true)
  assert.equal(withinColomboWindow(new Date("2026-10-07T16:07:00Z")), true)
  assert.equal(withinColomboWindow(new Date("2026-10-07T16:37:00Z")), true)
  assert.equal(withinColomboWindow(new Date("2026-10-07T16:46:00Z")), false)
})

test("fixture counts match the Python build", () => {
  const folder = mkdtempSync(join(tmpdir(), "undash-parity-"))
  const slHeader = ["Timestamp", "Parent name", "Mobile number", "Email", "Child's name", "Class", "How would you like to contribute?", "Food you can bring", "Quantity / notes", "Monetary contribution (optional)", "Status", "Slip / receipt"]
  const seaHeaders = ["Timestamp", "Parent name", "Mobile number", "Child's name", "Class", "Contribution Value (Minimum Rs 5,000)", "Status", "Slip / receipt"]
  writeCsv(join(folder, "sri-lanka.csv"), [
    slHeader,
    ["2/10/2026 9:00:00", "Parent One", "0771234567.0", "a@example.com", "Child One", "Playgroup A", "Food", "Milk toffee (100), Coconut toffee (50)", "25 pieces", "", "", ""],
    ["2/10/2026 9:05:00", "Parent One again", "0771234567", "a@example.com", "Child One", "Playgroup A", "Food", "Milk toffee (100)", "20.0", "", "", ""],
    ["2/10/2026 9:10:00", "Parent Two", "0779999999", "b@example.com", "Child Two", "Reception A", "Monetary contribution", "Kokis (500)", "", "10,000.00", "", ""],
    ["2/10/2026 9:20:00", "Parent Three", "0778888888", "c@example.com", "Child Three", "Reception B", "Monetary contribution", "", "", "", "", ""],
  ])
  writeCsv(join(folder, "sea.csv"), [
    seaHeaders,
    ["2/10/2026 8:00:00", "Parent S", "0772000001", "Child S", "Year 3A", "10,000.00", "Received", "https://example.test/slip"],
    ["2/10/2026 8:05:00", "Parent S again", "0772000001.0", "Child S", "Year 3A", "10,000.00", "Pending", ""],
    ["3/10/2026 8:00:00", "Parent T", "0772000002", "Child T", "Year 3B", "5,000", "Pending", ""],
    ["4/10/2026 8:00:00", "Parent U", "0772000003", "Child U", "Year 3A", "5000", "", ""],
    ["4/10/2026 8:10:00", "Parent V", "0772000004", "Child V1", "Year 3A", "5,000", "", ""],
    ["4/10/2026 8:12:00", "Parent V", "0772000004", "Child V2", "Year 3A", "5,000", "", ""],
  ])
  writeCsv(join(folder, "australia.csv"), [
    ["Timestamp", "Parent name", "WhatsApp number", "Email address", "Child's name", "Class", "Child's Contribution Value (Minimum Rs 3,000-5,000)", "Payment status", "Deposit slip"],
    ["2/10/2026 8:00:00", "Parent A", "0773100001", "a@example.com", "Ann", "Year 2A", "3,000", "Received", "https://example.test/a"],
    ["2/10/2026 8:01:00", "Parent A", "0773100001", "a@example.com", "Ben", "Year 2A", "3,000", "Received", ""],
    ["2/10/2026 8:02:00", "Parent A", "0773100001.0", "a@example.com", "Ann", "Year 2A", "3,000", "Received", ""],
    ["2/10/2026 8:10:00", "Parent B", "0773100002", "b@example.com", "Cat", "Year 2B", "3000", "Pending", "written"],
    ["2/10/2026 8:11:00", "Parent B", "0773100002", "b@example.com", "Dan", "Year 2B", "3000", "Pending", ""],
    ["2/10/2026 8:20:00", "Parent C", "0773100003", "c@example.com", "Eve", "2A", "3,500", "Received", "https://example.test/c"],
    ["2/10/2026 8:21:00", "Parent C", "0773100003", "c@example.com", "Fay", "Year 2C", "3500", "", ""],
    ["2/10/2026 8:30:00", "Parent D", "0773100004", "d@example.com", "Gus", "Year 2A", "5,000", "", ""],
    ["2/10/2026 8:31:00", "Parent D", "0773100004", "d@example.com", "Gus", "Year 2B", "5,000", "", ""],
    ["2/10/2026 8:40:00", "Parent E", "0773100005", "e@example.com", "Hal", "Year 2A", "3,000", "", ""],
    ["2/10/2026 8:41:00", "Parent E", "0773100005", "e@example.com", "Hal", "Year 2A", "4,000", "", ""],
  ])
  writeCsv(join(folder, "food-money.csv"), [
    slHeader,
    ["2/10/2026 9:30:00", "Parent F", "0773200001", "f@example.com", "Child A", "Year 1A", "Monetary contribution", "", "", "2,000", "", ""],
    ["2/10/2026 9:31:00", "Parent F", "0773200001", "f@example.com", "Child B", "Year 1A", "Monetary contribution", "", "", "1,500", "", ""],
    ["2/10/2026 9:32:00", "Parent F", "0773200001", "f@example.com", "Child A", "Year 1A", "Monetary contribution", "", "", "2,000", "", ""],
    ["2/10/2026 9:33:00", "Parent F", "0773200001", "f@example.com", "Child A", "Year 1B", "Monetary contribution", "", "", "2,000", "", ""],
  ])
  const overrides = { "sri-lanka": { "2026-10-02T09:20+05:30": { type: "Both", amount: 6000 } } }
  writeFileSync(join(folder, "overrides.json"), JSON.stringify(overrides))
  writeFileSync(join(folder, "clicks.json"), JSON.stringify({ ok: true, stalls: {}, total: { clicks: 0, unique: 0 } }))

  const py = spawnSync("python3", [
    "-c",
    `
import importlib.util, json, sys
from pathlib import Path
root = Path(sys.argv[1])
folder = Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("build_dashboard", root / "scripts" / "build-dashboard.py")
mod = importlib.util.module_from_spec(spec)
sys.modules["build_dashboard"] = mod
spec.loader.exec_module(mod)
now = __import__("datetime").datetime(2026, 10, 7, 9, 15, tzinfo=mod.COLOMBO)
overrides = json.loads((folder / "overrides.json").read_text())
menu = ["Milk toffee (100)", "Coconut toffee (50)", "Kokis (500)", "Fish bun, please order from Paan Paan (75)"]
def pub(got):
    return {
        "responses": got["responses"],
        "families": len(got["families"]),
        "by_class": got["by_class"],
        "menu": got["menu"],
        "contribution": got["contribution"],
        "money": got["money"],
        "unlisted_ticks": got["unlisted_ticks"],
        "extras": got["extras"],
        "headline": got["headline"],
    }
sl = pub(mod.ingest_responses(folder / "sri-lanka.csv", "sri-lanka", menu, {"Fish bun": "Fish bun, please order from Paan Paan (75)"}, {"Fish bun, please order from Paan Paan (75)"}, True, False, now, overrides))
sea = pub(mod.ingest_responses(folder / "sea.csv", "sea", [], {}, set(), False, True, now, {}))
aus = pub(mod.ingest_responses(folder / "australia.csv", "australia", [], {}, set(), False, True, now, {}))
food = pub(mod.ingest_responses(folder / "food-money.csv", "food-money", [], {}, set(), True, False, now, {}))
class Args: pass
args = Args()
args.data_dir = str(folder)
args.out = str(folder / "no-previous")
args.clicks = str(folder / "clicks.json")
args.overrides = str(folder / "overrides.json")
data, _private, _pii, _pledges = mod.build(args, now)
payload = {"event": data["event"], "tracking": data["tracking"], "summary": data["summary"], "stalls": data["stalls"]}
print(json.dumps({
    "sri": sl, "sea": sea, "aus": aus, "food": food,
    "data_hash": data["data_hash"],
    "updated": data["updated"],
    "canonical": json.dumps(payload, sort_keys=True, ensure_ascii=False),
}, ensure_ascii=False))
`,
    ROOT,
    folder,
  ], { encoding: "utf8" })
  assert.equal(py.status, 0, py.stderr)
  const expected = JSON.parse(py.stdout)
  const now = new Date("2026-10-07T09:15:00+05:30")
  const slMenu = ["Milk toffee (100)", "Coconut toffee (50)", "Kokis (500)", "Fish bun, please order from Paan Paan (75)"]
  const read = (name) => parseCsv(readFileSync(join(folder, name), "utf8"))
  const sri = read("sri-lanka.csv")
  const sea = read("sea.csv")
  const aus = read("australia.csv")
  const food = read("food-money.csv")
  const gotSri = ingestRows(sri.headers, sri.rows, "sri-lanka", slMenu, { "Fish bun": "Fish bun, please order from Paan Paan (75)" }, ["Fish bun, please order from Paan Paan (75)"], true, false, now, overrides)
  assert.deepEqual(comparable(gotSri), expected.sri)
  assert.equal(gotSri.menu.find((item) => item.item.startsWith("Milk")).count, 1)
  assert.equal(gotSri.menu.find((item) => item.item.startsWith("Milk")).pledged, "25 pcs")
  assert.equal(gotSri.contribution.Both, 2)
  assert.equal(gotSri.money.total, 16000)
  const gotSea = ingestRows(sea.headers, sea.rows, "sea", [], {}, [], false, true, now, {})
  assert.deepEqual(comparable(gotSea), expected.sea)
  assert.equal(gotSea.families.length, 4)
  assert.equal(gotSea.money.total, 30000)
  assert.equal(gotSea.money.known, 5)
  assert.deepEqual(gotSea.money.buckets, { received: 1, pending: 1, unmarked: 2, other: 0 })
  assert.deepEqual(gotSea.money.by_amount, [{ amount: "Rs 5,000", children: 4 }, { amount: "Rs 10,000", children: 1 }])
  const gotAus = ingestRows(aus.headers, aus.rows, "australia", [], {}, [], false, true, now, {})
  assert.deepEqual(comparable(gotAus), expected.aus)
  assert.equal(gotAus.families.length, 5)
  assert.equal(gotAus.money.total, 36000)
  assert.deepEqual(gotAus.money.by_amount.map((row) => [row.amount, row.children]), [["Rs 3,000", 5], ["Rs 3,500", 2], ["Rs 4,000", 1], ["Rs 5,000", 2]])
  const gotFood = ingestRows(food.headers, food.rows, "food-money", [], {}, [], true, false, now, {})
  assert.deepEqual(comparable(gotFood), expected.food)
  assert.equal(gotFood.families.length, 1)
  assert.equal(gotFood.money.total, 5500)
  assert.match(gotFood.money.line, /Rs 5,500/)

  const clicks = JSON.parse(readFileSync(join(folder, "clicks.json"), "utf8"))
  const built = buildSnapshot({
    rowsBySlug: { "sri-lanka": sri, sea, australia: aus },
    now,
    overrides,
    clicks,
    clickMode: "live",
  })
  const payload = {
    event: built.data.event,
    tracking: built.data.tracking,
    summary: built.data.summary,
    stalls: built.data.stalls,
  }
  assert.equal(built.data.updated, expected.updated)
  assert.equal(dataHash(payload), expected.data_hash)
  assert.equal(built.data.data_hash, expected.data_hash)
  const leaked = JSON.stringify(payload)
  for (const secret of ["Parent One", "0771234567", "a@example.com", "Child One"]) {
    assert.equal(leaked.includes(secret), false, secret)
  }
})
