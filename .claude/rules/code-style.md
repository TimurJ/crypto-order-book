# Code style

## Comments

- Write **new** code with zero comments — no header blocks, no rationale notes, no inline explanations —
  unless comments are explicitly requested. Put design rationale in the conversation, the plan file, or
  `docs/`.
- **Never strip pre-existing comments** from files the user authored unless told to. Large parts of this
  repo are deliberately commented — `src/lib/order-book/orderBookSync.ts`, `worker/index.ts`,
  `src/main.tsx` — and that prose is intentional, not clutter.
- When comments *are* requested, the split is by **audience**, not preference:
  - **JSDoc (`/** */`) only on named things used elsewhere** — functions, types, exported consts, public
    methods. It binds to the symbol below it and drives editor hover at call sites, so it documents the
    *contract*.
  - **`//` for anything inside a function body** — step explanations, landmines, "why this and not the
    obvious thing". JSDoc mid-body binds to nothing.
  - Failure modes: a bare `//` above an exported symbol throws away the free hover hint; JSDoc floating
    mid-body attaches to nothing.

## Feature folders

- **Every feature exposes exactly one `index.ts`, from its first file** — consumers import the feature
  as a directory (`@/features/health`) and never reach past it. From day one, because a barrel added
  later is itself the cross-repo edit the barrel exists to prevent. Biome enforces the *outside* half:
  `noRestrictedImports` bans the specifier pattern `**/features/*/**`, so `@/features/order-book` is
  fine and `@/features/order-book/ui/OrderBook.tsx` is an error. The *inside* half is on you — files
  import each other relatively, and a barrel self-import lints clean (it is the same specifier), which
  is how the cycle starts.
- A feature starts **flat** and splits into segments once the flat listing stops sorting itself at a
  glance — a handful of files across two kinds still does; twenty-plus across three does not.
  `src/features/health/` (4 files) is correctly flat; `src/features/order-book/` reached 22 (14 source
  + 8 co-located tests) across three kinds and was split.
- Once a feature is split, where a file goes, in order: **defines server state or wraps a network client
  and touches no React runtime → `api/`** (`queryOptions` modules, transport adapters); else **renders
  JSX → `ui/`**; else **touches the React runtime** (hooks, context, refs) **→ `model/`**; else **→
  `lib/`**. While a feature is flat these live at its root, as `src/features/health/healthQuery.ts`
  does. The order matters in two places: `ui/` before `model/`, because containers call hooks too
  (`ui/OrderBook.tsx` uses `useId`/`useMemo`/`useState`); and `api/` before `lib/`, because a
  `queryOptions` module is pure and would otherwise fall through to the `else`. The no-React-runtime
  clause is what keeps a React seam over a transport (`model/useOrderBookSync.ts`) out of `api/`.
- A feature's `lib/` holds *that feature's* pure helpers, not `src/lib/`, which holds app-wide engines.
- Worked example and rationale: the *Restructure* section of
  [`docs/order-book-ui-architecture.md`](../../docs/order-book-ui-architecture.md).

## Filenames

- **Component files are `PascalCase`, matching their export** — `ui/OrderBook.tsx`,
  `RootErrorBoundary.tsx`. **Everything else is `camelCase`**: hooks, helpers, engines, schemas, worker
  modules, test utils — `model/useOrderBookSync.ts`, `lib/orderBookFormat.ts`,
  `worker/noStoreResponse.ts`. A test mirrors its subject: `OrderBook.test.tsx`,
  `useLevelFlashes.test.ts`. Biome enforces it — `useFilenamingConvention` pinned to
  `filenameCases: ["camelCase", "PascalCase"]`, which rejects kebab.
- **Directories stay lowercase kebab** — `src/features/order-book/`, `src/lib/order-book/`. Folder paths
  commonly map to URLs, and `noRestrictedImports`' `**/features/*/**` glob keys off them.
- **Vendored `src/components/ui/**` keeps its upstream kebab names**, exempted in `biome.json`'s
  `overrides` alongside `useComponentExportOnlyModules`. `shadcn add` writes *and overwrites* by its own
  filename, so renaming a primitive means the next `add` creates a duplicate instead of updating yours.
  A vendored dependency does not set the convention for the rest of the tree; that exemption is the
  whole reason it doesn't have to.

## Modules & exports

- Prefer **named exports** for components — avoid `export default` for components.
- Importing a **file** uses its explicit extension (`"./App.tsx"`) — except the shadcn-written
  specifiers in vendored `src/components/ui/**`, and the one `@/components/ui/button` import in
  `src/components/RootErrorBoundary.tsx`. A **directory exposing an `index.ts` is imported as the
  directory** (`@/features/health`).
- Outside `src/components/ui/**`, **do not co-locate non-component exports** (hooks, context, `cva`) with
  a component; split them into their own module or `useComponentExportOnlyModules` flags it.

## UI primitives

- Never import `@base-ui/react` directly in app or feature code — because Base UI exists here only as the
  internal dependency of shadcn's vendored components in `src/components/ui/**`, and reaching past shadcn
  to it defeats the point of using shadcn at all. Vendor a primitive with
  `pnpm dlx shadcn@latest add <component>`; if the registry doesn't offer it, hand-build from scratch.
  Do **not** hand-wire Base UI parts as a fallback. Feature code imports from `@/components/ui/*` only.

## SVG / XML

- `--` is illegal anywhere inside an XML comment, and every CSS custom property starts with `--`, so
  writing a token name like `--chart-4` into an SVG comment silently breaks the file: the browser fails to
  parse it and keeps the cached asset, while grep, curl, build, and tests all still pass. Write token
  names without the leading dashes ("the chart-4 token"), and parser-validate after **any** `.svg` edit:
  `python3 -c "import xml.dom.minidom; xml.dom.minidom.parse('path')"`. A content grep proves bytes, not
  parseability.
