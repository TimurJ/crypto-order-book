# Order-book UI — conventions

Rules and rationale for `src/features/order-book/`. This file carries both the cross-file rules and
each file's design rationale — code files keep only one-line landmine comments at the load-bearing
spot. Full decision log: [`docs/order-book-ui-architecture.md`](../../../docs/order-book-ui-architecture.md).

## Layout

- Split into `ui/` + `model/` + `lib/` behind `index.ts`. The general rule — where a file goes, and the
  barrel boundary — is in `.claude/rules/code-style.md`, which loads every session; only the
  feature-specific part is below.
- `lib/` here is this feature's own pure helpers. It is **not** `src/lib/order-book/`, which is the
  part-2 sync engine — near-identical paths, so read the import twice before trusting it.
- `ui/` here is this feature's own components. It is **not** `@/components/ui/**`, the vendored shadcn
  primitives they import — both appear in the same import block in `ui/OrderBookLadder.tsx`.
  `biome.json`'s one `overrides` carve-out names the vendored path only, so `ui/**` here gets no
  exemption from `useComponentExportOnlyModules`.

## Prices and formatting

- **Never `parseFloat().toFixed()` an exchange price.** `toFixed` *rounds*, and a rounded price is a level
  that does not exist in the book. Format through `lib/orderBookFormat.ts` — pure string truncation.
- Truncation is lossless only while `decimals` >= the symbol's tick/step digits, and that guarantee lives in
  the `SymbolDisplay` record (`lib/symbolDisplay.ts`). Adding a symbol means getting its decimals right there.
- `SymbolDisplay` is a **hardcoded record, never parsed from the symbol string** (quote-asset length is a
  heuristic that breaks). It is the exact seam where a Binance `exchangeInfo` lookup slots in when a
  symbol picker arrives (decimals from `PRICE_FILTER` tickSize / `LOT_SIZE` stepSize, live-verified).
- `formatPair` is the one source of the pair label ("BTC/USDT"): the card title and the ladder's
  screen-reader caption both derive from it, so they can never drift apart.
- `groupThousands` composes **after** truncating, never before.
- Floats are for *derived* values only — never a price or a size (see View-model).

## View-model — `lib/orderBookView.ts`

- Pure, no React imports, unit-tested directly: one pass from the engine snapshot to everything the ladder needs.
- Exchange price/qty strings keep exact string identity to the formatter. Derived values — cumulative,
  quote sums, barPct, mid, spread, spreadPct, imbalance — are our own computed quantities, so `Number()`
  double math is honest there. Do not "fix" them into string arithmetic.
- `barPct` scales to the **own side's** max cumulative (both sides reach 100% at their worst level); the
  cross-side signal the old scaling carried lives in `ImbalanceBar` now.
- `hasBook` is the presentation fork, not `status`: false → skeleton; true + non-live → last-known book,
  dimmed. `destroyed` maps to false even though the Maps still hold data.
- Crossed/locked-book guard (bid >= ask): spread, mid and spreadPct go null **together**, rendered as
  "—" — defensive, since a correctly stitched book never crosses.

## Flashes

- Keyed **by price, never by slot.** A rank shift moves every row below an insert, and that must not light
  the ladder — only a changed quantity, or a price newly entering the window, flashes.
- Fire only on a continuous `live → live` commit; every other transition re-baselines silently — a
  self-heal swaps the whole book in one commit, and diffing that swap would light the entire ladder at
  once. The test is **status**, not a level-count heuristic: a gap commits a changed partial book while
  still `syncing`.
- Two layers: `useLevelFlashes` diffs the window per render into a map of changed prices → direction;
  `useRowFlash` folds membership into a slot-local monotonic key, latching direction at bump time so a
  parked overlay keeps its color. The overlay is keyed by that number — a bump remounts it and restarts
  its CSS fade (**no timers**); a pure rank shift leaves every key untouched.
- Do not key the flash overlay `${price}:${seq}` — an already-flashed price changing slots would remount and
  spuriously replay. The slot-local monotonic key exists precisely to prevent that.
- Direction: green when size grew, red when it shrank; new-to-window counts as "up"; compared numerically
  (`"1.0"` → `"1.00"` is no change). Departed prices drop out, so the map never outgrows the window.
- Both flash hooks must stay **render-pure**: next state derives from a ref committed in an effect, so
  StrictMode's double render computes the same result twice instead of double-bumping.

## Mid direction — `model/useMidDirection.ts`

- The view-model is pure, so the arrow's cross-commit memory ("which way did mid last move?") lives here.
  An unchanged mid keeps the last direction (no blink-off between moves); a null mid renders directionless
  **and wipes the memory**. Render-pure like the flash hooks.

## Engine lifecycle

- The engine is single-use (`destroy()` is terminal), so it is created **inside** the effect. StrictMode's
  create → destroy → create on mount is expected, not a bug — dev logs show one extra connect/abort pair
  per page load. A dependency change (a future symbol switcher) is the same destroy-and-recreate path.
- `getSnapshot` must return a referentially stable value — the idle snapshot and no-op subscribe are
  module-level constants, never rebuilt per render.
- Subscribe with `useSyncExternalStore`; one render per commit, no rAF coalescing.

## Container — `ui/OrderBook.tsx`

- Split in two so hooks stay unconditional: `OrderBook` guards the runtime config (the test fallback has
  empty URLs — an engine must **never be constructed with garbage**), then renders `ConnectedOrderBook`.
- Staleness: once a book exists, any non-live status keeps it rendered, dimmed. The engine stops
  committing during a resync, so the dimmed book is genuinely frozen — and gap resyncs usually resolve
  sub-second, so blanking to a skeleton would flicker.
- `DEPTH_LIMIT = 1000`: snapshot weight 50 (vs 250 at the engine's 5000 default), 980-level margin over
  the 20 displayed — decision log in the docs chronicle.
- The Card is capped at the viewport and the **ladder is the only scroll region on the page** — user
  decision: 20 levels/side scroll, the page never does.

## Ladder & rows

- One real `<table>`, three `<tbody>` sections — asks (reversed, best ask adjacent to the spread strip),
  the one-row spread strip, bids best-first. Multiple tbodies are valid HTML and read as one table.
- Rows are **slots** (rank 0..N-1): slot k always shows its side's k-th best level — levels flow through
  slots, rows never reorder; the ask reversal is a constant flip, so keys never reorder either. The flash
  keying rule stands on this invariant.
- The sticky header's hairline is an **inset box-shadow, not a border**: Tailwind preflight collapses
  table borders, and a collapsed border does not travel with a sticky cell. Likewise the vendored Table's
  `overflow-x-auto` wrapper is overridden — an intermediate scroll container breaks the sticky chain.
- The spread row centers **exactly once** per `hasBook` false→true edge — never on streaming commits, so
  free scrolling is never hijacked. Measured via `getBoundingClientRect` deltas, because a `tr`'s
  `offsetParent` is the table, not the scroll container.
- `SkeletonRow` is `DepthRow`'s geometry twin (shared `CELL`): no first-sync layout jump, and the
  centering measurement stays valid. Changing one row's geometry means changing both.
- `DepthRow`: both decorative layers live in the **last** cell — `table-fixed` makes each column a third,
  so a 300%-wide layer spans exactly the whole row, growing leftward. Text sits in `z-10` spans so layers
  never paint over it; layers are `aria-hidden` (their values are already row text).
- The hover tooltip **portals out**: the Card is `overflow-hidden` and the ladder scrolls, so an in-flow
  popup would clip (the prototype's `overflow: visible` hack was deliberately not ported). Its four
  values are derived floats (`toFixed` honest). Rows are otherwise non-interactive — row selection was
  dropped by user decision.
- `ViewToggle`: Base UI models single-select as a one-element value array, and an **empty array means the
  pressed item was re-clicked** — swallow it, so exactly one view is always active.
- `ImbalanceBar` is the explicit home of the imbalance signal (see `barPct`); renders nothing while
  imbalance is null.
- `LiveIndicator` remaps the design's Live/Paused dot onto the engine's real statuses — "paused" doesn't
  exist against live market data. Visual-only: it never carries `aria-live` (see Announcements).

## Announcements

- **No `aria-live` on streaming data.** Two tiers, never both at once: the polite `role="status"` region
  announces **availability** ("Order book live" on first sync and on recovery from degraded); the
  assertive Alert announces the **problem** (`model/useStatusAnnouncement.ts`).
- Routine sub-second gap resyncs (`live → syncing → live`) stay silent, so a healthy stream never spams
  the reader. On the degraded edge only the Alert speaks (the hook returns `""`); on recovery only the
  polite region speaks (the Alert unmounts silently).
- `degradedSinceLive` survives an intervening `syncing`, so `degraded → syncing → live` still announces.
  The hook is render-pure like the flash hooks.

## Tests

- Inject the fake engine through the `createSync` default-parameter seam
  (`src/test/fakeOrderBookSync.ts`) — **never `vi.mock`**.
- Drive state with `commit()`; listeners fire synchronously, so no fake timers are needed.
- Keep `createSync` referentially stable across renders. It sits in the effect's dependency array, so a
  fresh identity re-creates the engine on every render.

## Rendering approach

- The ladder is **manual by decision** — AG Grid was evaluated and reserved for a future blotter, because a
  ladder is not a grid. Do not reach for a grid library here.
- **Long-lived dev tabs leak renderer memory to gigabytes** — React 19.2 dev-only performance tracks ×
  this app's ~10 commits/sec; known upstream, invisible to the JS heap, prod unaffected. Hard-refresh;
  do not re-diagnose: [`docs/react-dev-memory-leak.md`](../../../docs/react-dev-memory-leak.md).
