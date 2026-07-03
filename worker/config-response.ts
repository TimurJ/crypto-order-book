// Builds the per-environment /config.js response.
//
// Extracted from index.ts so it can be unit-tested without importing index.ts — whose `Env`
// interface references the Workers-only `Fetcher` type, which isn't in the test project's libs.
// This module only uses the Web `Response`, so it type-checks under both the Worker project
// (generated worker-configuration.d.ts) and the test project (DOM lib).
//
// `_headers` cannot set headers on this response (it's Worker-generated, not served by Static
// Assets), so the one header that matters on a JS sub-resource — `nosniff` — is set here.
// Document-level headers (CSP, frame-ancestors, …) are irrelevant on a script response and live
// in public/_headers, which covers the static document + assets.

export interface RuntimeConfigEnv {
  APP_ENV: string
  API_BASE_URL: string
  WS_URL: string
}

export function configResponse(env: RuntimeConfigEnv): Response {
  const config = {
    env: env.APP_ENV,
    apiBaseUrl: env.API_BASE_URL,
    wsUrl: env.WS_URL,
  }
  return new Response(`window.__APP_CONFIG__ = ${JSON.stringify(config)}`, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // Differs per env and must never be cached at the edge/browser and outlive a deploy.
      "cache-control": "no-store",
      // `_headers` can't reach this Worker-generated response; set nosniff here so the script is
      // never MIME-sniffed into another content type.
      "x-content-type-options": "nosniff",
    },
  })
}
