import {
  createIdleSnapshot,
  type OrderBookSnapshot,
} from "@/lib/order-book/order-book-sync.ts"
import { selectOrderBookView } from "./order-book-view.ts"

function makeSnapshot(
  overrides: Partial<OrderBookSnapshot> = {}
): OrderBookSnapshot {
  return { ...createIdleSnapshot("BTCUSDT"), status: "live", ...overrides }
}

const liveSnapshot = makeSnapshot({
  status: "live",
  lastUpdateId: 42,
  bids: new Map([
    ["100.00", "2.0"],
    ["101.00", "1.0"],
    ["99.00", "4.0"],
  ]),
  asks: new Map([
    ["103.00", "1.0"],
    ["102.00", "0.5"],
    ["104.00", "0.5"],
  ]),
})

describe("selectOrderBookView", () => {
  it("sorts bids descending and asks ascending", () => {
    const view = selectOrderBookView(liveSnapshot, 20)
    expect(view.bids.map((l) => l.price)).toEqual(["101.00", "100.00", "99.00"])
    expect(view.asks.map((l) => l.price)).toEqual([
      "102.00",
      "103.00",
      "104.00",
    ])
  })

  it("slices to the requested level count", () => {
    const view = selectOrderBookView(liveSnapshot, 2)
    expect(view.bids).toHaveLength(2)
    expect(view.asks).toHaveLength(2)
  })

  it("returns short sides when the book has fewer levels than asked", () => {
    const view = selectOrderBookView(liveSnapshot, 20)
    expect(view.bids).toHaveLength(3)
    expect(view.asks).toHaveLength(3)
  })

  it("accumulates cumulative sums non-decreasing from best price", () => {
    const view = selectOrderBookView(liveSnapshot, 20)
    expect(view.bids.map((l) => l.cumulative)).toEqual([1, 3, 7])
    expect(view.asks.map((l) => l.cumulative)).toEqual([0.5, 1.5, 2])
  })

  it("scales bar percentages to each side's own max (design's per-side fill)", () => {
    const view = selectOrderBookView(liveSnapshot, 20)
    // Bid side total 7, ask side total 2 — each side's worst level reaches 100%.
    expect(view.bids.at(-1)?.barPct).toBe(100)
    expect(view.asks.at(-1)?.barPct).toBe(100)
    expect(view.bids[0]?.barPct).toBeCloseTo((1 / 7) * 100)
    expect(view.asks[0]?.barPct).toBeCloseTo((0.5 / 2) * 100)
  })

  it("accumulates quote sums (Σ price × qty) from the best price down", () => {
    const view = selectOrderBookView(liveSnapshot, 20)
    // Bids: 101×1, +100×2, +99×4 · Asks: 102×0.5, +103×1, +104×0.5
    expect(view.bids.map((l) => l.cumulativeQuote)).toEqual([101, 301, 697])
    expect(view.asks.map((l) => l.cumulativeQuote)).toEqual([51, 154, 206])
  })

  it("derives the spread from best bid and best ask", () => {
    const view = selectOrderBookView(liveSnapshot, 20)
    expect(view.spread).toBeCloseTo(1)
  })

  it("derives mid and spread percentage alongside the spread", () => {
    const view = selectOrderBookView(liveSnapshot, 20)
    expect(view.mid).toBeCloseTo(101.5)
    expect(view.spreadPct).toBeCloseTo((1 / 102) * 100)
  })

  it("nulls mid and spreadPct exactly when the spread is null", () => {
    const crossed = selectOrderBookView(
      makeSnapshot({
        lastUpdateId: 1,
        bids: new Map([["101.00", "1.0"]]),
        asks: new Map([["100.00", "1.0"]]),
      }),
      20
    )
    expect(crossed.spread).toBeNull()
    expect(crossed.mid).toBeNull()
    expect(crossed.spreadPct).toBeNull()
  })

  it("computes the imbalance split as whole percents summing to 100", () => {
    const view = selectOrderBookView(liveSnapshot, 20)
    // Bid volume 7 vs ask volume 2 → 78% / 22% (rounded).
    expect(view.imbalance).toEqual({ bidPct: 78, askPct: 22 })
  })

  it("gives a one-sided book the full imbalance share", () => {
    const view = selectOrderBookView(
      makeSnapshot({ lastUpdateId: 1, bids: new Map([["100.00", "1.0"]]) }),
      20
    )
    expect(view.imbalance).toEqual({ bidPct: 100, askPct: 0 })
  })

  it("nulls the imbalance when the visible window has no volume", () => {
    const view = selectOrderBookView(makeSnapshot(), 20)
    expect(view.imbalance).toBeNull()
  })

  it("returns a null spread when a side is empty", () => {
    const view = selectOrderBookView(
      makeSnapshot({ lastUpdateId: 1, bids: new Map([["100.00", "1.0"]]) }),
      20
    )
    expect(view.spread).toBeNull()
  })

  it("returns a null spread for a crossed or locked book", () => {
    const crossed = selectOrderBookView(
      makeSnapshot({
        lastUpdateId: 1,
        bids: new Map([["101.00", "1.0"]]),
        asks: new Map([["100.00", "1.0"]]),
      }),
      20
    )
    expect(crossed.spread).toBeNull()
    const locked = selectOrderBookView(
      makeSnapshot({
        lastUpdateId: 1,
        bids: new Map([["100.00", "1.0"]]),
        asks: new Map([["100.00", "1.0"]]),
      }),
      20
    )
    expect(locked.spread).toBeNull()
  })

  it("handles an empty book with zero bar percentages", () => {
    const view = selectOrderBookView(makeSnapshot(), 20)
    expect(view.bids).toEqual([])
    expect(view.asks).toEqual([])
    expect(view.spread).toBeNull()
  })

  it("reports hasBook false before the first sync", () => {
    expect(selectOrderBookView(makeSnapshot(), 20).hasBook).toBe(false)
  })

  it("reports hasBook true once a sync completed, even while resyncing", () => {
    const view = selectOrderBookView(
      makeSnapshot({ status: "syncing", lastUpdateId: 42 }),
      20
    )
    expect(view.hasBook).toBe(true)
  })

  it("maps destroyed like pre-book idle even when the maps still hold data", () => {
    const view = selectOrderBookView(
      makeSnapshot({
        status: "destroyed",
        lastUpdateId: 42,
        bids: new Map([["100.00", "1.0"]]),
      }),
      20
    )
    expect(view.hasBook).toBe(false)
  })

  it("passes through status and diagnostics counters", () => {
    const view = selectOrderBookView(
      makeSnapshot({ status: "degraded", resyncCount: 3, droppedFrames: 1 }),
      20
    )
    expect(view.status).toBe("degraded")
    expect(view.resyncCount).toBe(3)
    expect(view.droppedFrames).toBe(1)
  })
})
