// Flash tracking keyed by price, fired only on live→live commits, render-pure.
// The full mechanism and its invariants: ../CLAUDE.md (Flashes).

import { useEffect, useRef } from "react"
import type { OrderBookStatus } from "@/lib/order-book/orderBookSync.ts"

interface PricedLevel {
  price: string
  qty: string
}

export type FlashDirection = "up" | "down"

export interface FlashDiff {
  qtyByPrice: ReadonlyMap<string, string>
  changed: ReadonlyMap<string, FlashDirection>
}

export const EMPTY_FLASH_DIFF: FlashDiff = {
  qtyByPrice: new Map(),
  changed: new Map(),
}

/** Diffs the window against the last commit; `silent` records the baseline without flagging. */
export function diffChangedPrices(
  prev: FlashDiff,
  levels: readonly PricedLevel[],
  silent: boolean
): FlashDiff {
  const qtyByPrice = new Map<string, string>()
  const changed = new Map<string, FlashDirection>()
  for (const { price, qty } of levels) {
    qtyByPrice.set(price, qty)
    if (silent) continue
    const prevQty = prev.qtyByPrice.get(price)
    if (prevQty === undefined) {
      // New to the window: the quantity appeared out of nothing — an increase.
      changed.set(price, "up")
    } else {
      const delta = Number(qty) - Number(prevQty)
      if (delta > 0) changed.set(price, "up")
      else if (delta < 0) changed.set(price, "down")
    }
  }
  return { qtyByPrice, changed }
}

export interface LevelFlashes {
  bidFlashes: ReadonlyMap<string, FlashDirection>
  askFlashes: ReadonlyMap<string, FlashDirection>
}

export function useLevelFlashes(
  bids: readonly PricedLevel[],
  asks: readonly PricedLevel[],
  status: OrderBookStatus
): LevelFlashes {
  const previous = useRef<{
    bids: FlashDiff
    asks: FlashDiff
    status: OrderBookStatus
  }>({
    bids: EMPTY_FLASH_DIFF,
    asks: EMPTY_FLASH_DIFF,
    status: "idle",
  })
  // Flash only when this commit AND the last are both "live"; anything else re-baselines silently.
  const silent = !(status === "live" && previous.current.status === "live")
  const nextBids = diffChangedPrices(previous.current.bids, bids, silent)
  const nextAsks = diffChangedPrices(previous.current.asks, asks, silent)
  useEffect(() => {
    previous.current = { bids: nextBids, asks: nextAsks, status }
  })
  return { bidFlashes: nextBids.changed, askFlashes: nextAsks.changed }
}

export interface RowFlash {
  /** Slot-local monotonic key — the overlay mounts while > 0 and remounts on each bump. */
  key: number
  /** Direction latched at the last bump, so a parked overlay keeps its color. */
  tone: FlashDirection | null
}

/** Bumps the slot-local key when `direction` is set and latches it as the overlay's tone. */
export function useRowFlash(direction: FlashDirection | null): RowFlash {
  const committed = useRef<RowFlash>({ key: 0, tone: null })
  const next: RowFlash = direction
    ? { key: committed.current.key + 1, tone: direction }
    : committed.current
  useEffect(() => {
    committed.current = next
  })
  return next
}
