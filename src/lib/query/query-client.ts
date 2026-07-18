// QueryClient factory — the single source of truth for query defaults and the error-reporting
// seam. main.tsx calls it once (one client per tab); tests call it per-test for isolated caches
// with the *same* defaults (src/test/query-client.ts layers test-only overrides on top).
// Cache-level onError callbacks can only be set at construction, which is why the factory —
// not the call site — owns them. Full rationale per line: docs/tanstack-query-setup.md.
//
// House rule: React code reaches the client via useQueryClient(), never by importing an
// instance — there is deliberately no exported singleton here.

import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query"
import { reportError } from "@/lib/report-error.ts"
import { HttpError, ParseError } from "./fetch-json.ts"

export function createQueryClient(): QueryClient {
  return new QueryClient({
    // Fires once per failed *query* (after retries are exhausted), no matter how many
    // components observe it — the v5 replacement for the removed per-hook onError.
    queryCache: new QueryCache({
      onError: (error, query) =>
        reportError(error, { source: "query:cache", queryKey: query.queryKey }),
    }),
    mutationCache: new MutationCache({
      onError: (error) => reportError(error, { source: "query:mutation" }),
    }),
    defaultOptions: {
      queries: {
        // Cached data is trusted (no background refetch on mount/focus) for 30s;
        // per-resource overrides live in each queryOptions module.
        staleTime: 30_000,
        // Library default, made visible: unused entries linger 5 min for instant back-nav.
        gcTime: 5 * 60_000,
        // Never retry 4xx — a client error is a fact retrying can't fix (and retrying 429s
        // digs the hole deeper) — nor ParseErrors (a malformed body is deterministic).
        // Network errors / 5xx get 2 retries (3 attempts total).
        retry: (failureCount, error) => {
          if (error instanceof HttpError && error.status < 500) return false
          if (error instanceof ParseError) return false
          return failureCount < 2
        },
        // Defaults kept deliberately: with a non-zero staleTime these refetch only
        // genuinely stale data when the tab regains focus / network — exactly what a
        // market-data app wants.
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        // Failures stay in the hook's `error` field; components render degraded states.
        // Load-bearing queries opt into throwOnError per-query (error-boundary roadmap).
        throwOnError: false,
      },
    },
  })
}
