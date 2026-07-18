// Builds the 404 for unmatched /api/* paths. run_worker_first (wrangler.jsonc) routes the
// whole /api/* namespace to the Worker, so a path no route claims must NOT fall through to
// ASSETS — the SPA fallback would serve index.html at 200, masking broken/mistyped routes
// and feeding HTML to JSON consumers. An honest JSON 404 keeps the namespace truthful and
// flows through fetchJson as a non-retried HttpError(404).
//
// Same extraction rationale as config-response.ts / health-response.ts: Web-`Response` only,
// so it type-checks under both the Worker project and the test project.

import { noStoreResponse } from "./no-store-response.ts"

export function apiNotFoundResponse(pathname: string): Response {
  return noStoreResponse(
    JSON.stringify({ error: "not_found", path: pathname }),
    "application/json; charset=utf-8",
    404
  )
}
