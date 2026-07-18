// Shared builder for every Worker-generated response (config.js, /api/*). One home for the
// header block so the endpoints can't drift on it:
//
// - `_headers` (public/_headers) only covers responses served by Static Assets — it CANNOT
//   attach headers to Worker-generated responses, so `nosniff` must be set in code here.
// - `no-store`: these responses differ per env / per request and must never be cached at the
//   edge or browser, or they'd outlive a deploy.
//
// Web-`Response` only (no Workers-specific types), so it type-checks under both the Worker
// project (generated worker-configuration.d.ts) and the test project (DOM lib).

export function noStoreResponse(
  body: string,
  contentType: string,
  status = 200
): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  })
}
