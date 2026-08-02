// Presentational ladder: one real <table>, three tbodies (asks reversed · spread strip · bids);
// slots are the stable row identity. Geometry and scroll invariants: ../CLAUDE.md (Ladder & rows).

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
import type { OrderBookView } from "../lib/orderBookView.ts"
import { formatPair, type SymbolDisplay } from "../lib/symbolDisplay.ts"
import type { LevelFlashes } from "../model/useLevelFlashes.ts"
import type { MidDirection } from "../model/useMidDirection.ts"
import { DepthRow, SkeletonRow } from "./DepthRow.tsx"
import { SpreadRow } from "./SpreadRow.tsx"
import type { BookViewFilter } from "./ViewToggle.tsx"

// Hairline as an inset box-shadow: a collapsed table border does not travel with a sticky cell.
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
  // Center the spread row exactly once per hasBook false→true edge, never on streaming commits.
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
  const askSlots = Array.from(
    { length: view.asks.length },
    (_, i) => view.asks.length - 1 - i
  )
  const bidSlots = Array.from({ length: view.bids.length }, (_, i) => i)
  const skeletonSlots = Array.from({ length: levelCount }, (_, i) => i)
  // One body renderer for both sides and both states; only the row content switches on hasBook.
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
          // The vendored overflow-x-auto would break the sticky header's chain to our scroller.
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
