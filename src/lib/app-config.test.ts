import { getConfig } from "./app-config.ts"

// getConfig() reads window.__APP_CONFIG__ (populated by /config.js in dev/deployed envs) and falls
// back to the "local" defaults when it's absent — the path a no-DOM-bootstrap unit test exercises.
describe("getConfig", () => {
  afterEach(() => {
    delete window.__APP_CONFIG__
  })

  it("returns the local fallback when window.__APP_CONFIG__ is unset", () => {
    expect(getConfig()).toEqual({
      env: "local",
      apiBaseUrl: "",
      wsUrl: "",
      binanceRestUrl: "",
    })
  })

  it("returns the injected runtime config when present", () => {
    window.__APP_CONFIG__ = {
      env: "prod",
      apiBaseUrl: "https://api.example.com",
      wsUrl: "wss://stream.example.com",
      binanceRestUrl: "https://data.example.com",
    }
    expect(getConfig()).toEqual({
      env: "prod",
      apiBaseUrl: "https://api.example.com",
      wsUrl: "wss://stream.example.com",
      binanceRestUrl: "https://data.example.com",
    })
  })
})
