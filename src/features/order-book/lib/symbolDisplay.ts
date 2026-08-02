// Hardcoded record, never parsed from the symbol string — the exchangeInfo seam (see ../CLAUDE.md).

export interface SymbolDisplay {
  symbol: string
  base: string
  quote: string
  /** Fractional digits shown for prices — must be >= the symbol's tick-size digits. */
  priceDecimals: number
  /** Fractional digits shown for quantities — must be >= the symbol's step-size digits. */
  qtyDecimals: number
}

/** The one source of the pair label ("BTC/USDT") — card title and SR caption both use it. */
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
