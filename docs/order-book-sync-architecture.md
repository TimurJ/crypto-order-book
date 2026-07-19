# Order-book sync layer — architecture & decisions

The Binance-specific data layer (**part 2 of the connection stack**): `src/lib/order-book/`
maintains a provably-correct local order book from Binance's diff-depth stream + REST
snapshot, exposed as a `subscribe`/`getState` store ready for `useSyncExternalStore`
(part 3). This chronicle records the verified spec facts, every design decision (each one
explicitly reviewed and approved — this layer is the **reference pattern** for how exchange
connections get built in future projects), the failure-mode matrix, and the reuse recipe.

> Part 1 (the app-generic transport) is chronicled in
> [`ws-transport-architecture.md`](ws-transport-architecture.md); part 3 (the rendered
> ladder, `src/features/order-book/`) is chronicled in
> [`order-book-ui-architecture.md`](order-book-ui-architecture.md) and consumes this store.

## The problem this layer solves

Binance's `@depth` stream does not send the order book — it sends *changes* to a book you
are expected to already have. The bootstrap is a documented dance, and getting it wrong
produces a **silently wrong** book (crossed spreads, phantom levels) with no error anywhere:

1. Open the WebSocket first and **buffer** events. Each frame says "this covers updates
   `U` through `u`".
2. Fetch the REST snapshot (`/api/v3/depth`), stamped `lastUpdateId` ("reflects everything
   through update N").
3. Stitch: discard buffered events with `u` ≤ `lastUpdateId` (already inside the snapshot);
   if the snapshot lags the first buffered event by more than the overlap boundary
   (`lastUpdateId < first U - 1` — the exact-one-behind case still stitches), the REST replica
   lags the stream — refetch. Apply the survivors in order.
4. From then on **verify continuity on every event**: normally `U == previous u + 1`.
   `u < bookId` → stale, ignore. `U > bookId + 1` → updates were missed, the book is
   provably wrong — **gap**, resync.

The gap check is the single safety net, and it makes one recovery path serve every failure:
drop a malformed frame → if it mattered, the next frame trips the gap check; the 24h forced
disconnect → transport reconnects → reopen triggers the same resync; watchdog kills a silent
socket → same. **One dance, re-run on every discontinuity.**

## Verified spec facts (sources + live probes, 2026-07-18)

From the **raw** GitHub markdown of `binance-spot-api-docs` (`web-socket-streams.md`,
`rest-api.md`, `faqs/market_data_only.md`) — not rendered doc pages, which dropped whole
sections when fetched:

- Stream `wss://<base>/ws/<symbol_lc>@depth@100ms`; payload
  `{e:"depthUpdate", E, s, U, u, b, a}`; `b`/`a` are `[price, qty]` **string** tuples.
- Quantities are **absolute** (not deltas); qty `0` ⇒ remove the level; removing an absent
  level ⇒ ignore.
- Snapshot `GET /api/v3/depth?symbol=<S>&limit=5000` → `{lastUpdateId, bids, asks}`;
  weight 250 at limit 5000 (IP budget 6000/min); 429 = rate-limited, 418 = auto-ban for
  ignoring 429s.
- Server pings every 20s; the **browser auto-pongs** (ping/pong frames are invisible to
  page JS), so the transport's staleness watchdog — not pong handling — is the liveness
  guard. A connection is force-closed at the **24h** mark.
- We send **zero** messages (raw `/ws/` URL, no SUBSCRIBE frames), so the 5-inbound-msgs/s
  limit is irrelevant.
- Market-data-only hosts `https://data-api.binance.vision` / `wss://data-stream.binance.vision`
  are officially documented: same streams/endpoints, **no auth possible**.

Live probes run before implementation:

- CORS: `access-control-allow-origin: *` on the depth endpoint of **both** `api.binance.com`
  and `data-api.binance.vision` — the browser snapshot fetch works.
- Stream: a Node WebSocket on `data-stream.binance.vision/ws/btcusdt@depth@100ms` delivered
  spec-exact frames (keys `e,E,s,U,u,b,a`, string tuples, a real qty-`0` removal), with
  **`U == prev u + 1` holding on 19/19 consecutive pairs**.
- Update IDs observed ≈ 9.7 × 10¹⁰ — five orders of magnitude inside
  `Number.MAX_SAFE_INTEGER`, so `z.number().int()` is sound for the foreseeable future.

## Decision log

Every decision below was presented with alternatives and **explicitly approved** before
implementation. The rationale is the reusable part — future projects should re-check the
premises, not cargo-cult the conclusions.

### 1. Gap recovery: in-place resync over the live socket
The spec's "restart the process" read literally means reconnect — but a gap means *our
book* broke, not the socket (which is provably healthy and delivering contiguous frames).
Correctness comes from the update-ID math, not from a fresh connection, so the engine
re-runs only the buffer+snapshot dance over the open socket (~1–2s) instead of paying
backoff + handshake + redance. Socket-level pathologies stay the transport's job; the
`destroy()`+recreate option from part 1's contract stays in reserve, unused.

### 2. Failure policy: retry forever; `degraded` is advisory
Snapshot failures retry with full-jitter backoff **forever** (the transport's philosophy).
After 3 failures since the last successful sync the store's status becomes `"degraded"` — purely
advisory (part 3 shows a banner), retries continue; the first success flips straight to `"live"`.
A terminal give-up state would need a manual-restart affordance that doesn't exist until
part 3, and would strand the user on a transient outage. `"degraded"` persists across retry
cycles **and transport reconnects** (no `syncing`/`connecting` flicker) until a sync completes.
Two counters keep this honest: the **backoff** counter resets on every fresh dance (a reconnect
must not inherit a prior dance's inflated delay), while the **degraded** counter tracks failures
since the last *successful* sync — so a connection that flaps faster than three failures accumulate
still latches `"degraded"` instead of resetting to zero on every reopen.

### 3. Book storage: `Map<priceString, qty>` per side, sort-on-read
Writes dominate (10 frames/s × dozens of levels; Map upsert/delete is O(1)); reads are
once per commit (~10/s, the part-3 view-model). `selectTopLevels` (`book-levels.ts`) sorts when a
reader asks, using `Number(price)` for **comparison only** — the exact string prices remain
the identity (floats as keys would corrupt it: Binance prices are exact decimals). If
part-3 profiling ever shows read-sorting matters, a sorted index can be added behind the
same store shape.

### 4. Endpoints: the market-data-only `.vision` hosts, via runtime config
`data-api.binance.vision` + `data-stream.binance.vision` over `api.binance.com` /
`stream.binance.com`: no credentials can ever be sent to them, they're isolated from
trading infrastructure, and they serve identical market data (both CORS-verified live).
Wired through `/config.js` per the house runtime-config rule — `WS_URL` +
`BINANCE_REST_URL` in `wrangler.jsonc` `vars`, `AppConfig.wsUrl`/`.binanceRestUrl`,
`devConfig` in `vite.config.ts` — never `VITE_*`.

### 5. Validation: full zod per frame, tolerant of unknown keys
Every frame is `safeParse`d **before** it touches the buffer or the book (one validation
point covers both phases); the snapshot is parsed inside the REST client. Not `.strict()`:
Binance *adding* a field must be a non-event — strictness rejects only what breaks us.
Cost is real but irrelevant: tens of µs at 10 frames/s (~0.1% of the frame budget); the
one-per-resync 5000-level snapshot parse likewise. A hand-rolled structural check would
save nothing measurable while forfeiting inferred types and precise error payloads.
Level tuples are validated as **canonical decimal strings** (a fixed-decimal regex, not a
permissive `Number()` check) so the exact string that keys the book's Map can't diverge from a
normalized form — a bad tuple is dropped and the continuity check heals if it mattered.

### 6. Store shape: shared Maps, new snapshot identity per commit
The snapshot object (`{status, symbol, bids, asks, lastUpdateId, resyncCount,
droppedFrames}`) is rebuilt on every commit, but `bids`/`asks` are the engine's own Maps
typed `ReadonlyMap` — zero copying at 10Hz. **The invariant that makes this safe:** every
mutation is followed synchronously, in the same task, by rebuild + notify, so the snapshot
identity always changes when contents do — exactly what `useSyncExternalStore` needs (a
torn concurrent read is discarded because `getSnapshot` identity changed). Copying
2×5000 entries 10×/s would be pure defensive GC churn under part 3's render loop. No
derived data (spread / top-N) in the store — reads are far colder than writes.

### 7. Ownership: the engine creates and destroys its own transport
`createOrderBookSync()` builds the transport in `start()` (stream URL from its options,
watchdog armed) and destroys it in `destroy()` — one lifecycle, one single-use contract
(mirroring the transport's), impossible to wire wrong (URL/symbol mismatch, forgotten
watchdog). Rejected: injected transport — it splits destroy-ownership and mocks out the
very integration this layer exists to get right. Tests drive everything through the
**real** transport via the global `FakeWebSocket` stub.

### 8. Hardening parameters (all overridable engine options)
| Parameter | Default | Why |
|---|---|---|
| `depthLimit` | 5000 (max) | full-book correctness; weight 250 of 6000/min is nothing at one fetch per resync |
| `staleThresholdMs` | 10 000 | stream is ~10 frames/s → 100× margin; armed by the engine per part 1's contract. Assumes an *active* symbol — a quiet part-3 symbol (sparse updates) may idle past 10s and needs a higher/per-symbol threshold (see Roadmap) |
| snapshot retry | full-jitter, base 500ms, cap 10s | the spec's bare "go back to step 3" would hot-loop a weight-250 call against a lagging replica; same `fullJitterDelay` helper as the transport (`src/lib/connection/backoff.ts`) |
| `rateLimitFloorMs` | 30 000 after 429/418 | respects Binance's escalating-ban policy — never retry a rate-limit "soon". Held as a `performance.now()` deadline, not just the retry timer, so a transport reconnect inside the window can't bypass it |
| `bufferLimit` | 1000 events (~100s of stream) | dropping *oldest* is unsound (pre-snapshot you can't know what's covered), so overflow aborts the attempt; the frame in hand seeds the next buffer, so continuity survives |
| `degradedAfterAttempts` | 3 | early enough to matter as a signal, late enough to skip blips |
| stream | `@depth@100ms`, symbol BTCUSDT | the real-time variant the part-3 ladder renders |

### 9. Ships to deployed envs now (demo + CSP + config vars)
A console demo (`order-book-demo.ts`) ran in dev/uat until part 3 replaced it with the
rendered ladder (demo retired in the same change). It was gated out of prod because real
users shouldn't see dev console logging — the same hygiene as shipping no prod source
maps; the Binance connection itself was never the concern (the part-3 UI connects in prod
by design). The gate was in-app, so the CSP and `vars` stayed env-identical: `connect-src`
gained both `.vision` origins in
`public/_headers` and the `vars` were filled in the same change. This
deliberately proved deployed CSP + Binance connectivity end-to-end **before** UI work
depended on them — a CSP mistake surfaces as a refused connection in the DEV console, not
mid-part-3. The origins are env-identical (public market data has no per-env tier),
which is exactly what lets the CSP stay in the static `_headers`
([`security-headers-setup.md`](security-headers-setup.md)). The invariant is
test-enforced, not prose-only: `binance-hosts.test.ts` reads `wrangler.jsonc`, the vite
`devConfig`, and `_headers` and fails if the hosts diverge or the CSP stops admitting them
(the smoke script checks `/config.js` contents, not CSP admittance).

### 10. MSW: deferred again, deliberately, at its own trigger
The docs had "MSW enters with the Binance layer". Re-decided at the trigger: the engine's
tests need exact control over *when* the snapshot resolves relative to buffered frames —
deferred-promise fetch doubles give that directly; an always-async network interceptor
obscures it (the same reasoning that kept MSW out of the ws-transport suite). Recorded in
[`tanstack-query-setup.md`](tanstack-query-setup.md).

## What each file owns

```
src/lib/order-book/
  binance-schemas.ts     zod schemas + inferred types (DepthUpdate, DepthSnapshot)
  binance-rest.ts        BinanceHttpError (extends HttpError, + code/binanceMsg),
                         BinanceSchemaError, fetchDepthSnapshot (zod-parsed, abortable)
  order-book-sync.ts     createOrderBookSync — the engine + store
  book-levels.ts         selectTopLevels — pure sort-on-read
```

(The former `order-book-demo.ts` — the pre-UI console proof — was retired when part 3
landed; the rendering consumer lives in `src/features/order-book/`.)

Engine internals worth knowing before touching:

- **One resync path** (`beginResync(seed = [])`): new generation → abort any in-flight
  fetch → buffer := seed → `"syncing"` → snapshot attempt. Called by `onOpen` (every
  (re)open, empty seed) and gap detection (which seeds the still-contiguous frames), and
  nothing else.
- **Generation guard**: `runSnapshotAttempt` captures `generation` at start; any supersede
  (resync, overflow, transport drop, destroy) bumps it, so a late-resolving snapshot —
  even from a fetch that ignores its `AbortSignal` — is discarded, never installed. This
  is belt-and-braces with the `AbortController`, and unit-tested with an abort-ignoring
  fetch double.
- **Drain == live apply**: the same `applyEvent` (spec rule: `u < bookId` ignore;
  `U > bookId + 1` gap; else apply absolutely, `bookId = u`) runs for buffered and live
  events. The spec's separate "first event must satisfy `U ≤ lastUpdateId+1 ≤ u`" rule is
  subsumed by it — no special case.
- **Gap events seed the next buffer** (live gap and mid-drain gap alike): the gap frame and
  everything after it are still contiguous with the stream, so they carry over — passed as
  `beginResync`'s seed — instead of being re-awaited. A *mid-drain* gap has already mutated the
  shared Maps (snapshot + pre-gap events), so the engine commits that consistent partial book
  before the re-dance — the store contract's "every mutation is followed by rebuild + notify"
  holds even on this path (a live gap hasn't mutated, since `applyEvent` returns `"gap"` first).
- **Transport drop mid-sync** (subscriber sees not-`open`): the attempt is superseded and
  buffering stops — frames can't arrive, so a resolving snapshot could never be stitched;
  status falls back to `"connecting"`. The reopen starts a fresh dance. This also prevents
  ever showing `"live"` over a dead socket with a frozen book.

## Failure-mode matrix

| Failure | Detected at | Response | reported? |
|---|---|---|---|
| Malformed / schema-failing frame | `onMessage` (JSON.parse / zod, before buffer or book) | drop, `droppedFrames++`, commit | yes |
| Snapshot HTTP 4xx/5xx | `BinanceHttpError` from the REST client | failed attempt → jittered retry; ≥3 → `"degraded"` (still retrying) | yes, per attempt |
| Snapshot 429 / 418 | same, `status` narrowed | retry no sooner than the 30s floor (a deadline that survives a transport reconnect) | yes |
| Snapshot not JSON / wrong shape | `ParseError` / `BinanceSchemaError` | same failed-attempt path (replica may heal) | yes |
| Snapshot older than first buffered event (by >1) | spec step-4 check in the attempt | failed attempt → backoff refetch (buffer keeps growing) | yes |
| Continuity gap (`U > bookId+1`), live or drain | `applyEvent` | in-place resync; gap frame seeds the buffer; `resyncCount++` on completion | yes, with IDs |
| Stale event (`u < bookId`) | `applyEvent` | ignore silently — normal right after a snapshot | no |
| Buffer overflow while snapshot pending | buffer push | supersede attempt; overflowing frame seeds fresh buffer; failed-attempt backoff | yes |
| Transport reconnect (incl. the 24h close) | engine's transport subscriber / `onOpen` | supersede + `"connecting"` (holds `"degraded"` if still unhealthy) → reopen re-dances | no (transport's layer) |
| Silent connection (≥10s no frames) | transport watchdog (engine arms it) | force-reconnect → reopen re-dances | no (transport's layer) |
| `destroy()` with fetch in flight | engine | abort; the rejection is recognized (generation/destroyed) and swallowed | no — intentional |
| Throwing store subscriber | `commit` | isolated per listener, others still notified | yes |

**The self-heal property, proven in tests:** a dropped frame that mattered makes the *next*
frame trip the gap check (live) or the drain trip it (buffered) → resync. A dropped frame
that didn't matter (it would have been discarded anyway) causes nothing. Drop is therefore
always a safe local response to garbage.

## Consumer contract (part 3, read this)

- `createOrderBookSync(opts)` → `start()` once; `destroy()` is **terminal** — same
  create-inside-`useEffect` pattern as the transport
  ([`ws-transport-architecture.md` §consumer contract](ws-transport-architecture.md)):
  never create it in `useMemo`/`useState`/module scope inside React.
- `subscribe`/`getState` plug into `useSyncExternalStore` directly. Snapshot identity
  changes on every commit (~10/s while live); the data layer will not slow down for you.
  Part 3 measured that rate and renders per commit unthrottled (decision 3 in
  [`order-book-ui-architecture.md`](order-book-ui-architecture.md)); a consumer that does
  need pacing throttles at the render layer (a wrapper store, `useDeferredValue`).
- The Maps in the snapshot are live references — **read, never mutate**; take
  `selectTopLevels` for ordered slices.
- `status` drives UX: `connecting` (no socket), `syncing` (dance in flight — book may hold
  the previous data), `live`, `degraded` (failing to sync, still trying — banner),
  `destroyed`.
- Endpoints come from `getConfig()` (`wsUrl`, `binanceRestUrl`) — never hardcode, never
  `VITE_*`.

## Testing notes (`order-book-sync.test.ts`, 23 cases)

Reuses part 1's entire harness discipline: `FakeWebSocket` (now shared from
`src/test/fake-web-socket.ts`), fake timers (incl. faked `performance.now()` for the
watchdog), `Math.random → 0.5` for exact jitter delays, bounded `advanceTimersByTime` only,
every engine destroyed in `afterEach`. Engine tests run through the **real transport** —
integration is the point. New tricks this suite adds:

- **Deferred fetch double**: each `fetch` call parks in `pendingFetches[]` until the test
  resolves it — that's how "frames arrive while the snapshot is pending" is driven
  deterministically. Plain response-shaped objects, not `Response`, to minimize microtask
  hops. `{ honorAbort: false }` variant models a signal-ignoring fetch to isolate the
  generation guard.
- **Fake timers don't flush microtasks**: after resolving a deferred, always
  `await vi.advanceTimersByTimeAsync(…)` (or `(0)` as a flush) — never assert synchronously
  after `deferred.resolve()`.
- **The watchdog is always armed** (10s default): any test that advances >10s without
  stream traffic will (correctly) get its socket killed — the 429-floor test widens
  `staleThresholdMs` to isolate the backoff behaviour. This bit us in development; it is
  the engine working as designed.

## Config & CSP wiring (what a new exchange/env would touch)

`AppConfig` (`src/lib/app-config.ts`) + `RuntimeConfigEnv`/`configResponse`
(`worker/config-response.ts`) + per-env `vars` (`wrangler.jsonc`) + `devConfig`
(`vite.config.ts`) + the exact-shape asserts in `app-config.test.ts` /
`config-response.test.ts` — one field rides all six surfaces. CSP: `connect-src` in
`public/_headers` lists both origins statically; if origins ever differ per env, the CSP
moves into the Worker ([`security-headers-setup.md`](security-headers-setup.md)).

## Reuse recipe (next project / next exchange)

1. Bring part 1 (`ws-transport`) unchanged, plus `report-error.ts` with a reserved source.
2. Port `binance-schemas.ts` to the target exchange's payloads (zod, tolerant objects,
   string tuples) and `binance-rest.ts` to its snapshot endpoint + error-body shape
   (subclass the repo's `HttpError` equivalent).
3. The engine's skeleton transfers wholesale **if** the exchange uses the same
   sequence-numbered diff + snapshot model (most do). Re-verify against *their* spec:
   the ID fields, the first-event/continuity rules, rate-limit semantics, ping policy —
   from primary sources, with a live probe, before writing code (this file's "verified
   facts" section is the template).
4. Re-derive the tunables: snapshot weight/budget, stream cadence (→ watchdog threshold,
   buffer cap), rate-limit floor from their ban policy.
5. Wire endpoints through runtime config; extend `connect-src`; decide env-identical vs
   per-env origins (that decision places the CSP).

## Roadmap

- **Part 3 — rendering**: ✅ landed (`src/features/order-book/` — the slot-keyed ladder,
  `degraded`/`connecting` UX, demo removed); chronicled in
  [`order-book-ui-architecture.md`](order-book-ui-architecture.md).
- **Multi-symbol**: one engine per symbol is the intended model (engines are cheap; the
  transport supports 1024 streams/connection if a combined-stream multiplexer ever becomes
  worth it — that would be a new decision, not a tweak).
- **Per-symbol staleness threshold**: the 10s watchdog assumes an active symbol (BTCUSDT). A thin
  symbol whose book changes less than once per 10s would trip the watchdog and churn
  reconnect→resync (re-fetching a weight-250 snapshot each cycle); part-3 multi-symbol needs a
  higher or per-symbol `staleThresholdMs`, or a liveness signal that tells "quiet" from "dead".
- **Sentry**: already funnelled — every failure path exits through
  `reportError(…, { source: "order-book:sync" })`.
