// Display metadata for a rendered symbol. Deliberately a hardcoded record, NOT derived
// by parsing the symbol string ("BTCUSDT".slice(…) is a heuristic that breaks on the
// first symbol whose quote asset isn't 4 chars). This record is the exact seam where a
// Binance exchangeInfo lookup slots in when a symbol picker arrives: base/quote come from
// baseAsset/quoteAsset, and the decimal counts from the PRICE_FILTER tickSize (0.01) and
// LOT_SIZE stepSize (0.00001) — the values below were verified against the live endpoint.

export interface SymbolDisplay {
  symbol: string
  base: string
  quote: string
  /** Fractional digits shown for prices — must be >= the symbol's tick-size digits. */
  priceDecimals: number
  /** Fractional digits shown for quantities — must be >= the symbol's step-size digits. */
  qtyDecimals: number
}

/**
 * The one source of the human-facing pair label ("BTC/USDT") — the visible card title and
 * the ladder's screen-reader caption both derive from here, so they can never drift apart.
 */
export function formatPair(display: SymbolDisplay): string {
  return `${display.base}/${display.quote}`
}

export const BTCUSDT_DISPLAY: SymbolDisplay = {
  symbol: "BTCUSDT",
  base: "BTC",
  quote: "USDT",
  priceDecimals: 2,
  qtyDecimals: 5,
}
