# WebSocket transport — architecture & decisions

The app-generic reconnecting WebSocket transport (`src/lib/connection/ws-transport.ts`) — the
decisions behind it, the consumer contract, the spec-level nuances it was audited against, the
testing harness, and the roadmap for the layers that build on it (order-book sync, rendering).

> **Status:** implemented **2026-07-11** (PR #34), reviewed in depth **2026-07-18**.
> This is **part 1 of the connection stack** — part 2 (the Binance order-book *sync* layer) and
> part 3 (rendering) are pending; the module is a standalone, fully tested primitive with no
> consumer yet.
>
> This is the long-form architecture record. The short version lives in
> [`CLAUDE.md`](../CLAUDE.md#architecture) (rationale) and [`README.md`](../README.md#tech-stack)
> (the one-line mention). Update those on changes; update this file when the transport or its
> contract changes.

---

## What's implemented today

`createWsTransport(options)` returns a small four-method transport:

| Method | Contract |
|---|---|
| `connect()` | Opens the socket. Only acts from `"idle"` — a no-op from every other state (including `"closed"`; see [Consumer contract](#consumer-contract)). |
| `destroy()` | **Terminal.** Clears every timer, detaches + closes the socket, notifies `"closed"`. A destroyed transport can never reconnect — create a fresh one. |
| `subscribe(listener)` | Registers a change listener; returns the unsubscribe function. Shaped for `useSyncExternalStore`. |
| `getState()` | Returns the cached `{ status, openCount }` snapshot — reference-stable between transitions. |

The status state machine: `idle → connecting → open ⇄ reconnecting → closed` (with
`connecting → reconnecting` on handshake failure/timeout, and `closed` reachable from anywhere
via `destroy()`). `openCount` increments on every (re)open — it's how subscribers detect a
reconnect happened (e.g. to trigger an order-book resync).

Options (`WsTransportOptions`):

| Option | Default | Purpose |
|---|---|---|
| `url` | — | The `wss://` endpoint — per-env from runtime config (`vars.WS_URL`), **never** `VITE_*`. |
| `onMessage(data)` | — | Raw frame passthrough. The transport is protocol-agnostic — parsing/validation is the sync layer's job. |
| `onOpen()` | — | Fires on every (re)open, after subscribers are notified. |
| `baseDelayMs` / `maxDelayMs` | 1 000 / 30 000 | Backoff window bounds. |
| `connectTimeoutMs` | 10 000 | How long a handshake may sit in `connecting` before it's abandoned and retried. |
| `staleThresholdMs` | **unset = off** | Opt-in staleness watchdog: force-reconnect if no message arrives within the threshold. |

Errors (socket `error` events, constructor throws, throwing subscribers) funnel through the
central [`reportError`](error-handling-architecture.md) seam with `source: "ws:transport"`.
`"order-book:sync"` is already reserved in `ReportContext` for part 2.

## Architecture decisions

| Decision | Choice | Why |
|---|---|---|
| Backoff shape | **Full jitter**: `random() * min(cap, base·2^attempts)` | Prevents thundering-herd reconnects after an exchange-side blip; full jitter (vs equal jitter) gives the best contention spread (see the AWS reference below). `2^attempts` overflowing to `Infinity` is harmless — the `min(cap, …)` clamps it. |
| Backoff reset | On the first **message**, not on `open` | A connection that opens and instantly dies (flapping) shouldn't reset the delay ladder; only a *proven-healthy* connection (data flowing) does. |
| Connect timeout | Own timer, default 10 s | The browser's native handshake timeout can take **minutes**; a hung `connecting` socket would otherwise stall the whole ladder. Armed before the `"connecting"` notify so a reentrant `destroy()` can clear it. |
| Staleness watchdog | **Opt-in** (`staleThresholdMs` absent = off) | Stream cadence is the *caller's* knowledge — the transport can't know whether 10 s of silence is death (Binance depth stream) or normal (a quiet feed). One re-arming deadline instead of clear+set per message; measured with `performance.now()` because a wall-clock step would skew the deadline. |
| Store shape | `subscribe`/`getState` with a **cached snapshot** | `useSyncExternalStore` requires reference-stable snapshots between changes; the snapshot object is rebuilt only inside `setStatus`, so status and `openCount` are always coherent and identity-stable. |
| `destroy()` is terminal | Single-use instances; generation guards | Every handler checks `socket !== ws` — after `destroy()`/`forceReconnect` null `ws`, late events from a superseded socket are dead on arrival. Terminal destroy keeps the generation model trivially correct (no "revive" edge cases). |
| Reconnect scheduling | On `close` **only**; `error` just reports | Per the WHATWG spec, `error` is always followed by `close` (see [nuances](#verified-specbrowser-nuances)) — scheduling on both would double-schedule. A dedicated test locks in exactly-one-reconnect when both fire. |
| Timer-vs-notify ordering | Every timer is armed **before** its `setStatus` notify | Subscribers are notified synchronously and may call `destroy()` reentrantly; arming first means destroy's `clearTimeout`s always see the timer. Tested for all three timers. |
| Protocol knowledge | **None** | Binance specifics (depth-update schema, snapshot resync, `lastUpdateId` sequencing) live in the part-2 sync layer. This module is copy-paste reusable for any stream. |

## Consumer contract

The non-negotiables for the sync layer (part 2) and any future consumer:

- **A transport instance is single-use.** `destroy()` is terminal, and `connect()` silently
  no-ops from `"closed"`. Under React **StrictMode** (dev), effects run mount → cleanup →
  mount — so a transport created in `useMemo`, a `useState` initializer, or module scope is
  destroyed by the first cleanup and the remount's `connect()` does nothing: a **permanently
  dead connection with zero diagnostics**. The only safe pattern:

  ```tsx
  useEffect(() => {
    const transport = createWsTransport(opts)
    transport.connect()
    return () => transport.destroy()
  }, [/* opts identity */])
  ```

- **The watchdog is opt-in — the sync layer must arm it** (`staleThresholdMs: 10_000` for the
  Binance depth stream); without it, a black-holed socket (open but silent) is only caught by
  TCP's own timeouts, i.e. minutes.
- **`openCount` is the resync signal** — key the snapshot-refetch on it changing (or `onOpen`).
- **The endpoint is runtime config** (`vars.WS_URL` → `getConfig()`), never `VITE_*` — see the
  [runtime-config rule](../CLAUDE.md#architecture).

## Verified spec/browser nuances

Each of these is verified against primary sources — they are load-bearing for why the code is
shaped the way it is:

- **`close` fires at most once per socket.** Not literal spec prose, but structural: the spec
  fires `close` only inside the single terminal transition to `readyState CLOSED`, which has no
  exit path. This is why the (deliberately thin) close handler is safe without nulling `ws` —
  see [accepted gaps](#known-accepted-gaps).
- **No-arg `close()` can't throw, even during `CONNECTING`.** The spec's `close()` throws only
  for an out-of-range code or a >123-byte reason; this code passes neither. Closing a
  handshake-stage socket "fails the WebSocket connection" → an eventual `close` event, which
  the generation guard ignores.
- **`error` is always followed by `close`.** The spec emits `error` only inside the
  fail-the-connection task that also fires `close`. That's why reconnects are scheduled on
  `close` alone — error-without-close is unreachable.
- **The constructor throws `SyntaxError` synchronously — and deterministically — for a bad
  URL** (parse failure, non-`ws(s)` scheme, fragment, malformed subprotocols). Insecure-context
  / mixed-content blocking is *not* a throw — it fails via `error`+`close`. (The code comment's
  "mid page-unload" example is spec-inaccurate; the realistic trigger is a misconfigured URL.)
  Consequence, accepted deliberately: a permanently invalid URL retries forever at the 30 s cap,
  reporting each attempt — loud and visible, and the URL is a config constant, so a give-up
  counter wasn't worth the state.
- **Background-tab throttling is safe.** Browsers clamp timers (≥1 min) in throttled tabs, but
  **message events are not throttled** — so `lastMessageAt` stays fresh on a healthy socket and
  a late-firing watchdog just re-arms. Throttling can only *delay* stale/timeout detection,
  never false-close a healthy socket or storm reconnects (timers never fire early).

## Testing

`src/lib/connection/ws-transport.test.ts` — the harness decisions and their gotchas:

- **Hand-rolled `FakeWebSocket`**, not MSW: the transport needs precise control over event
  *timing and ordering* (late events from superseded sockets, error-then-close, close during
  connecting), which a network-level mock can't stage. Its `close()` deliberately **emits
  nothing** — tests fire `simulateClose()` where the browser would, making the async close
  explicit. (MSW stays on the [Vitest roadmap](vitest-setup.md#8-deferred--future) for
  HTTP/API mocking.)
- **`vi.useFakeTimers()` fakes `performance.now()`** on the pinned Vitest 4.1.9 + jsdom — the
  watchdog tests depend on it advancing in lockstep with `vi.advanceTimersByTime()`. This was
  **verified in the installed bundle**, not the docs (which were historically wrong — vitest
  issues #9351/#9352): the default `toFake` is "everything except `nextTick`/`queueMicrotask`",
  and `performance` registers only because jsdom provides it. Treat it as **version- and
  environment-fragile** — a Vitest bump or a non-jsdom environment can silently break the stale
  tests; if they hang or false-pass after a bump, check this first.
- **Never `vi.runAllTimers()` while an unopened socket exists.** With the default connect
  timeout, an unopened socket is an endless timeout → reconnect → timeout timer chain —
  `runAllTimers` never terminates. Use bounded `advanceTimersByTime` instead.
- **`Math.random()` is mocked to 0.5**, making the jittered delays exact (500, 1000, 2000, …
  15 000 capped) so backoff-growth assertions are deterministic.
- **Every transport is tracked and destroyed in `afterEach`** — a leaked live transport keeps
  timers running into the next test.

## Known accepted gaps

No reachable defect is known in a spec-conformant browser; these hardening items are
**deliberately declined**, not overlooked. Recorded so a future pass (or a copy into another
project) picks them up knowingly:

| Gap | Current safety rests on | Hardening that would close it |
|---|---|---|
| The `close` handler doesn't null `ws` — a duplicate `close` from one socket would double-schedule reconnects | The spec's single-`CLOSED`-transition guarantee (close fires once) | Null `ws` in the close handler, matching `forceReconnect`/`destroy`; add a duplicate-close regression test |
| `forceReconnect` has no `status === "closed"` bail — it unconditionally resurrects | Timer-clearing discipline: `destroy()` clears all three timers, so nothing can invoke it post-destroy | An early-return guard as a second line of defense against a future forgotten `clearTimeout` |
| Test gap: server-initiated `close` of a watchdog-armed socket never exercised (the `clearTimeout(staleTimer)` in the close handler is unverified) | The code does clear it | A test: open with `staleThresholdMs`, `simulateClose()`, advance past the threshold, assert no force-close of the next generation |
| Test gap: the duplicate-reconnect defense for a superseded socket's late `close` (the "abandons a handshake" test's assertion window closes too early to catch a doubled schedule) | `socket !== ws` guard + `ws = null` in `forceReconnect` | Extend that test: advance well past the second backoff delay and assert no extra socket |
| Test gap: the `socket !== ws` half of the **message** guard (only the `status` half is exercised) | The guard exists | A test delivering a message from an old socket while a new one is `open` |

## Reuse recipe (for the next project)

This module is designed to be lifted wholesale:

1. Copy `src/lib/connection/ws-transport.ts` + `ws-transport.test.ts`.
2. Satisfy its **single dependency**: the `reportError(error, { source })` seam
   (`@/lib/report-error.ts`). Either bring the seam (recommended — see
   [`error-handling-architecture.md`](error-handling-architecture.md)) or stub it with
   `console.error`.
3. Test harness prerequisites: Vitest + jsdom + fake timers per
   [`docs/vitest-setup.md`](vitest-setup.md) — and re-verify the `performance.now()` faking
   note above if the Vitest version differs.
4. Wire the consumer per the [contract](#consumer-contract): create-inside-effect, terminal
   destroy, opt-in watchdog, endpoint from runtime config.

The transport is the **client** leg regardless of backend topology — it stays as-is even if a
server-side WebSocket fan-out (the Durable Objects idea in [`cd-setup.md`](cd-setup.md)) lands
later; only the `url` it's pointed at changes.

## Roadmap

### Part 2 — order-book sync layer
The protocol brain: maintain the book from Binance depth diffs (`lastUpdateId` sequencing),
refetch the snapshot on every reconnect (keyed on `openCount`), and own the frame-validation /
failure-decision half of error-handling's
[WS-layer hardening](error-handling-architecture.md#ws-layer-hardening) — plus the one option
only this layer can take, `destroy()`+recreate the transport. Arms the watchdog per the
[consumer contract](#consumer-contract).

### Part 3 — rendering layer
The order-book UI (grid + depth visualization) consuming the sync layer's store.

### Per-env endpoint → CSP into the Worker
When `vars.WS_URL` gets real per-env values, the per-env CSP `connect-src` work unblocks —
mechanics (including the `:9443` variant gotcha) in
[`security-headers-setup.md`](security-headers-setup.md).

## References

- [WHATWG WebSocket spec](https://websockets.spec.whatwg.org/) — close/error event tasks,
  `close()` algorithm, constructor throw conditions
- [AWS Architecture Blog — Exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [Vitest — fake timers config](https://vitest.dev/config/#faketimers) + issues
  [#9351](https://github.com/vitest-dev/vitest/issues/9351) /
  [#9352](https://github.com/vitest-dev/vitest/issues/9352) (the `performance.now()` faking
  history)
- [React — `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore)
