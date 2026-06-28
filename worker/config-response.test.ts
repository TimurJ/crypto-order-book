import { configResponse } from "./config-response.ts"

// configResponse builds the /config.js response the Worker serves (run_worker_first). Because that
// response is Worker-generated, Cloudflare's `_headers` file can't attach headers to it — so the
// nosniff header is set here and guarded by this test. (Document-level headers live in
// public/_headers, which covers the statically served document + assets.)
describe("configResponse", () => {
  it("sets a nosniff, no-store JavaScript response", () => {
    const res = configResponse({
      APP_ENV: "prod",
      API_BASE_URL: "",
      WS_URL: "",
    })

    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("content-type")).toContain("application/javascript")
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("serialises the runtime config into window.__APP_CONFIG__", async () => {
    const res = configResponse({
      APP_ENV: "dev",
      API_BASE_URL: "https://api.example.com",
      WS_URL: "wss://stream.example.com",
    })

    const body = await res.text()
    expect(body).toContain("window.__APP_CONFIG__")
    expect(body).toContain('"env":"dev"')
    expect(body).toContain('"apiBaseUrl":"https://api.example.com"')
    expect(body).toContain('"wsUrl":"wss://stream.example.com"')
  })
})
