// Display formatter for the exchange's exact decimal strings. Pure string surgery —
// never a parseFloat().toFixed() round-trip, because toFixed ROUNDS, and a rounded
// price is a price level that doesn't exist in the book. Truncation is lossless by
// construction whenever `decimals` >= the symbol's tick/step digits, which the
// SymbolDisplay record guarantees (see symbol-display.ts).

export function formatDecimalString(value: string, decimals: number): string {
  const dot = value.indexOf(".")
  const whole = dot === -1 ? value : value.slice(0, dot)
  if (decimals === 0) return whole
  const frac = dot === -1 ? "" : value.slice(dot + 1)
  return `${whole}.${frac.slice(0, decimals).padEnd(decimals, "0")}`
}
