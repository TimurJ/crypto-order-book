// Binance order-book sync engine — part 2 of the connection stack. Owns a ws-transport
// instance (part 1) and maintains a correct local book per Binance's documented procedure:
// buffer stream events → fetch REST snapshot → discard covered events → apply the rest →
// verify continuity on every subsequent event. A continuity gap means the book is silently
// wrong, so it is thrown away and the dance re-runs IN PLACE over the healthy socket
// (correctness comes from the update-ID math, not from a fresh connection). Every failure
// path is detected → responded → reported; sync failures retry forever with full-jitter
// backoff ("degraded" after 3 consecutive failures is advisory, never terminal).
// Decisions, spec verification, and failure-mode matrix: docs/order-book-sync-architecture.md.
//
// Store contract (useSyncExternalStore-ready, like the transport's): the snapshot object is
// rebuilt on EVERY commit, but `bids`/`asks` are the engine's own Maps, shared by reference.
// That is safe because every mutation is followed synchronously by rebuild + notify — the
// snapshot's identity always changes when its contents do. Do not mutate outside commit().
//
// Single-use, like the transport: destroy() is terminal; create a fresh engine to restart.

import { fullJitterDelay } from "@/lib/connection/backoff.ts"
import {
  createWsTransport,
  type WsTransport,
} from "@/lib/connection/ws-transport.ts"
import { reportError } from "@/lib/report-error.ts"
import { fetchDepthSnapshot, isBinanceRateLimited } from "./binance-rest.ts"
import {
  type DepthLevel,
  type DepthSnapshot,
  type DepthUpdate,
  depthUpdateSchema,
} from "./binance-schemas.ts"

export type OrderBookStatus =
  | "idle"
  | "connecting"
  | "syncing"
  | "live"
  | "degraded"
  | "destroyed"

export interface OrderBookSnapshot {
  status: OrderBookStatus
  symbol: string
  /** price → quantity, exact decimal strings. Unsorted — order via selectTopLevels. */
  bids: ReadonlyMap<string, string>
  asks: ReadonlyMap<string, string>
  /** Update ID the book reflects; 0 until the first successful sync. */
  lastUpdateId: number
  /** Completed re-syncs after the first successful sync. */
  resyncCount: number
  /** Malformed frames discarded (the continuity check self-heals any that mattered). */
  droppedFrames: number
}

export interface OrderBookSyncOptions {
  /** Binance symbol, e.g. "BTCUSDT" (lowercased for the stream path). */
  symbol: string
  /** e.g. "wss://data-stream.binance.vision" — from getConfig().wsUrl. */
  wsBaseUrl: string
  /** e.g. "https://data-api.binance.vision" — from getConfig().binanceRestUrl. */
  restBaseUrl: string
  depthLimit?: number
  staleThresholdMs?: number
  snapshotRetryBaseMs?: number
  snapshotRetryMaxMs?: number
  /** Minimum wait after a 429/418 — respects Binance's ban escalation. */
  rateLimitFloorMs?: number
  bufferLimit?: number
  degradedAfterAttempts?: number
}

export interface OrderBookSync {
  start: () => void
  /** Terminal — create a fresh engine to restart. */
  destroy: () => void
  subscribe: (listener: () => void) => () => void
  getState: () => OrderBookSnapshot
}

export function createOrderBookSync(
  options: OrderBookSyncOptions
): OrderBookSync {
  const {
    symbol,
    wsBaseUrl,
    restBaseUrl,
    depthLimit = 5_000,
    staleThresholdMs = 10_000,
    snapshotRetryBaseMs = 500,
    snapshotRetryMaxMs = 10_000,
    rateLimitFloorMs = 30_000,
    bufferLimit = 1_000,
    degradedAfterAttempts = 3,
  } = options

  let status: OrderBookStatus = "idle"
  let lastUpdateId = 0
  let resyncCount = 0
  let droppedFrames = 0
  let syncedOnce = false
  // Per-dance backoff counter — reset every fresh dance so the jitter ladder restarts.
  let failedAttempts = 0
  // Degraded-latch counter — failures since the last SUCCESSFUL sync. Unlike failedAttempts
  // it survives reconnects/re-dances, so a prolonged flapping+failing outage still latches
  // "degraded" instead of resetting to 0 on every reopen.
  let failuresSinceSync = 0
  // performance.now() deadline for the post-429/418 rate-limit floor. Held here, not only in
  // retryTimer, so a transport reconnect (which clears the timer) can't bypass the floor.
  let rateLimitedUntil = 0
  // Bumped whenever an in-flight snapshot attempt is superseded (resync, overflow,
  // transport drop, destroy) — a resolving fetch from an old generation is discarded,
  // so it can never install a stale book.
  let generation = 0
  let transport: WsTransport | null = null
  let abortController: AbortController | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let buffer: DepthUpdate[] = []
  let buffering = false
  const bids = new Map<string, string>()
  const asks = new Map<string, string>()
  const listeners = new Set<() => void>()

  const buildSnapshot = (): OrderBookSnapshot => ({
    status,
    symbol,
    bids,
    asks,
    lastUpdateId,
    resyncCount,
    droppedFrames,
  })
  let snapshot = buildSnapshot()

  const report = (error: unknown) => {
    reportError(error, { source: "order-book:sync" })
  }

  const commit = () => {
    snapshot = buildSnapshot()
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        // A throwing subscriber must not wedge a commit mid-flight.
        report(error)
      }
    }
  }

  const setStatus = (next: OrderBookStatus) => {
    if (status === next) return
    status = next
    commit()
  }

  const applySide = (map: Map<string, string>, levels: DepthLevel[]) => {
    for (const [price, qty] of levels) {
      // Quantities are absolute; zero means "remove this price level". Removing an
      // absent level is a documented no-op (Map.delete already is one).
      if (Number(qty) === 0) {
        map.delete(price)
      } else {
        map.set(price, qty)
      }
    }
  }

  // Spec update rule: u < bookId → stale, ignore; U > bookId + 1 → we missed updates,
  // the book is provably wrong → gap. Overlap (U <= bookId + 1 <= u) applies safely
  // because quantities are absolute.
  const applyEvent = (event: DepthUpdate): "applied" | "ignored" | "gap" => {
    if (event.u < lastUpdateId) return "ignored"
    if (event.U > lastUpdateId + 1) return "gap"
    applySide(bids, event.b)
    applySide(asks, event.a)
    lastUpdateId = event.u
    return "applied"
  }

  const supersedeAttempt = () => {
    generation += 1
    abortController?.abort()
    abortController = null
    clearTimeout(retryTimer)
  }

  // Full re-dance: new generation, fresh buffer, immediate snapshot attempt. One code
  // path for the initial sync, every reconnect, and every detected gap. Gap callers pass
  // the still-contiguous events as `seed` so stream continuity survives the restart.
  const beginResync = (seed: DepthUpdate[] = []) => {
    if (status === "destroyed") return
    supersedeAttempt()
    // A fresh dance restarts the per-dance backoff ladder, so reset the backoff counter (a
    // reconnect/gap resync shouldn't inherit a prior dance's inflated delay). The degraded
    // latch (failuresSinceSync) deliberately does NOT reset here — it clears only on a
    // successful sync, so a flapping-and-failing outage still surfaces "degraded".
    failedAttempts = 0
    buffer = seed
    buffering = true
    // "degraded" survives until a sync completes — it tells part 3 "still not healthy",
    // which a flip through "syncing" every retry would hide.
    if (status !== "degraded") setStatus("syncing")
    void runSnapshotAttempt()
  }

  const armRetry = (ms: number) => {
    retryTimer = setTimeout(() => {
      void runSnapshotAttempt()
    }, ms)
  }

  const scheduleRetry = (error: unknown) => {
    failuresSinceSync += 1
    report(error)
    // "degraded" tracks failures since the last successful sync (persists across reconnects),
    // not the per-dance backoff count.
    if (failuresSinceSync >= degradedAfterAttempts) setStatus("degraded")
    // The spec's "go back to step 3" taken literally would hot-loop a weight-250 request
    // against a lagging REST replica — full-jitter backoff, with a hard floor after a
    // rate-limit response.
    const backoff = fullJitterDelay(
      failedAttempts,
      snapshotRetryBaseMs,
      snapshotRetryMaxMs
    )
    failedAttempts += 1
    const rateLimited = isBinanceRateLimited(error)
    const delay = rateLimited ? Math.max(rateLimitFloorMs, backoff) : backoff
    // The floor must outlive this timer: a reconnect clears retryTimer, so record a deadline
    // runSnapshotAttempt re-checks before every fetch (else a reopen bypasses the floor).
    if (rateLimited) rateLimitedUntil = performance.now() + delay
    armRetry(delay)
  }

  const runSnapshotAttempt = async () => {
    // Respect an active rate-limit floor even across a reconnect: the deadline outlives the
    // retry timer a transport drop would have cleared, so a reopen can't hammer a banned IP.
    const wait = rateLimitedUntil - performance.now()
    if (wait > 0) {
      armRetry(wait)
      return
    }
    const gen = generation
    const controller = new AbortController()
    abortController = controller
    let depthSnapshot: DepthSnapshot
    try {
      depthSnapshot = await fetchDepthSnapshot({
        restBaseUrl,
        symbol,
        limit: depthLimit,
        signal: controller.signal,
      })
    } catch (error) {
      // Superseded attempts (resync, transport drop, destroy) were aborted on purpose —
      // swallow silently. Every superseding path bumps the generation.
      if (gen !== generation) return
      scheduleRetry(error)
      return
    }
    if (gen !== generation) return

    const firstBufferedU = buffer[0]?.U
    if (
      firstBufferedU !== undefined &&
      depthSnapshot.lastUpdateId < firstBufferedU - 1
    ) {
      // REST replica is behind the stream by more than the overlap boundary: even the first
      // buffered event would gap (applyEvent needs U <= lastUpdateId + 1), so nothing can be
      // stitched. The exact-one-behind case (lastUpdateId == first U - 1) IS stitchable and
      // falls through. Keep buffering, refetch after backoff.
      scheduleRetry(
        new Error(
          `depth snapshot ${depthSnapshot.lastUpdateId} predates first buffered update ${firstBufferedU} (${symbol})`
        )
      )
      return
    }

    bids.clear()
    asks.clear()
    applySide(bids, depthSnapshot.bids)
    applySide(asks, depthSnapshot.asks)
    lastUpdateId = depthSnapshot.lastUpdateId

    const pending = buffer
    buffer = []
    buffering = false
    for (const [index, event] of pending.entries()) {
      const result = applyEvent(event)
      if (result === "gap") {
        // A hole inside the buffered run (e.g. a dropped malformed frame). The events
        // from the gap onward are still contiguous with the live stream, so they seed
        // the next attempt's buffer instead of being thrown away. The snapshot + pre-gap
        // events already mutated the shared Maps, so commit the (consistent) partial book
        // before re-dancing — beginResync's setStatus is a no-op mid-dance and would
        // otherwise leave the exposed snapshot's scalars stale against its Maps.
        report(gapError(event))
        commit()
        beginResync(pending.slice(index))
        return
      }
    }

    failedAttempts = 0
    failuresSinceSync = 0
    rateLimitedUntil = 0
    if (syncedOnce) resyncCount += 1
    syncedOnce = true
    status = "live"
    commit()
  }

  const gapError = (event: DepthUpdate) =>
    new Error(
      `order book continuity gap: event U=${event.U} > lastUpdateId+1=${lastUpdateId + 1} (${symbol})`
    )

  // Drop is always safe: if the frame mattered, the next frame fails the continuity
  // check and forces a resync (the self-healing property).
  const dropFrame = (error: unknown) => {
    droppedFrames += 1
    report(error)
    commit()
  }

  const handleFrame = (raw: string) => {
    if (status === "destroyed") return
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch (cause) {
      dropFrame(new Error(`unparseable depth frame (${symbol})`, { cause }))
      return
    }
    const parsed = depthUpdateSchema.safeParse(json)
    if (!parsed.success) {
      dropFrame(parsed.error)
      return
    }
    if (buffering) {
      if (buffer.length >= bufferLimit) {
        // Oldest-dropping would be unsound (pre-snapshot we can't know which events
        // the snapshot covers), so overflow makes this attempt unsalvageable. The frame
        // in hand seeds the next attempt's buffer — continuity is unbroken.
        supersedeAttempt()
        buffer = [parsed.data]
        scheduleRetry(
          new Error(
            `depth buffer overflow (> ${bufferLimit} events) awaiting snapshot (${symbol})`
          )
        )
        return
      }
      buffer.push(parsed.data)
      return
    }
    const result = applyEvent(parsed.data)
    if (result === "gap") {
      report(gapError(parsed.data))
      beginResync([parsed.data])
      return
    }
    if (result === "applied") commit()
  }

  return {
    start: () => {
      if (status !== "idle") return
      const streamUrl = `${wsBaseUrl}/ws/${symbol.toLowerCase()}@depth@100ms`
      const ws = createWsTransport({
        url: streamUrl,
        onMessage: handleFrame,
        // Fires on EVERY (re)open — initial connect, the 24h forced disconnect, watchdog
        // force-reconnects. Reconnect always means stream discontinuity, so: re-dance.
        onOpen: beginResync,
        staleThresholdMs,
      })
      transport = ws
      ws.subscribe(() => {
        if (status === "destroyed") return
        const transportStatus = ws.getState().status
        // "open" is handled by onOpen; "closed" only follows our own destroy().
        if (transportStatus === "open" || transportStatus === "closed") return
        // Stream is down: frames can't arrive, so an in-flight snapshot could never be
        // stitched — abandon the attempt and let the reopen start a fresh one.
        supersedeAttempt()
        buffer = []
        buffering = false
        // Preserve "degraded" across the drop (still-unhealthy signal) — mirror beginResync's
        // guard, else a reconnect flashes "connecting"→"syncing" while sync is still failing.
        if (status !== "degraded") setStatus("connecting")
      })
      setStatus("connecting")
      ws.connect()
    },
    destroy: () => {
      if (status === "destroyed") return
      supersedeAttempt()
      const ws = transport
      transport = null
      setStatus("destroyed")
      ws?.destroy()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getState: () => snapshot,
  }
}
