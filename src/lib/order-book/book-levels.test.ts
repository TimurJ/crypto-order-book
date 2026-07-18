import { selectTopLevels } from "./book-levels.ts"

describe("selectTopLevels", () => {
  const book = new Map([
    ["100.10", "1.0"],
    ["99.50", "2.0"],
    ["101.00", "0.5"],
    ["100.90", "3.0"],
  ])

  it("orders bids best-first (highest price)", () => {
    expect(selectTopLevels(book, "bids", 3)).toEqual([
      { price: "101.00", qty: "0.5" },
      { price: "100.90", qty: "3.0" },
      { price: "100.10", qty: "1.0" },
    ])
  })

  it("orders asks best-first (lowest price)", () => {
    expect(selectTopLevels(book, "asks", 3)).toEqual([
      { price: "99.50", qty: "2.0" },
      { price: "100.10", qty: "1.0" },
      { price: "100.90", qty: "3.0" },
    ])
  })

  it("returns fewer levels than requested when the book is shallow", () => {
    expect(selectTopLevels(new Map([["1.00", "1"]]), "bids", 5)).toEqual([
      { price: "1.00", qty: "1" },
    ])
    expect(selectTopLevels(new Map(), "asks", 5)).toEqual([])
  })

  it("compares numerically but returns the exact string prices", () => {
    // "9" < "10" numerically but not lexicographically — and the 8-decimal
    // strings come back byte-identical, never re-serialised through a float.
    const levels = new Map([
      ["9.00000000", "1"],
      ["10.00000000", "1"],
    ])
    expect(selectTopLevels(levels, "asks", 2).map((l) => l.price)).toEqual([
      "9.00000000",
      "10.00000000",
    ])
  })
})
