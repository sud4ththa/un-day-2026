import { getStore } from "@netlify/blobs"
import { handle } from "./lib/handle.mjs"
import { refreshDashboard } from "./lib/refresh.mjs"

// Keep in step with scripts/publish-dashboard.py (store name, site: prefix, region).
export const STORE_NAME = "stall-dashboard"
export const REGION = "us-east-2"

export default async (req, context) => {
  return handle(req, {
    env: process.env,
    dashboard: getStore({ name: STORE_NAME, region: REGION }),
    limits: getStore({ name: "stall-dashboard-auth", region: REGION }),
    fetch: globalThis.fetch,
    ip: context?.ip || "",
    now: () => Date.now(),
    refresh: (opts) => refreshDashboard({ ...opts, fetch: opts.fetch || globalThis.fetch }),
  })
}

export const config = {
  path: ["/api/*", "/view", "/view/*"],
}
