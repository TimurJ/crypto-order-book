// Test QueryClient: the REAL factory (same defaults, same reporting seam — zero drift) with
// two test-only overrides. retry: false — otherwise error-state tests sit through the real
// backoff (~3s per failing query) before `error` ever appears. gcTime: Infinity — the
// v5-recommended test setting: finite gc schedules cache-eviction timers that can fire after
// a test's teardown (act-warnings / hung-worker noise); Infinity schedules nothing, and the
// client is discarded with the test anyway.

import type { QueryClient } from "@tanstack/react-query"
import { createQueryClient } from "@/lib/query/query-client.ts"

export function createTestQueryClient(): QueryClient {
  const client = createQueryClient()
  client.setDefaultOptions({
    queries: {
      ...client.getDefaultOptions().queries,
      retry: false,
      gcTime: Number.POSITIVE_INFINITY,
    },
  })
  return client
}
