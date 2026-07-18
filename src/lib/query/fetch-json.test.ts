import { fetchJson, HttpError, ParseError } from "./fetch-json.ts"

describe("fetchJson", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("parses JSON on ok responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }))
    )

    await expect(fetchJson("/api/health")).resolves.toEqual({ status: "ok" })
  })

  it("throws HttpError carrying the status on non-ok responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("boom", { status: 503, statusText: "Service Unavailable" })
    )

    const error = await fetchJson("/api/health").catch((e: unknown) => e)

    expect(error).toBeInstanceOf(HttpError)
    const httpError = error as HttpError
    expect(httpError.status).toBe(503)
    expect(httpError.name).toBe("HttpError")
    // Synthetic Responses have an empty res.url, so the requested URL is the fallback.
    expect(httpError.message).toBe("HTTP 503 Service Unavailable — /api/health")
  })

  it("throws ParseError when an ok response body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!doctype html><title>SPA</title>")
    )

    const error = await fetchJson("/api/health").catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ParseError)
    const parseError = error as ParseError
    expect(parseError.name).toBe("ParseError")
    // Synthetic Responses have an empty res.url, so the requested URL is the fallback.
    expect(parseError.message).toBe("Invalid JSON response — /api/health")
    expect(parseError.cause).toBeInstanceOf(SyntaxError)
  })

  it("forwards the AbortSignal to fetch", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"))
    const controller = new AbortController()

    await fetchJson("/api/health", { signal: controller.signal })

    expect(spy).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ signal: controller.signal })
    )
  })
})
