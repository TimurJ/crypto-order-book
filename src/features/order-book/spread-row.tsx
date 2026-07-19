// The center strip between asks and bids (design handoff: big mid price with a ▲/▼
// direction arrow, spread + spread% on the right). Mid is DERIVED from the book —
// (bestBid + bestAsk) / 2 — because the sync layer streams depth only; there is no
// trade stream, so there is no "last price" (user decision). Direction comes from
// useMidDirection in the container; pre-first-move (null) renders the mid neutral with
// no arrow, and a null mid (empty or crossed book) renders an em dash.
//
// Mid/spread/spreadPct are all derived floats, so toFixed is honest here — the
// never-round-an-exchange-string rule guards the book's own price/qty strings, not our
// computed midpoints (a half-tick mid can't round-trip through the string rules anyway).

import { groupThousands } from "./order-book-format.ts"
import type { MidDirection } from "./use-mid-direction.ts"
import { cn } from "@/lib/utils.ts"

interface SpreadRowProps {
  mid: number | null
  spread: number | null
  spreadPct: number | null
  direction: MidDirection | null
  priceDecimals: number
}

export function SpreadRow({
  mid,
  spread,
  spreadPct,
  direction,
  priceDecimals,
}: SpreadRowProps) {
  return (
    <div className="flex h-7 items-center justify-between px-2.5">
      <span
        className={cn(
          "font-mono text-lg font-semibold tabular-nums",
          direction === "up" && "text-bid",
          direction === "down" && "text-ask"
        )}
      >
        {mid === null ? (
          "—"
        ) : (
          <>
            {direction === "up" && "▲ "}
            {direction === "down" && "▼ "}
            {groupThousands(mid.toFixed(priceDecimals))}
          </>
        )}
      </span>
      <span className="font-sans text-2xs text-muted-foreground">
        {spread === null || spreadPct === null
          ? "Spread —"
          : `Spread ${spread.toFixed(priceDecimals)} · ${spreadPct.toFixed(3)}%`}
      </span>
    </div>
  )
}
