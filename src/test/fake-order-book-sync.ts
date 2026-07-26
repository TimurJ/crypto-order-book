// Controllable fake of the OrderBookSync interface (order-book-sync.ts) for hook and
// container tests — injected through the createSync seam, never vi.mock. Tests drive
// state via commit(); listeners fire synchronously, so no fake timers are needed.

import {
  createIdleSnapshot,
  type OrderBookSnapshot,
  type OrderBookSync,
} from "@/lib/order-book/order-book-sync.ts"

export interface FakeOrderBookSync extends OrderBookSync {
  started: boolean
  destroyed: boolean
  /** Merge overrides into the snapshot (new object identity) and notify subscribers. */
  commit: (overrides: Partial<OrderBookSnapshot>) => void
}

export function createFakeOrderBookSync(
  initial: Partial<OrderBookSnapshot> = {}
): FakeOrderBookSync {
  const listeners = new Set<() => void>()
  let snapshot: OrderBookSnapshot = {
    ...createIdleSnapshot("BTCUSDT"),
    ...initial,
  }
  const fake: FakeOrderBookSync = {
    started: false,
    destroyed: false,
    start: () => {
      fake.started = true
    },
    destroy: () => {
      fake.destroyed = true
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getState: () => snapshot,
    commit: (overrides) => {
      snapshot = { ...snapshot, ...overrides }
      for (const listener of listeners) {
        listener()
      }
    },
  }
  return fake
}
