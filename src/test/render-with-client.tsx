// RTL render wrapped in a fresh, isolated QueryClientProvider — the house way to render
// anything that calls useQuery. Returns the client so tests can pre-seed the cache
// (client.setQueryData — the "data already cached" path, no fetch fired) or assert on
// cache contents afterwards. Pass your own client when a test needs to seed BEFORE mount.

import { type QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import type { ReactNode } from "react"
import { createTestQueryClient } from "./query-client.ts"

export function renderWithClient(
  ui: ReactNode,
  client: QueryClient = createTestQueryClient()
) {
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  }
}
