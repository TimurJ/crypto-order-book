// The polite tier's announcement text; the two-tier policy lives in ../CLAUDE.md (Announcements).

import { useEffect, useRef } from "react"
import type { OrderBookStatus } from "@/lib/order-book/orderBookSync.ts"

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
    // Other statuses leave the flags unchanged — a routine gap must not cause a re-announce.
  })
  return announce ? "Order book live" : ""
}
