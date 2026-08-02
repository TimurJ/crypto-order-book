// Container. Split so hooks stay unconditional: OrderBook guards the runtime config (never
// construct an engine with empty URLs), then ConnectedOrderBook runs the hooks (../CLAUDE.md).

import { type ReactNode, useId, useMemo, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx"
import { Badge } from "@/components/ui/badge.tsx"
import { Card } from "@/components/ui/card.tsx"
import { getConfig } from "@/lib/appConfig.ts"
import type { createOrderBookSync } from "@/lib/order-book/orderBookSync.ts"
import { cn } from "@/lib/utils.ts"
import { selectOrderBookView } from "../lib/orderBookView.ts"
import {
  BTCUSDT_DISPLAY,
  formatPair,
  type SymbolDisplay,
} from "../lib/symbolDisplay.ts"
import { useLevelFlashes } from "../model/useLevelFlashes.ts"
import { useMidDirection } from "../model/useMidDirection.ts"
import { useOrderBookSync } from "../model/useOrderBookSync.ts"
import { useStatusAnnouncement } from "../model/useStatusAnnouncement.ts"
import { ImbalanceBar } from "./ImbalanceBar.tsx"
import { LiveIndicator } from "./LiveIndicator.tsx"
import { OrderBookLadder } from "./OrderBookLadder.tsx"
import { type BookViewFilter, ViewToggle } from "./ViewToggle.tsx"

const LEVEL_COUNT = 20
// Weight 50, 980-level margin over the 20 shown — decision log in docs/order-book-ui-architecture.md.
const DEPTH_LIMIT = 1_000

const PANEL = "flex max-h-full w-full max-w-[360px] flex-col gap-0 py-0"

export interface OrderBookProps {
  display?: SymbolDisplay
  /** Test seam, forwarded to useOrderBookSync — production never passes it. */
  createSync?: typeof createOrderBookSync
}

interface PanelHeaderProps {
  headingId: string
  display: SymbolDisplay
  children?: ReactNode
}

function PanelHeader({ headingId, display, children }: PanelHeaderProps) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-b px-3">
      <div className="flex items-center gap-2">
        <h2 id={headingId} className="text-xs font-medium">
          Order Book
        </h2>
        <Badge variant="outline" className="font-mono tabular-nums">
          {formatPair(display)}
        </Badge>
      </div>
      {children}
    </div>
  )
}

export function OrderBook({
  display = BTCUSDT_DISPLAY,
  createSync,
}: OrderBookProps) {
  const headingId = useId()
  const { wsUrl, binanceRestUrl } = getConfig()
  if (!wsUrl || !binanceRestUrl) {
    return (
      <Card role="region" aria-labelledby={headingId} className={PANEL}>
        <PanelHeader headingId={headingId} display={display} />
        <p className="px-3 py-4 text-xs text-muted-foreground">
          Order book not configured — wsUrl and binanceRestUrl are missing from
          runtime config.
        </p>
      </Card>
    )
  }
  return (
    <ConnectedOrderBook
      wsBaseUrl={wsUrl}
      restBaseUrl={binanceRestUrl}
      display={display}
      createSync={createSync}
    />
  )
}

interface ConnectedOrderBookProps {
  wsBaseUrl: string
  restBaseUrl: string
  display: SymbolDisplay
  createSync?: typeof createOrderBookSync
}

function ConnectedOrderBook({
  wsBaseUrl,
  restBaseUrl,
  display,
  createSync,
}: ConnectedOrderBookProps) {
  const headingId = useId()
  const [viewFilter, setViewFilter] = useState<BookViewFilter>("all")
  const snapshot = useOrderBookSync({
    symbol: display.symbol,
    wsBaseUrl,
    restBaseUrl,
    depthLimit: DEPTH_LIMIT,
    createSync,
  })
  const view = useMemo(
    () => selectOrderBookView(snapshot, LEVEL_COUNT),
    [snapshot]
  )
  const flashes = useLevelFlashes(view.bids, view.asks, view.status)
  const midDirection = useMidDirection(view.mid)
  const announcement = useStatusAnnouncement(view.status)
  const stale = view.hasBook && view.status !== "live"
  return (
    <Card role="region" aria-labelledby={headingId} className={PANEL}>
      {/* Polite live region: announces availability only (see useStatusAnnouncement). */}
      <div role="status" className="sr-only">
        {announcement}
      </div>
      <PanelHeader headingId={headingId} display={display}>
        <LiveIndicator status={view.status} />
      </PanelHeader>
      <div className="flex shrink-0 items-center border-b px-2.5 py-2">
        <ViewToggle value={viewFilter} onChange={setViewFilter} />
      </div>
      {view.status === "degraded" && (
        <div className="shrink-0 border-b px-2.5 py-2">
          <Alert variant="destructive">
            <AlertTitle>Reconnecting</AlertTitle>
            <AlertDescription>
              {view.hasBook
                ? "The connection is unhealthy — the book below is the last known state and may be stale."
                : "The connection is unhealthy — retrying until the book syncs."}
            </AlertDescription>
          </Alert>
        </div>
      )}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col transition-opacity motion-reduce:transition-none",
          stale && "opacity-60"
        )}
      >
        <OrderBookLadder
          view={view}
          display={display}
          flashes={flashes}
          midDirection={midDirection}
          viewFilter={viewFilter}
          levelCount={LEVEL_COUNT}
        />
        <ImbalanceBar imbalance={view.imbalance} />
      </div>
      <div className="shrink-0 border-t px-2.5 py-1.5 font-mono text-2xs text-muted-foreground">
        {`resyncs ${view.resyncCount} · dropped ${view.droppedFrames}`}
      </div>
    </Card>
  )
}
