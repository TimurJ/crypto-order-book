import { renderHook } from "@testing-library/react"
import { StrictMode } from "react"
import type { OrderBookStatus } from "@/lib/order-book/order-book-sync.ts"
import {
  diffChangedPrices,
  EMPTY_FLASH_DIFF,
  useFlashKey,
  useLevelFlashes,
} from "./use-level-flashes.ts"

const level = (price: string, qty: string) => ({ price, qty })

describe("diffChangedPrices", () => {
  it("records the baseline without flagging anything when silent", () => {
    const next = diffChangedPrices(
      EMPTY_FLASH_DIFF,
      [level("100.00", "1.0"), level("99.00", "2.0")],
      true
    )
    expect(next.changed.size).toBe(0)
    expect(next.qtyByPrice.get("100.00")).toBe("1.0")
  })

  it("flags nothing on a silent commit even when quantities changed", () => {
    const first = diffChangedPrices(
      EMPTY_FLASH_DIFF,
      [level("100.00", "1.0")],
      true
    )
    // A wholesale swap arriving on a non-streaming commit (resync) re-baselines, not flashes.
    const next = diffChangedPrices(
      first,
      [level("100.00", "9.9"), level("50.00", "1.0")],
      true
    )
    expect(next.changed.size).toBe(0)
    expect(next.qtyByPrice.get("100.00")).toBe("9.9")
  })

  it("flags a price whose quantity changed", () => {
    const first = diffChangedPrices(
      EMPTY_FLASH_DIFF,
      [level("100.00", "1.0")],
      true
    )
    const next = diffChangedPrices(first, [level("100.00", "2.0")], false)
    expect(next.changed.has("100.00")).toBe(true)
  })

  it("does not flag a pure rank shift", () => {
    const first = diffChangedPrices(
      EMPTY_FLASH_DIFF,
      [level("100.00", "1.0"), level("99.00", "2.0")],
      true
    )
    // Same prices and quantities, different slot order — nothing changed.
    const next = diffChangedPrices(
      first,
      [level("99.00", "2.0"), level("100.00", "1.0")],
      false
    )
    expect(next.changed.size).toBe(0)
  })

  it("flags a price newly entering the window", () => {
    const first = diffChangedPrices(
      EMPTY_FLASH_DIFF,
      [level("100.00", "1.0")],
      true
    )
    const next = diffChangedPrices(
      first,
      [level("100.00", "1.0"), level("101.00", "0.5")],
      false
    )
    expect(next.changed.has("101.00")).toBe(true)
    expect(next.changed.has("100.00")).toBe(false)
  })

  it("clears the flag on the following unchanged diff", () => {
    let state = diffChangedPrices(
      EMPTY_FLASH_DIFF,
      [level("100.00", "1.0")],
      true
    )
    state = diffChangedPrices(state, [level("100.00", "2.0")], false)
    state = diffChangedPrices(state, [level("100.00", "2.0")], false)
    expect(state.changed.size).toBe(0)
  })

  it("drops departed prices so the tracking map never grows unbounded", () => {
    const first = diffChangedPrices(
      EMPTY_FLASH_DIFF,
      [level("100.00", "1.0"), level("101.00", "0.5")],
      true
    )
    const next = diffChangedPrices(first, [level("100.00", "1.0")], false)
    expect(next.qtyByPrice.has("101.00")).toBe(false)
    expect(next.qtyByPrice.size).toBe(1)
    // A departed price re-entering counts as new-to-window again.
    const back = diffChangedPrices(
      next,
      [level("100.00", "1.0"), level("101.00", "0.7")],
      false
    )
    expect(back.changed.has("101.00")).toBe(true)
  })
})

describe("useLevelFlashes", () => {
  type Props = {
    bids: { price: string; qty: string }[]
    asks: { price: string; qty: string }[]
    status: OrderBookStatus
  }

  const liveBook: Props = {
    bids: [level("100.00", "1.0")],
    asks: [level("101.00", "1.0")],
    status: "live",
  }

  it("flashes only while streaming live→live, per side", () => {
    const { result, rerender } = renderHook(
      ({ bids, asks, status }: Props) => useLevelFlashes(bids, asks, status),
      { initialProps: liveBook }
    )
    // First live commit is the silent baseline.
    expect(result.current.bidFlashes.size).toBe(0)
    rerender({ ...liveBook, bids: [level("100.00", "2.0")] })
    expect(result.current.bidFlashes.has("100.00")).toBe(true)
    expect(result.current.askFlashes.size).toBe(0)
    // A re-render without a data change must not re-flash.
    rerender({ ...liveBook, bids: [level("100.00", "2.0")] })
    expect(result.current.bidFlashes.size).toBe(0)
  })

  it("re-baselines silently on a resync instead of flashing the swapped book", () => {
    const { result, rerender } = renderHook(
      ({ bids, asks, status }: Props) => useLevelFlashes(bids, asks, status),
      { initialProps: liveBook }
    )
    // Gap → resync: the engine freezes (syncing), then commits a wholesale-new book on live.
    rerender({ ...liveBook, status: "syncing" })
    rerender({
      bids: [level("200.00", "5.0")],
      asks: [level("201.00", "5.0")],
      status: "live",
    })
    expect(result.current.bidFlashes.size).toBe(0)
    expect(result.current.askFlashes.size).toBe(0)
    // The next live streaming update flashes normally again.
    rerender({
      bids: [level("200.00", "9.0")],
      asks: [level("201.00", "5.0")],
      status: "live",
    })
    expect(result.current.bidFlashes.has("200.00")).toBe(true)
  })

  it("does not flash a changed book committed while still syncing (gap-partial)", () => {
    const { result, rerender } = renderHook(
      ({ bids, asks, status }: Props) => useLevelFlashes(bids, asks, status),
      { initialProps: liveBook }
    )
    // A gap inside the buffered run commits a changed partial book while status is "syncing".
    rerender({ ...liveBook, bids: [level("100.00", "7.0")], status: "syncing" })
    expect(result.current.bidFlashes.size).toBe(0)
  })

  it("re-baselines silently on degraded recovery", () => {
    const { result, rerender } = renderHook(
      ({ bids, asks, status }: Props) => useLevelFlashes(bids, asks, status),
      { initialProps: liveBook }
    )
    rerender({ ...liveBook, status: "degraded" })
    rerender({
      bids: [level("300.00", "2.0")],
      asks: [level("301.00", "2.0")],
      status: "live",
    })
    expect(result.current.bidFlashes.size).toBe(0)
    expect(result.current.askFlashes.size).toBe(0)
  })

  it("flashes returning levels when a side empties then refills while live", () => {
    const { result, rerender } = renderHook(
      ({ bids, asks, status }: Props) => useLevelFlashes(bids, asks, status),
      { initialProps: liveBook }
    )
    // Bid side empties (still live — a thin book, not a resync).
    rerender({ ...liveBook, bids: [] })
    expect(result.current.bidFlashes.size).toBe(0)
    // ...then refills: the returning level must flash (new-to-window), not be silenced.
    rerender(liveBook)
    expect(result.current.bidFlashes.has("100.00")).toBe(true)
  })

  it("does not double-bump flashes under StrictMode's double render", () => {
    const { result, rerender } = renderHook(
      ({ bids, asks, status }: Props) => useLevelFlashes(bids, asks, status),
      { initialProps: liveBook, wrapper: StrictMode }
    )
    rerender({ ...liveBook, bids: [level("100.00", "2.0")] })
    expect(result.current.bidFlashes.has("100.00")).toBe(true)
    expect(result.current.bidFlashes.size).toBe(1)
  })
})

describe("useFlashKey", () => {
  it("bumps once per fresh render and holds otherwise", () => {
    const { result, rerender } = renderHook(
      ({ fresh }: { fresh: boolean }) => useFlashKey(fresh),
      { initialProps: { fresh: false } }
    )
    expect(result.current).toBe(0)
    rerender({ fresh: true })
    expect(result.current).toBe(1)
    rerender({ fresh: false })
    expect(result.current).toBe(1)
    rerender({ fresh: true })
    expect(result.current).toBe(2)
  })

  it("does not double-bump under StrictMode's double render", () => {
    const { result, rerender } = renderHook(
      ({ fresh }: { fresh: boolean }) => useFlashKey(fresh),
      { initialProps: { fresh: false }, wrapper: StrictMode }
    )
    rerender({ fresh: true })
    expect(result.current).toBe(1)
  })
})
