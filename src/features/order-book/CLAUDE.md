# Order-book UI — conventions

Rules for `src/features/order-book/`. Each file's own header comment covers its internals; what's collected
here is the **cross-file** part — rules documented in one file that bind when you edit another. Full
decision log: [`docs/order-book-ui-architecture.md`](../../../docs/order-book-ui-architecture.md).

## Layout

- Split into `ui/` + `model/` + `lib/` behind `index.ts`. The general rule — where a file goes, and the
  barrel boundary — is in `.claude/rules/code-style.md`, which loads every session; only the
  feature-specific part is below.
- `lib/` here is this feature's own pure helpers. It is **not** `src/lib/order-book/`, which is the
  part-2 sync engine — near-identical paths, so read the import twice before trusting it.
- `ui/` here is this feature's own components. It is **not** `@/components/ui/**`, the vendored shadcn
  primitives they import — both appear in the same import block in `ui/order-book-ladder.tsx`.
  `biome.json`'s one `overrides` carve-out names the vendored path only, so `ui/**` here gets no
  exemption from `useComponentExportOnlyModules`.

## Prices and formatting

- **Never `parseFloat().toFixed()` an exchange price.** `toFixed` *rounds*, and a rounded price is a level
  that does not exist in the book. Format through `lib/order-book-format.ts` — pure string truncation.
- Truncation is lossless only while `decimals` >= the symbol's tick/step digits, and that guarantee lives in
  the `SymbolDisplay` record (`lib/symbol-display.ts`). Adding a symbol means getting its decimals right there.
- `groupThousands` composes **after** truncating, never before.
- Floats are for *derived* values only — mid, spreadPct, imbalance. Never a price or a size.

## Flashes

- Keyed **by price, never by slot.** A rank shift moves every row below an insert, and that must not light
  the ladder — only a changed quantity, or a price newly entering the window, flashes.
- Fire only on a continuous `live → live` commit; every other transition re-baselines silently. The test is
  **status**, not a level-count heuristic: a gap commits a changed partial book while still `syncing`.
- Do not key the flash overlay `${price}:${seq}` — an already-flashed price changing slots would remount and
  spuriously replay. The slot-local monotonic key exists precisely to prevent that.
- Both flash hooks must stay **render-pure**: next state derives from a ref committed in an effect, so
  StrictMode's double render computes the same result twice instead of double-bumping.

## Engine lifecycle

- The engine is single-use (`destroy()` is terminal), so it is created **inside** the effect. StrictMode's
  create → destroy → create on mount is expected, not a bug.
- `getSnapshot` must return a referentially stable value — the idle snapshot and no-op subscribe are
  module-level constants, never rebuilt per render.
- Subscribe with `useSyncExternalStore`; one render per commit, no rAF coalescing.

## Tests

- Inject the fake engine through the `createSync` default-parameter seam
  (`src/test/fake-order-book-sync.ts`) — **never `vi.mock`**.
- Drive state with `commit()`; listeners fire synchronously, so no fake timers are needed.
- Keep `createSync` referentially stable across renders. It sits in the effect's dependency array, so a
  fresh identity re-creates the engine on every render.

## Semantics

- A real `<table>`, and **no `aria-live` on streaming data**.
- Two tiers, never both at once: the polite region announces availability, the assertive Alert announces
  problems (`model/use-status-announcement.ts`).

## Rendering approach

- The ladder is **manual by decision** — AG Grid was evaluated and reserved for a future blotter, because a
  ladder is not a grid. Do not reach for a grid library here.
