import { createPrivateKey, createSign } from "node:crypto"

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"

function b64url(value) {
  return Buffer.from(value).toString("base64url")
}

export function parseServiceAccount(raw) {
  if (!raw || !String(raw).trim()) return { error: "missing" }
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return { error: "invalid" }
  }
  if (!data || typeof data.client_email !== "string" || typeof data.private_key !== "string") {
    return { error: "invalid" }
  }
  if (!data.client_email.includes("@") || !data.private_key.includes("PRIVATE KEY")) {
    return { error: "invalid" }
  }
  return { account: { client_email: data.client_email, private_key: data.private_key } }
}

export function parseStallSheets(raw) {
  if (!raw || !String(raw).trim()) return { error: "missing" }
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return { error: "invalid" }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "invalid" }
  const map = {}
  for (const [slug, spec] of Object.entries(data)) {
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) return { error: "invalid" }
    if (!spec || typeof spec !== "object" || typeof spec.id !== "string" || !spec.id.trim()) {
      return { error: "invalid" }
    }
    const gid = spec.gid == null ? 0 : Number(spec.gid)
    if (!Number.isInteger(gid) || gid < 0) return { error: "invalid" }
    map[slug] = { id: spec.id.trim(), gid }
  }
  if (!Object.keys(map).length) return { error: "missing" }
  return { map }
}

export async function googleAccessToken(fetchImpl, account, now) {
  const iat = Math.floor(now.getTime() / 1000)
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claim = b64url(JSON.stringify({
    iss: account.client_email,
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  }))
  const unsigned = `${header}.${claim}`
  const sign = createSign("RSA-SHA256")
  sign.update(unsigned)
  sign.end()
  const signature = sign.sign(createPrivateKey(account.private_key)).toString("base64url")
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  })
  if (!res.ok) throw new Error("google-auth")
  const body = await res.json()
  if (!body?.access_token) throw new Error("google-auth")
  return body.access_token
}

export async function readSheetValues(fetchImpl, token, spec) {
  const id = encodeURIComponent(spec.id)
  const metaRes = await fetchImpl(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  if (!metaRes.ok) throw new Error("sheet")
  const meta = await metaRes.json()
  const sheets = Array.isArray(meta?.sheets) ? meta.sheets : []
  let title = ""
  for (const sheet of sheets) {
    const props = sheet?.properties || {}
    if (props.sheetId === spec.gid) title = String(props.title || "")
  }
  if (!title && sheets[0]?.properties?.title) title = String(sheets[0].properties.title)
  if (!title) throw new Error("sheet")
  const valuesRes = await fetchImpl(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(title)}`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  if (!valuesRes.ok) throw new Error("sheet")
  const body = await valuesRes.json()
  const values = Array.isArray(body?.values) ? body.values : []
  if (!values.length) return { headers: [], rows: [] }
  const width = values.reduce((max, row) => Math.max(max, row.length), 0)
  const headers = Array.from({ length: width }, (_, i) => String(values[0][i] ?? ""))
  const rows = values.slice(1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .map((row) => Array.from({ length: width }, (_, i) => String(row[i] ?? "")))
  return { headers, rows }
}
