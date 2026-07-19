// Level-change flash tracking, keyed BY PRICE, never by slot: a rank shift (every row
// below an inserted level moves down one slot) must not light the ladder — only a level
// whose quantity actually changed, or a price newly entering the window, flashes. Each
// flash carries a DIRECTION (design handoff: green when the size grew, red when it
// shrank; new-to-window counts as "up" — quantity appeared).
//
// Two-layer mechanism. useLevelFlashes diffs the visible window per render and emits the
// MAP of freshly changed prices → direction; useRowFlash (one per slot side, inside the
// row) folds membership into a slot-local monotonic key and latches the direction at
// bump time, so a parked overlay keeps its color. The ladder mounts the flash overlay
// keyed by that number, so a bump remounts just the overlay and restarts its CSS
// animation — while a pure rank shift leaves every slot's key untouched (index-keyed
// rows update in place), which is what makes replayed flashes on row movement
// impossible. A naive `${price}:${seq}` overlay key fails exactly there: an
// already-flashed price changing slots would remount and spuriously replay.
//
// Flashes fire ONLY on a continuous `live → live` commit. Every other transition — the
// first sync, a `syncing`/gap-partial commit, `degraded`, and the edge back into `live` —
// re-baselines silently. A self-heal replaces the whole book in one commit (the engine
// clears and rebuilds its Maps on every resync), and diffing that wholesale swap against
// the pre-resync book would flash most of the ladder at once — noise that misrepresents
// which levels actually moved on the stream. Keying off status (not a level-count
// heuristic) is what makes this robust to WHEN the engine commits book data vs status: a
// gap inside the buffered run commits a changed partial book while still `syncing`, and
// that must not flash either.
//
// Render purity is load-bearing in BOTH hooks: next state is derived purely from a ref
// committed in an effect after render, so StrictMode's double render computes identical
// results twice instead of double-bumping. Departed prices drop out of the tracking map,
// so it never outgrows the visible window.

import { useEffect, useRef } from "react"
import type { OrderBookStatus } from "@/lib/order-book/order-book-sync.ts"

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

/**
 * Diff the current visible levels against the previously committed ones. When `silent`,
 * record the new baseline WITHOUT flagging any change — used whenever the commit isn't a
 * continuous live-stream update, so a wholesale book swap (first sync / resync) re-baselines
 * instead of lighting the whole ladder. Direction compares numerically, so a cosmetic
 * string change ("1.0" → "1.00") is no change at all.
 */
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
  // Flash only while streaming: this commit AND the last are both "live". Any other commit
  // (first sync, syncing/gap-partial, degraded, the edge into live) re-baselines silently.
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

/**
 * Slot-local flash state: bumps the key once per render in which `direction` is set and
 * latches that direction as the overlay's tone. The caller mounts the overlay only while
 * the key is > 0 and keys it by this number — see the module header for why this beats
 * keying by `${price}:${seq}`.
 */
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
