import assert from "node:assert/strict"
import test from "node:test"
import {
  SESSION_TTL_SECONDS,
  allowStamp,
  decorateDashboard,
  maskPhone,
  readSession,
  signSession,
  viewKey,
} from "./auth.mjs"

const SECRET = "test-session-secret-at-least-32-chars"

test("mask shows the country code and the last two digits", () => {
  const masked = maskPhone("+94771234567")
  assert.equal(masked, "+94 ••••••• 67")
  assert.equal(masked.includes("7712345"), false)
  assert.equal(masked.includes("771234567"), false)
  assert.equal(maskPhone("0771234567"), "your mobile")
  assert.equal(maskPhone("+94 77 123 4567"), "+94 ••••••• 67")
})

test("session cookie lasts twelve hours and rejects tampering", () => {
  const now = 1_700_000_000
  const token = signSession("subraja", now + SESSION_TTL_SECONDS, SECRET)
  assert.deepEqual(readSession(token, SECRET, now), { who: "subraja", exp: now + SESSION_TTL_SECONDS })
  assert.equal(readSession(token, SECRET, now + SESSION_TTL_SECONDS), null)
  assert.equal(readSession(token.slice(0, -2) + "aa", SECRET, now), null)
  assert.equal(readSession(token, "another-secret-that-is-long-enough", now), null)
  assert.equal(SESSION_TTL_SECONDS, 12 * 60 * 60)
})

test("view paths stay inside the dashboard files", () => {
  assert.equal(viewKey("/view"), "index.html")
  assert.equal(viewKey("/view/"), "index.html")
  assert.equal(viewKey("/view/data.json"), "data.json")
  assert.equal(viewKey("/view/sheets/UN-Day-Stall-Sri-Lanka-2026-10-07.pdf"), "sheets/UN-Day-Stall-Sri-Lanka-2026-10-07.pdf")
  assert.equal(viewKey("/view/sheets/../../data.json"), null)
  assert.equal(viewKey("/view/%2e%2e/data.json"), null)
  assert.equal(viewKey("/view/sheets/%2e%2e%2fdata.json"), null)
  assert.equal(viewKey("/data.json"), null)
  assert.equal(viewKey("/view/private-bundle.json"), null)
})

test("send limit is three stamps inside the window", () => {
  let stamps = []
  for (let i = 0; i < 3; i += 1) {
    const next = allowStamp(stamps, 1_000 + i, 3, 100)
    assert.equal(next.ok, true)
    stamps = next.stamps
  }
  assert.equal(allowStamp(stamps, 1_010, 3, 100).ok, false)
  assert.equal(allowStamp(stamps, 1_200, 3, 100).ok, true)
})

test("dashboard html is served under /view/", () => {
  const html = decorateDashboard("<html><head></head><body><p>Counts</p></body></html>")
  assert.match(html, /<base href="\/view\/">/)
  assert.match(html, /Sign out/)
  assert.match(html, /href="\/api\/logout"/)
})
