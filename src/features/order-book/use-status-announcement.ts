// Screen-reader announcement policy for the order book's connection status, kept separate
// from the visible Badge (which shows every status). Two live-region tiers that never
// speak for the same event:
//
//   • polite — this hook's text, rendered in a role="status" region. It announces the
//     book's AVAILABILITY, not its churn: "Order book live" on the first successful sync
//     and on recovery from a degraded connection. Routine sub-second gap resyncs
//     (live → syncing → live) stay silent, so a healthy stream never spams the reader.
//   • assertive — the degraded Alert (role="alert"), owned by the container. It announces
//     the PROBLEM ("connection unhealthy…").
//
// On the degraded edge only the Alert speaks (this hook returns ""); on recovery only this
// hook speaks (the Alert unmounts silently). `degradedSinceLive` survives an intervening
// `syncing`, so a degraded → syncing → live recovery still announces.
//
// Render purity: the announcement is derived from a ref committed in an effect after render
// (like use-level-flashes.ts), so StrictMode's double render yields the same text twice.

import { useEffect, useRef } from "react"
import type { OrderBookStatus } from "@/lib/order-book/order-book-sync.ts"

export function useStatusAnnouncement(status: OrderBookStatus): string {
  const seen = useRef({ announcedLive: false, degradedSinceLive: false })
  const announce =
    status === "live" &&
    (!seen.current.announcedLive || seen.current.degradedSinceLive)
  useEffect(() => {
    if (status === "live") {
      seen.current = { announcedLive: true, degradedSinceLive: false }
    } else if (status === "degraded") {
      seen.current = { ...seen.current, degradedSinceLive: true }
    }
    // idle/connecting/syncing/destroyed: leave the flags unchanged — a routine gap between
    // two live states must not reset the "already announced" flag (that would re-announce).
  })
  return announce ? "Order book live" : ""
}
