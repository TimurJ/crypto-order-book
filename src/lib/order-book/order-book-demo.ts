// Console proof for the part-2 data layer: creates the sync engine for one symbol and
// logs status transitions immediately plus a 1s summary line while live. Ships in dev/uat
// (gated out of prod — no live Binance client for real visitors) until part 3 replaces it
// with the rendered book (decision recorded in docs/order-book-sync-architecture.md — it
// live-verifies the deployed CSP + Binance connectivity end-to-end before any UI depends on them).

import { getConfig } from "@/lib/app-config.ts"
import { selectTopLevels } from "./book-levels.ts"
import { createOrderBookSync } from "./order-book-sync.ts"

const DEMO_SYMBOL = "BTCUSDT"
const LOG_INTERVAL_MS = 1_000

export function startOrderBookDemo(): () => void {
  const { env, wsUrl, binanceRestUrl } = getConfig()
  if (env === "prod") {
    // Gated out of prod: a live Binance client for every real visitor (persistent WS +
    // weight-250 (limit-5000) snapshot fetches) is not what the plain app should do. Connectivity is
    // proven live in dev/uat before part 3 renders the book (decision 9, see the docs).
    return () => {}
  }
  if (!wsUrl || !binanceRestUrl) {
    // The no-DOM-bootstrap fallback config (tests) has empty URLs — nothing to demo.
    console.info("[order-book] wsUrl/binanceRestUrl unset — demo not started")
    return () => {}
  }

  const book = createOrderBookSync({
    symbol: DEMO_SYMBOL,
    wsBaseUrl: wsUrl,
    restBaseUrl: binanceRestUrl,
  })

  let lastStatus = book.getState().status
  const unsubscribe = book.subscribe(() => {
    const { status } = book.getState()
    if (status !== lastStatus) {
      console.info(`[order-book ${DEMO_SYMBOL}] ${lastStatus} → ${status}`)
      lastStatus = status
    }
  })

  const timer = setInterval(() => {
    const state = book.getState()
    if (state.status !== "live") return
    const [bestBid] = selectTopLevels(state.bids, "bids", 1)
    const [bestAsk] = selectTopLevels(state.asks, "asks", 1)
    if (!bestBid || !bestAsk) return
    const spread = Number(bestAsk.price) - Number(bestBid.price)
    console.info(
      `[order-book ${DEMO_SYMBOL}] bid ${bestBid.price}×${bestBid.qty} | ` +
        `ask ${bestAsk.price}×${bestAsk.qty} | spread ${spread.toFixed(2)} | ` +
        `levels ${state.bids.size}/${state.asks.size} | id ${state.lastUpdateId} | ` +
        `resyncs ${state.resyncCount} | dropped ${state.droppedFrames}`
    )
  }, LOG_INTERVAL_MS)

  book.start()

  return () => {
    clearInterval(timer)
    unsubscribe()
    book.destroy()
  }
}
