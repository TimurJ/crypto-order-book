// The panel header's connection dot (design handoff: 6px dot + tiny label). This is the
// design's Live/Paused indicator remapped onto the engine's real statuses — "paused"
// doesn't exist against live market data. Visual-only by design: availability is spoken
// by the polite live region and problems by the assertive Alert (see order-book.tsx),
// so this widget never carries aria-live itself.

import type { OrderBookStatus } from "@/lib/order-book/order-book-sync.ts"
import { cn } from "@/lib/utils.ts"

const LABELS: Record<OrderBookStatus, string> = {
  idle: "Idle",
  connecting: "Connecting",
  syncing: "Syncing",
  live: "Live",
  degraded: "Degraded",
  destroyed: "Idle",
}

export function LiveIndicator({ status }: { status: OrderBookStatus }) {
  return (
    <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          status === "live" &&
            "animate-ob-pulse bg-bid motion-reduce:animate-none",
          status === "degraded" && "bg-destructive",
          status !== "live" && status !== "degraded" && "bg-muted-foreground"
        )}
      />
      {LABELS[status]}
    </div>
  )
}
