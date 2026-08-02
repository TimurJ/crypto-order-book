// One depth level: decorative layers live in the LAST cell at width 300% under table-fixed
// thirds, text in z-10 spans. Full geometry rationale: ../CLAUDE.md (Ladder & rows).

import { Skeleton } from "@/components/ui/skeleton.tsx"
import { TableCell, TableRow } from "@/components/ui/table.tsx"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx"
import { cn } from "@/lib/utils.ts"
import { formatDecimalString, groupThousands } from "../lib/orderBookFormat.ts"
import type { ViewLevel } from "../lib/orderBookView.ts"
import type { SymbolDisplay } from "../lib/symbolDisplay.ts"
import { type FlashDirection, useRowFlash } from "../model/useLevelFlashes.ts"

const CELL = "h-[22px] px-2.5 py-0"

// DepthRow's geometry twin (shared CELL) — the spread-centering measurement depends on it.
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

// All four values are derived floats, so toFixed/round formatting is honest here.
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
      {/* Portals out of the panel: the Card is overflow-hidden, an in-flow popup would clip. */}
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
