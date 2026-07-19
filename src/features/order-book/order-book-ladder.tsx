// Presentational ladder — fully deterministic from props, no hooks-into-the-engine, no
// config. One real <table>, four fixed-width columns mirrored around the center gutter:
// Amount | Bid ‖ Ask | Amount. Rows are slot-keyed by index (slot = rank; slots never
// reorder, so index keys are correct here — the levels flow THROUGH the slots).
//
// The depth bar and flash overlay are absolutely-positioned layers inside the price cell
// (the cell adjacent to the gutter). table-fixed makes every column exactly 25% of the
// table, so a layer at width 200% of the price cell spans exactly the row's half —
// growing outward from the gutter across both of its side's cells. Cell text sits in a
// z-10 span so the overflowing layers can never paint over it. Both layers are
// decorative (aria-hidden) — the values they encode are already in the row as text.

import { Skeleton } from "@/components/ui/skeleton.tsx"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx"
import { cn } from "@/lib/utils.ts"
import { formatDecimalString } from "./order-book-format.ts"
import type { OrderBookView, ViewLevel } from "./order-book-view.ts"
import { formatPair, type SymbolDisplay } from "./symbol-display.ts"
import { type LevelFlashes, useFlashKey } from "./use-level-flashes.ts"

interface SideCellsProps {
  level: ViewLevel | undefined
  flashes: ReadonlySet<string>
  display: SymbolDisplay
}

interface HalfRowProps extends SideCellsProps {
  side: "bid" | "ask"
}

// One side's half of a slot row. The DOM order mirrors: bid = qty then price (bar grows
// leftward from the gutter), ask = price then qty (bar grows rightward). The flash
// overlay mounts once its slot-local key first bumps and stays mounted invisibly after
// (base opacity-0, animation fills forwards) — see use-level-flashes.ts.
function HalfRow({ level, flashes, display, side }: HalfRowProps) {
  const flashKey = useFlashKey(level ? flashes.has(level.price) : false)
  if (!level) {
    return (
      <>
        <TableCell />
        <TableCell />
      </>
    )
  }
  const isBid = side === "bid"
  const qtyCell = (
    <TableCell className={isBid ? "text-left" : "text-right"}>
      <span className="relative z-10">
        {formatDecimalString(level.qty, display.qtyDecimals)}
      </span>
    </TableCell>
  )
  const gutterEdge = isBid ? "right-0" : "left-0"
  const priceCell = (
    <TableCell className={cn("relative", isBid ? "text-right" : "text-left")}>
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 z-0 transition-[width] duration-100 ease-linear motion-reduce:transition-none",
          gutterEdge,
          isBid ? "bg-bid/20" : "bg-ask/20"
        )}
        style={{ width: `${2 * Math.min(level.barPct, 100)}%` }}
      />
      {flashKey > 0 && (
        <div
          key={flashKey}
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 z-0 w-[200%] animate-book-flash opacity-0 motion-reduce:animate-none",
            gutterEdge,
            isBid ? "bg-bid" : "bg-ask"
          )}
        />
      )}
      <span className={cn("relative z-10", isBid ? "text-bid" : "text-ask")}>
        {formatDecimalString(level.price, display.priceDecimals)}
      </span>
    </TableCell>
  )
  return isBid ? (
    <>
      {qtyCell}
      {priceCell}
    </>
  ) : (
    <>
      {priceCell}
      {qtyCell}
    </>
  )
}

function SkeletonCell() {
  return (
    <TableCell>
      <Skeleton
        aria-hidden="true"
        className="h-4 w-full motion-reduce:animate-none"
      />
    </TableCell>
  )
}

interface OrderBookLadderProps {
  view: OrderBookView
  display: SymbolDisplay
  flashes: LevelFlashes
  levelCount: number
}

export function OrderBookLadder({
  view,
  display,
  flashes,
  levelCount,
}: OrderBookLadderProps) {
  // The row list is the SLOTS (rank 0..N-1), not the levels: slot k always shows each
  // side's k-th best level, so slot number IS the stable row identity — levels flow
  // through slots, rows never reorder. That's why keying rows by slot is correct where
  // keying a reorderable list by position would not be.
  const rowCount = view.hasBook
    ? Math.max(view.bids.length, view.asks.length)
    : levelCount
  const slots = Array.from({ length: rowCount }, (_, index) => index)
  return (
    <Table
      className="table-fixed font-mono"
      aria-busy={view.hasBook ? undefined : true}
    >
      <TableCaption className="sr-only">
        {`Live order book for ${formatPair(display)}`}
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className="w-1/4 text-left">
            {`Amount (${display.base})`}
          </TableHead>
          <TableHead scope="col" className="w-1/4 text-right">
            {`Bid (${display.quote})`}
          </TableHead>
          <TableHead scope="col" className="w-1/4 text-left">
            {`Ask (${display.quote})`}
          </TableHead>
          <TableHead scope="col" className="w-1/4 text-right">
            {`Amount (${display.base})`}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {view.hasBook
          ? slots.map((slot) => (
              <TableRow key={slot}>
                <HalfRow
                  side="bid"
                  level={view.bids[slot]}
                  flashes={flashes.bidFlashes}
                  display={display}
                />
                <HalfRow
                  side="ask"
                  level={view.asks[slot]}
                  flashes={flashes.askFlashes}
                  display={display}
                />
              </TableRow>
            ))
          : slots.map((slot) => (
              <TableRow key={slot}>
                <SkeletonCell />
                <SkeletonCell />
                <SkeletonCell />
                <SkeletonCell />
              </TableRow>
            ))}
      </TableBody>
    </Table>
  )
}
