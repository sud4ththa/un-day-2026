import { getStore } from "@netlify/blobs"
import { refreshDashboard } from "./lib/refresh.mjs"

const STORE_NAME = "stall-dashboard"
const REGION = "us-east-2"

export default async () => {
  const result = await refreshDashboard({
    env: process.env,
    store: getStore({ name: STORE_NAME, region: REGION }),
    fetch: globalThis.fetch,
    now: new Date(),
    manual: false,
    log: (slug) => console.error(slug),
  })
  const status = result.ok || result.skipped ? 200 : 500
  const body = result.skipped ? "skipped" : result.ok ? "ok" : "error"
  return new Response(body, { status, headers: { "cache-control": "no-store" } })
}

// 01:37–16:37 UTC lands on 07:07–22:07 Asia/Colombo. The function skips the
// 06:37 Colombo tick. Minutes are off the hour.
export const config = {
  schedule: "7,37 1-16 * * *",
}
