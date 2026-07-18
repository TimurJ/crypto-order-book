// Exercises the health feature at the layered mocking levels from docs/tanstack-query-setup.md:
// cache seeding (no fetch at all), fetch-level mocks (real queryFn + fetchJson end to end),
// the degraded error path — which also asserts the reportError seam fired — and the
// last-known-good posture (a failed background refetch never discards cached data).

import { screen, waitFor } from "@testing-library/react"
import { HttpError } from "@/lib/query/fetch-json.ts"
import { createTestQueryClient } from "@/test/query-client.ts"
import { renderWithClient } from "@/test/render-with-client.tsx"
import { type AppHealth, healthQueryOptions } from "./health-query.ts"
import { HealthStatus } from "./health-status.tsx"

const health: AppHealth = {
  status: "ok",
  env: "test",
  now: "2026-07-18T00:00:00.000Z",
}

describe("HealthStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders from a seeded cache without fetching", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const client = createTestQueryClient()
    client.setQueryData(healthQueryOptions().queryKey, health)

    renderWithClient(<HealthStatus />, client)

    expect(screen.getByText("api: ok")).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("fetches through the real queryFn end to end, forwarding the signal", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(health)))

    renderWithClient(<HealthStatus />)

    expect(await screen.findByText("api: ok")).toBeInTheDocument()
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it("shows the pending state while the request is in flight", () => {
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>(() => {})
    )

    renderWithClient(<HealthStatus />)

    expect(screen.getByText("api: checking…")).toBeInTheDocument()
  })

  it("degrades to unreachable on HTTP errors and reports through the seam", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("boom", { status: 503, statusText: "Service Unavailable" })
    )

    renderWithClient(<HealthStatus />)

    expect(await screen.findByText("api: unreachable")).toBeInTheDocument()
    expect(errorSpy).toHaveBeenCalledWith(
      "[reportError] query:cache",
      expect.any(HttpError)
    )
  })

  it("keeps showing last-known-good data when a background refetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("boom", { status: 503, statusText: "Service Unavailable" })
    )
    const client = createTestQueryClient()
    const { queryKey } = healthQueryOptions()
    client.setQueryData(queryKey, health)

    renderWithClient(<HealthStatus />, client)
    expect(screen.getByText("api: ok")).toBeInTheDocument()

    client.refetchQueries({ queryKey }).catch(() => undefined)

    // Gate on the query state, not the refetch promise — v5 keeps `data` alongside the error.
    await waitFor(() =>
      expect(client.getQueryState(queryKey)?.status).toBe("error")
    )
    expect(screen.getByText("api: ok")).toBeInTheDocument()
    expect(screen.queryByText("api: unreachable")).toBeNull()
  })
})
