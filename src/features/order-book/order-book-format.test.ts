import { formatDecimalString } from "./order-book-format.ts"

describe("formatDecimalString", () => {
  it("truncates extra fractional digits", () => {
    expect(formatDecimalString("67012.34000000", 2)).toBe("67012.34")
  })

  it("truncates — never rounds — at the boundary", () => {
    // toFixed would produce "67012.35"; a rounded price is not a real book level.
    expect(formatDecimalString("67012.34999999", 2)).toBe("67012.34")
  })

  it("zero-pads when the input has fewer fractional digits", () => {
    expect(formatDecimalString("67012.3", 2)).toBe("67012.30")
  })

  it("handles input with no decimal point", () => {
    expect(formatDecimalString("67012", 2)).toBe("67012.00")
  })

  it("returns the input unchanged at exactly the asked precision", () => {
    expect(formatDecimalString("0.00512", 5)).toBe("0.00512")
  })

  it("formats an all-zero quantity", () => {
    expect(formatDecimalString("0.00000000", 5)).toBe("0.00000")
  })

  it("drops the fraction entirely at zero decimals", () => {
    expect(formatDecimalString("67012.34", 0)).toBe("67012")
  })
})
