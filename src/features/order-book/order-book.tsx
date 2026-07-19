// Container for the order-book widget: owns the engine (via useOrderBookSync), the
// view-model derivation, and the panel chrome. Split in two so hooks stay
// unconditional: OrderBook guards the runtime config (the no-DOM-bootstrap test
// fallback has empty URLs — never construct an engine with garbage) and only then
// renders ConnectedOrderBook, which runs the hooks.
//
// The panel is the design handoff's stacked layout on our kit: Card stays the shell
// (bg/hairline/radius are already its job), zeroed of its default padding, composed of
// hairline-separated strips — header (title + pair badge + live dot), view toggle,
// degraded Alert, the scrollable ladder, imbalance bar, diagnostics. The Card is capped
// at the viewport (max-h-full under App's h-dvh page) and the LADDER is the only thing
// that scrolls — user decision: 20 levels/side, never the page.
//
// Staleness presentation: once a book exists, any non-live status keeps the last-known
// book rendered, dimmed — the engine stops committing during a resync, so the dimmed
// book is genuinely frozen, and gap-triggered resyncs usually resolve sub-second
// (blanking to a skeleton would flicker).
//
// Announcements use two live-region tiers that never speak for the same event: a polite
// role="status" region announces AVAILABILITY (first sync + recovery from degraded, via
// useStatusAnnouncement — routine gap resyncs stay silent), and the assertive degraded
// Alert (role="alert") announces the PROBLEM. The live-indicator dot is visual-only.

import { type ReactNode, useId, useMemo, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.tsx"
import { Badge } from "@/components/ui/badge.tsx"
import { Card } from "@/components/ui/card.tsx"
import { getConfig } from "@/lib/app-config.ts"
import type { createOrderBookSync } from "@/lib/order-book/order-book-sync.ts"
import { cn } from "@/lib/utils.ts"
import { ImbalanceBar } from "./imbalance-bar.tsx"
import { LiveIndicator } from "./live-indicator.tsx"
import { OrderBookLadder } from "./order-book-ladder.tsx"
import { selectOrderBookView } from "./order-book-view.ts"
import {
  BTCUSDT_DISPLAY,
  formatPair,
  type SymbolDisplay,
} from "./symbol-display.ts"
import { useLevelFlashes } from "./use-level-flashes.ts"
import { useMidDirection } from "./use-mid-direction.ts"
import { useOrderBookSync } from "./use-order-book-sync.ts"
import { useStatusAnnouncement } from "./use-status-announcement.ts"
import { type BookViewFilter, ViewToggle } from "./view-toggle.tsx"

const LEVEL_COUNT = 20
// Snapshot depth for the engine: weight 50 vs 250 at the engine's 5000 default, and a
// 1000-level seed leaves a 980-level margin over the 20 displayed — see the decision
// log in docs/order-book-ui-architecture.md.
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
