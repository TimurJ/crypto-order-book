// Central error-reporting seam. Every error channel — the React error boundary
// (react-error-boundary's onError), React 19's root createRoot hooks, and the global
// window listeners — funnels through this one function. Today it just logs; the point
// is the *contract*: adopting Sentry later is a one-line swap here (Sentry.captureException),
// with zero changes at any call site.
//
// NB: this is our module export `reportError`, deliberately not the global `window.reportError`
// Web API — always import it explicitly from "@/lib/report-error.ts".

export interface ReportContext {
  // React-supplied component stack (errorInfo.componentStack), when the error came
  // from a render path. Null/absent for async/global errors.
  componentStack?: string | null
  // Where the error was caught, so logs/breadcrumbs are attributable.
  source?:
    | "react:boundary"
    | "react:uncaught"
    | "react:recoverable"
    | "window:unhandledrejection"
    | "window:error"
    | "ws:transport"
    | "order-book:sync"
    | "query:cache"
    | "query:mutation"
  // Which query failed (QueryCache onError's `query.queryKey`) — the primary triage fact for
  // query errors. Maps onto Sentry's `extra` when the swap happens. Absent for non-query sources.
  queryKey?: readonly unknown[]
}

export function reportError(error: unknown, context: ReportContext = {}): void {
  const { source, componentStack, queryKey } = context

  // Swap this body for `Sentry.captureException(error, { ... })` when observability lands.
  console.error(`[reportError]${source ? ` ${source}` : ""}`, error)
  if (componentStack) {
    console.error("[reportError] component stack:", componentStack)
  }
  if (queryKey) {
    console.error("[reportError] query key:", JSON.stringify(queryKey))
  }
}
