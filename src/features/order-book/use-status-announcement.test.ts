import { renderHook } from "@testing-library/react"
import { StrictMode } from "react"
import type { OrderBookStatus } from "@/lib/order-book/order-book-sync.ts"
import { useStatusAnnouncement } from "./use-status-announcement.ts"

describe("useStatusAnnouncement", () => {
  const setup = (initial: OrderBookStatus) =>
    renderHook(
      ({ status }: { status: OrderBookStatus }) =>
        useStatusAnnouncement(status),
      { initialProps: { status: initial } }
    )

  it("announces the first successful sync", () => {
    const { result } = setup("live")
    expect(result.current).toBe("Order book live")
  })

  it("stays silent on transient states before the first sync", () => {
    const { result, rerender } = setup("idle")
    expect(result.current).toBe("")
    rerender({ status: "connecting" })
    expect(result.current).toBe("")
    rerender({ status: "syncing" })
    expect(result.current).toBe("")
    rerender({ status: "live" })
    expect(result.current).toBe("Order book live")
  })

  it("stays silent on a routine gap resync (live → syncing → live)", () => {
    const { result, rerender } = setup("live")
    expect(result.current).toBe("Order book live")
    rerender({ status: "syncing" })
    expect(result.current).toBe("")
    rerender({ status: "live" })
    expect(result.current).toBe("")
  })

  it("announces recovery from a degraded connection", () => {
    const { result, rerender } = setup("live")
    rerender({ status: "degraded" })
    expect(result.current).toBe("")
    rerender({ status: "live" })
    expect(result.current).toBe("Order book live")
  })

  it("announces recovery even when degraded clears through syncing", () => {
    const { result, rerender } = setup("live")
    rerender({ status: "degraded" })
    rerender({ status: "syncing" })
    expect(result.current).toBe("")
    rerender({ status: "live" })
    expect(result.current).toBe("Order book live")
  })

  it("does not re-announce a routine gap under StrictMode's double render", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: OrderBookStatus }) =>
        useStatusAnnouncement(status),
      { initialProps: { status: "live" }, wrapper: StrictMode }
    )
    expect(result.current).toBe("Order book live")
    rerender({ status: "syncing" })
    rerender({ status: "live" })
    expect(result.current).toBe("")
  })
})
