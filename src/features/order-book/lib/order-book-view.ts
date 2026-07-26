// Pure view-model for the rendered order book: one pass from the engine's snapshot to
// everything the ladder needs. No React imports — this module is unit-tested directly.
//
// The float line: exchange-given values (price/qty strings) keep their exact string
// identity all the way to the formatter (order-book-format.ts). DERIVED values —
// cumulative totals, quote sums, bar percentages, mid, spread, imbalance — are our own
// computed quantities, so Number() double math is honest here (display-only, precision
// far beyond what's shown). Do not "fix" these into string arithmetic, and never
// float-format the exchange's own strings.

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
  /** Running Σ(price × qty) from best price down to this level — feeds the hover aggregates. */
  cumulativeQuote: number
  /**
   * Bar width, 0–100, scaled to the OWN side's max cumulative (the design's per-side
   * fill — both sides reach 100% at their worst level). The cross-side imbalance signal
   * the previous scaling carried lives in the imbalance bar now.
   */
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
  /** spread / bestAsk × 100 — null exactly when spread is null. */
  spreadPct: number | null
  /** (bestBid + bestAsk) / 2 — null exactly when spread is null (same crossed-book guard). */
  mid: number | null
  /**
   * Buy/sell share of the visible window's total volume, whole percents summing to 100.
   * Null until at least one side has volume.
   */
  imbalance: { bidPct: number; askPct: number } | null
  resyncCount: number
  droppedFrames: number
}

interface CumulativeLevel extends BookLevel {
  cumulative: number
  cumulativeQuote: number
}

function accumulate(levels: BookLevel[]): CumulativeLevel[] {
  let sum = 0
  let quoteSum = 0
  return levels.map(({ price, qty }) => {
    sum += Number(qty)
    quoteSum += Number(price) * Number(qty)
    return { price, qty, cumulative: sum, cumulativeQuote: quoteSum }
  })
}

function withBarPct(levels: CumulativeLevel[]): ViewLevel[] {
  const maxCumulative = levels.at(-1)?.cumulative ?? 0
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
  const bestBid = bids[0]
  const bestAsk = asks[0]
  const rawSpread =
    bestBid && bestAsk ? Number(bestAsk.price) - Number(bestBid.price) : null
  // Guard a crossed/locked book (bid >= ask): never surface a non-positive spread, and
  // never derive a mid from one — mid/spreadPct share the spread's null exactly.
  const spread = rawSpread !== null && rawSpread > 0 ? rawSpread : null
  const mid =
    spread !== null && bestBid && bestAsk
      ? (Number(bestBid.price) + Number(bestAsk.price)) / 2
      : null
  const spreadPct =
    spread !== null && bestAsk ? (spread / Number(bestAsk.price)) * 100 : null
  const bidTotal = bids.at(-1)?.cumulative ?? 0
  const askTotal = asks.at(-1)?.cumulative ?? 0
  const totalVolume = bidTotal + askTotal
  const bidPct =
    totalVolume > 0 ? Math.round((bidTotal / totalVolume) * 100) : 0
  return {
    status: snapshot.status,
    hasBook: snapshot.lastUpdateId > 0 && snapshot.status !== "destroyed",
    bids: withBarPct(bids),
    asks: withBarPct(asks),
    spread,
    spreadPct,
    mid,
    imbalance: totalVolume > 0 ? { bidPct, askPct: 100 - bidPct } : null,
    resyncCount: snapshot.resyncCount,
    droppedFrames: snapshot.droppedFrames,
  }
}
