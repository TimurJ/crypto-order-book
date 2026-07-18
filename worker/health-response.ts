// Builds the /api/health response — the first (deliberately trivial) /api/* route.
//
// Extracted from index.ts for the same reason as config-response.ts: index.ts's Env references
// the Workers-only `Fetcher` type, while this module uses only the Web `Response`, so it
// type-checks under both the Worker project and the test project.
//
// The response is the contract the SPA's health query consumes (src/features/health/):
//   { status: "ok", env, now }
// `now` is server-generated so a live response can't be mistaken for a cached/static one.
// Headers (nosniff/no-store — the Worker-generated-response gotcha) come from the shared
// noStoreResponse helper.

import { noStoreResponse } from "./no-store-response.ts"

export interface HealthEnv {
  APP_ENV: string
}

export function healthResponse(env: HealthEnv): Response {
  const body = {
    status: "ok",
    env: env.APP_ENV,
    now: new Date().toISOString(),
  }
  return noStoreResponse(
    JSON.stringify(body),
    "application/json; charset=utf-8"
  )
}
