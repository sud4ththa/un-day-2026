import assert from "node:assert/strict"
import { inflateSync } from "node:zlib"
import test from "node:test"
import { blankMenu, STALLS } from "./aggregate.mjs"
import { refreshDashboard } from "./refresh.mjs"

function memoryStore(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    async get(key, opts) {
      if (!map.has(key)) return null
      const value = map.get(key)
      if (opts?.type === "json") return typeof value === "string" ? JSON.parse(value) : value
      if (opts?.type === "text") return typeof value === "string" ? value : JSON.stringify(value)
      return value
    },
    async set(key, value) {
      map.set(key, value)
    },
    async setJSON(key, value) {
      map.set(key, value)
    },
    async delete(key) {
      map.delete(key)
    },
  }
}

function pdfText(bytes) {
  const latin = Buffer.from(bytes).toString("latin1")
  const chunks = []
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let match
  while ((match = re.exec(latin))) {
    const buf = Buffer.from(match[1], "latin1")
    try {
      chunks.push(inflateSync(buf).toString("latin1"))
    } catch {
      chunks.push(match[1])
    }
  }
  return chunks.join("\n").replace(/<([0-9A-Fa-f\s]+)>/g, (_, hex) => {
    const clean = hex.replace(/\s+/g, "")
    if (!clean || clean.length % 2) return ""
    return Buffer.from(clean, "hex").toString("latin1")
  })
}

const ENV = {
  STALL_SHEETS: JSON.stringify({
    "sri-lanka": { id: "sheet-sri-lanka", gid: 0 },
    japan: { id: "sheet-japan", gid: 1 },
  }),
  GOOGLE_SA_KEY_JSON: JSON.stringify({
    client_email: "stalls@example.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nnot-used\n-----END PRIVATE KEY-----\n",
  }),
}

test("a failed sheet keeps that stall and the log is only the stall key", async () => {
  const japanMenu = blankMenu(STALLS.find((stall) => stall.slug === "japan").menu, new Set())
  const store = memoryStore({
    "state/japan.json": {
      entry: {
        slug: "japan",
        name: "Japan",
        year_groups: "Nursery & Year 1",
        minimum_note: "",
        status: "ok",
        money_only: false,
        responses: 7,
        families: 1,
        by_class: [{ class: "Year 1A", count: 1 }],
        contribution: { Food: 1, "Monetary contribution": 0, Both: 0, "Not given": 0 },
        menu: japanMenu,
        headline_pct: null,
        unlisted_ticks: 0,
        extras: [],
        money: null,
        money_line: "",
        last_response: "2026-10-02T09:00+05:30",
        clicks: null,
        conversion: null,
      },
      contacts: [{
        parent: "Secret Parent",
        child: "Secret Child",
        phone: "0775550199",
        class: "Year 1A",
        type: "Food",
        items: [],
        labels: [],
        unlisted: [],
        notes: "call me",
        amount: "",
        pay_status: "",
        slip: "",
      }],
      families: ["p:775550199"],
    },
  })
  const logs = []
  const leaked = "Secret Parent 0775550199 secret.parent@example.com sheet-japan"
  const result = await refreshDashboard({
    manual: true,
    env: ENV,
    store,
    fetch: async () => new Response(JSON.stringify({ ok: true, stalls: {}, total: { clicks: 0, unique: 0 } }), { status: 200 }),
    now: new Date("2026-10-07T09:15:00+05:30"),
    log: (line) => logs.push(line),
    tokenFor: async () => "token",
    readSheet: async (_token, spec) => {
      if (spec.gid === 1) throw new Error(leaked)
      return {
        headers: ["Timestamp", "Parent name", "Mobile number", "Email", "Child's name", "Class", "How would you like to contribute?", "Food you can bring", "Quantity / notes"],
        rows: [["2/10/2026 9:00:00", "Parent One", "0771234567", "a@example.com", "Child One", "Playgroup A", "Food", "Kokis (500)", "25 pieces"]],
      }
    },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(logs, ["japan"])
  assert.equal(logs.join(" ").includes("Secret"), false)
  assert.equal(logs.join(" ").includes("0775550199"), false)
  assert.equal(logs.join(" ").includes("sheet-japan"), false)
  const data = JSON.parse(await store.get("data.json", { type: "text" }))
  const japan = data.stalls.find((stall) => stall.slug === "japan")
  const sri = data.stalls.find((stall) => stall.slug === "sri-lanka")
  assert.equal(japan.responses, 7)
  assert.equal(japan.status, "ok")
  assert.equal(sri.responses, 1)
  assert.equal(sri.status, "ok")
  const published = JSON.stringify(data)
  assert.equal(published.includes("Secret Parent"), false)
  assert.equal(published.includes("0775550199"), false)
  assert.equal(published.includes("a@example.com"), false)
  assert.equal(published.includes("Parent One"), false)
  const text = pdfText(await store.get(`sheets/${sri.pdf}`))
  assert.match(text, /Parent One/)
  assert.match(text, /0771234567/)
  const japanPdf = pdfText(await store.get(`sheets/${japan.pdf}`))
  assert.match(japanPdf, /Secret Parent/)
  assert.match(japanPdf, /0775550199/)
})

test("a bad sheet list does not replace the last counts", async () => {
  const store = memoryStore({
    "data.json": JSON.stringify({ updated: "keep-me", data_hash: "abc", stalls: [] }),
  })
  const logs = []
  const result = await refreshDashboard({
    manual: true,
    env: { STALL_SHEETS: "{", GOOGLE_SA_KEY_JSON: "{}" },
    store,
    fetch: async () => {
      throw new Error("should not fetch")
    },
    now: new Date("2026-10-07T09:15:00+05:30"),
    log: (line) => logs.push(line),
  })
  assert.equal(result.ok, false)
  assert.deepEqual(logs, ["sheets-config"])
  const data = await store.get("data.json", { type: "json" })
  assert.equal(data.updated, "keep-me")
  const again = await refreshDashboard({
    manual: true,
    env: { STALL_SHEETS: "{", GOOGLE_SA_KEY_JSON: "{}" },
    store,
    fetch: async () => {
      throw new Error("should not fetch")
    },
    now: new Date(),
    log: (line) => logs.push(line),
  })
  assert.equal(again.retry, true)
  assert.deepEqual(logs, ["sheets-config"])
})

test("the scheduled run stays quiet outside the Colombo window", async () => {
  let called = false
  const result = await refreshDashboard({
    manual: false,
    env: ENV,
    store: memoryStore(),
    fetch: async () => {
      called = true
      return new Response("no")
    },
    now: new Date("2026-10-07T01:07:00Z"),
    log: () => {
      called = true
    },
  })
  assert.equal(result.skipped, true)
  assert.equal(called, false)
})
