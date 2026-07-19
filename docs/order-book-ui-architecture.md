# Order-book UI — architecture & decision chronicle (part 3 of 3)

Part 3 of the connection stack: the rendering layer over the part-2 sync engine
([`order-book-sync-architecture.md`](order-book-sync-architecture.md)) and the part-1
transport ([`ws-transport-architecture.md`](ws-transport-architecture.md)). A manually
rendered, slot-keyed ladder in `src/features/order-book/` — live book, depth bars,
level-change flashes, full status/degradation UX. Every decision below was debated and
explicitly signed off before implementation; the amendments found during implementation
are recorded at the end.

> Status: **live**. The app shell (`src/App.tsx`) renders the widget as the page; the
> part-2 console demo (`order-book-demo.ts`) is retired. Prod renders the live book —
> the old prod gate on the demo was about console noise for real users (like shipping
> no source maps), never about the Binance connection itself.

## The AG Grid debate (why manual)

AG Grid was seriously considered — it is the finance-industry grid, and its
`getRowId`/`applyTransactionAsync`/cell-flash pipeline is precisely a trading pitch.
Rejected for the *ladder* because a ladder is not a grid:

- A fixed ~20-slot window has no scrolling, sorting, filtering, selection, or editing —
  everything a data-grid engine charges its bundle (~300 kB+ community, minified) for
  goes unused.
- Row identity is the wrong model: in a ladder the stable entity is the **visual slot**
  (rank), not the price level. AG Grid's whole update model is built on row ids, which
  actively fights slot-keyed rendering.
- The mirrored two-sided layout needs either two synced grid instances or row data
  zipped by index — which destroys the row-id model and concedes the point.
- ~10 renders/sec of 40 rows needs no engine; plain React idles through it.

**Reserved, not rejected**: a future trades blotter / order history (scrollable,
sortable, thousands of rows) *is* a grid use case — AG Grid lands there, coexisting
with the manual ladder. The `style-src 'unsafe-inline'` rationale in
[`security-headers-setup.md`](security-headers-setup.md) already accounts for it.

## Decision log (all signed off)

### 1. Engine lifecycle — hook-owned
`useOrderBookSync` creates the engine inside a `useEffect` (deps: symbol/urls/limit/
factory), calls `start()`, destroys in cleanup. StrictMode's dev double-mount runs
create №1 → destroy №1 → create №2 — exactly the single-use engine's documented
restart contract, costing one transient connect/abort pair in dev logs (expected, not
a bug). A future symbol switcher is free: dependency change = destroy-and-recreate.
Module-scope ownership (like the demo used) was rejected: symbol frozen at boot,
socket runs with no consumer, teaches nothing reusable.

### 2. Subscription — direct `useSyncExternalStore`, selectors downstream
The engine's snapshot is rebuilt per commit and referentially stable between commits —
already the `getSnapshot` contract, so the hook wires `subscribe`/`getState` straight
in (module-level stable idle-snapshot + noop-subscribe constants cover pre-mount).
`selectOrderBookView(snapshot, levelCount)` (`order-book-view.ts`) is a pure function
memoized on snapshot identity: sorted top-N via the engine's `selectTopLevels`,
cumulative sums, bar percentages, spread, `hasBook`.

**`depthLimit: 1000` passed by the UI** (engine default untouched): REST depth weight
is tiered (1–100→5, 101–500→25, 501–1000→50, 1001–5000→250 — verified against the
spec), so 1000 costs weight 50 vs the default's 250 on an endpoint the engine refetches
on every resync and retries forever. Correctness margin: a diff-maintained book can
render a hole only if a never-touched level outside the snapshot window rises into the
displayed top-20 — with a 1000-level seed that needs ~980 removals above it while it
stays untouched; unreachable on a liquid market, and any resync heals it.

**Escape hatch (recorded, not built)**: `selectTopLevels` is O(n log n) per side per
commit (~1–2k entries at limit 1000, sub-millisecond). If profiling ever objects, the
path is O(n) top-k selection — do not pre-build cleverness into the read path.

### 3. Render cadence — one render per commit, no rAF coalescing
The engine hardcodes `@depth@100ms`; Binance batches diffs server-side, so one frame →
one commit → one render, ~10/sec. Coalescing is for commits outpacing frames; building
it would ship untested scheduling code for a problem the stream contract prevents.
**Escape hatch**: the store shape makes a coalescer a ~20-line wrapper store between
engine and hook — zero component changes. Also deliberate: direct wiring keeps
rendering in background tabs (WS delivery isn't throttled like timers), so tab-return
shows a current book; rAF coalescing would silently freeze hidden tabs.

### 4. Decomposition & the test seam — DI by default parameter
`use-order-book-sync.ts` (lifecycle + store read) / `order-book-view.ts` (pure
view-model) / `order-book.tsx` (container: config guard, status chrome) /
`order-book-ladder.tsx` (presentational, props-only). The hook's `createSync` option
defaults to the real `createOrderBookSync`; the container forwards it as an optional
prop. Tests inject `src/test/fake-order-book-sync.ts` — a controllable, synchronous
implementation of the four-method `OrderBookSync` interface. No module mocking
anywhere; the engine's own suite covers continuity math, the UI suites never re-test it.

### 5. Layout — side-by-side mirrored, 20 levels, no symbol parsing
Row *i* = *i*-th best level per side (slot = rank — maps 1:1 onto slot-keyed
rendering); columns `Amount | Bid ‖ Ask | Amount`, prices hugging the center gutter,
spread strip above; half the height of a stacked ladder and survives phone widths
without a layout switch. `LEVEL_COUNT = 20` (a prop end-to-end, so a density toggle is
free). Base/quote/decimals come from a `SymbolDisplay` record (`symbol-display.ts`) —
**never** derived by splitting the symbol string (breaks the first time a quote isn't
4 chars); the record is exactly what an `exchangeInfo` lookup populates when a symbol
picker arrives (verified: tickSize 0.01 → 2 price decimals, stepSize 0.00001 → 5 qty
decimals).

### 6. Depth bars — cumulative, cross-side scale, center-out
Bar = running sum best→level (the cost-to-walk-the-book number; per-level qty is
already row text). Denominator = max of both sides' visible totals — per-side scaling
would stretch both sides to full width and erase the imbalance signal, the one thing
mirrored bars uniquely show. Bars anchor at the gutter and grow outward with a 100ms
linear width transition (matches stream cadence). Implementation trick: `table-fixed`
makes each column exactly 25%, so a layer at `width: 2×barPct%` of the price cell spans
exactly the row's half; text sits in a `z-10` span so overflowing layers can't paint
over it. **Not** shadcn Progress — the bars are decorative `aria-hidden` layers, not
progressbars.

Tokens `--bid`/`--ask` (`index.css`, `:root` + `.dark`, mapped in `@theme inline`):
validated with the dataviz palette validator, not eyeballed. Light `oklch(0.513 0.110
163.6)` / `oklch(0.509 0.209 28.5)` — deutan ΔE 8.7 (above the ≥8 target), text
contrast 5.4:1 / 6.4:1 on white. Dark `oklch(0.769 0.169 161.9)` / `oklch(0.702 0.189
22.2)` — deutan ΔE 6.9 (legal floor band: the encoding is redundant — side position and
labels carry identity), contrast 9.0:1 / 6.0:1 on the dark card. The green leans
emerald (hue ~162°) deliberately: deutan vision keeps the blue–yellow axis, so a cooler
green buys red/green separation a pure green can't have at equal lightness.

### 7. Level-change flashes — diff by price, never by slot
A level flashes when its price's quantity changed or the price newly entered the
window; a pure rank shift (every row below an insertion moves a slot) must not light
the ladder. Flash = side-color pulse, 300ms fade (`--animate-book-flash`), no up/down
color axis (it would put green pulses in the red column and reintroduce hue-only
encoding). Top-of-book rows flashing nearly every tick is correct — the shimmer is the
activity signal. **Flashes fire only on a continuous `live → live` commit** (hardened
post-review — see Post-review hardening): the first sync, every resync/reconnect,
`degraded`, and the edge back into `live` re-baseline silently, because a self-heal
swaps the whole book in one commit and diffing that against the pre-resync book would
light the entire ladder at once — noise that misrepresents what actually moved.

**Mechanism (amended during implementation — see Amendments)**: `useLevelFlashes`
diffs the window per render (recording a silent baseline whenever the commit isn't a
`live → live` streaming update) and emits the set of freshly changed prices; a per-slot
`useFlashKey` folds membership into a slot-local monotonic key; the overlay mounts
keyed by that number (base `opacity-0`, animation fills forwards, so it parks
invisibly after playing). Both hooks derive during render from a ref committed in an
effect — StrictMode's double render computes identical results instead of
double-bumping.

### 8. Formatting — lossless string truncation; floats only for derived values
`formatDecimalString` (`order-book-format.ts`): find the dot, truncate or zero-pad —
never `parseFloat().toFixed()`, which ROUNDS, and a rounded price is a level that
doesn't exist. Lossless by construction while display decimals ≥ tick/step digits
(the `SymbolDisplay` record guarantees it). Derived values (spread, bar %, cumulative)
are `Number()` math + `toFixed` — display-only, our own quantities, precision far
beyond what's shown; the view-model comment marks the line so nobody "fixes" it in
either direction. The spread is additionally floored: a non-positive value (a
momentarily crossed or locked book — bid ≥ ask) collapses to `null` and renders as
"—" alongside the empty-side case, so a trader never sees a negative or `0.00` spread
(defensive; a correctly-stitched book never crosses — see Post-review hardening). Two
columns per side — the bar IS the total column (the view-model already computes
cumulative, so adding a Total column later is pure markup). Numeric cells are
`font-mono` (uniform digit widths kill the last jitter source).

### 9. Status & degradation UX — `hasBook` forks the presentation
`hasBook = lastUpdateId > 0 && status !== "destroyed"`. No book → skeleton ladder
(20 placeholder slots at real geometry — first sync populates with zero layout shift;
`aria-busy`). Book + non-live status → **last-known book, dimmed to 60%**, never
blanked: gap resyncs usually resolve sub-second and the engine's commit-freeze means
the dimmed book is genuinely static; honesty comes from the explicit signal, not data
destruction. Status pill (shadcn Badge in the Card header action, **visual-only** — a11y
announcements are decision 10): verbatim status text; live → bid token, degraded →
destructive variant, else secondary — no invented amber token. `degraded` adds an Alert
with state-appropriate wording (pre-book vs stale-book). `destroyed` renders like pre-book idle and is pinned by a test (it only
follows unmount in practice). `resyncs N · dropped N` render in the **Card footer**
(mono, muted — the operator register), not App's global footer: the engine state lives
in the container (recorded amendment to the original placement). No per-widget error
boundary this pass: App is essentially one widget, so the root boundary already has
widget granularity; the blotter is the trigger to add one.

### 10. Semantics & a11y — a real table, silence on data, voice on state
One real `<table>` (shadcn Table = styled native elements), four `<th scope="col">`
with units, sr-only caption naming the table. **No `aria-live` anywhere near the
ladder** — a 10Hz live region would narrate forty numbers a second; streaming data
belongs in a navigable table read on demand. Announcements use **two live-region tiers
that never fire for the same event** (hardened post-review — see Post-review hardening):
a polite sr-only `role="status"` region announces AVAILABILITY only ("Order book live"
on the first sync and on recovery from `degraded`; routine gap resyncs stay silent, so
a healthy stream never spams the reader), and the degraded Alert's native `role="alert"`
(assertive) announces the PROBLEM. On the degraded edge only the Alert speaks; on
recovery only the polite region does. The status **Badge itself is visual-only** — it
shows every status word for sighted users but carries no live-region role, so it can't
narrate transient churn. Bars, flash overlays, and skeleton shimmer are `aria-hidden`;
nothing is interactive, so no tabindex. All motion (flash, bar glide, shimmer, dim
transition) is disabled via `motion-reduce:` utility variants in markup — one mechanism
for custom and Tailwind animations alike (a global media block can't reach utility
classes).

### 11. Testing — each layer at its own altitude
View-model and formatter: pure unit tests (sort directions, short sides, empty book,
lopsided cross-side scale, truncate-not-round boundary, `hasBook`/`destroyed`
mapping). Flash: pure diff tests + `renderHook` for both hooks, including explicit
`<StrictMode>` no-double-bump tests. Engine hook: `renderHook` + fake — mount/start,
commit propagation, unmount destroy, symbol-change recreate, and a `<StrictMode>`
test pinning the double-mount contract (two creates, first destroyed). Ladder: RTL by
roles (table name via caption, header units, exact mirrored row order, decorative
layers hidden, skeleton variant). Container: fake injected — every status branch
including degraded-before-first-sync, stale-dim keeps rows rendered, diagnostics
footer, and the config guard (renders "not configured" AND the factory is never
called). `App.test.tsx` exercises the guard naturally: the jsdom fallback config has
empty URLs, so no mocking, per house posture.

### 12. shadcn usage — organic fits only
`Table`, `Badge` (pill), `Skeleton`, `Card` (frame), `Alert` (degraded) — vendored via
the CLI; Table/Skeleton/Card/Alert are pure markup, Badge uses `useRender` from the
already-present `@base-ui/react`; zero new runtime dependencies. Deliberate non-fits:
`Progress` for depth bars (progressbar semantics on a decorative layer) and anything
for the flash overlays (pure CSS). Cells extend the vendored Table with `relative`
positioning — that's the vendored-code model working as intended.

## Failure-mode → UI matrix

| Engine state | UI |
|---|---|
| `idle`/`connecting`/`syncing`, never synced | skeleton ladder + status badge, `aria-busy`; polite region silent |
| `degraded`, never synced | skeleton + destructive badge + assertive Alert ("retrying until the book syncs") |
| `live` (first sync) | full ladder, bars, flashes; badge in bid-green; polite region announces "Order book live" |
| `connecting`/`syncing` after a sync | last-known book dimmed 60%, frozen (engine commit-freeze); badge shows status, polite region silent (routine gap) |
| `degraded` after a sync | dimmed book + assertive Alert ("last known state, may be stale"); recovery to `live` announces politely |
| `destroyed` | skeleton presentation (unmount-only in practice; pinned by test) |
| empty config (test/local fallback) | "not configured" card; engine never constructed |
| malformed frames / resyncs | invisible except `resyncs N · dropped N` in the card footer |

## Implementation amendments (found while building, all improving on the plan)

1. **Flash mechanism redesign.** The planned `${price}:${seq}` overlay key had a flaw
   caught during implementation: an already-flashed price merely changing slots
   remounts its overlay (new key under an index-keyed row) and spuriously replays the
   animation — a rank-shift flash, exactly what decision 7 forbids. Fix: fresh-set +
   slot-local flash key (see decision 7). Same semantics, no spurious replays;
   `use-flash-sequences.ts` became `use-level-flashes.ts`.
2. **`noArrayIndexKey` vs slot keys.** Biome errors on `key={index}` inside a map
   callback. The design *is* index-keyed on purpose (slots never reorder), so the
   honest refactor — not a suppression — was to make the slot list the mapped
   collection (`slots.map((slot) => <TableRow key={slot}>)`): the key is now the slot
   identity element, which is also the truthful reading of the design.
3. **Diagnostics placement** (decision 9): card footer, not App's global footer — the
   engine state lives in the container.
4. **Two live regions, later refined post-review** (decision 10): the build shipped a
   polite pill `role="status"` + the Alert's native `role="alert"`. A subsequent code
   review found the pill re-announced transient churn and doubled the degraded
   announcement; the fix keeps two regions but makes the polite one announce availability
   only and the Badge visual-only — see Post-review hardening.
5. **Reduced-motion mechanism**: `motion-reduce:` variants in markup everywhere,
   rather than a media block for custom animations + variants for utilities.

## Post-review hardening (xhigh code review, after the initial build)

An adversarial workflow code review of the shipped layer surfaced six findings; all were
fixed to the "production-ready + documented reference" bar:

- **F1 — flash only on `live → live`.** The flash diff was status-blind, so a resync
  (which swaps the whole book in a single commit) diffed the fresh book against the
  pre-resync baseline and flashed most of the ladder on every self-heal. Fixed by keying
  the diff on status: `silent = !(status === "live" && prevStatus === "live")`. Verified
  against the engine — a gap inside the buffered run commits a *changed* partial book
  while still `syncing`, which the naive "edge into live" rule would have mass-flashed;
  the `live → live`-only rule silences it too.
- **F3 — empty-then-refill flashes.** Dropping the old `size === 0` "first book"
  heuristic (superseded by the status gate) also fixed a latent bug: a side that emptied
  then refilled was wrongly treated as a silent baseline. Matters for thin/halted symbols
  reusing the hook, not BTCUSDT.
- **F2 + F5 — curated announcements** (decision 10). The pill was a polite live region
  carrying the status word, so routine gap resyncs announced "syncing"/"live" (noise) and
  `degraded` was announced twice (polite pill + assertive Alert). `useStatusAnnouncement`
  makes the polite region announce availability only, the Alert own problems, the Badge
  visual-only — keeping the load-complete/recovery announcement (WCAG 4.1.3) that a blunt
  "drop the live region" fix would have lost.
- **F4 — crossed/locked spread guard** (decision 8): a non-positive spread renders "—".
- **F6 — shared `createIdleSnapshot` factory** (`order-book-sync.ts`): the empty-book
  snapshot shape had been hand-built in both the hook and the test fake; one factory now
  sources both (the running engine still builds its own snapshots from live state).

## Reuse recipe (for the next project)

1. Bring parts 1+2 (transport + sync) per their own chronicles; this layer only needs
   the store contract (`subscribe`/`getState`, commit-stable snapshot) and a top-N
   selector.
2. Copy `src/features/order-book/` + `src/test/fake-order-book-sync.ts`; vendor
   `table badge skeleton card alert` via the shadcn CLI.
3. Add `--bid`/`--ask` tokens and the `book-flash` keyframes to the CSS theme —
   re-validate colors against YOUR surfaces with the dataviz validator; don't copy
   blind.
4. Swap `BTCUSDT_DISPLAY` for your symbol record (or wire `exchangeInfo` if you have a
   picker) and mount `<OrderBook/>`.
5. Keep the invariants: engine created only inside the effect; selectors downstream of
   `useSyncExternalStore`; flash state derived in render, committed in effects; string
   truncation for exchange values; no `aria-live` on streaming data.
