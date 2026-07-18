import {
  BinanceHttpError,
  BinanceSchemaError,
  fetchDepthSnapshot,
} from "./binance-rest.ts"
import { HttpError, ParseError } from "@/lib/query/fetch-json.ts"

const options = {
  restBaseUrl: "https://data-api.test",
  symbol: "btcusdt",
  limit: 5000,
  signal: new AbortController().signal,
}

const validBody = {
  lastUpdateId: 42,
  bids: [["100.00", "1.5"]],
  asks: [["100.10", "2.0"]],
}

describe("fetchDepthSnapshot", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("builds the depth URL (symbol uppercased) and returns the parsed snapshot", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(validBody)))

    const snapshot = await fetchDepthSnapshot(options)

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://data-api.test/api/v3/depth?symbol=BTCUSDT&limit=5000",
      { signal: options.signal }
    )
    expect(snapshot).toEqual(validBody)
  })

  it("throws BinanceHttpError carrying the error body's code and msg", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: -1121, msg: "Invalid symbol." }), {
        status: 400,
        statusText: "Bad Request",
      })
    )

    const error = await fetchDepthSnapshot(options).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(BinanceHttpError)
    // The subclass contract: the query layer's `status < 500` narrowing keeps working.
    expect(error).toBeInstanceOf(HttpError)
    const binanceError = error as BinanceHttpError
    expect(binanceError.status).toBe(400)
    expect(binanceError.code).toBe(-1121)
    expect(binanceError.binanceMsg).toBe("Invalid symbol.")
  })

  it("throws BinanceHttpError with no code when the error body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>gateway error</html>", {
        status: 502,
        statusText: "Bad Gateway",
      })
    )

    const error = await fetchDepthSnapshot(options).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(BinanceHttpError)
    const binanceError = error as BinanceHttpError
    expect(binanceError.status).toBe(502)
    expect(binanceError.code).toBeUndefined()
  })

  it("throws ParseError when a 2xx body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not json at all")
    )

    await expect(fetchDepthSnapshot(options)).rejects.toBeInstanceOf(ParseError)
  })

  it("throws BinanceSchemaError when valid JSON fails the snapshot schema", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ lastUpdateId: "not-a-number", bids: [] }))
    )

    await expect(fetchDepthSnapshot(options)).rejects.toBeInstanceOf(
      BinanceSchemaError
    )
  })
})
