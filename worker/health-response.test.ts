import { healthResponse } from "./health-response.ts"

// healthResponse builds the /api/health JSON the Worker serves (run_worker_first covers
// /api/*). Worker-generated ⇒ `_headers` can't attach headers, so nosniff/no-store are set
// in code and guarded here — same contract-pinning as config-response.test.ts. The raw-text
// assertions pin the exact substrings scripts/smoke.sh greps before every promote.
describe("healthResponse", () => {
  it("sets a nosniff, no-store JSON response", () => {
    const res = healthResponse({ APP_ENV: "prod" })

    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("serialises status, env, and a parseable server timestamp", async () => {
    const res = healthResponse({ APP_ENV: "uat" })
    const text = await res.text()

    expect(text).toContain('"status":"ok"')
    expect(text).toContain('"env":"uat"')

    const body = JSON.parse(text) as {
      status: string
      env: string
      now: string
    }
    expect(body.status).toBe("ok")
    expect(body.env).toBe("uat")
    expect(Number.isNaN(Date.parse(body.now))).toBe(false)
  })
})
