// Read-side helper for the order-book store: the book lives as unsorted Maps (O(1)
// writes at stream cadence — see docs/order-book-sync-architecture.md), and ordering
// is paid only when a reader asks. Number() is used for COMPARISON only — the exact
// string prices remain the identity the caller gets back.

export type BookSide = "bids" | "asks"

export interface BookLevel {
  price: string
  qty: string
}

export function selectTopLevels(
  levels: ReadonlyMap<string, string>,
  side: BookSide,
  count: number
): BookLevel[] {
  // Parse each price once, not twice per comparison inside the sort.
  const sign = side === "bids" ? -1 : 1
  const decorated = Array.from(
    levels,
    ([price, qty]): [number, string, string] => [Number(price), price, qty]
  )
  decorated.sort(([a], [b]) => sign * (a - b))
  return decorated.slice(0, count).map(([, price, qty]) => ({ price, qty }))
}
