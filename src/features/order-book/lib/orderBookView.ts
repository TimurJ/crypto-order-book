// Pure view-model: exchange strings stay strings; floats only for derived values (see ../CLAUDE.md).

import { type BookLevel, selectTopLevels } from "@/lib/order-book/bookLevels.ts"
import type {
  OrderBookSnapshot,
  OrderBookStatus,
} from "@/lib/order-book/orderBookSync.ts"

export interface ViewLevel {
  price: string
  qty: string
  /** Running quantity sum from best price down to this level. */
  cumulative: number
  /** Running Σ(price × qty) from best price down to this level — feeds the hover aggregates. */
  cumulativeQuote: number
  /** Bar width 0–100, scaled to the OWN side's max cumulative — per-side fill by design. */
  barPct: number
}

export interface OrderBookView {
  status: OrderBookStatus
  /** The presentation fork: false → skeleton; true + non-live → dimmed book. "destroyed" → false. */
  hasBook: boolean
  bids: ViewLevel[]
  asks: ViewLevel[]
  /** Best-ask minus best-bid; null while a side is empty or the book is crossed/locked. */
  spread: number | null
  /** spread / bestAsk × 100 — null exactly when spread is null. */
  spreadPct: number | null
  /** (bestBid + bestAsk) / 2 — null exactly when spread is null (same crossed-book guard). */
  mid: number | null
  /** Buy/sell share of the window's volume, whole percents summing to 100; null while no volume. */
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
  // Crossed/locked guard: mid and spreadPct share the spread's null exactly.
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
