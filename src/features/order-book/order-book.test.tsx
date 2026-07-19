import { act, render, screen } from "@testing-library/react"
import type {
  createOrderBookSync,
  OrderBookSnapshot,
  OrderBookSyncOptions,
} from "@/lib/order-book/order-book-sync.ts"
import {
  createFakeOrderBookSync,
  type FakeOrderBookSync,
} from "@/test/fake-order-book-sync.ts"
import { OrderBook } from "./order-book.tsx"

const testConfig = {
  env: "local",
  apiBaseUrl: "",
  wsUrl: "wss://stream.example",
  binanceRestUrl: "https://rest.example",
} as const

function makeTrackedSync(initial: Partial<OrderBookSnapshot> = {}) {
  const created: FakeOrderBookSync[] = []
  const createSync = ((options: OrderBookSyncOptions) => {
    const fake = createFakeOrderBookSync({ symbol: options.symbol, ...initial })
    created.push(fake)
    return fake
  }) as typeof createOrderBookSync
  return { created, createSync }
}

function setupConfigured(initial: Partial<OrderBookSnapshot> = {}) {
  window.__APP_CONFIG__ = { ...testConfig }
  const { created, createSync } = makeTrackedSync(initial)
  const utils = render(<OrderBook createSync={createSync} />)
  const fake = created[0]
  if (!fake) throw new Error("engine was not created")
  return { created, fake, ...utils }
}

const liveBook: Partial<OrderBookSnapshot> = {
  status: "live",
  lastUpdateId: 42,
  bids: new Map([
    ["101.00", "1.5"],
    ["100.00", "2.0"],
  ]),
  asks: new Map([
    ["102.00", "0.5"],
    ["103.00", "3.0"],
  ]),
}

afterEach(() => {
  delete window.__APP_CONFIG__
})

describe("OrderBook", () => {
  it("renders the not-configured state without constructing an engine", () => {
    // No window.__APP_CONFIG__ — getConfig() falls back to empty URLs.
    const { created, createSync } = makeTrackedSync()
    render(<OrderBook createSync={createSync} />)
    expect(screen.getByText(/not configured/i)).toBeInTheDocument()
    expect(created).toHaveLength(0)
  })

  it("shows the skeleton and a visual status badge before the first sync", () => {
    const { fake } = setupConfigured()
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true")
    expect(screen.getByText("idle")).toBeInTheDocument()
    // The polite live region stays silent until the book is actually available.
    expect(screen.getByRole("status")).not.toHaveTextContent("Order book live")
    act(() => {
      fake.commit({ status: "connecting" })
    })
    expect(screen.getByText("connecting")).toBeInTheDocument()
    expect(screen.getByRole("status")).not.toHaveTextContent("Order book live")
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true")
  })

  it("renders the live book with spread, status badge, and diagnostics", () => {
    const { fake } = setupConfigured()
    act(() => {
      fake.commit(liveBook)
    })
    expect(screen.getByText("live")).toBeInTheDocument()
    // The first successful sync announces availability to the polite region.
    expect(screen.getByRole("status")).toHaveTextContent("Order book live")
    expect(screen.getByText("101.00")).toBeInTheDocument()
    expect(screen.getByText("102.00")).toBeInTheDocument()
    expect(screen.getByText("spread 1.00 USDT")).toBeInTheDocument()
    expect(screen.getByText("resyncs 0 · dropped 0")).toBeInTheDocument()
  })

  it("keeps the last-known book visible and dimmed during a resync", () => {
    const { fake, container } = setupConfigured()
    act(() => {
      fake.commit(liveBook)
    })
    act(() => {
      fake.commit({ status: "syncing" })
    })
    expect(screen.getByText("syncing")).toBeInTheDocument()
    // A routine gap resync must not re-announce to the polite region.
    expect(screen.getByRole("status")).not.toHaveTextContent("Order book live")
    // Never blank on resync: the stale book stays rendered, dimmed.
    expect(screen.getByText("101.00")).toBeInTheDocument()
    expect(container.querySelector(".opacity-60")).not.toBeNull()
  })

  it("shows the degraded alert with the pre-book wording over the skeleton", () => {
    const { fake } = setupConfigured()
    act(() => {
      fake.commit({ status: "degraded" })
    })
    expect(screen.getByText("degraded")).toBeInTheDocument()
    // Degraded is announced by the assertive Alert only, never the polite region.
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.getByRole("status")).not.toHaveTextContent("Order book live")
    expect(
      screen.getByText(/retrying until the book syncs/i)
    ).toBeInTheDocument()
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true")
  })

  it("shows the degraded alert with the stale-book wording over the dimmed book", () => {
    const { fake } = setupConfigured()
    act(() => {
      fake.commit(liveBook)
    })
    act(() => {
      fake.commit({ status: "degraded" })
    })
    expect(screen.getByText(/may be stale/i)).toBeInTheDocument()
    expect(screen.getByText("101.00")).toBeInTheDocument()
  })

  it("announces recovery politely once the degraded connection clears", () => {
    const { fake } = setupConfigured()
    act(() => {
      fake.commit(liveBook)
    })
    act(() => {
      fake.commit({ status: "degraded" })
    })
    // While degraded: the assertive Alert speaks, the polite region does not.
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.getByRole("status")).not.toHaveTextContent("Order book live")
    act(() => {
      fake.commit(liveBook)
    })
    // Recovery: the Alert is gone and only the polite region announces.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Order book live")
  })

  it("updates the diagnostics footer from the snapshot counters", () => {
    const { fake } = setupConfigured()
    act(() => {
      fake.commit({ ...liveBook, resyncCount: 2, droppedFrames: 1 })
    })
    expect(screen.getByText("resyncs 2 · dropped 1")).toBeInTheDocument()
  })

  it("maps destroyed back to the skeleton presentation", () => {
    const { fake } = setupConfigured()
    act(() => {
      fake.commit(liveBook)
    })
    act(() => {
      fake.commit({ status: "destroyed" })
    })
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true")
    expect(screen.queryByText("101.00")).not.toBeInTheDocument()
  })
})
