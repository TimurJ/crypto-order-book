// React seam for the part-2 sync engine: owns one engine's lifecycle and exposes its
// snapshot via useSyncExternalStore (the engine's snapshot is rebuilt on every commit
// and referentially stable between commits — exactly the getSnapshot contract).
//
// The engine is created INSIDE the effect because instances are single-use (destroy()
// is terminal). Under StrictMode's dev double-mount this runs create №1 → destroy №1 →
// create №2, so dev logs show one extra connect/abort pair per page load — expected,
// not a bug. A dependency change (e.g. a future symbol switcher) is the same path:
// destroy-and-recreate, the engine's documented restart contract.
//
// createSync is a dependency-injection seam for tests (src/test/fake-order-book-sync.ts);
// production code never passes it.

import { useEffect, useState, useSyncExternalStore } from "react"
import {
  createIdleSnapshot,
  createOrderBookSync,
  type OrderBookSnapshot,
  type OrderBookSync,
} from "@/lib/order-book/order-book-sync.ts"

export interface UseOrderBookSyncOptions {
  symbol: string
  wsBaseUrl: string
  restBaseUrl: string
  depthLimit?: number
  createSync?: typeof createOrderBookSync
}

// Module-level constants: getSnapshot must return a referentially stable value and a
// changed subscribe identity forces a resubscribe, so both pre-mount fallbacks are fixed.
// createIdleSnapshot is called once here (not per render) to keep that stable identity.
const IDLE_SNAPSHOT: OrderBookSnapshot = createIdleSnapshot()

const noopSubscribe = () => () => {}
const getIdleSnapshot = () => IDLE_SNAPSHOT

export function useOrderBookSync(
  options: UseOrderBookSyncOptions
): OrderBookSnapshot {
  const {
    symbol,
    wsBaseUrl,
    restBaseUrl,
    depthLimit,
    createSync = createOrderBookSync,
  } = options
  const [engine, setEngine] = useState<OrderBookSync | null>(null)

  useEffect(() => {
    const next = createSync({ symbol, wsBaseUrl, restBaseUrl, depthLimit })
    setEngine(next)
    next.start()
    return () => {
      next.destroy()
    }
  }, [symbol, wsBaseUrl, restBaseUrl, depthLimit, createSync])

  return useSyncExternalStore(
    engine ? engine.subscribe : noopSubscribe,
    engine ? engine.getState : getIdleSnapshot
  )
}
