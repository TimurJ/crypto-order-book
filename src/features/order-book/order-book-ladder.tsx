// Presentational ladder — fully deterministic from props, no engine hooks, no config.
// Still ONE real <table> (the redesign changed the look, not the semantics): the stacked
// design-handoff layout is three <tbody> sections inside it — asks (worst price at the
// top, best ask ending adjacent to the spread row), the one-row spread strip (a colSpan-3
// cell), and bids (best first). Multiple tbodies are valid HTML and read as one table.
// Rows stay slot-keyed by rank within their side; the asks' visual reversal is a CONSTANT
// render-order flip, so keys never reorder — levels flow through the slots exactly as
// before.
//
// The ladder owns the ONLY scroll region on the page (user decision: 20 levels/side may
// exceed the viewport; the levels scroll, the page never does). The column header row is
// sticky inside it — its hairline is an inset box-shadow, NOT a border, because Tailwind
// preflight collapses table borders and a collapsed border does not travel with a sticky
// cell. On first book acquisition (hasBook false→true) the container scrolls once so the
// spread row sits centered — the market you care about is around the spread, and without
// this you'd open onto the worst asks. Measured via getBoundingClientRect deltas (a tr's
// offsetParent is the table, not the scroll container); never re-run on data commits, so
// free scrolling is never hijacked.

import { useLayoutEffect, useRef } from "react"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx"
import { TooltipProvider } from "@/components/ui/tooltip.tsx"
import { cn } from "@/lib/utils.ts"
import { DepthRow, SkeletonRow } from "./depth-row.tsx"
import type { OrderBookView } from "./order-book-view.ts"
import { SpreadRow } from "./spread-row.tsx"
import { formatPair, type SymbolDisplay } from "./symbol-display.ts"
import type { LevelFlashes } from "./use-level-flashes.ts"
import type { MidDirection } from "./use-mid-direction.ts"
import type { BookViewFilter } from "./view-toggle.tsx"

const HEAD_CELL =
  "sticky top-0 z-20 h-6 bg-card px-2.5 py-0 font-sans text-2xs font-normal text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]"

interface OrderBookLadderProps {
  view: OrderBookView
  display: SymbolDisplay
  flashes: LevelFlashes
  midDirection: MidDirection | null
  viewFilter: BookViewFilter
  levelCount: number
}

export function OrderBookLadder({
  view,
  display,
  flashes,
  midDirection,
  viewFilter,
  levelCount,
}: OrderBookLadderProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const spreadRef = useRef<HTMLTableRowElement>(null)
  // Center the spread row exactly once per book acquisition. hasBook is the dependency:
  // the effect re-fires only on its false→true edge (skeleton → first sync, and again
  // after destroyed→resync), never on streaming commits.
  useLayoutEffect(() => {
    if (!view.hasBook) return
    const container = scrollRef.current
    const spreadRow = spreadRef.current
    if (!container || !spreadRow) return
    const containerRect = container.getBoundingClientRect()
    const rowRect = spreadRow.getBoundingClientRect()
    container.scrollTop +=
      rowRect.top -
      containerRect.top -
      (containerRect.height - rowRect.height) / 2
  }, [view.hasBook])

  const showAsks = viewFilter !== "bids"
  const showBids = viewFilter !== "asks"
  // The row lists are SLOTS (rank 0..N-1), not the levels: slot k always shows its
  // side's k-th best level, so slot number IS the stable row identity — levels flow
  // through slots, rows never reorder. The asks render their slots in reverse (worst at
  // the top, best ask ending adjacent to the spread row): a constant flip of the same
  // slot list, so keys still never reorder between commits.
  const askSlots = Array.from(
    { length: view.asks.length },
    (_, i) => view.asks.length - 1 - i
  )
  const bidSlots = Array.from({ length: view.bids.length }, (_, i) => i)
  const skeletonSlots = Array.from({ length: levelCount }, (_, i) => i)
  // One body renderer for both sides and both states: the tbody scaffold below stays a
  // single copy, and only the row content switches on hasBook (skeleton rows share the
  // live rows' geometry — see SkeletonRow in depth-row.tsx).
  const renderSide = (side: "ask" | "bid") => {
    if (!view.hasBook) {
      return skeletonSlots.map((slot) => <SkeletonRow key={slot} />)
    }
    const isAsk = side === "ask"
    const levels = isAsk ? view.asks : view.bids
    const slots = isAsk ? askSlots : bidSlots
    const sideFlashes = isAsk ? flashes.askFlashes : flashes.bidFlashes
    return slots.map((slot) => {
      const level = levels[slot]
      return level ? (
        <DepthRow
          key={slot}
          side={side}
          level={level}
          display={display}
          flashDirection={sideFlashes.get(level.price) ?? null}
          mid={view.mid}
        />
      ) : null
    })
  }
  const spreadStrip = (
    <TableRow ref={spreadRef} className="border-0 bg-muted">
      <TableCell colSpan={3} className="p-0">
        <SpreadRow
          mid={view.mid}
          spread={view.spread}
          spreadPct={view.spreadPct}
          direction={midDirection}
          priceDecimals={display.priceDecimals}
        />
      </TableCell>
    </TableRow>
  )
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <TooltipProvider>
        <Table
          className="table-fixed font-mono text-xs tabular-nums"
          // The vendored container's overflow-x-auto is an intermediate scroll container,
          // which breaks position:sticky against OUR outer scroller — the sticky header
          // needs an unbroken chain to it (nothing here can overflow horizontally anyway).
          containerClassName="overflow-x-visible"
          aria-busy={view.hasBook ? undefined : true}
        >
          <TableCaption className="sr-only">
            {`Live order book for ${formatPair(display)}`}
          </TableCaption>
          <TableHeader>
            <TableRow className="border-0">
              <TableHead
                scope="col"
                className={cn(HEAD_CELL, "w-1/3 text-left")}
              >
                {`Price (${display.quote})`}
              </TableHead>
              <TableHead
                scope="col"
                className={cn(HEAD_CELL, "w-1/3 text-right")}
              >
                {`Size (${display.base})`}
              </TableHead>
              <TableHead
                scope="col"
                className={cn(HEAD_CELL, "w-1/3 text-right")}
              >
                Total
              </TableHead>
            </TableRow>
          </TableHeader>
          {showAsks && <TableBody>{renderSide("ask")}</TableBody>}
          <TableBody>{spreadStrip}</TableBody>
          {showBids && <TableBody>{renderSide("bid")}</TableBody>}
        </Table>
      </TooltipProvider>
    </div>
  )
}
