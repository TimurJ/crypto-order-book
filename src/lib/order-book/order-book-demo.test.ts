import type { AppConfig } from "@/lib/app-config.ts"
import { FakeWebSocket } from "@/test/fake-web-socket.ts"
import { startOrderBookDemo } from "./order-book-demo.ts"

const HOSTS = {
  wsUrl: "wss://data-stream.binance.vision",
  binanceRestUrl: "https://data-api.binance.vision",
}

const setConfig = (config: Partial<AppConfig>) => {
  window.__APP_CONFIG__ = {
    env: "local",
    apiBaseUrl: "",
    wsUrl: "",
    binanceRestUrl: "",
    ...config,
  }
}

describe("startOrderBookDemo", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("WebSocket", FakeWebSocket)
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    )
    vi.spyOn(console, "info").mockImplementation(() => {})
  })

  afterEach(() => {
    window.__APP_CONFIG__ = undefined
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
    FakeWebSocket.instances = []
  })

  it("does not open a Binance connection in prod", () => {
    setConfig({ env: "prod", ...HOSTS })
    const stop = startOrderBookDemo()
    expect(FakeWebSocket.instances).toHaveLength(0)
    stop()
  })

  it("starts the live client in a non-prod env with hosts configured", () => {
    setConfig({ env: "dev", ...HOSTS })
    const stop = startOrderBookDemo()
    expect(FakeWebSocket.instances).toHaveLength(1)
    stop()
  })

  it("does nothing when the hosts are unset (fallback config)", () => {
    setConfig({ env: "local" })
    const stop = startOrderBookDemo()
    expect(FakeWebSocket.instances).toHaveLength(0)
    stop()
  })
})
