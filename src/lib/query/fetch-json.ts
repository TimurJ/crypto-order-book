// Minimal JSON fetch primitive for queryFns. `fetch` only rejects on *network* failure —
// an HTTP 500 resolves successfully with `ok: false` — while TanStack Query's entire failure
// machinery (error state, the retry predicate, cache-level reporting) keys off the queryFn's
// promise rejecting. This helper closes that gap: non-ok responses become a thrown HttpError
// carrying the status code the retry predicate narrows on (query-client.ts).
//
// Deliberately dumb — no base URL, no timeout, no schema validation (see
// docs/tanstack-query-setup.md for why zod is deferred to the first third-party API).
// Richer clients (the future Binance REST handler) should subclass HttpError so the
// `status < 500` retry check keeps working on their errors.

export class HttpError extends Error {
  readonly status: number

  constructor(status: number, statusText: string, url: string) {
    // Status + URL only — never the response body (unbounded, and may embed arbitrary
    // server output into logs/Sentry).
    super(`HTTP ${status} ${statusText} — ${url}`)
    this.name = "HttpError"
    this.status = status
  }
}

// The other typed failure mode: HTTP succeeded but the body isn't JSON (a misrouted path
// serving HTML, a 204, a truncated body). Deterministic — the retry predicate never retries
// it (query-client.ts). `cause` preserves the original SyntaxError for the reportError seam
// without quoting the response body into the message.
export class ParseError extends Error {
  constructor(url: string, cause: unknown) {
    super(`Invalid JSON response — ${url}`, { cause })
    this.name = "ParseError"
  }
}

// Callers must forward the AbortSignal Query hands every queryFn:
//   queryFn: ({ signal }) => fetchJson<T>("/api/…", { signal })
// so requests are truly cancelled when a query unmounts or its key changes.
export async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, init)
  // res.url is empty on synthetic Responses (tests); fall back to the requested URL.
  const resolvedUrl = res.url || url
  if (!res.ok) {
    throw new HttpError(res.status, res.statusText, resolvedUrl)
  }
  try {
    return (await res.json()) as T
  } catch (cause) {
    throw new ParseError(resolvedUrl, cause)
  }
}
