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

  it("scales bar percentages to the cross-side max so the thin side stays short", () => {
    const view = selectOrderBookView(liveSnapshot, 20)
    // Bid side total 7 vs ask side total 2 — shared denominator is 7.
    expect(view.bids.at(-1)?.barPct).toBe(100)
    expect(view.asks.at(-1)?.barPct).toBeCloseTo((2 / 7) * 100)
  })

  it("derives the spread from best bid and best ask", () => {
    const view = selectOrderBookView(liveSnapshot, 20)
    expect(view.spread).toBeCloseTo(1)
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
