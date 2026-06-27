// Thin Cloudflare Worker fronting the static SPA.
//
// Its only job today is to serve /config.js — the per-environment runtime config — from the
// Worker's `vars` (see wrangler.jsonc). Everything else falls through to the static assets.
// Keeping env config here (not in `import.meta.env`) is what makes build-once-promote work: the
// same built bundle is deployed unchanged to dev/uat/prod, and only this response differs.
//
// Future API routes / Durable Object + Container bindings branch here before the ASSETS fallback.

interface Env {
  ASSETS: Fetcher
  APP_ENV: string
  API_BASE_URL: string
  WS_URL: string
}

function configScript(env: Env): string {
  const config = {
    env: env.APP_ENV,
    apiBaseUrl: env.API_BASE_URL,
    wsUrl: env.WS_URL,
  }
  return `window.__APP_CONFIG__ = ${JSON.stringify(config)}`
}

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    const url = new URL(request.url)

    // Per-environment runtime config. `no-store` because it differs per env and must never be
    // cached at the edge/browser and outlive a deploy. Routed worker-first via run_worker_first.
    if (url.pathname === "/config.js") {
      return new Response(configScript(env), {
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-store",
        },
      })
    }

    // Static assets, with SPA fallback to index.html (assets.not_found_handling in wrangler.jsonc).
    return env.ASSETS.fetch(request)
  },
}
