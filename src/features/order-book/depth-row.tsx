// One depth level as a real table row (design handoff look, our table semantics). Three
// cells — Price | Size | Total — with the two decorative layers living inside the LAST
// cell: table-fixed makes every column exactly a third of the table, so an absolutely
// positioned layer at width 300% of the Total cell spans exactly the whole row, growing
// leftward from the right edge (the design anchors depth bars right on both sides). Cell
// text sits in z-10 spans so the overflowing layers can never paint over it — the same
// stacking technique the pre-redesign ladder proved at 200%.
//
// The depth bar's width is the level's per-side cumulative share; the flash overlay is
// keyed by the slot-local useRowFlash key, so a bump remounts just the overlay and
// restarts the CSS fade (no timers — see use-level-flashes.ts). Both layers are
// aria-hidden: the values they encode are already row text.
//
// Hovering the row opens the cumulative-aggregates popup (vendored shadcn Tooltip — the
// row itself is the trigger via the render prop). It PORTALS out of the panel: the Card
// is overflow-hidden and the ladder scrolls, so an in-flow popup would clip — the
// prototype's `overflow: visible` hack is deliberately not ported. Rows are
// deliberately non-interactive otherwise (row selection was dropped by user decision).

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx"
import { Skeleton } from "@/components/ui/skeleton.tsx"
import { TableCell, TableRow } from "@/components/ui/table.tsx"
import { cn } from "@/lib/utils.ts"
import { formatDecimalString, groupThousands } from "./order-book-format.ts"
import type { ViewLevel } from "./order-book-view.ts"
import type { SymbolDisplay } from "./symbol-display.ts"
import { type FlashDirection, useRowFlash } from "./use-level-flashes.ts"

const CELL = "h-[22px] px-2.5 py-0"

// The skeleton row lives here, next to DepthRow, because it is its geometry twin: both
// share CELL, so the pre-book ladder is exactly the height the live one will be — no
// layout jump on first sync, and the spread-centering measurement stays valid.
export function SkeletonRow() {
  return (
    <TableRow className="border-0">
      {[0, 1, 2].map((cell) => (
        <TableCell key={cell} className={CELL}>
          <Skeleton
            aria-hidden="true"
            className="h-3 w-full motion-reduce:animate-none"
          />
        </TableCell>
      ))}
    </TableRow>
  )
}

interface DepthRowAggregatesProps {
  level: ViewLevel
  mid: number | null
  display: SymbolDisplay
}

// Popup body: cumulative aggregates from the best price down to this level. All four
// values are derived floats (our math over the window), so toFixed/round formatting is
// honest. The quote label comes from the symbol record — the handoff's hardcoded "USDC"
// was a prototype mismatch with its own BTC-USDT pair.
function DepthRowAggregates({ level, mid, display }: DepthRowAggregatesProps) {
  const averagePrice = level.cumulativeQuote / level.cumulative
  const rows: Array<[string, string]> = [
    [
      "Distance from Mid",
      mid === null
        ? "—"
        : `${((Math.abs(averagePrice - mid) / mid) * 100).toFixed(4)}%`,
    ],
    ["Average Price", groupThousands(String(Math.round(averagePrice)))],
    [`Total (${display.base})`, level.cumulative.toFixed(5)],
    [
      `Total (${display.quote})`,
      groupThousands(String(Math.round(level.cumulativeQuote))),
    ],
  ]
  return (
    <>
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex h-[22px] items-center justify-between gap-6"
        >
          <span className="font-sans text-2xs text-muted-foreground">
            {label}
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums">
            {value}
          </span>
        </div>
      ))}
    </>
  )
}

export interface DepthRowProps {
  side: "bid" | "ask"
  level: ViewLevel
  display: SymbolDisplay
  flashDirection: FlashDirection | null
  mid: number | null
}

export function DepthRow({
  side,
  level,
  display,
  flashDirection,
  mid,
}: DepthRowProps) {
  const flash = useRowFlash(flashDirection)
  const isBid = side === "bid"
  return (
    <Tooltip>
      <TooltipTrigger render={<TableRow className="border-0 hover:bg-muted" />}>
        <TableCell
          className={cn(CELL, "text-left", isBid ? "text-bid" : "text-ask")}
        >
          <span className="relative z-10">
            {groupThousands(
              formatDecimalString(level.price, display.priceDecimals)
            )}
          </span>
        </TableCell>
        <TableCell className={cn(CELL, "text-right")}>
          <span className="relative z-10">
            {formatDecimalString(level.qty, display.qtyDecimals)}
          </span>
        </TableCell>
        <TableCell
          className={cn(CELL, "relative text-right text-muted-foreground")}
        >
          <div
            aria-hidden="true"
            className={cn(
              "absolute inset-y-0 right-0 z-0 transition-[width] duration-100 ease-linear motion-reduce:transition-none",
              isBid ? "bg-bid-muted" : "bg-ask-muted"
            )}
            style={{ width: `${Math.min(level.barPct, 100) * 3}%` }}
          />
          {flash.key > 0 && (
            <div
              key={flash.key}
              aria-hidden="true"
              className={cn(
                "absolute inset-y-0 right-0 z-0 w-[300%] animate-book-flash opacity-0 motion-reduce:animate-none",
                flash.tone === "up" ? "bg-bid-muted" : "bg-ask-muted"
              )}
            />
          )}
          <span className="relative z-10">{level.cumulative.toFixed(2)}</span>
        </TableCell>
      </TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={-4}
        showArrow={false}
        className="pointer-events-none flex min-w-[200px] flex-col items-stretch gap-0 rounded-md border bg-popover px-2.5 py-2 text-popover-foreground shadow-lg motion-reduce:animate-none"
      >
        <DepthRowAggregates level={level} mid={mid} display={display} />
      </TooltipContent>
    </Tooltip>
  )
}
