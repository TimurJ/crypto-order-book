// The explicit home of the imbalance signal since depth bars scale per-side (../CLAUDE.md).

import type { OrderBookView } from "../lib/orderBookView.ts"

export function ImbalanceBar({
  imbalance,
}: {
  imbalance: OrderBookView["imbalance"]
}) {
  if (!imbalance) return null
  return (
    <div className="flex flex-col gap-1.5 border-t px-2.5 py-2">
      <div className="flex items-center justify-between text-2xs font-medium">
        <span className="text-bid">{`${imbalance.bidPct}% Buy`}</span>
        <span className="text-ask">{`Sell ${imbalance.askPct}%`}</span>
      </div>
      <div
        aria-hidden="true"
        className="flex h-1.5 gap-0.5 overflow-hidden rounded-sm"
      >
        <div
          className="bg-bid transition-[width] duration-150 motion-reduce:transition-none"
          style={{ width: `${imbalance.bidPct}%` }}
        />
        <div
          className="bg-ask transition-[width] duration-150 motion-reduce:transition-none"
          style={{ width: `${imbalance.askPct}%` }}
        />
      </div>
    </div>
  )
}
