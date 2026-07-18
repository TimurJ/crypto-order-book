// Binance REST client for the depth snapshot — the one imperatively-timed fetch inside
// the sync handshake. Deliberately NOT routed through TanStack Query (caching semantics
// are harmful there — docs/tanstack-query-setup.md), and deliberately not fetchJson:
// Binance error responses carry a `{ code, msg }` JSON body that fetchJson's HttpError
// never reads, so this client mirrors fetchJson's shape while capturing it.
//
// BinanceHttpError extends HttpError so the query-layer retry predicate's `status < 500`
// narrowing keeps working if these errors ever flow through Query (fetch-json.ts contract).

import { HttpError, ParseError } from "@/lib/query/fetch-json.ts"
import { z } from "zod"
import { type DepthSnapshot, depthSnapshotSchema } from "./binance-schemas.ts"

const binanceErrorBodySchema = z.object({
  code: z.number(),
  msg: z.string(),
})

export class BinanceHttpError extends HttpError {
  /** Binance API error code (e.g. -1121 invalid symbol); absent if the body wasn't parseable. */
  readonly code?: number
  readonly binanceMsg?: string

  constructor(
    status: number,
    statusText: string,
    url: string,
    code?: number,
    binanceMsg?: string
  ) {
    super(status, statusText, url)
    this.name = "BinanceHttpError"
    this.code = code
    this.binanceMsg = binanceMsg
  }
}

// Binance protocol fact, owned here: 429 = rate-limited, 418 = auto-ban for ignoring
// 429s. Callers decide the policy (the sync engine's retry floor); this names the fact.
export function isBinanceRateLimited(error: unknown): boolean {
  return (
    error instanceof BinanceHttpError &&
    (error.status === 429 || error.status === 418)
  )
}

// HTTP + JSON succeeded but the payload doesn't match the documented shape — a distinct,
// reportable failure (not ParseError, whose contract is "body isn't JSON").
export class BinanceSchemaError extends Error {
  constructor(url: string, cause: unknown) {
    super(`Binance response failed schema validation — ${url}`, { cause })
    this.name = "BinanceSchemaError"
  }
}

export interface FetchDepthSnapshotOptions {
  restBaseUrl: string
  symbol: string
  limit: number
  signal: AbortSignal
}

export async function fetchDepthSnapshot(
  options: FetchDepthSnapshotOptions
): Promise<DepthSnapshot> {
  const { restBaseUrl, symbol, limit, signal } = options
  const url = `${restBaseUrl}/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=${limit}`
  const res = await fetch(url, { signal })
  const resolvedUrl = res.url || url
  if (!res.ok) {
    // A non-JSON error body parses to `undefined` and fails the schema — the status
    // alone is the signal then.
    const body = binanceErrorBodySchema.safeParse(
      await res.json().catch(() => undefined)
    )
    throw new BinanceHttpError(
      res.status,
      res.statusText,
      resolvedUrl,
      body.success ? body.data.code : undefined,
      body.success ? body.data.msg : undefined
    )
  }
  let json: unknown
  try {
    json = await res.json()
  } catch (cause) {
    throw new ParseError(resolvedUrl, cause)
  }
  const parsed = depthSnapshotSchema.safeParse(json)
  if (!parsed.success) {
    throw new BinanceSchemaError(resolvedUrl, parsed.error)
  }
  return parsed.data
}
