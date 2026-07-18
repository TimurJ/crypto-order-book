# Error handling — architecture & decisions

How errors are caught, reported, and recovered across the React tree — the decisions behind the
current setup, and the roadmap for what gets built on top of it (per-widget boundaries, Sentry,
data-layer hardening).

> **Status:** implemented **2026-06-28**. A root error boundary, the `reportError` seam, and global
> async handlers are in place and tested. Per-widget boundaries, route-level boundaries, and Sentry
> are **deferred** — see [Roadmap](#roadmap).
>
> This is the long-form architecture record. The short version lives in
> [`CLAUDE.md`](../CLAUDE.md#architecture) (rationale) and [`README.md`](../README.md#tech-stack)
> (the one-line mention). Update those on changes; update this file when the error-handling
> architecture or roadmap changes.

---

## What's implemented today

A single top-level boundary wraps the app, and **every** error channel — including the ones a React
boundary structurally can't catch — funnels into one reporting function. Today that function just
logs; the value is that it's the single seam Sentry slots into later (see [Roadmap](#roadmap)).

| Error channel | Caught by | Routed to |
|---|---|---|
| Render error under the boundary | `RootErrorBoundary`'s `onError` (react-error-boundary) | `reportError(…, "react:boundary")` + the `RootErrorFallback` UI (Try again / Reload) |
| Uncaught render error (escaped the boundary) | React 19 `createRoot` `onUncaughtError` — **prod only** | `reportError(…, "react:uncaught")` |
| Auto-recovered React error (e.g. hydration) | `createRoot` `onRecoverableError` — **prod only** | `reportError(…, "react:recoverable")` |
| Unhandled promise rejection | `window` `unhandledrejection` listener | `reportError(…, "window:unhandledrejection")` |
| Uncaught runtime / resource error | `window` `error` listener | `reportError(…, "window:error")` |
| WebSocket transport error (socket `error` event, constructor throw, throwing subscriber) | the transport's own handlers ([`ws-transport-architecture.md`](ws-transport-architecture.md)) | `reportError(…, "ws:transport")` |
| Failed query (after the retry policy is exhausted; once per query, not per observer) | `QueryCache.onError`, set in `createQueryClient()` ([`tanstack-query-setup.md`](tanstack-query-setup.md)) | `reportError(…, "query:cache")` + the failing `queryKey` in `ReportContext` |
| Failed mutation | `MutationCache.onError` (same factory) | `reportError(…, "query:mutation")` |
| Order-book sync failure (malformed/schema-failing frame, snapshot fetch failure, continuity gap, buffer overflow, throwing store subscriber) | the sync engine's handlers ([`order-book-sync-architecture.md`](order-book-sync-architecture.md) — full failure-mode matrix) | `reportError(…, "order-book:sync")` |

The optional `queryKey` field (populated by the query channel) maps onto Sentry's `extra` when
the swap happens. Known double-report: a query opting into `throwOnError` reports from both the
cache seam and the boundary, with distinct `source` tags — informative, not a bug.

Source: `src/components/root-error-boundary.tsx` (boundary + fallback), `src/lib/report-error.ts`
(the seam), `src/main.tsx` (the `createRoot` hooks + `window` listeners),
`src/lib/connection/ws-transport.ts` (the transport channel), `src/lib/order-book/` (the sync
channel).

## Architecture decisions

| Decision | Choice | Why |
|---|---|---|
| Boundary implementation | **`react-error-boundary`**, not hand-rolled | Maintained de-facto standard; error boundaries are class-only and that won't change. Gives `resetKeys`, `resetErrorBoundary`, and `useErrorBoundary().showBoundary` for free. |
| One reporting path | A single **`reportError(error, context)`** seam | Every channel funnels through it, so adopting Sentry later is a one-line change in one file with **zero call-site edits**. |
| Root hooks are prod-only | `onUncaughtError`/`onRecoverableError` gated on `import.meta.env.PROD` | React 19's root hooks **replace** React's default console logging; React's docs say not to attach them in dev, or you lose the dev error overlay. |
| No `onCaughtError` | Deliberately unset | Caught render errors are already reported by the boundary's `onError`; setting both would double-report. |
| Global `window` handlers | `unhandledrejection` + `error`, always on | Boundaries can't catch errors from event handlers or async code — these are the logging net for those. |
| Recover vs. log | `showBoundary` for recovery, `reportError` for logging | Async errors that should surface a *widget* fallback go through `useErrorBoundary().showBoundary(err)`; logging-only errors go through `reportError`. The global handlers and root hooks only **observe** — they don't recover anything. |
| Dev/prod gate source | `import.meta.env.PROD`/`DEV` | These are Vite **build-mode** flags, not deployment-env config — distinct from the `/config.js` runtime-config rule, so they don't bake env values into the bundle. |
| Test type-checking | `vite/client` added to `tsconfig.test.json` `types` | The boundary test imports the component, which reads `import.meta.env.DEV`; the isolated test project needed the ambient Vite types to type-check it. |

## The async gap — why the boundary isn't enough

A React error boundary is the **last** line of defence, not the first. It only catches errors thrown
**during render**. It does **not** catch errors from event handlers, `setTimeout`/`Promise`
callbacks, or anything after the first `await` — which, for a real-time order book, is most of the
risk surface. A malformed WebSocket frame handled in `onmessage` never reaches a boundary.

So the real resilience work for the order book is **not** an error-boundary task — it lives in the
WebSocket / data layer: validate the frame, `try/catch` the parse/reducer, then make a decision —
drop the frame, resync, or reconnect. A boundary catching a render crash that resulted from bad state
reaching the store is cleanup *after* the loss. That layer now exists in full — the
reconnecting transport plus the part-2 sync engine's validate/drop/resync half (see
[WS-layer hardening](#ws-layer-hardening) below).

What's implemented today therefore hardens the **React tree**. The order-book data hardening is a
separate, larger piece (see [WS-layer hardening](#ws-layer-hardening) below). The seam between them is
`showBoundary`: async code that wants to surface a widget's fallback calls it; everything else logs
through `reportError`.

## Roadmap

Deferred work, roughly in the order it becomes relevant. Each item is scoped enough to pick up later.

### Per-widget error boundaries
Wrap each real-time widget (depth chart, trade tape, order-entry panel) in its own `ErrorBoundary`
so one bad payload kills **one widget** — with its own retry — instead of white-screening a live
trading view.
- Extract a reusable `WidgetErrorFallback` by generalizing `RootErrorFallback`.
- Reset via `resetKeys` (e.g. keyed on the active symbol / stream) so a fresh subscription clears a
  stuck widget automatically; keep the manual retry too.
- Pair with `useErrorBoundary().showBoundary(err)` from each widget's data hook to push **async**
  failures (the bad WS frame) into that widget's boundary.
- **Depends on:** widgets existing.

### Route-level boundaries
When a router is added, give each route its own boundary so a broken route keeps the shell/nav alive.
- TanStack Router: `errorComponent` / `defaultErrorComponent` / `CatchBoundary`. React Router:
  `errorElement`.
- **Not** `QueryErrorResetBoundary` — that's a TanStack **Query** primitive for resetting query
  error state, not a route boundary (it belongs to the suspense-posture roadmap in
  [`tanstack-query-setup.md`](tanstack-query-setup.md)).
- **Depends on:** a router being chosen.

### Sentry adoption
Ties to the production-readiness observability work (item #4). The seam was designed for exactly this.
- Swap `reportError`'s body for `Sentry.captureException(error, { extra: { source }, … })` — one file,
  no call-site changes.
- Wire `Sentry.reactErrorHandler` into the `createRoot` `onUncaughtError`/`onRecoverableError` hooks.
- `@sentry/react` for the client; `@sentry/cloudflare` for the Worker, so client and edge errors land
  in one place.
- Add Sentry's ingest origin to the **CSP** when security headers land, and flip
  `observability.enabled` in `wrangler.jsonc`.
- Show the Sentry event ID in `RootErrorFallback` so users can quote it when reporting.

### WS-layer hardening
The real order-book data resilience — separate from, and bigger than, the React-tree boundary.
- **Reconnect** with backoff — **delivered** by the transport layer (full-jitter backoff,
  connect timeout, opt-in staleness watchdog, errors via `reportError("ws:transport")`); see
  [`ws-transport-architecture.md`](ws-transport-architecture.md).
- Validate every frame + `try/catch` the parse — **delivered** by the part-2 sync engine
  (zod before anything touches the buffer or book, reporting via `"order-book:sync"`).
- Decide per failure: **drop** (self-healing via the continuity check) or **resync**
  (in place, over the live socket) — **delivered**; the full matrix is in
  [`order-book-sync-architecture.md`](order-book-sync-architecture.md).
- Surface fatal widget failures via `showBoundary`; log non-fatal ones via `reportError` —
  the remaining piece, owned by part 3 (there is no widget yet to surface into).

## References

- [React — `createRoot` error hooks](https://react.dev/reference/react-dom/client/createRoot)
- [`react-error-boundary`](https://github.com/bvaughn/react-error-boundary)
- [Sentry — React error boundary](https://docs.sentry.io/platforms/javascript/guides/react/features/error-boundary/)
