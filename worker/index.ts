// Thin Cloudflare Worker fronting the static SPA.
//
// Its only job today is to serve /config.js — the per-environment runtime config — from the
// Worker's `vars` (see wrangler.jsonc). Everything else falls through to the static assets.
// Keeping env config here (not in `import.meta.env`) is what makes build-once-promote work: the
// same built bundle is deployed unchanged to dev/uat/prod, and only this response differs.
//
// Security headers: the static document + assets get theirs from public/_headers (served directly
// by Static Assets). Cloudflare's `_headers` does NOT apply to Worker-generated responses, so
// /config.js sets its own header (nosniff) in configResponse — see worker/config-response.ts.
//
// Future API routes / Durable Object + Container bindings branch here before the ASSETS fallback.

import { configResponse, type RuntimeConfigEnv } from "./config-response.ts"

interface Env extends RuntimeConfigEnv {
  ASSETS: Fetcher
}

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const url = new URL(request.url)

    // Per-environment runtime config. Worker-generated, so `_headers` can't touch it; its headers
    // (`cache-control: no-store`, `nosniff`) are set in configResponse. Routed worker-first via
    // run_worker_first in wrangler.jsonc.
    if (url.pathname === "/config.js") {
      return configResponse(env)
    }

    // Static assets, with SPA fallback to index.html (assets.not_found_handling in wrangler.jsonc).
    return env.ASSETS.fetch(request)
  },
}
