// Truncates, never rounds: toFixed would invent price levels that don't exist in the book.

export function formatDecimalString(value: string, decimals: number): string {
  const dot = value.indexOf(".")
  const whole = dot === -1 ? value : value.slice(0, dot)
  if (decimals === 0) return whole
  const frac = dot === -1 ? "" : value.slice(dot + 1)
  return `${whole}.${frac.slice(0, decimals).padEnd(decimals, "0")}`
}

/** Comma-groups the integer part ("68418.00" → "68,418.00") — group AFTER truncating. */
export function groupThousands(value: string): string {
  const dot = value.indexOf(".")
  const whole = dot === -1 ? value : value.slice(0, dot)
  const rest = dot === -1 ? "" : value.slice(dot)
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${grouped}${rest}`
}
