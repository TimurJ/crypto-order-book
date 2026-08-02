// Center strip. Mid is DERIVED — depth stream only, so there is no "last price" (user decision).
// Mid/spread/spreadPct are derived floats, so toFixed is honest here.

import { cn } from "@/lib/utils.ts"
import { groupThousands } from "../lib/orderBookFormat.ts"
import type { MidDirection } from "../model/useMidDirection.ts"

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
