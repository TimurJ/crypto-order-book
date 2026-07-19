import { render, screen, within } from "@testing-library/react"
import { OrderBookLadder } from "./order-book-ladder.tsx"
import type { OrderBookView } from "./order-book-view.ts"
import { BTCUSDT_DISPLAY } from "./symbol-display.ts"
import type { LevelFlashes } from "./use-level-flashes.ts"

const noFlashes: LevelFlashes = {
  bidFlashes: new Set(),
  askFlashes: new Set(),
}

const level = (price: string, qty: string, cumulative = 1, barPct = 50) => ({
  price,
  qty,
  cumulative,
  barPct,
})

function makeView(overrides: Partial<OrderBookView> = {}): OrderBookView {
  return {
    status: "live",
    hasBook: true,
    bids: [level("101.00", "1.5"), level("100.00", "2.0")],
    asks: [level("102.00", "0.5"), level("103.00", "3.0")],
    spread: 1,
    resyncCount: 0,
    droppedFrames: 0,
    ...overrides,
  }
}

function renderLadder(view: OrderBookView, flashes: LevelFlashes = noFlashes) {
  return render(
    <OrderBookLadder
      view={view}
      display={BTCUSDT_DISPLAY}
      flashes={flashes}
      levelCount={20}
    />
  )
}

describe("OrderBookLadder", () => {
  it("renders a real table named by its caption, with unit-labeled headers", () => {
    renderLadder(makeView())
    expect(
      screen.getByRole("table", { name: "Live order book for BTC/USDT" })
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole("columnheader").map((th) => th.textContent)
    ).toEqual(["Amount (BTC)", "Bid (USDT)", "Ask (USDT)", "Amount (BTC)"])
  })

  it("renders slot rows mirrored: bid qty|price then ask price|qty, formatted", () => {
    renderLadder(makeView())
    const [, firstSlot, secondSlot] = screen.getAllByRole("row")
    expect(
      within(firstSlot as HTMLElement)
        .getAllByRole("cell")
        .map((cell) => cell.textContent)
    ).toEqual(["1.50000", "101.00", "102.00", "0.50000"])
    expect(
      within(secondSlot as HTMLElement)
        .getAllByRole("cell")
        .map((cell) => cell.textContent)
    ).toEqual(["2.00000", "100.00", "103.00", "3.00000"])
  })

  it("renders short sides with empty cells, no phantom rows", () => {
    renderLadder(makeView({ asks: [level("102.00", "0.5")] }))
    const rows = screen.getAllByRole("row")
    // Header row + two slots (bid side has two levels).
    expect(rows).toHaveLength(3)
    const secondSlotCells = within(rows[2] as HTMLElement).getAllByRole("cell")
    expect(secondSlotCells.map((cell) => cell.textContent)).toEqual([
      "2.00000",
      "100.00",
      "",
      "",
    ])
  })

  it("exposes bars and flash overlays as decorative only — cell text is exactly the values", () => {
    const { container } = renderLadder(
      makeView({
        bids: [level("101.00", "1.5", 1, 100)],
        asks: [level("102.00", "0.5", 1, 30)],
      }),
      { bidFlashes: new Set(["101.00"]), askFlashes: new Set() }
    )
    const [, slot] = screen.getAllByRole("row")
    const cells = within(slot as HTMLElement).getAllByRole("cell")
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "1.50000",
      "101.00",
      "102.00",
      "0.50000",
    ])
    const decorative = container.querySelectorAll('[aria-hidden="true"]')
    // Two depth bars + one flash overlay (only the flagged bid level flashes).
    expect(decorative).toHaveLength(3)
    expect(container.querySelectorAll(".animate-book-flash")).toHaveLength(1)
  })

  it("renders the skeleton variant before the first sync", () => {
    const { container } = renderLadder(
      makeView({ hasBook: false, bids: [], asks: [], spread: null })
    )
    const table = screen.getByRole("table")
    expect(table).toHaveAttribute("aria-busy", "true")
    // 20 placeholder slots at full geometry, no readable values anywhere.
    expect(screen.getAllByRole("row")).toHaveLength(21)
    for (const cell of screen.getAllByRole("cell")) {
      expect(cell).toHaveTextContent("")
    }
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
  })
})
