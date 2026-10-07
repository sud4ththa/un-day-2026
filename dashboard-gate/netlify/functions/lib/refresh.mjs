import {
  STALLS,
  TRACKER_URL,
  buildSnapshot,
  pdfFilename,
  publicTextHasSecrets,
  withinColomboWindow,
} from "./aggregate.mjs"
import { renderStallPdf } from "./pdf.mjs"
import { googleAccessToken, parseServiceAccount, parseStallSheets, readSheetValues } from "./sheets.mjs"

const LOCK_MS = 60 * 1000

async function loadClicks(fetchImpl, previous) {
  if (!TRACKER_URL) return { clicks: null, clickMode: "off" }
  try {
    const res = await fetchImpl(`${TRACKER_URL}?t=stats`, { headers: { "user-agent": "un-day-dashboard" } })
    if (!res.ok) throw new Error("clicks")
    const data = await res.json()
    if (!data || data.ok !== true || typeof data !== "object") throw new Error("clicks")
    return { clicks: data, clickMode: "live" }
  } catch {
    return { clicks: null, clickMode: previous ? "unavailable" : "off" }
  }
}

function targetsFrom(entry) {
  return (entry.menu || []).map((item) => {
    let label = item.label || item.item
    if (item.closed) label = `${label} (closed)`
    return {
      label,
      needed: item.needed || "-",
      total: item.pledged || "0",
      pct: item.pct || "-",
      status: item.status || "Open",
    }
  })
}

export async function refreshDashboard(opts) {
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now)
  if (!opts.manual && !withinColomboWindow(now)) return { ok: true, skipped: true }
  const store = opts.store
  const lock = await store.get("refresh-lock", { type: "json" })
  if (lock && typeof lock.at === "number" && now.getTime() - lock.at < LOCK_MS) {
    return { ok: false, retry: true }
  }
  await store.setJSON("refresh-lock", { at: now.getTime() })
  try {
    return await runRefresh({ ...opts, now })
  } finally {
    await store.setJSON("refresh-lock", { at: Date.now() })
  }
}

async function runRefresh(opts) {
  const { env, store, now } = opts
  const logSlug = (slug) => {
    if (/^[a-z0-9-]{1,40}$/.test(slug)) opts.log?.(slug)
  }
  const sheets = parseStallSheets(env.STALL_SHEETS)
  const account = parseServiceAccount(env.GOOGLE_SA_KEY_JSON)
  if (sheets.error || account.error) {
    opts.log?.(sheets.error ? "sheets-config" : "google-key")
    return { ok: false, error: "config" }
  }

  const previous = await store.get("data.json", { type: "json" })
  const kept = {}
  for (const stall of STALLS) {
    const saved = await store.get(`state/${stall.slug}.json`, { type: "json" })
    if (saved?.entry) {
      const entry = { ...saved.entry }
      delete entry.pdf
      kept[stall.slug] = { ...saved, entry }
    }
  }

  let token = ""
  try {
    token = opts.tokenFor
      ? await opts.tokenFor(account.account, now)
      : await googleAccessToken(opts.fetch, account.account, now)
  } catch {
    opts.log?.("google-key")
  }

  const rowsBySlug = {}
  const useKept = {}
  const read = opts.readSheet
    ? (spec) => opts.readSheet(token, spec)
    : (spec) => readSheetValues(opts.fetch, token, spec)

  for (const stall of STALLS) {
    const spec = sheets.map[stall.slug]
    if (!spec) continue
    if (!token) {
      if (kept[stall.slug]) useKept[stall.slug] = kept[stall.slug]
      logSlug(stall.slug)
      continue
    }
    try {
      rowsBySlug[stall.slug] = await read(spec)
    } catch {
      if (kept[stall.slug]) useKept[stall.slug] = kept[stall.slug]
      logSlug(stall.slug)
    }
  }

  const { clicks, clickMode } = await loadClicks(opts.fetch, previous)
  if (clickMode === "unavailable") opts.log?.("clicks")
  const built = buildSnapshot({
    rowsBySlug,
    kept: useKept,
    now,
    clicks,
    clickMode,
    previous: previous || null,
  })

  const names = new Map()
  for (const stall of built.data.stalls) {
    let name = pdfFilename(stall.name, built.data.updated)
    if ([...names.values()].includes(name)) name = name.replace(/\.pdf$/, `-${stall.slug}.pdf`)
    names.set(stall.slug, name)
  }

  const publicData = structuredClone(built.data)
  for (const stall of publicData.stalls) {
    if (stall.status === "ok") stall.pdf = names.get(stall.slug)
  }
  const body = `${JSON.stringify(publicData, null, 2)}\n`
  if (publicTextHasSecrets(body, built.pii)) {
    opts.log?.("public-data")
    return { ok: false, error: "refused" }
  }

  const pledgeBySlug = Object.fromEntries(built.pledges.stalls.map((stall) => [stall.slug, stall]))
  const pdfKeys = []
  for (const stall of publicData.stalls) {
    const slug = stall.slug
    const pledge = pledgeBySlug[slug] || { contacts: [], families: [] }
    const prior = useKept[slug]
    const wrote = Boolean(rowsBySlug[slug])
    if (stall.status !== "ok") continue
    if (!wrote && !prior) continue
    const contacts = wrote ? pledge.contacts : (prior.contacts || [])
    const bytes = await renderStallPdf({
      name: stall.name,
      years: stall.year_groups,
      kind: stall.money_only ? "money" : "food",
      money_only: stall.money_only,
      connected: true,
      as_of: publicData.updated,
      responses: stall.responses,
      families: stall.families,
      last_response: stall.last_response || "-",
      contribution: stall.contribution,
      targets: targetsFrom(stall),
      money: stall.money,
      money_line: stall.money_line,
      minimum_note: stall.minimum_note,
      contacts,
    })
    const key = `sheets/${names.get(slug)}`
    await store.set(key, bytes)
    pdfKeys.push(key)
    await store.setJSON(`state/${slug}.json`, {
      entry: { ...stall },
      contacts,
      families: wrote ? pledge.families : (prior.families || []),
    })
  }

  await store.set("data.json", body)
  const previousKeys = new Set((await store.get("manifest.json", { type: "json" }))?.pdfs || [])
  for (const key of previousKeys) {
    if (!pdfKeys.includes(key)) {
      try {
        await store.delete(key)
      } catch {
        /* The previous file is already gone. */
      }
    }
  }
  await store.setJSON("manifest.json", { pdfs: pdfKeys })
  return { ok: true }
}
