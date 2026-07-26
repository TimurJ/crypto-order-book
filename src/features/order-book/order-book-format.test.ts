import { formatDecimalString, groupThousands } from "./order-book-format.ts"

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

describe("groupThousands", () => {
  it("groups the integer part and leaves the fraction alone", () => {
    expect(groupThousands("68418.00")).toBe("68,418.00")
  })

  it("groups seven-plus digit integers with multiple commas", () => {
    expect(groupThousands("1234567.89")).toBe("1,234,567.89")
  })

  it("passes short integers through unchanged", () => {
    expect(groupThousands("999.5")).toBe("999.5")
  })

  it("handles input with no decimal point", () => {
    expect(groupThousands("68418")).toBe("68,418")
  })

  it("never groups fractional digits", () => {
    expect(groupThousands("0.00012345")).toBe("0.00012345")
  })

  it("composes with formatDecimalString", () => {
    expect(groupThousands(formatDecimalString("68418.11999999", 2))).toBe(
      "68,418.11"
    )
  })
})
