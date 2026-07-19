import { screen } from "@testing-library/react"
import { App } from "./App.tsx"
import {
  type AppHealth,
  healthQueryOptions,
} from "@/features/health/health-query.ts"
import { createTestQueryClient } from "@/test/query-client.ts"
import { renderWithClient } from "@/test/render-with-client.tsx"

// App renders HealthStatus (useQuery), so it needs a QueryClientProvider. Seeding the health
// entry BEFORE render means the data is fresh (within staleTime) — no fetch is attempted, so
// no jsdom fetch failures and no reportError noise; assertions stay deterministic.
function renderApp() {
  const health: AppHealth = {
    status: "ok",
    env: "local",
    now: "2026-07-18T00:00:00.000Z",
  }
  const client = createTestQueryClient()
  client.setQueryData(healthQueryOptions().queryKey, health)
  return renderWithClient(<App />, client)
}

describe("App", () => {
  it("renders the shell heading", () => {
    renderApp()
    expect(
      screen.getByRole("heading", { name: "Crypto Order Book" })
    ).toBeInTheDocument()
  })

  it("renders the order-book widget on its not-configured path", () => {
    // No window.__APP_CONFIG__ in jsdom, so getConfig() falls back to empty URLs —
    // the widget guard renders its explicit state and never constructs an engine.
    renderApp()
    expect(screen.getByText("BTC/USDT")).toBeInTheDocument()
    expect(screen.getByText(/not configured/i)).toBeInTheDocument()
  })

  it("shows the env from the runtime-config fallback", () => {
    renderApp()
    expect(screen.getByText("local")).toBeInTheDocument()
  })

  it("shows the health status line from the seeded cache", () => {
    renderApp()
    expect(screen.getByText("api: ok")).toBeInTheDocument()
  })
})
