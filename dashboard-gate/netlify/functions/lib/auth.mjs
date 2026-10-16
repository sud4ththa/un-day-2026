import { createHash, createHmac, timingSafeEqual } from "node:crypto"

export const SESSION_TTL_SECONDS = 12 * 60 * 60
export const COOKIE_NAME = "undash"
export const SEND_LIMIT = 3
export const IP_SEND_LIMIT = 8
export const VERIFY_LIMIT = 10
export const WINDOW_MS = 15 * 60 * 1000

export const PEOPLE = [
  { id: "sudaththa", name: "Sudaththa", env: "PHONE_SUDATHTHA" },
  { id: "subraja", name: "Subraja", env: "PHONE_SUBRAJA" },
  { id: "zainab", name: "Zainab", env: "PHONE_ZAINAB" },
]

export function personById(id) {
  return PEOPLE.find((person) => person.id === id) || null
}

export function normalizePhone(raw) {
  const trimmed = String(raw || "").trim().replace(/[\s-]/g, "")
  if (!/^\+[1-9]\d{7,14}$/.test(trimmed)) return null
  return trimmed
}

/** Country code and the last two digits only. The rest are bullets. */
export function maskPhone(raw) {
  const phone = normalizePhone(raw)
  if (!phone) return "your mobile"
  const digits = phone.slice(1)
  const middle = digits.slice(2, -2)
  return `+${digits.slice(0, 2)} ${"•".repeat(middle.length)} ${digits.slice(-2)}`
}

export function allowStamp(stamps, now, limit, windowMs = WINDOW_MS) {
  const fresh = (Array.isArray(stamps) ? stamps : []).filter((t) => typeof t === "number" && now - t < windowMs)
  if (fresh.length >= limit) {
    return { ok: false, stamps: fresh, retryMs: windowMs - (now - fresh[0]) }
  }
  return { ok: true, stamps: [...fresh, now], retryMs: 0 }
}

export function signSession(who, exp, secret) {
  const body = Buffer.from(JSON.stringify({ who, exp }), "utf8").toString("base64url")
  const sig = createHmac("sha256", secret).update(body).digest("base64url")
  return `${body}.${sig}`
}

export function readSession(token, secret, nowSeconds) {
  if (!token || !secret || !token.includes(".")) return null
  const dot = token.lastIndexOf(".")
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = createHmac("sha256", secret).update(body).digest("base64url")
  const got = Buffer.from(sig)
  const want = Buffer.from(expected)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  let payload
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (!payload || typeof payload.exp !== "number" || !personById(payload.who)) return null
  if (payload.exp <= nowSeconds) return null
  return { who: payload.who, exp: payload.exp }
}

export function readCookie(header, name) {
  if (!header) return ""
  for (const part of header.split(";")) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1)
  }
  return ""
}

export function sessionCookie(token, { secure, maxAge }) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ]
  if (secure) parts.push("Secure")
  return parts.join("; ")
}

export function ipHash(ip, secret) {
  return createHash("sha256").update(`${secret}\n${ip}`).digest("hex").slice(0, 24)
}

export function viewKey(pathname) {
  let path
  try {
    path = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (path.includes("\\") || path.includes("\0") || path.includes("//")) return null
  if (path === "/view" || path === "/view/") return "index.html"
  if (!path.startsWith("/view/")) return null
  const rest = path.slice("/view/".length)
  if (rest === "index.html") return "index.html"
  if (!/^(data\.json|report-pdf\.js|og\.jpg|sheets\/[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.pdf)$/.test(rest)) {
    return null
  }
  return rest
}

export function decorateDashboard(html) {
  let out = String(html)
  if (!out.includes("<base ")) {
    out = out.replace("<head>", '<head>\n<base href="/view/">')
  }
  if (!out.includes("gate-session")) {
    const bar = [
      '<style>.gate-session{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:.78rem;letter-spacing:.04em;text-align:right;padding:.65rem 1.1rem 0}.gate-session a{color:inherit}</style>',
      '<div class="gate-session">Signed in · <a href="/api/logout">Sign out</a></div>',
    ].join("\n")
    out = out.replace("<body>", `<body>\n${bar}`)
  }
  return out
}

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
}

export function contentType(key) {
  if (key.endsWith(".html")) return "text/html; charset=utf-8"
  if (key.endsWith(".json")) return "application/json; charset=utf-8"
  if (key.endsWith(".js")) return "text/javascript; charset=utf-8"
  if (key.endsWith(".jpg")) return "image/jpeg"
  if (key.endsWith(".pdf")) return "application/pdf"
  return "application/octet-stream"
}

export function privateHeaders(key) {
  const headers = { ...PRIVATE_HEADERS, "content-type": contentType(key) }
  if (key.endsWith(".pdf")) {
    const filename = key.slice(key.lastIndexOf("/") + 1)
    headers["content-disposition"] = `attachment; filename="${filename}"`
  }
  return headers
}
