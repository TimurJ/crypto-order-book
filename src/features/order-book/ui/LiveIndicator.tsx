// Visual-only connection dot — never carries aria-live (two-tier policy in ../CLAUDE.md).

import type { OrderBookStatus } from "@/lib/order-book/orderBookSync.ts"
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
