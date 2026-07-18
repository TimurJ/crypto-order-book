// queryOptions module for the /api/health resource — the house pattern: every resource's
// key, queryFn and per-resource tuning live together in ONE typed unit in its feature dir
// (never inline in components). The same object drives useQuery, prefetchQuery, and typed
// getQueryData. Contract served by the Worker (worker/health-response.ts) and the dev server
// twin (vite.config.ts); shape documented in docs/tanstack-query-setup.md.

import { queryOptions } from "@tanstack/react-query"
import { fetchJson } from "@/lib/query/fetch-json.ts"

export interface AppHealth {
  status: "ok"
  env: string
  now: string
}

// A function (not a constant) even with zero params — parameterised resources
// (e.g. tickerQueryOptions(symbol)) force the function shape; one uniform shape for all.
export function healthQueryOptions() {
  return queryOptions({
    queryKey: ["health"],
    // Own-Worker endpoint from this same repo ⇒ the cast is trusted; third-party responses
    // must be schema-parsed here instead (see the zod section of the chronicle).
    queryFn: ({ signal }) => fetchJson<AppHealth>("/api/health", { signal }),
    staleTime: 60_000,
  })
}
