// Page shell (design handoff: header strip + the ladder centered below). The page NEVER
// scrolls — h-dvh + overflow-hidden pins it to the viewport, and the order-book panel
// inside main is capped at the remaining height (max-h-full), so the ladder's own scroll
// region is the only scrolling surface (user decision). The env/health footer is our
// operational chrome, kept from the pre-redesign shell.

import { Badge } from "@/components/ui/badge.tsx"
import { HealthStatus } from "@/features/health/health-status.tsx"
import { OrderBook } from "@/features/order-book/order-book.tsx"
import {
  BTCUSDT_DISPLAY,
  formatPair,
} from "@/features/order-book/symbol-display.ts"
import { getConfig } from "@/lib/app-config.ts"

export function App() {
  const { env } = getConfig()
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex shrink-0 items-end justify-between border-b px-8 py-5">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Crypto Order Book
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {`${formatPair(BTCUSDT_DISPLAY)} · live depth · Binance spot`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-bid-muted font-mono text-bid tabular-nums">
            Bids
          </Badge>
          <Badge className="bg-ask-muted font-mono text-ask tabular-nums">
            Asks
          </Badge>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 items-center justify-center p-6">
        <OrderBook />
      </main>
      <footer className="flex shrink-0 items-center justify-center gap-1 py-2 font-mono text-xs text-muted-foreground">
        env:{" "}
        <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">
          {env}
        </span>{" "}
        · <HealthStatus /> · (Press <kbd>d</kbd> to toggle dark mode)
      </footer>
    </div>
  )
}
