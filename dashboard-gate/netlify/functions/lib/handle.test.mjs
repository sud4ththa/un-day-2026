import assert from "node:assert/strict"
import test from "node:test"
import { COOKIE_NAME, readCookie } from "./auth.mjs"
import { handle } from "./handle.mjs"

const PHONES = {
  sudaththa: "+94771234567",
  subraja: "+94770000002",
  zainab: "+94770000003",
}

const ENV = {
  TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  TWILIO_AUTH_TOKEN: "auth-token-not-a-phone",
  TWILIO_VERIFY_SERVICE_SID: "VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  PHONE_SUDATHTHA: PHONES.sudaththa,
  PHONE_SUBRAJA: PHONES.subraja,
  PHONE_ZAINAB: PHONES.zainab,
  SESSION_SECRET: "test-session-secret-at-least-32-chars",
}

function memoryStore(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    async get(key, opts) {
      if (!map.has(key)) return null
      const value = map.get(key)
      if (opts?.type === "json") return value
      if (opts?.type === "arrayBuffer") return value
      return value
    },
    async setJSON(key, value) {
      map.set(key, value)
    },
  }
}

function twilio(statusFor) {
  const calls = []
  const fetch = async (url, opts) => {
    const params = new URLSearchParams(opts.body)
    calls.push({
      url: String(url),
      to: params.get("To"),
      code: params.get("Code"),
      channel: params.get("Channel"),
      auth: opts.headers.authorization,
    })
    const status = statusFor(String(url), params)
    return new Response(JSON.stringify(status.body), { status: status.code })
  }
  return { fetch, calls }
}

function request(path, { method = "GET", body, cookie } = {}) {
  const headers = new Headers()
  if (body) headers.set("content-type", "application/json")
  if (cookie) headers.set("cookie", cookie)
  return new Request(`https://gate.example${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

function deps(extra = {}) {
  return {
    env: { ...ENV },
    dashboard: memoryStore(),
    limits: memoryStore(),
    fetch: async () => {
      throw new Error("twilio should not be called")
    },
    ip: "203.0.113.8",
    now: () => 1_800_000_000_000,
    ...extra,
  }
}

function assertNoPhones(text) {
  for (const phone of Object.values(PHONES)) {
    assert.equal(text.includes(phone), false, phone)
    assert.equal(text.includes(phone.slice(3, -2)), false, phone)
  }
}

test("only the three people can be sent a code, and the browser phone is ignored", async () => {
  const sms = twilio(() => ({ code: 201, body: { status: "pending" } }))
  const gate = deps({ fetch: sms.fetch })
  const stranger = await handle(request("/api/send", { method: "POST", body: { who: "parent", phone: "+15555550199" } }), gate)
  assert.equal(stranger.status, 400)
  assert.equal(sms.calls.length, 0)

  const sent = await handle(request("/api/send", {
    method: "POST",
    body: { who: "zainab", phone: "+15555550199" },
  }), gate)
  assert.equal(sent.status, 200)
  const payload = await sent.json()
  assert.equal(payload.masked, "+94 ••••••• 03")
  assert.equal(sms.calls.length, 1)
  assert.equal(sms.calls[0].to, PHONES.zainab)
  assert.equal(sms.calls[0].channel, "sms")
  assert.match(sms.calls[0].url, /\/Verifications$/)
  assert.match(sms.calls[0].auth, /^Basic /)
  assertNoPhones(JSON.stringify(payload))
})

test("a fourth code in the window is refused before Twilio", async () => {
  const sms = twilio(() => ({ code: 201, body: { status: "pending" } }))
  const gate = deps({ fetch: sms.fetch })
  for (let i = 0; i < 3; i += 1) {
    const res = await handle(request("/api/send", { method: "POST", body: { who: "sudaththa" } }), gate)
    assert.equal(res.status, 200)
  }
  const blocked = await handle(request("/api/send", { method: "POST", body: { who: "sudaththa" } }), gate)
  assert.equal(blocked.status, 429)
  assert.equal(sms.calls.length, 3)
  assertNoPhones(await blocked.text())
})

test("an approved code sets a twelve-hour cookie and unlocks the files", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.4 contact 0770000000")
  const dashboard = memoryStore({
    "index.html": "<html><head></head><body><p>FIGURES-42</p></body></html>",
    "data.json": "{\"responses\":42}\n",
    "sheets/UN-Day-Stall-Sri-Lanka-2026-10-07.pdf": pdf,
  })
  const sms = twilio((url) => {
    if (url.endsWith("/VerificationCheck")) return { code: 200, body: { status: "approved" } }
    return { code: 201, body: { status: "pending" } }
  })
  const gate = deps({ fetch: sms.fetch, dashboard })

  const locked = await handle(request("/view/data.json"), gate)
  assert.equal(locked.status, 302)
  assert.equal(locked.headers.get("location"), "/")
  assert.equal(await locked.text(), "")

  const lockedPdf = await handle(request("/view/sheets/UN-Day-Stall-Sri-Lanka-2026-10-07.pdf"), gate)
  assert.equal(lockedPdf.status, 302)
  assert.equal(await lockedPdf.text(), "")

  const wrong = await handle(request("/api/verify", { method: "POST", body: { who: "sudaththa", code: "000000" } }), deps({
    fetch: twilio(() => ({ code: 200, body: { status: "pending" } })).fetch,
    dashboard,
    limits: gate.limits,
  }))
  assert.equal(wrong.status, 401)
  assert.equal(wrong.headers.get("set-cookie"), null)

  const ok = await handle(request("/api/verify", { method: "POST", body: { who: "sudaththa", code: "123456" } }), gate)
  assert.equal(ok.status, 200)
  const setCookie = ok.headers.get("set-cookie")
  assert.match(setCookie, /HttpOnly/)
  assert.match(setCookie, /Secure/)
  assert.match(setCookie, /SameSite=Lax/)
  assert.match(setCookie, /Max-Age=43200/)
  assertNoPhones(setCookie)
  assertNoPhones(await ok.clone().text())
  const cookie = setCookie.split(";")[0]
  assert.equal(readCookie(cookie, COOKIE_NAME).length > 20, true)

  const page = await handle(request("/view/", { cookie }), gate)
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /FIGURES-42/)
  assert.match(html, /<base href="\/view\/">/)
  assert.match(page.headers.get("cache-control"), /no-store/)

  const data = await handle(request("/view/data.json", { cookie }), gate)
  assert.match(await data.text(), /"responses":42/)

  const file = await handle(request("/view/sheets/UN-Day-Stall-Sri-Lanka-2026-10-07.pdf", { cookie }), gate)
  assert.equal(file.headers.get("content-type"), "application/pdf")
  assert.match(file.headers.get("content-disposition"), /UN-Day-Stall-Sri-Lanka-2026-10-07\.pdf/)
  assert.equal(new TextDecoder().decode(await file.arrayBuffer()), new TextDecoder().decode(pdf))

  const escape = await handle(request("/view/sheets/../../data.json", { cookie }), gate)
  assert.equal(escape.status, 404)

  const session = await handle(request("/api/session", { cookie }), gate)
  assert.deepEqual(await session.json(), { ok: true, name: "Sudaththa" })
})

test("sign-in is refused when Twilio is not configured", async () => {
  const res = await handle(request("/api/send", { method: "POST", body: { who: "subraja" } }), deps({
    env: { ...ENV, TWILIO_AUTH_TOKEN: "" },
  }))
  assert.equal(res.status, 500)
  assert.match(await res.text(), /not set up/)
})
