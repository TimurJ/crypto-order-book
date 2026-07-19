// Container for the order-book widget: owns the engine (via useOrderBookSync), the
// view-model derivation, and the status chrome. Split in two so hooks stay
// unconditional: OrderBook guards the runtime config (the no-DOM-bootstrap test
// fallback has empty URLs — never construct an engine with garbage) and only then
// renders ConnectedOrderBook, which runs the hooks.
//
// Staleness presentation: once a book exists, any non-live status keeps the last-known
// book rendered, dimmed — the engine stops committing during a resync, so the dimmed
// book is genuinely frozen, and gap-triggered resyncs usually resolve sub-second
// (blanking to a skeleton would flicker).
//
// Announcements use two live-region tiers that never speak for the same event: a polite
// role="status" region announces AVAILABILITY (first sync + recovery from degraded, via
// useStatusAnnouncement — routine gap resyncs stay silent), and the assertive degraded
// Alert (role="alert") announces the PROBLEM. The status Badge itself is visual-only.

import { useMemo } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx"
import { Badge } from "@/components/ui/badge.tsx"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx"
import { getConfig } from "@/lib/app-config.ts"
import type {
  createOrderBookSync,
  OrderBookStatus,
} from "@/lib/order-book/order-book-sync.ts"
import { cn } from "@/lib/utils.ts"
import { OrderBookLadder } from "./order-book-ladder.tsx"
import { selectOrderBookView } from "./order-book-view.ts"
import {
  BTCUSDT_DISPLAY,
  formatPair,
  type SymbolDisplay,
} from "./symbol-display.ts"
import { useLevelFlashes } from "./use-level-flashes.ts"
import { useOrderBookSync } from "./use-order-book-sync.ts"
import { useStatusAnnouncement } from "./use-status-announcement.ts"

const LEVEL_COUNT = 20
// Snapshot depth for the engine: weight 50 vs 250 at the engine's 5000 default, and a
// 1000-level seed leaves a 980-level margin over the 20 displayed — see the decision
// log in docs/order-book-ui-architecture.md.
const DEPTH_LIMIT = 1_000

export interface OrderBookProps {
  display?: SymbolDisplay
  /** Test seam, forwarded to useOrderBookSync — production never passes it. */
  createSync?: typeof createOrderBookSync
}

function statusBadge(status: OrderBookStatus) {
  if (status === "degraded") {
    return <Badge variant="destructive">{status}</Badge>
  }
  if (status === "live") {
    return <Badge className="bg-bid/10 text-bid">{status}</Badge>
  }
  return <Badge variant="secondary">{status}</Badge>
}

export function OrderBook({
  display = BTCUSDT_DISPLAY,
  createSync,
}: OrderBookProps) {
  const { wsUrl, binanceRestUrl } = getConfig()
  if (!wsUrl || !binanceRestUrl) {
    return (
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>{formatPair(display)}</CardTitle>
          <CardDescription>order book</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          Order book not configured — wsUrl and binanceRestUrl are missing from
          runtime config.
        </CardContent>
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
  const announcement = useStatusAnnouncement(view.status)
  const stale = view.hasBook && view.status !== "live"
  return (
    <Card className="w-full max-w-2xl">
      {/* Polite live region: announces availability only (see useStatusAnnouncement). */}
      <div role="status" className="sr-only">
        {announcement}
      </div>
      <CardHeader>
        <CardTitle>{formatPair(display)}</CardTitle>
        <CardDescription>
          {`Binance spot · top ${LEVEL_COUNT} levels`}
        </CardDescription>
        <CardAction>{statusBadge(view.status)}</CardAction>
      </CardHeader>
      {view.status === "degraded" && (
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Reconnecting</AlertTitle>
            <AlertDescription>
              {view.hasBook
                ? "The connection is unhealthy — the book below is the last known state and may be stale."
                : "The connection is unhealthy — retrying until the book syncs."}
            </AlertDescription>
          </Alert>
        </CardContent>
      )}
      <CardContent
        className={cn(
          "space-y-1 transition-opacity motion-reduce:transition-none",
          stale && "opacity-60"
        )}
      >
        <p className="text-center font-mono text-xs text-muted-foreground">
          {view.spread === null
            ? "spread —"
            : `spread ${view.spread.toFixed(display.priceDecimals)} ${display.quote}`}
        </p>
        <OrderBookLadder
          view={view}
          display={display}
          flashes={flashes}
          levelCount={LEVEL_COUNT}
        />
      </CardContent>
      <CardFooter className="font-mono text-xs text-muted-foreground">
        {`resyncs ${view.resyncCount} · dropped ${view.droppedFrames}`}
      </CardFooter>
    </Card>
  )
}
