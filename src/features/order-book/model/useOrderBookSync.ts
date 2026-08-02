// React seam for the sync engine, created INSIDE the effect — instances are single-use (../CLAUDE.md).

import { useEffect, useState, useSyncExternalStore } from "react"
import {
  createIdleSnapshot,
  createOrderBookSync,
  type OrderBookSnapshot,
  type OrderBookSync,
} from "@/lib/order-book/orderBookSync.ts"

export interface UseOrderBookSyncOptions {
  symbol: string
  wsBaseUrl: string
  restBaseUrl: string
  depthLimit?: number
  createSync?: typeof createOrderBookSync
}

// Module-level: getSnapshot and subscribe need referentially stable pre-mount fallbacks.
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
