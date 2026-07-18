// Behaviour-tests the factory's retry predicate and reporting seam through a REAL client —
// the predicate isn't exported, so we drive fetchQuery with per-query retryDelay: 0 (a
// supported per-query option) to make the retry cycles instant.

import type { QueryClient } from "@tanstack/react-query"
import { HttpError, ParseError } from "./fetch-json.ts"
import { createQueryClient } from "./query-client.ts"

describe("createQueryClient", () => {
  let client: QueryClient
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    client = createQueryClient()
    // Silences the reportError console output the onError seam produces — and doubles as
    // the assertion surface for it (the house move: test the seam, don't suppress it).
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    client.clear()
    vi.restoreAllMocks()
  })

  it("does not retry 4xx HttpErrors", async () => {
    const queryFn = vi
      .fn()
      .mockRejectedValue(new HttpError(404, "Not Found", "/x"))

    await expect(
      client.fetchQuery({ queryKey: ["t"], queryFn, retryDelay: 0 })
    ).rejects.toBeInstanceOf(HttpError)

    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it("retries 5xx twice (3 attempts total)", async () => {
    const queryFn = vi
      .fn()
      .mockRejectedValue(new HttpError(503, "Service Unavailable", "/x"))

    await expect(
      client.fetchQuery({ queryKey: ["t"], queryFn, retryDelay: 0 })
    ).rejects.toBeInstanceOf(HttpError)

    expect(queryFn).toHaveBeenCalledTimes(3)
  })

  it("does not retry ParseErrors (a malformed body is deterministic)", async () => {
    const queryFn = vi
      .fn()
      .mockRejectedValue(new ParseError("/x", new SyntaxError("bad json")))

    await expect(
      client.fetchQuery({ queryKey: ["t"], queryFn, retryDelay: 0 })
    ).rejects.toBeInstanceOf(ParseError)

    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it("retries network-style errors twice (3 attempts total)", async () => {
    const queryFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"))

    await expect(
      client.fetchQuery({ queryKey: ["t"], queryFn, retryDelay: 0 })
    ).rejects.toBeInstanceOf(TypeError)

    expect(queryFn).toHaveBeenCalledTimes(3)
  })

  it("reports final failures through reportError with the query key", async () => {
    const failure = new HttpError(404, "Not Found", "/x")

    await client
      .fetchQuery({
        queryKey: ["health"],
        queryFn: () => Promise.reject(failure),
        retryDelay: 0,
      })
      .catch(() => undefined)

    expect(errorSpy).toHaveBeenCalledWith("[reportError] query:cache", failure)
    expect(errorSpy).toHaveBeenCalledWith(
      "[reportError] query key:",
      JSON.stringify(["health"])
    )
  })
})
