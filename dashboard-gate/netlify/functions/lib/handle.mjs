import {
  COOKIE_NAME,
  IP_SEND_LIMIT,
  SEND_LIMIT,
  SESSION_TTL_SECONDS,
  VERIFY_LIMIT,
  WINDOW_MS,
  allowStamp,
  decorateDashboard,
  ipHash,
  maskPhone,
  normalizePhone,
  personById,
  privateHeaders,
  readCookie,
  readSession,
  sessionCookie,
  signSession,
  viewKey,
} from "./auth.mjs"

const TWILIO_VARS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"]

function json(status, body, headers = {}) {
  const text = JSON.stringify(body)
  if (/\d{8,}/.test(text)) {
    console.error("blocked a response that contained a long number")
    return new Response(JSON.stringify({ ok: false, error: "Something went wrong. Try again." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    })
  }
  return new Response(text, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  })
}

function clientIp(req, explicit) {
  if (explicit) return explicit
  return req.headers.get("x-nf-client-connection-ip") || ""
}

function secureCookie(req) {
  const host = new URL(req.url).hostname
  return host !== "localhost" && host !== "127.0.0.1"
}

async function readJson(req) {
  const length = Number(req.headers.get("content-length") || 0)
  if (length > 4000) return { error: "too-large" }
  let text
  try {
    text = await req.text()
  } catch {
    return { error: "bad-json" }
  }
  if (text.length > 4000) return { error: "too-large" }
  try {
    const data = JSON.parse(text)
    if (!data || typeof data !== "object") return { error: "bad-json" }
    return { data }
  } catch {
    return { error: "bad-json" }
  }
}

function configuredPhone(env, person) {
  const phone = normalizePhone(env[person.env])
  if (!phone) {
    console.error(`missing or invalid ${person.env}`)
    return null
  }
  return phone
}

function twilioReady(env) {
  const missing = TWILIO_VARS.filter((name) => !env[name])
  if (!missing.length && !env.SESSION_SECRET) missing.push("SESSION_SECRET")
  if (missing.length) {
    console.error(`missing env ${missing.join(", ")}`)
    return false
  }
  if (String(env.SESSION_SECRET).length < 32) {
    console.error("SESSION_SECRET is too short")
    return false
  }
  return true
}

async function loadStamps(store, key) {
  const data = await store.get(key, { type: "json" })
  return data && Array.isArray(data.stamps) ? data.stamps : []
}

async function takeSlot(store, key, now, limit) {
  const current = await loadStamps(store, key)
  const next = allowStamp(current, now, limit, WINDOW_MS)
  if (!next.ok) return next
  await store.setJSON(key, { stamps: next.stamps })
  return next
}

async function twilio(fetchImpl, env, action, params) {
  const service = env.TWILIO_VERIFY_SERVICE_SID
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")
  const res = await fetchImpl(`https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/${action}`, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  })
  let data = {}
  try {
    data = await res.json()
  } catch {
    data = {}
  }
  return { status: res.status, data }
}

function requestPath(req) {
  return new URL(req.url).pathname
}

function currentSession(req, env, nowMs) {
  const token = readCookie(req.headers.get("cookie"), COOKIE_NAME)
  return readSession(token, env.SESSION_SECRET || "", Math.floor(nowMs / 1000))
}

async function sendCode(req, deps) {
  if (!twilioReady(deps.env)) return json(500, { ok: false, error: "Sign-in is not set up yet." })
  const body = await readJson(req)
  if (body.error) return json(400, { ok: false, error: "Choose Sudaththa, Subraja, or Zainab." })
  const person = personById(body.data.who)
  if (!person) return json(400, { ok: false, error: "Choose Sudaththa, Subraja, or Zainab." })
  const now = deps.now()
  const personSlot = await takeSlot(deps.limits, `send:${person.id}`, now, SEND_LIMIT)
  if (!personSlot.ok) {
    return json(429, { ok: false, error: "Too many codes. Wait a few minutes and try again." })
  }
  const ip = clientIp(req, deps.ip)
  if (ip) {
    const ipSlot = await takeSlot(deps.limits, `send-ip:${ipHash(ip, deps.env.SESSION_SECRET)}`, now, IP_SEND_LIMIT)
    if (!ipSlot.ok) {
      return json(429, { ok: false, error: "Too many codes. Wait a few minutes and try again." })
    }
  }
  const phone = configuredPhone(deps.env, person)
  if (!phone) return json(500, { ok: false, error: "Sign-in is not set up yet." })
  let result
  try {
    result = await twilio(deps.fetch, deps.env, "Verifications", { To: phone, Channel: "sms" })
  } catch (err) {
    console.error("verify send failed", err && err.name)
    return json(502, { ok: false, error: "The code could not be sent. Try again in a minute." })
  }
  if (result.status === 429) {
    return json(429, { ok: false, error: "Too many codes. Wait a few minutes and try again." })
  }
  if (result.status < 200 || result.status >= 300) {
    console.error("verify send status", result.status)
    return json(502, { ok: false, error: "The code could not be sent. Try again in a minute." })
  }
  return json(200, { ok: true, name: person.name, masked: maskPhone(phone) })
}

async function verifyCode(req, deps) {
  if (!twilioReady(deps.env)) return json(500, { ok: false, error: "Sign-in is not set up yet." })
  const body = await readJson(req)
  if (body.error) return json(400, { ok: false, error: "Enter the code from the text message." })
  const person = personById(body.data.who)
  const code = String(body.data.code || "").replace(/\s/g, "")
  if (!person || !/^\d{4,10}$/.test(code)) {
    return json(400, { ok: false, error: "Enter the code from the text message." })
  }
  const now = deps.now()
  const slot = await takeSlot(deps.limits, `check:${person.id}`, now, VERIFY_LIMIT)
  if (!slot.ok) {
    return json(429, { ok: false, error: "Too many tries. Wait a few minutes and ask for a new code." })
  }
  const phone = configuredPhone(deps.env, person)
  if (!phone) return json(500, { ok: false, error: "Sign-in is not set up yet." })
  let result
  try {
    result = await twilio(deps.fetch, deps.env, "VerificationCheck", { To: phone, Code: code })
  } catch (err) {
    console.error("verify check failed", err && err.name)
    return json(502, { ok: false, error: "The code could not be checked. Try again." })
  }
  if (result.status === 429 || result.data?.code === 60202) {
    return json(429, { ok: false, error: "Too many tries. Wait a few minutes and ask for a new code." })
  }
  if (result.data?.status !== "approved") {
    const expired = result.status === 404 || result.data?.code === 20404
    return json(401, {
      ok: false,
      error: expired
        ? "That code has expired. Ask for a new one."
        : "That code is not right. Try again.",
    })
  }
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS
  const token = signSession(person.id, exp, deps.env.SESSION_SECRET)
  return json(200, { ok: true, name: person.name }, {
    "set-cookie": sessionCookie(token, { secure: secureCookie(req), maxAge: SESSION_TTL_SECONDS }),
  })
}

function sessionInfo(req, deps) {
  const session = currentSession(req, deps.env, deps.now())
  if (!session) return json(401, { ok: false })
  const person = personById(session.who)
  return json(200, { ok: true, name: person.name })
}

function logout(req) {
  return new Response(null, {
    status: 302,
    headers: {
      location: "/",
      "cache-control": "no-store",
      "set-cookie": sessionCookie("", { secure: secureCookie(req), maxAge: 0 }),
    },
  })
}

async function serveAsset(req, deps, key) {
  const session = currentSession(req, deps.env, deps.now())
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: { location: "/", "cache-control": "no-store" },
    })
  }
  let data
  try {
    const type = key.endsWith(".pdf") || key.endsWith(".jpg") ? "arrayBuffer" : "text"
    data = await deps.dashboard.get(key, { type })
  } catch (err) {
    console.error("dashboard read failed", err && err.name)
    return new Response("The dashboard could not be opened. Try again in a minute.", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    })
  }
  if (data == null) {
    const missing = key === "index.html"
      ? "The stall dashboard has not been uploaded yet."
      : "That file is not on the dashboard."
    return new Response(missing, {
      status: key === "index.html" ? 503 : 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    })
  }
  const headers = privateHeaders(key)
  if (key === "index.html") {
    return new Response(decorateDashboard(data), { status: 200, headers })
  }
  const bytes = typeof data === "string" ? data : data
  return new Response(bytes, { status: 200, headers })
}

export async function handle(req, deps) {
  const path = requestPath(req)
  const method = req.method.toUpperCase()
  try {
    if (path === "/api/send" && method === "POST") return await sendCode(req, deps)
    if (path === "/api/verify" && method === "POST") return await verifyCode(req, deps)
    if (path === "/api/session" && method === "GET") return sessionInfo(req, deps)
    if (path === "/api/logout" && (method === "GET" || method === "POST")) return logout(req)
    if (method === "GET" || method === "HEAD") {
      const key = viewKey(path)
      if (key) {
        if (method === "HEAD") {
          const res = await serveAsset(req, deps, key)
          return new Response(null, { status: res.status, headers: res.headers })
        }
        return serveAsset(req, deps, key)
      }
    }
    if (path.startsWith("/api/") || path === "/view" || path.startsWith("/view/")) {
      return json(404, { ok: false, error: "Not found." })
    }
    return json(404, { ok: false, error: "Not found." })
  } catch (err) {
    console.error("gate failed", err && err.name)
    return json(500, { ok: false, error: "Something went wrong. Try again." })
  }
}
