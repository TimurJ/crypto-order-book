// Guards the env-identical-hosts invariant that keeps the CSP static (decision 9,
// docs/order-book-sync-architecture.md): the Binance hosts live in three files that can't
// share a constant (JSONC vars, the vite devConfig, the _headers CSP), and nothing else
// checks they agree — smoke.sh asserts /config.js contents, not CSP admittance. A host
// changed in one surface but not the others would CSP-block every deployed env from its
// data source.

import headersText from "../../../public/_headers?raw"
import viteConfigText from "../../../vite.config.ts?raw"
import wranglerText from "../../../wrangler.jsonc?raw"

const allMatches = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].map(([, value]) => {
    if (value === undefined) throw new Error(`no capture group: ${pattern}`)
    return value
  })

const single = (values: string[], label: string): string => {
  const unique = new Set(values)
  expect(unique, `${label} must be identical everywhere`).toEqual(
    new Set([values[0]])
  )
  const value = values[0]
  if (!value) throw new Error(`${label} not found or empty`)
  return value
}

describe("binance host invariant (env-identical, CSP-admitted)", () => {
  const wranglerWs = allMatches(wranglerText, /"WS_URL":\s*"([^"]*)"/g)
  const wranglerRest = allMatches(
    wranglerText,
    /"BINANCE_REST_URL":\s*"([^"]*)"/g
  )

  it("declares the same hosts in all three wrangler envs", () => {
    expect(wranglerWs).toHaveLength(3)
    expect(wranglerRest).toHaveLength(3)
    single(wranglerWs, "WS_URL")
    single(wranglerRest, "BINANCE_REST_URL")
  })

  it("keeps the vite devConfig on the deployed hosts", () => {
    expect(allMatches(viteConfigText, /wsUrl:\s*"([^"]*)"/g)).toEqual([
      single(wranglerWs, "WS_URL"),
    ])
    expect(allMatches(viteConfigText, /binanceRestUrl:\s*"([^"]*)"/g)).toEqual([
      single(wranglerRest, "BINANCE_REST_URL"),
    ])
  })

  it("admits both hosts in the CSP connect-src", () => {
    const csp = headersText.match(/Content-Security-Policy: (.*)/)?.[1]
    if (!csp) throw new Error("no Content-Security-Policy line in _headers")
    const connectSrc = csp.match(/connect-src ([^;]*)/)?.[1]
    if (!connectSrc) throw new Error("no connect-src directive in the CSP")
    const sources = connectSrc.trim().split(/\s+/)
    expect(sources).toContain(single(wranglerWs, "WS_URL"))
    expect(sources).toContain(single(wranglerRest, "BINANCE_REST_URL"))
  })
})
