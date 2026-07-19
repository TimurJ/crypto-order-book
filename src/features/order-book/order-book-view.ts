// Pure view-model for the rendered order book: one pass from the engine's snapshot to
// everything the ladder needs. No React imports — this module is unit-tested directly.
//
// The float line: exchange-given values (price/qty strings) keep their exact string
// identity all the way to the formatter (order-book-format.ts). DERIVED values —
// cumulative totals, bar percentages, the spread — are our own computed quantities,
// so Number() double math is honest here (display-only, precision far beyond what's
// shown). Do not "fix" these into string arithmetic, and never float-format the
// exchange's own strings.

import {
  type BookLevel,
  selectTopLevels,
} from "@/lib/order-book/book-levels.ts"
import type {
  OrderBookSnapshot,
  OrderBookStatus,
} from "@/lib/order-book/order-book-sync.ts"

export interface ViewLevel {
  price: string
  qty: string
  /** Running quantity sum from best price down to this level. */
  cumulative: number
  /** Bar width, 0–100, scaled to the cross-side max cumulative (imbalance stays visible). */
  barPct: number
}

export interface OrderBookView {
  status: OrderBookStatus
  /**
   * Whether a first sync ever completed. Presentation forks on this, not on status:
   * false → skeleton; true + non-live status → last-known book, dimmed. "destroyed"
   * maps to false (render like pre-book idle) even though the Maps still hold data.
   */
  hasBook: boolean
  bids: ViewLevel[]
  asks: ViewLevel[]
  /**
   * Best-ask minus best-bid; null until both sides have a level, and also null if the
   * local book is momentarily crossed or locked (a non-positive difference) — defensive,
   * since a correctly-stitched book never crosses. The display renders null as "—".
   */
  spread: number | null
  resyncCount: number
  droppedFrames: number
}

interface CumulativeLevel extends BookLevel {
  cumulative: number
}

function accumulate(levels: BookLevel[]): CumulativeLevel[] {
  let sum = 0
  return levels.map(({ price, qty }) => {
    sum += Number(qty)
    return { price, qty, cumulative: sum }
  })
}

function withBarPct(
  levels: CumulativeLevel[],
  maxCumulative: number
): ViewLevel[] {
  return levels.map((level) => ({
    ...level,
    barPct: maxCumulative > 0 ? (level.cumulative / maxCumulative) * 100 : 0,
  }))
}

export function selectOrderBookView(
  snapshot: OrderBookSnapshot,
  levelCount: number
): OrderBookView {
  const bids = accumulate(selectTopLevels(snapshot.bids, "bids", levelCount))
  const asks = accumulate(selectTopLevels(snapshot.asks, "asks", levelCount))
  const maxCumulative = Math.max(
    bids.at(-1)?.cumulative ?? 0,
    asks.at(-1)?.cumulative ?? 0
  )
  const bestBid = bids[0]
  const bestAsk = asks[0]
  const rawSpread =
    bestBid && bestAsk ? Number(bestAsk.price) - Number(bestBid.price) : null
  return {
    status: snapshot.status,
    hasBook: snapshot.lastUpdateId > 0 && snapshot.status !== "destroyed",
    bids: withBarPct(bids, maxCumulative),
    asks: withBarPct(asks, maxCumulative),
    // Guard a crossed/locked book (bid >= ask): never surface a negative or zero spread.
    spread: rawSpread !== null && rawSpread > 0 ? rawSpread : null,
    resyncCount: snapshot.resyncCount,
    droppedFrames: snapshot.droppedFrames,
  }
}
