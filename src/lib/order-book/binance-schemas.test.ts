import { depthLevelSchema, depthUpdateSchema } from "./binance-schemas.ts"

describe("depthLevelSchema", () => {
  it("accepts finite decimal strings, including zero", () => {
    expect(depthLevelSchema.safeParse(["100.00", "1.0"]).success).toBe(true)
    expect(depthLevelSchema.safeParse(["0", "0.00000000"]).success).toBe(true)
    expect(depthLevelSchema.safeParse(["64143.91000000", "0.5"]).success).toBe(
      true
    )
  })

  it("rejects empty, whitespace, non-numeric, and non-canonical numeric strings", () => {
    for (const bad of [
      ["", "1.0"],
      [" ", "1.0"],
      ["abc", "1.0"],
      ["100.00", ""],
      ["100.00", " "],
      ["100.00", "NaN"],
      // Number()-finite but not canonical decimals — these would key the book Map on the
      // raw form, diverging from the same price written canonically.
      [" 100 ", "1.0"],
      ["1e3", "1.0"],
      ["+100", "1.0"],
      ["0x10", "1.0"],
    ]) {
      expect(depthLevelSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe("depthUpdateSchema", () => {
  const frame = (b: [string, string][], a: [string, string][] = []) => ({
    e: "depthUpdate",
    E: 1,
    s: "BTCUSDT",
    U: 1,
    u: 2,
    b,
    a,
  })

  it("accepts a well-formed frame", () => {
    expect(
      depthUpdateSchema.safeParse(frame([["100.00", "1.0"]])).success
    ).toBe(true)
  })

  it("rejects a frame whose level carries a non-numeric price", () => {
    expect(depthUpdateSchema.safeParse(frame([["x", "1.0"]])).success).toBe(
      false
    )
  })

  it("rejects a frame whose level carries an empty quantity", () => {
    expect(depthUpdateSchema.safeParse(frame([["100.00", ""]])).success).toBe(
      false
    )
  })
})
