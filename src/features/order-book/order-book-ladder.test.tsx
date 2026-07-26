import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { OrderBookLadder } from "./order-book-ladder.tsx"
import type { OrderBookView, ViewLevel } from "./order-book-view.ts"
import { BTCUSDT_DISPLAY } from "./symbol-display.ts"
import type { LevelFlashes } from "./use-level-flashes.ts"
import type { MidDirection } from "./use-mid-direction.ts"
import type { BookViewFilter } from "./view-toggle.tsx"

const noFlashes: LevelFlashes = {
  bidFlashes: new Map(),
  askFlashes: new Map(),
}

const level = (
  price: string,
  qty: string,
  cumulative = 1,
  barPct = 50,
  cumulativeQuote = 100
): ViewLevel => ({ price, qty, cumulative, barPct, cumulativeQuote })

function makeView(overrides: Partial<OrderBookView> = {}): OrderBookView {
  return {
    status: "live",
    hasBook: true,
    bids: [
      level("101.00", "1.5", 1.5, 42.9, 151.5),
      level("100.00", "2.0", 3.5, 100, 351.5),
    ],
    asks: [
      level("102.00", "0.5", 0.5, 14.3, 51),
      level("103.00", "3.0", 3.5, 100, 360),
    ],
    spread: 1,
    spreadPct: (1 / 102) * 100,
    mid: 101.5,
    imbalance: { bidPct: 50, askPct: 50 },
    resyncCount: 0,
    droppedFrames: 0,
    ...overrides,
  }
}

interface RenderOptions {
  flashes?: LevelFlashes
  midDirection?: MidDirection | null
  viewFilter?: BookViewFilter
}

function renderLadder(
  view: OrderBookView,
  {
    flashes = noFlashes,
    midDirection = null,
    viewFilter = "all",
  }: RenderOptions = {}
) {
  return render(
    <OrderBookLadder
      view={view}
      display={BTCUSDT_DISPLAY}
      flashes={flashes}
      midDirection={midDirection}
      viewFilter={viewFilter}
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
    ).toEqual(["Price (USDT)", "Size (BTC)", "Total"])
  })

  it("stacks asks worst-first above the spread row and bids best-first below", () => {
    renderLadder(makeView())
    const [, ...rows] = screen.getAllByRole("row")
    const firstCells = rows.map(
      (row) => within(row as HTMLElement).getAllByRole("cell")[0]?.textContent
    )
    // Ask tbody renders reversed (best ask ends adjacent to the spread row), then the
    // spread strip (one colSpan cell), then bids best-first.
    expect(firstCells[0]).toBe("103.00")
    expect(firstCells[1]).toBe("102.00")
    expect(firstCells[2]).toContain("101.50")
    expect(firstCells[3]).toBe("101.00")
    expect(firstCells[4]).toBe("100.00")
  })

  it("formats cells: grouped 2dp price, lossless 5dp size, 2dp derived total", () => {
    renderLadder(
      makeView({
        bids: [level("68418.10000000", "1.23456789", 1.234, 100, 84463)],
        asks: [level("68419.90000000", "0.5", 0.5, 100, 34210)],
      })
    )
    const rows = screen.getAllByRole("row")
    // Rows: header, ask, spread, bid — the bid row is last.
    const bidCells = within(rows.at(-1) as HTMLElement).getAllByRole("cell")
    expect(bidCells.map((cell) => cell.textContent)).toEqual([
      "68,418.10",
      "1.23456",
      "1.23",
    ])
  })

  it("renders the spread row from mid/spread/spreadPct with no arrow pre-first-move", () => {
    renderLadder(makeView())
    const spreadCell = screen.getByText("101.50")
    expect(spreadCell.textContent).toBe("101.50")
    expect(screen.getByText("Spread 1.00 · 0.980%")).toBeInTheDocument()
  })

  it("arrows and colors the mid by the last move direction", () => {
    renderLadder(makeView(), { midDirection: "up" })
    expect(screen.getByText(/▲ 101\.50/)).toHaveClass("text-bid")
  })

  it("renders an em dash when the book has no valid mid", () => {
    renderLadder(makeView({ mid: null, spread: null, spreadPct: null }))
    expect(screen.getByText("—")).toBeInTheDocument()
    expect(screen.getByText("Spread —")).toBeInTheDocument()
  })

  it("hides the ask side under the bids filter but keeps the spread row", () => {
    renderLadder(makeView(), { viewFilter: "bids" })
    expect(screen.queryByText("102.00")).not.toBeInTheDocument()
    expect(screen.queryByText("103.00")).not.toBeInTheDocument()
    expect(screen.getByText("101.00")).toBeInTheDocument()
    expect(screen.getByText("101.50")).toBeInTheDocument()
  })

  it("hides the bid side under the asks filter but keeps the spread row", () => {
    renderLadder(makeView(), { viewFilter: "asks" })
    expect(screen.queryByText("101.00")).not.toBeInTheDocument()
    expect(screen.getByText("102.00")).toBeInTheDocument()
    expect(screen.getByText("101.50")).toBeInTheDocument()
  })

  it("sizes each depth bar at 3× its per-side barPct inside the third column", () => {
    const { container } = renderLadder(
      makeView({
        bids: [level("101.00", "1.5", 1.5, 100, 151.5)],
        asks: [level("102.00", "0.5", 0.5, 30, 51)],
      })
    )
    const widths = Array.from(
      container.querySelectorAll<HTMLElement>('[aria-hidden="true"]')
    )
      .filter((el) => el.style.width !== "")
      .map((el) => el.style.width)
    expect(widths).toEqual(["90%", "300%"])
  })

  it("tones the flash overlay by direction, not by side", () => {
    const { container } = renderLadder(makeView(), {
      flashes: {
        bidFlashes: new Map([["101.00", "down"]]),
        askFlashes: new Map(),
      },
    })
    const overlays = container.querySelectorAll(".animate-book-flash")
    expect(overlays).toHaveLength(1)
    // A bid whose size DROPPED flashes in the ask/red family (design: direction color).
    expect(overlays[0]).toHaveClass("bg-ask-muted")
  })

  it("shows the cumulative aggregates popup on row hover", async () => {
    const user = userEvent.setup()
    renderLadder(makeView())
    const bestAskRow = screen.getByText("102.00").closest("tr") as HTMLElement
    await user.hover(bestAskRow)
    // Hand-computed from the level: cumulative 0.5, cumulativeQuote 51, mid 101.5 →
    // avg 102, distance |102 − 101.5| / 101.5 × 100 = 0.4926%.
    const popup = (await screen.findByText("Distance from Mid")).closest(
      '[data-slot="tooltip-content"]'
    ) as HTMLElement
    expect(within(popup).getByText("0.4926%")).toBeInTheDocument()
    expect(within(popup).getByText("Average Price")).toBeInTheDocument()
    expect(within(popup).getByText("102")).toBeInTheDocument()
    expect(within(popup).getByText("Total (BTC)")).toBeInTheDocument()
    expect(within(popup).getByText("0.50000")).toBeInTheDocument()
    expect(within(popup).getByText("Total (USDT)")).toBeInTheDocument()
    expect(within(popup).getByText("51")).toBeInTheDocument()
  })

  it("renders the skeleton variant before the first sync", () => {
    const { container } = renderLadder(
      makeView({
        hasBook: false,
        bids: [],
        asks: [],
        spread: null,
        spreadPct: null,
        mid: null,
        imbalance: null,
      })
    )
    const table = screen.getByRole("table")
    expect(table).toHaveAttribute("aria-busy", "true")
    // Header + 20 ask placeholders + the spread strip + 20 bid placeholders.
    expect(screen.getAllByRole("row")).toHaveLength(42)
    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
    // No readable book values anywhere — the strip shows placeholders only.
    expect(screen.queryByText(/\d/)).not.toBeInTheDocument()
  })
})
