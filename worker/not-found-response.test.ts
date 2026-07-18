import { apiNotFoundResponse } from "./not-found-response.ts"

// apiNotFoundResponse answers unmatched /api/* paths (run_worker_first routes the whole
// namespace to the Worker). Guards the contract smoke.sh asserts before every promote:
// a real 404 + JSON body — never the SPA fallback's index.html at 200.
describe("apiNotFoundResponse", () => {
  it("sets a 404 nosniff, no-store JSON response", () => {
    const res = apiNotFoundResponse("/api/bogus")

    expect(res.status).toBe(404)
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("serialises the not_found marker and the echoed path", async () => {
    const res = apiNotFoundResponse("/api/bogus")
    const text = await res.text()

    expect(text).toContain('"error":"not_found"')

    const body = JSON.parse(text) as { error: string; path: string }
    expect(body.error).toBe("not_found")
    expect(body.path).toBe("/api/bogus")
  })
})
