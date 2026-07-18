# TanStack Query setup — architecture & decisions

The REST/server-state layer of the app: **TanStack Query v5** (`@tanstack/react-query`),
configured once and consumed through house conventions. This chronicle records every decision
and its *why*, so a future project can copy the setup verbatim and defend each line.

**Platform-pure by design:** nothing in this document (or in `src/lib/query/` /
`src/features/health/`) depends on the hosting platform. The demo consumer is written against
an endpoint *contract* (see [The `/api/health` contract](#the-apihealth-contract)); how that
endpoint is served is the hosting layer's concern — in this repo, the Cloudflare Worker
(see [`cd-setup.md`](cd-setup.md)). A project on Vercel/AWS implements the same contract in
its own idiom and copies everything else unchanged.

**Scope boundary:** Query is for **request/response state, not streaming state**. Anything
that must be live (order-book depth, tickers) belongs to the WebSocket layer
([`ws-transport-architecture.md`](ws-transport-architecture.md)); anything cacheable and
fetch-shaped (exchange metadata, health, later account data) belongs here. The one REST call
that looks like an exception — the future Binance depth *snapshot* — is deliberately **not**
routed through Query: it's an imperatively-timed step inside the sync handshake that must
always be fresh, so caching semantics are actively harmful there. It will call the future
Binance REST client directly.

## What's implemented today

| Piece | File |
|---|---|
| `QueryClient` factory (defaults + reporting seam) | `src/lib/query/query-client.ts` |
| `HttpError`/`ParseError` + `fetchJson` transport primitive | `src/lib/query/fetch-json.ts` |
| Provider + devtools mount | `src/main.tsx` |
| Demo resource (`queryOptions` module) | `src/features/health/health-query.ts` |
| Demo consumer (house rendering posture) | `src/features/health/health-status.tsx` |
| Test client + provider-wrapped render | `src/test/query-client.ts`, `src/test/render-with-client.tsx` |

## The mental model

Query is a **cache**, not a fetching library. It never touches the network — it runs the
async `queryFn` you give it and watches the promise: resolve → cache the value; reject →
failure machinery (retry, error state, reporting). Every cached entry has a lifecycle:

- **fresh** (age < `staleTime`): served from cache with **no** network activity at all.
- **stale** (age ≥ `staleTime`): still served instantly from cache, but a background refetch
  fires on the next trigger (component mount, window focus, network reconnect) and re-renders
  when the update lands.
- **inactive** (no component observing): the entry idles for `gcTime`, then is
  garbage-collected. Return within the window → instant render from cache.

Because `fetch` only rejects on *network* failure (an HTTP 500 "succeeds" with `ok: false`),
the failure machinery only works if the queryFn throws on HTTP errors — that translation is
`fetchJson`'s whole job.

## Architecture decisions

### 1. A factory, not a singleton

`createQueryClient()` (`src/lib/query/query-client.ts`) is called once at module scope in
`main.tsx` — one client per tab. Tests call the *same factory* per-test for isolated caches
with identical defaults (zero drift between app and test behaviour). There is deliberately no
exported client instance: React code reaches it via `useQueryClient()`, which keeps components
testable. Cache-level `onError` callbacks can only be set at construction, so the factory is
the single home of the whole configuration.

**If you ever SSR:** module scope on a server is shared across *all users' requests* — switch
to the `useState(() => createQueryClient())` shape so the client's lifetime follows the
component tree. Irrelevant for a browser-only SPA.

### 2. Defaults (every changed default has a reason; every kept one is visible)

| Option | Value | Why |
|---|---|---|
| `staleTime` | `30_000` | The library default (`0`) refetches on every mount/focus — the #1 "why is my API spammed" surprise. 30s is the sane app-wide floor; per-resource overrides live in each `queryOptions` module. |
| `gcTime` | `5 * 60_000` | Library default, written out — load-bearing numbers stay visible. Never set below `staleTime` (evicting "fresh" data is incoherent). |
| `retry` | predicate | **Never retry 4xx** — a client error is a fact retrying can't fix, and retrying 429s digs the hole deeper — **and never retry `ParseError`** (a malformed body is deterministic; refetching a permanently-broken endpoint can't help). Network errors / 5xx retry twice (3 attempts, ~3s worst case). Requires typed errors to inspect → `HttpError`/`ParseError`. |
| `refetchOnWindowFocus` / `refetchOnReconnect` | `true` | With a non-zero `staleTime` these refetch only genuinely stale data — exactly right for a market-data app (tab return → numbers quietly catch up). Don't reflexively disable; the annoyance people remember comes from `staleTime: 0`. |
| `throwOnError` | `false` | Failures stay in the hook's `error` field; each widget renders its own degraded state — one dead panel never nukes the page. Load-bearing queries opt into `true` per-query when the per-widget error-boundary work lands ([`error-handling-architecture.md`](error-handling-architecture.md)). |

No `mutations` defaults block: there are no mutations yet, and speculative tuning is template
rot. (The mutation *reporting* seam does exist — see §4 — because a missing safety net fails
silently, whereas missing tuning fails loudly.)

Not configured (defaults kept, known about): `networkMode: 'online'` pauses queries while the
browser is offline (`fetchStatus: 'paused'`, not an error) and resumes on reconnect;
`retryDelay` keeps its exponential backoff (1s → 2s → …, capped 30s).

### 3. `HttpError`/`ParseError` + `fetchJson` — the HTTP error model

`src/lib/query/fetch-json.ts`, three exports:

- **`HttpError extends Error`** with a readonly `status`. A *class* because the retry
  predicate narrows with `instanceof`; message carries status + URL but **never the response
  body** (unbounded; may embed arbitrary server output into logs). Richer clients (the future
  Binance REST handler, which needs the error-code JSON bodies) should **subclass `HttpError`**
  so `status < 500` keeps working on their errors.
- **`ParseError extends Error`** — the *other* typed failure mode: HTTP succeeded but the body
  isn't JSON (a misrouted path serving HTML, a `204`, a truncated body). Deterministic, so the
  retry predicate never retries it. The original `SyntaxError` rides along as `cause` (kept out
  of the message — same no-response-body rule as `HttpError`).
- **`fetchJson<T>(url, init?)`** — throws `HttpError` on `!res.ok`, `ParseError` on an
  unparseable 2xx body, else returns the parsed JSON. Error messages carry `res.url`, falling
  back to the requested `url` (synthetic test `Response`s have an empty `res.url`). Takes a
  standard `RequestInit` so callers forward the `AbortSignal` Query hands every queryFn
  (aborted when the query becomes out-of-date or inactive — unmount, or key change mid-flight).
  Deliberately absent: base URL, timeout, response-type branching, schema validation. It's a
  transport primitive; features own their protocols (the same layering as the ws-transport).

**Why no zod (yet):** `fetchJson<T>`'s cast is a compile-time label checked against nothing —
an honest lie. Runtime validation is worth its cost exactly when the data source can drift
independently of this repo. Our only consumer is our own same-repo endpoint (client and server
change in one PR), so schema ceremony buys nothing. **House rule: same-origin/own-backend
responses may trust the cast; any third-party response must be schema-parsed in its
`queryOptions` module** (`const parsed = Schema.parse(await fetchJson<unknown>(…))` — the
parse failure then flows through the normal error machinery, and the TS type comes from the
schema for free). zod enters the repo with the Binance layer, where it has a real job.

### 4. Error reporting: cache-level `onError` → `reportError()`

Set in the factory: `QueryCache.onError` reports with `source: "query:cache"` plus the
failing `queryKey` (the primary triage fact); `MutationCache.onError` with
`"query:mutation"`. Why cache-level is the only right layer (v5 *removed* per-hook
`onError`): it fires **once per query failure** regardless of observer count (the per-hook
version fired once per component — duplicate reports/toasts), and it fires **after the retry
policy is exhausted** — you hear about outcomes, not blips. Known behaviour: a permanently
broken endpoint re-reports on each refetch cycle (fine — console now; Sentry dedupes later).

Report-everything, no filtering: policy about "expected" failures (404-as-absence) belongs to
real endpoints, none of which exist. The escape hatch, when one appears, is the query's `meta`
field (`meta: { suppressReport: true }`, checked in `onError`) — documented, not built.

Interplay to leave alone: a query that opts into `throwOnError` reports twice (once from the
cache seam, once from `RootErrorBoundary`'s own `onError`) with two distinct `source` tags.
That's informative, not a bug — don't "fix" it into a gap.

### 5. House posture: `useQuery`, states as values

Components call `useQuery` and branch on `isPending`/`error` — every widget owns its
loading/error UI, degraded states stay local (pairs with `throwOnError: false`).
**Last-known-good wins:** v5 keeps cached `data` when a *background* refetch fails, so check
`data` before `error` — a widget should only degrade when it has nothing to show, never flip a
healthy display on a transient blip (`health-status.tsx` is the living example: `isPending` →
`!data` → render `data`).
`useSuspenseQuery` (non-nullable `data`, loading/errors as control flow) is the deliberate
upgrade for route-level data where the whole view is meaningless without it — it *requires* a
`<Suspense>` ancestor plus an error boundary with `QueryErrorResetBoundary` retry wiring, i.e.
the per-widget-boundary roadmap. Two traps recorded for that day: two `useSuspenseQuery` calls
in one component run **sequentially** (first suspends before the second executes — use
`useSuspenseQueries` for parallel), and suspense can't express background-refresh flags.

### 6. Resource definitions: `queryOptions()` modules

The query key is a cache entry's **identity by value** — dedup, staleness, and invalidation
all key off it, and a typo silently creates a second entry rather than erroring. So: **no
inline `queryKey`/`queryFn` in components, ever.** Each resource gets one module in its
feature directory (`src/features/<feature>/<resource>-query.ts`) exporting a
`<resource>QueryOptions()` function — key, queryFn (with `signal` forwarding), and
per-resource tuning in one typed unit. `queryOptions()` (the v5 identity helper) links the
key to the data type, so `useQuery(fooQueryOptions())`, `prefetchQuery`, and
`getQueryData(fooQueryOptions().queryKey)` are all fully typed from one definition.

Always a *function*, even with zero params — parameterised resources
(`tickerQueryOptions(symbol)`) force the shape; one uniform shape for all. Key *factories*
(hierarchical `fooKeys.all`/`detail(id)` objects) are ceremony until a feature has a family of
related keys to invalidate together — the known growth step, not built.

### 7. Devtools

`@tanstack/react-query-devtools` (devDependency), `<ReactQueryDevtools initialIsOpen={false}>`
plain-imported inside the provider in `main.tsx`. The package self-excludes from production:
its export is the real panel only when `process.env.NODE_ENV === 'development'` (statically
replaced by Vite, dead branch tree-shaken) — no lazy-load ritual needed in v5. **Trust but
grep** after any major devtools bump: `grep -ri "react-query-devtools" dist/` → empty.
The panel injects runtime `<style>` elements — covered by this repo's `style-src
'unsafe-inline'`, moot in prod.

## The `/api/health` contract

The demo consumer proving the wiring end to end. Platform-neutral interface:

```
GET /api/health            (same-origin — no CSP/connect-src changes)
→ 200, application/json, cache-control: no-store, x-content-type-options: nosniff
{ "status": "ok", "env": "<dev|uat|prod|local>", "now": "<server ISO-8601>" }
```

`env` proves the *right* environment's backend answered; `now` is server-generated so a
response can't be mistaken for something cached/static. Two contract edges that bit us before
they were pinned:

- **Unmatched API paths must 404** (JSON, from the API layer itself) — an SPA fallback that
  serves `index.html` at 200 for `/api/typo` masks broken routes and feeds HTML to `fetchJson`
  (→ `ParseError`). In this repo the Worker owns the whole `/api/*` namespace and 404s the rest.
- **The local servers must serve twins of every backend route, dev AND preview builds, with
  the same matching semantics** — in this repo one exact-matching middleware in
  `vite.config.ts`'s `runtimeConfig` plugin, registered in both `configureServer` and
  `configurePreviewServer` (Connect's route-mounted `use(path, fn)` prefix-matches, which would
  quietly diverge from the deployed router).

Hosting implementation + deploy-gate assertions: [`cd-setup.md`](cd-setup.md).

Consumer chain, each file the living example of its house rule:
`health-query.ts` (options module, trusted cast) → `health-status.tsx` (useQuery posture,
last-known-good display, degraded line only with no data) → mounted in `App.tsx`.

## Testing recipe

- **`createTestQueryClient()`** (`src/test/query-client.ts`): the real factory + two
  overrides. `retry: false` — error tests otherwise wait through real backoff (~3s/query).
  `gcTime: Infinity` — finite gc schedules eviction timers that fire after teardown
  (act-warnings, hung-worker noise); Infinity schedules nothing and the client dies with the
  test.
- **`renderWithClient(ui, client?)`** (`src/test/render-with-client.tsx`): RTL render inside a
  fresh provider; returns the client for cache seeding/assertions. Pass your own client to
  seed **before** mount (`setQueryData` → data is fresh within `staleTime` → no fetch fired,
  fully deterministic — how `App.test.tsx` avoids network entirely).
- **Layered mocking:** component tests seed the cache or mock at the queryFn level (no network
  concepts); the transport seam (`fetch-json.test.ts`) and one end-to-end case per feature
  mock `globalThis.fetch` itself. **MSW deferred** until real third-party endpoints exist
  (Binance) — it also fakes fetch, one layer lower, so adopting it invalidates nothing.
- **Error-state tests hit the reporting seam** — `vi.spyOn(console, "error")` silences the
  noise *and* asserts reporting fired (test the seam, don't suppress it).
- **No fake timers around queries** — retries/gc/interval internals interact badly with
  `vi.useFakeTimers`; use real timers + `findBy*`/`waitFor` (fast, thanks to `retry: false`).
- The retry predicate is tested through a real client with per-query `retryDelay: 0`
  (`query-client.test.ts`) — behaviour, not implementation.

## What you lose without ESLint (and why it's covered)

`@tanstack/eslint-plugin-query` (exhaustive key deps, unstable option references) is
ESLint-only; Biome can't run it and has no equivalent. The mitigation is structural: keys and
queryFns are only ever written together inside `queryOptions` modules (a reviewer sees both
lines at once — key/fn drift can't hide), and the no-inline-queries rule removes the sprawl
where those bugs breed. Do **not** add ESLint just for the plugin.

## Versioning policy

Both packages ride caret (`^5.x`) like other runtime deps — exact-pinning is for tools whose
output bytes/verdicts must be reproducible (Biome, Vitest). **Lockstep rule:** the devtools
panel reads the client's internals; keep both packages on the same minor (Dependabot's grouped
PRs do; a human bumping one by hand bumps both).

## Deliberately deferred (trigger → do it then)

| Deferred | Trigger |
|---|---|
| zod validation | first third-party API (Binance layer) — parse in the resource's `queryOptions` module |
| MSW | real endpoints worth intercepting (Binance layer) |
| Key factories | first feature with a *family* of keys invalidated together |
| `useSuspenseQuery` | per-widget error-boundary work (route-level data) |
| `mutations` defaults | first real mutation |
| 429/`Retry-After`/418 handling | the Binance REST client — exchange-grade rate-limit logic does not belong in generic defaults |
| Sentry | swap `reportError`'s body; `queryKey` maps onto `extra` |

## Reuse recipe (for the next project)

1. `pnpm add @tanstack/react-query` + `pnpm add -D @tanstack/react-query-devtools` (same minor).
2. Copy `src/lib/query/` verbatim; wire `ReportContext`'s `"query:cache"`/`"query:mutation"`
   sources + `queryKey` field into your error-reporting seam (or inline `console.error` until
   one exists).
3. In your entry file: create the client once at module scope, wrap the app in
   `QueryClientProvider`, add `<ReactQueryDevtools initialIsOpen={false} />` inside it.
4. Copy `src/test/query-client.ts` + `src/test/render-with-client.tsx`; any component test
   touching `useQuery` renders via `renderWithClient`.
5. Implement the `/api/health` contract in your hosting idiom + local twins (dev **and**
   preview, exact-matched, with a JSON 404 for unmatched API paths); copy
   `src/features/health/` as the first consumer and the pattern template.
6. Adopt the house rules: no inline queries; `signal` always forwarded; `useQuery` posture;
   third-party responses schema-parsed; same-minor devtools.

## References

- TanStack Query v5 docs — <https://tanstack.com/query/v5/docs/framework/react/overview>
  (verified against v5.101.2, 2026-07: `QueryCache.onError(error, query)` signature; per-query
  `retryDelay`; queryFn `AbortSignal`; devtools NODE_ENV exclusion)
- Related chronicles: [`error-handling-architecture.md`](error-handling-architecture.md)
  (reportError seam), [`ws-transport-architecture.md`](ws-transport-architecture.md)
  (streaming counterpart + the layering this setup mirrors), [`cd-setup.md`](cd-setup.md)
  (hosting side of `/api/health`), [`vitest-setup.md`](vitest-setup.md) (harness the test
  helpers plug into)
