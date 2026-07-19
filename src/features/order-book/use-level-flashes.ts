// Level-change flash tracking, keyed BY PRICE, never by slot: a rank shift (every row
// below an inserted level moves down one slot) must not light the ladder — only a level
// whose quantity actually changed, or a price newly entering the window, flashes.
//
// Two-layer mechanism. useLevelFlashes diffs the visible window per render and emits the
// SET of freshly changed prices; useFlashKey (one per slot side, inside the row) folds
// membership into a slot-local monotonic key. The ladder mounts the flash overlay keyed
// by that number, so a bump remounts just the overlay and restarts its CSS animation —
// while a pure rank shift leaves every slot's key untouched (index-keyed rows update in
// place), which is what makes replayed flashes on row movement impossible. A naive
// `${price}:${seq}` overlay key fails exactly there: an already-flashed price changing
// slots would remount and spuriously replay.
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

export interface FlashDiff {
  qtyByPrice: ReadonlyMap<string, string>
  changed: ReadonlySet<string>
}

export const EMPTY_FLASH_DIFF: FlashDiff = {
  qtyByPrice: new Map(),
  changed: new Set(),
}

/**
 * Diff the current visible levels against the previously committed ones. When `silent`,
 * record the new baseline WITHOUT flagging any change — used whenever the commit isn't a
 * continuous live-stream update, so a wholesale book swap (first sync / resync) re-baselines
 * instead of lighting the whole ladder.
 */
export function diffChangedPrices(
  prev: FlashDiff,
  levels: readonly PricedLevel[],
  silent: boolean
): FlashDiff {
  const qtyByPrice = new Map<string, string>()
  const changed = new Set<string>()
  for (const { price, qty } of levels) {
    qtyByPrice.set(price, qty)
    // Covers both flash cases: qty changed (prev qty differs) and new-to-window (prev qty
    // undefined). A silent commit records the baseline but flags nothing.
    if (!silent && prev.qtyByPrice.get(price) !== qty) {
      changed.add(price)
    }
  }
  return { qtyByPrice, changed }
}

export interface LevelFlashes {
  bidFlashes: ReadonlySet<string>
  askFlashes: ReadonlySet<string>
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

/**
 * Slot-local flash key: bumps once per render in which `fresh` is true. The caller
 * mounts the overlay only while the key is > 0 and keys it by this number — see the
 * module header for why this beats keying by `${price}:${seq}`.
 */
export function useFlashKey(fresh: boolean): number {
  const committed = useRef(0)
  const next = fresh ? committed.current + 1 : committed.current
  useEffect(() => {
    committed.current = next
  })
  return next
}
