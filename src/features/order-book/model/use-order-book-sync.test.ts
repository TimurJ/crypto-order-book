import { act, renderHook } from "@testing-library/react"
import { StrictMode } from "react"
import type { OrderBookSyncOptions } from "@/lib/order-book/order-book-sync.ts"
import {
  createFakeOrderBookSync,
  type FakeOrderBookSync,
} from "@/test/fake-order-book-sync.ts"
import { useOrderBookSync } from "./use-order-book-sync.ts"

function makeHarness() {
  const created: FakeOrderBookSync[] = []
  const received: OrderBookSyncOptions[] = []
  const createSync = (options: OrderBookSyncOptions) => {
    received.push(options)
    const fake = createFakeOrderBookSync({ symbol: options.symbol })
    created.push(fake)
    return fake
  }
  return { created, received, createSync }
}

describe("useOrderBookSync", () => {
  it("creates and starts one engine with the forwarded options", () => {
    const { created, received, createSync } = makeHarness()
    const { result } = renderHook(() =>
      useOrderBookSync({
        symbol: "BTCUSDT",
        wsBaseUrl: "wss://stream.example",
        restBaseUrl: "https://rest.example",
        depthLimit: 1000,
        createSync,
      })
    )
    expect(created).toHaveLength(1)
    expect(created[0]?.started).toBe(true)
    expect(received[0]).toMatchObject({
      symbol: "BTCUSDT",
      wsBaseUrl: "wss://stream.example",
      restBaseUrl: "https://rest.example",
      depthLimit: 1000,
    })
    expect(result.current.symbol).toBe("BTCUSDT")
  })

  it("re-renders with each committed snapshot", () => {
    const { created, createSync } = makeHarness()
    const { result } = renderHook(() =>
      useOrderBookSync({
        symbol: "BTCUSDT",
        wsBaseUrl: "wss://stream.example",
        restBaseUrl: "https://rest.example",
        createSync,
      })
    )
    act(() => {
      created[0]?.commit({ status: "live", lastUpdateId: 42 })
    })
    expect(result.current.status).toBe("live")
    expect(result.current.lastUpdateId).toBe(42)
  })

  it("destroys the engine on unmount", () => {
    const { created, createSync } = makeHarness()
    const { unmount } = renderHook(() =>
      useOrderBookSync({
        symbol: "BTCUSDT",
        wsBaseUrl: "wss://stream.example",
        restBaseUrl: "https://rest.example",
        createSync,
      })
    )
    unmount()
    expect(created[0]?.destroyed).toBe(true)
  })

  it("destroys and recreates when the symbol changes", () => {
    const { created, createSync } = makeHarness()
    const { rerender, result } = renderHook(
      ({ symbol }: { symbol: string }) =>
        useOrderBookSync({
          symbol,
          wsBaseUrl: "wss://stream.example",
          restBaseUrl: "https://rest.example",
          createSync,
        }),
      { initialProps: { symbol: "BTCUSDT" } }
    )
    rerender({ symbol: "ETHUSDT" })
    expect(created).toHaveLength(2)
    expect(created[0]?.destroyed).toBe(true)
    expect(created[1]?.destroyed).toBe(false)
    expect(created[1]?.started).toBe(true)
    expect(result.current.symbol).toBe("ETHUSDT")
  })

  it("survives StrictMode's double-mount: first engine destroyed, second lives", () => {
    const { created, createSync } = makeHarness()
    const { result } = renderHook(
      () =>
        useOrderBookSync({
          symbol: "BTCUSDT",
          wsBaseUrl: "wss://stream.example",
          restBaseUrl: "https://rest.example",
          createSync,
        }),
      { wrapper: StrictMode }
    )
    expect(created).toHaveLength(2)
    expect(created[0]?.destroyed).toBe(true)
    expect(created[1]?.destroyed).toBe(false)
    expect(created[1]?.started).toBe(true)
    act(() => {
      created[1]?.commit({ status: "live" })
    })
    expect(result.current.status).toBe("live")
  })
})
